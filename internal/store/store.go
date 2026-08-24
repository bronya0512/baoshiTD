package store

import (
	"baoshiTD/internal/model"
	"log"
	"strconv"
	"sync"
	"time"
)

// Store：统一存储入口。
//
// 运行时选择实现（由 Init(mysql, redis) 决定，见 store_db.go）：
//   - modeMySQL=true : users/save_records 持久化到 MySQL（SELECT ... FOR UPDATE 乐观锁事务）
//   - modeRedis=true : SSO jti 优先缓存 Redis TTL=7d；SetActiveSession 双写 MySQL+Redis
//   - 否则继续使用原来的内存 map（未配置环境变量 / 连接失败时自动 fallback）
//
// handler/middleware 保持调用 store.*() 包级函数；零侵入。
var (
	accountsMu sync.RWMutex
	accounts        = make(map[string]*model.Account) // key=username lowercase
	accountIDs      = make(map[uint]*model.Account)
	accountSeq uint = 1

	savesMu sync.RWMutex
	// V4-1: saves 按 (uid, mapId, difficulty) 三元分桶；key=复合字符串 "uid|mapId|difficulty"
	saves = make(map[string]*model.GameSaveRecord)
)

// saveKey 构造 save map 的复合 key（内存版）
func saveKey(uid uint, mapId int, difficulty string) string {
	if mapId == 0 {
		mapId = 1
	}
	if difficulty == "" {
		difficulty = "normal"
	}
	return strconv.FormatUint(uint64(uid), 10) + "|" + strconv.Itoa(mapId) + "|" + difficulty
}

// ========== Accounts 路由 ==========

func CreateAccount(username, passwordHash string) *model.Account {
	if modeMySQL {
		a, err := sqlCreateAccount(username, passwordHash)
		if err != nil {
			log.Printf("[store-mysql] CreateAccount(%q) error (fallback disabled): %v", username, err)
			return nil
		}
		return a
	}
	// 内存版
	accountsMu.Lock()
	defer accountsMu.Unlock()
	now := time.Now().UTC()
	a := &model.Account{
		ID:           accountSeq,
		Username:     username,
		PasswordHash: passwordHash,
		CreatedAt:    now,
	}
	accounts[username] = a
	accountIDs[a.ID] = a
	accountSeq++
	return a
}

func AccountByName(username string) *model.Account {
	if modeMySQL {
		a, err := sqlAccountByName(username)
		if err != nil {
			log.Printf("[store-mysql] AccountByName(%q) error: %v", username, err)
			return nil
		}
		return a
	}
	accountsMu.RLock()
	defer accountsMu.RUnlock()
	return accounts[username]
}

func AccountByID(id uint) *model.Account {
	if modeMySQL {
		a, err := sqlAccountByID(id)
		if err != nil {
			log.Printf("[store-mysql] AccountByID(%d) error: %v", id, err)
			return nil
		}
		return a
	}
	accountsMu.RLock()
	defer accountsMu.RUnlock()
	return accountIDs[id]
}

// SetActiveSession 登录成功 / 注册成功 写 SSO jti
// - MySQL: UPDATE users + Redis SET sess:{uid}=jti TTL 7d（双写）
// - 内存: 直接更新内存结构
func SetActiveSession(id uint, jti string) {
	if modeMySQL {
		if err := sqlUpdateActiveSession(id, jti); err != nil {
			log.Printf("[store-mysql] SetActiveSession(%d, %q) error: %v", id, jti, err)
		}
		return
	}
	accountsMu.Lock()
	defer accountsMu.Unlock()
	a, ok := accountIDs[id]
	if !ok || a == nil {
		return
	}
	a.ActiveSessionJti = jti
	a.ActiveSessionAt = time.Now().UTC()
}

