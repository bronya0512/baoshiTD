package store

import (
	"baoshiTD/internal/model"
	"sync"
	"time"
)

// Store V3-1 MVP: 内存单例存储（后端重启清空）。
// 升级 SQLite 时，只需替换 AccountStore / SaveStore 的底层实现即可，API 签名保持不变。
var (
	accountsMu sync.RWMutex
	accounts        = make(map[string]*model.Account) // key=username lowercase
	accountIDs      = make(map[uint]*model.Account)
	accountSeq uint = 1

	savesMu sync.RWMutex
	saves   = make(map[uint]*model.GameSaveRecord) // key=account.ID
)

// ==== Accounts ====
func CreateAccount(username, passwordHash string) *model.Account {
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
	accountsMu.RLock()
	defer accountsMu.RUnlock()
	return accounts[username]
}
func AccountByID(id uint) *model.Account {
	accountsMu.RLock()
	defer accountsMu.RUnlock()
	return accountIDs[id]
}

// SetActiveSession 单点登录核心：在登录/注册成功时把 Account 的活跃 jti 更新成新的
// （旧 JWT 在下次通过 AuthRequired 时会因 jti != ActiveSessionJti 被 401 踢掉）
func SetActiveSession(id uint, jti string) {
	accountsMu.Lock()
	defer accountsMu.Unlock()
	a, ok := accountIDs[id]
	if !ok || a == nil {
		return
	}
	a.ActiveSessionJti = jti
	a.ActiveSessionAt = time.Now().UTC()
}

// CheckActiveSession 在 AuthRequired 里调用：核对 JWT 中的 jti 是否等于该账号的当前活跃 jti
// 若账号从未记录 jti（旧版本注册流程遗留），出于兼容视为通过；否则必须严格相等
func CheckActiveSession(id uint, jti string) (ok bool, needKick bool) {
	accountsMu.RLock()
	defer accountsMu.RUnlock()
	a, ok := accountIDs[id]
	if !ok || a == nil {
		return false, false
	}
	if a.ActiveSessionJti == "" {
		// 从未调用过 SetActiveSession 的旧 token / 旧账号：兼容放行
		return true, false
	}
	if jti == a.ActiveSessionJti {
		return true, false
	}
	// jti 不匹配 → 不是当前唯一有效会话：踢下线
	return false, true
}

// ==== Saves (uid => one record) ====
func GetSave(uid uint) *model.GameSaveRecord {
	savesMu.RLock()
	defer savesMu.RUnlock()
	rec, ok := saves[uid]
	if !ok {
		return nil
	}
	// 返回副本，避免调用方修改内部状态
	cp := *rec
	return &cp
}
func SetSave(uid uint, rec *model.GameSaveRecord) {
	savesMu.Lock()
	defer savesMu.Unlock()
	saves[uid] = rec
}

// SetSaveWithCheck 存档乐观锁：只有当前存档的 UpdatedAt 等于 expectUpdatedAt 时才允许写入
// - expectZero: true 表示客户端期望存档不存在（第一次保存），若已有存档返回冲突
// - expectZero: false && expectUpdatedAt.IsZero() => 跳过检查（兼容旧前端/契约测试不带字段）
// 返回 ok=true 写入成功；conflict=true 版本不匹配写失败
func SetSaveWithCheck(uid uint, rec *model.GameSaveRecord, expectUpdatedAt time.Time, expectZero bool) (ok bool, conflict bool, serverUpdatedAt time.Time) {
	savesMu.Lock()
	defer savesMu.Unlock()
	existing, has := saves[uid]
	if expectZero {
		// 客户端期望没存档：有存档则冲突
		if has {
			return false, true, existing.UpdatedAt
		}
		saves[uid] = rec
		return true, false, rec.UpdatedAt
	}
	if expectUpdatedAt.IsZero() {
		// 未提供 ifMatchUpdatedAt：兼容模式（旧前端/测试），直接写不冲突
		saves[uid] = rec
		return true, false, rec.UpdatedAt
	}
	// 有存档 + 提供了 expectUpdatedAt：必须一致
	if !has {
		// 服务器没存档但客户端拿着一个非0 updatedAt 来写 → 客户端读到的存档被清了
		return false, true, time.Time{}
	}
	// 比较：时间戳精度按毫秒一致就视为相同（JS 到 Go round trip 可能损纳秒）
	if !sameMs(existing.UpdatedAt, expectUpdatedAt) {
		return false, true, existing.UpdatedAt
	}
	saves[uid] = rec
	return true, false, rec.UpdatedAt
}

// sameMs 比较两个 time.Time 的 Unix 毫秒值（忽略纳秒与 location 差异）
func sameMs(a, b time.Time) bool {
	return a.UTC().UnixMilli() == b.UTC().UnixMilli()
}