// CheckActiveSession 校验 JWT jti 是否是当前唯一有效会话。
// 优先级：Redis(key=sess:{uid}) 命中 → 直接用；不命中 → 回源 MySQL/内存。
// 若账号从未记录过 jti（兼容旧版本）视为通过。
func CheckActiveSession(id uint, jti string) (ok bool, needKick bool) {
	if modeMySQL {
		// 先 Redis （命中即回）
		if modeRedis {
			if j, err := redisGetActiveSession(id); err == nil && j != "" {
				if j == jti {
					return true, false
				}
				return false, true
			}
			// 不命中 / Redis 短暂失败 → 继续 MySQL 回源（正常业务仍可用）
		}
		// MySQL 回源
		a, err := sqlAccountByID(id)
		if err != nil {
			log.Printf("[store-mysql] CheckActiveSession(%d) SQL error: %v", id, err)
			return false, false
		}
		if a == nil {
			return false, false
		}
		if a.ActiveSessionJti == "" {
			// 旧账号兼容：放行
			return true, false
		}
		if jti == a.ActiveSessionJti {
			// 顺便回填 Redis（缓存预热，避免每次 miss 回源 DB）
			if modeRedis && redisHolder != nil {
				_ = func() error {
					key := "sess:" + itoaID(id)
					return redisHolder.Set(ctx1500(), key, a.ActiveSessionJti, 7*24*time.Hour).Err()
				}()
			}
			return true, false
		}
		return false, true
	}
	// 内存版
	accountsMu.RLock()
	defer accountsMu.RUnlock()
	a, ok := accountIDs[id]
	if !ok || a == nil {
		return false, false
	}
	if a.ActiveSessionJti == "" {
		return true, false
	}
	if jti == a.ActiveSessionJti {
		return true, false
	}
	return false, true
}

// ========== Saves 路由 ==========

// GetSave 按 (uid, mapId, difficulty) 取一份存档；mapId=0/difficulty="" 视为默认 (1/normal)
func GetSave(uid uint, mapId int, difficulty string) *model.GameSaveRecord {
	if modeMySQL {
		rec, err := sqlGetSave(uid, mapId, difficulty)
		if err != nil {
			log.Printf("[store-mysql] GetSave(%d,%d,%q) error: %v", uid, mapId, difficulty, err)
			return nil
		}
		if rec == nil {
			return nil
		}
		cp := *rec
		return &cp
	}
	savesMu.RLock()
	defer savesMu.RUnlock()
	rec, ok := saves[saveKey(uid, mapId, difficulty)]
	if !ok {
		return nil
	}
	cp := *rec
	return &cp
}

// SetSave 按三元桶写入
func SetSave(uid uint, rec *model.GameSaveRecord) {
	if rec.MapId == 0 {
		rec.MapId = 1
	}
	if rec.Difficulty == "" {
		rec.Difficulty = "normal"
	}
	if modeMySQL {
		if err := sqlSetSave(uid, rec); err != nil {
			log.Printf("[store-mysql] SetSave(%d,%d,%q) error: %v", uid, rec.MapId, rec.Difficulty, err)
		}
		return
	}
	savesMu.Lock()
	defer savesMu.Unlock()
	saves[saveKey(uid, rec.MapId, rec.Difficulty)] = rec
}

// SetSaveWithCheck 乐观锁版本写入；memory 版语义不变
func SetSaveWithCheck(uid uint, rec *model.GameSaveRecord, expectUpdatedAt time.Time, expectZero bool) (ok bool, conflict bool, serverUpdatedAt time.Time) {
	if rec.MapId == 0 {
		rec.MapId = 1
	}
	if rec.Difficulty == "" {
		rec.Difficulty = "normal"
	}
	if modeMySQL {
		return sqlSetSaveWithCheck(uid, rec, expectUpdatedAt, expectZero)
	}
	// memory 版
	savesMu.Lock()
	defer savesMu.Unlock()
	key := saveKey(uid, rec.MapId, rec.Difficulty)
	existing, has := saves[key]
	if expectZero {
		if has {
			return false, true, existing.UpdatedAt
		}
		saves[key] = rec
		return true, false, rec.UpdatedAt
	}
	if expectUpdatedAt.IsZero() {
		saves[key] = rec
		return true, false, rec.UpdatedAt
	}
	if !has {
		return false, true, time.Time{}
	}
	if !sameMs(existing.UpdatedAt, expectUpdatedAt) {
		return false, true, existing.UpdatedAt
	}
	saves[key] = rec
	return true, false, rec.UpdatedAt
}
