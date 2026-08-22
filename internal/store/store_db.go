package store

import (
	"baoshiTD/internal/db"
	"baoshiTD/internal/model"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// 存储模式：根据 Connect 结果在 runtime 选择实现。
// 保持对外包级函数签名不变（handler/middleware 零改动）。
//
//   - modeMySQL=true   → 账号 & 存档读写优先走 MySQL；失败时绝不 fallback 内存（防跨层状态混乱）
//   - modeMySQL=false  → 继续走原来的内存 map（MVP 未配置 DB 时）
//   - modeRedis=true   → SetActiveSession 双写 Redis + MySQL；CheckActiveSession 优先查 Redis 命中即回
//                         不命中/Redis 失败 → 回源 MySQL/内存
// ---------------------------------------------------------------------------

var (
	storeModeMu sync.RWMutex
	modeMySQL   = false
	modeRedis   = false
	mysqlHolder *db.MySQLHolder
	redisHolder *db.RedisHolder
)

// 工具：1.5s 短 timeout ctx；itoa 拼接（避免 fmt.Sprintf import 成本）
func ctx1500() context.Context {
	ctx, _ := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	return ctx
}
func itoaID(id uint) string { return strconv.FormatUint(uint64(id), 10) }

// Init 由 main 调用：传入连接好的 MySQL / Redis 指针（空表示不启用该层）。
// - 启用 MySQL：modeMySQL=true；handler 层的包级函数全部切到 SQL 实现
// - 启用 Redis：SetActiveSession 双写，CheckActiveSession 先读 Redis（不阻塞 SQL 写入主流程）
func Init(my *db.MySQLHolder, rd *db.RedisHolder) {
	storeModeMu.Lock()
	defer storeModeMu.Unlock()
	mysqlHolder = my
	redisHolder = rd
	modeMySQL = (my != nil)
	modeRedis = (rd != nil)
	log.Printf("[store-init] 存储层初始化: MySQL=%v Redis=%v", modeMySQL, modeRedis)
}

// ===================== MySQL helpers =====================

// jsonMarshalBytes 统一 JSON 序列化：不带 HTML 转义，字符串用于 MySQL JSON 列
func jsonMarshalBytes(v interface{}) ([]byte, error) {
	if v == nil {
		return nil, nil
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	out := buf.Bytes()
	if len(out) > 0 && out[len(out)-1] == '\n' {
		out = out[:len(out)-1]
	}
	if bytes.Equal(out, []byte("null")) {
		return nil, nil
	}
	return out, nil
}

// sameMs 比较毫秒级（UTC UnixMilli）
func sameMs(a, b time.Time) bool {
	return a.UTC().UnixMilli() == b.UTC().UnixMilli()
}

// ===================== Account (SQL 实现) =====================

func sqlCreateAccount(username, passwordHash string) (*model.Account, error) {
	if mysqlHolder == nil {
		return nil, errors.New("mysql holder nil")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	now := time.Now().UTC().Truncate(time.Millisecond)
	res, err := mysqlHolder.ExecContext(ctx,
		"INSERT INTO users(username, password_hash, created_at, active_session_jti, active_session_at) VALUES (?, ?, ?, '', NULL)",
		username, passwordHash, now,
	)
	if err != nil {
		return nil, fmt.Errorf("insert users: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("last insert id: %w", err)
	}
	return &model.Account{
		ID:               uint(id),
		Username:         username,
		PasswordHash:     passwordHash,
		CreatedAt:        now,
		ActiveSessionJti: "",
	}, nil
}

func sqlScanAccount(row *sql.Row) (*model.Account, error) {
	var (
		a            model.Account
		activeSessAt sql.NullTime
	)
	err := row.Scan(&a.ID, &a.Username, &a.PasswordHash, &a.CreatedAt, &a.ActiveSessionJti, &activeSessAt)
	if err != nil {
		return nil, err
	}
	if activeSessAt.Valid {
		a.ActiveSessionAt = activeSessAt.Time
	}
	return &a, nil
}

func sqlAccountByName(username string) (*model.Account, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	row := mysqlHolder.QueryRowContext(ctx,
		"SELECT id, username, password_hash, created_at, active_session_jti, active_session_at "+
			"FROM users WHERE username = ? LIMIT 1", username)
	a, err := sqlScanAccount(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return a, nil
}

func sqlAccountByID(id uint) (*model.Account, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	row := mysqlHolder.QueryRowContext(ctx,
		"SELECT id, username, password_hash, created_at, active_session_jti, active_session_at "+
			"FROM users WHERE id = ? LIMIT 1", id)
	a, err := sqlScanAccount(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return a, err
}

// sqlUpdateActiveSession (SetActiveSession 的 SQL 版) — 同时写 Redis（TTL=JWT默认有效期7天）
func sqlUpdateActiveSession(id uint, jti string) error {
	if mysqlHolder == nil {
		return errors.New("mysql holder nil")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	now := time.Now().UTC().Truncate(time.Millisecond)
	result, err := mysqlHolder.ExecContext(ctx,
		"UPDATE users SET active_session_jti = ?, active_session_at = ? WHERE id = ? LIMIT 1",
		jti, now, id,
	)
	if err != nil {
		return fmt.Errorf("update active_session mysql: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("user id=%d not found", id)
	}
	// Redis 侧双写（不阻塞主流程，失败仅告警；下次读时不命中会回源 MySQL）
	if modeRedis && redisHolder != nil {
		key := fmt.Sprintf("sess:%d", id)
		ttl := 7 * 24 * time.Hour // 对齐 JWT exp
		rc, rcCancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
		defer rcCancel()
		if err := redisHolder.Set(rc, key, jti, ttl).Err(); err != nil {
			log.Printf("[store-redis] WARN SetActiveSession sess:%d failed (non-fatal): %v", id, err)
		}
	}
	return nil
}

// redisGetActiveSession 先查 Redis，nil/miss 返回 ( "", nil ) 上层去 MySQL 回源
func redisGetActiveSession(id uint) (string, error) {
	if !modeRedis || redisHolder == nil {
		return "", nil
	}
	key := fmt.Sprintf("sess:%d", id)
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	v, err := redisHolder.Get(ctx, key).Result()
	if err != nil {
		if err.Error() == "redis: nil" {
			return "", nil
		}
		return "", err
	}
	return v, nil
}

// ===================== Saves (SQL 实现) =====================

func sqlGetSave(uid uint) (*model.GameSaveRecord, error) {
	if mysqlHolder == nil {
		return nil, errors.New("mysql holder nil")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var (
		rec                     model.GameSaveRecord
		tilesJSON, gJSON, bJSON sql.NullString
		savedAt, updatedAt      sql.NullTime
		isAutoInt               int8
	)
	row := mysqlHolder.QueryRowContext(ctx,
		`SELECT version, phase, luck_level, gold, base_hp, base_max_hp, wave_index,
		        tiles, grid, active_buffs, placement_used, placement_total, is_auto, saved_at, updated_at
		 FROM save_records WHERE uid = ? LIMIT 1`, uid)
	err := row.Scan(
		&rec.Version, &rec.Phase, &rec.LuckLevel, &rec.Gold, &rec.BaseHP, &rec.BaseMaxHP, &rec.WaveIndex,
		&tilesJSON, &gJSON, &bJSON, &rec.PlacementUsed, &rec.PlacementTotal, &isAutoInt, &savedAt, &updatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("sqlGetSave scan: %w", err)
	}
	// JSON 列解码
	if tilesJSON.Valid && tilesJSON.String != "" && tilesJSON.String != "null" {
		var ints []int
		if err := json.Unmarshal([]byte(tilesJSON.String), &ints); err == nil {
			rec.Tiles = make([]uint8, 0, len(ints))
			for _, v := range ints {
				rec.Tiles = append(rec.Tiles, uint8(v))
			}
		}
	}
	if gJSON.Valid && gJSON.String != "" && gJSON.String != "null" {
		_ = json.Unmarshal([]byte(gJSON.String), &rec.Grid)
	}
	if bJSON.Valid && bJSON.String != "" && bJSON.String != "null" {
		_ = json.Unmarshal([]byte(bJSON.String), &rec.ActiveBuffs)
	}
	rec.IsAuto = isAutoInt == 1
	if savedAt.Valid {
		rec.SavedAt = savedAt.Time.UTC()
	}
	if updatedAt.Valid {
		rec.UpdatedAt = updatedAt.Time.UTC()
	}
	return &rec, nil
}

// sqlSetSave 无条件写入（INSERT ... ON DUPLICATE KEY UPDATE）。
// 注意：DATETIME(3) 的精度支持毫秒；ON UPDATE CURRENT_TIMESTAMP(3) 会自动改 updatedAt，但我们返回 rec.UpdatedAt = 服务器真实写后值
func sqlSetSave(uid uint, rec *model.GameSaveRecord) error {
	if mysqlHolder == nil {
		return errors.New("mysql holder nil")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tilesB, _ := jsonMarshalBytes(tilesToInts(rec.Tiles))
	gridB, _ := jsonMarshalBytes(rec.Grid)
	bufB, _ := jsonMarshalBytes(rec.ActiveBuffs)
	isAuto := int8(0)
	if rec.IsAuto {
		isAuto = 1
	}
	savedAt := rec.SavedAt.Truncate(time.Millisecond)
	_, err := mysqlHolder.ExecContext(ctx, `
INSERT INTO save_records
  (uid, version, phase, luck_level, gold, base_hp, base_max_hp, wave_index,
   tiles, grid, active_buffs, placement_used, placement_total, is_auto, saved_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON DUPLICATE KEY UPDATE
  version         = VALUES(version),
  phase           = VALUES(phase),
  luck_level      = VALUES(luck_level),
  gold            = VALUES(gold),
  base_hp         = VALUES(base_hp),
  base_max_hp     = VALUES(base_max_hp),
  wave_index      = VALUES(wave_index),
  tiles           = VALUES(tiles),
  grid            = VALUES(grid),
  active_buffs    = VALUES(active_buffs),
  placement_used  = VALUES(placement_used),
  placement_total = VALUES(placement_total),
  is_auto         = VALUES(is_auto),
  saved_at        = VALUES(saved_at)
`,
		uint64(uid), rec.Version, rec.Phase, rec.LuckLevel, rec.Gold, rec.BaseHP, rec.BaseMaxHP, rec.WaveIndex,
		nilJSON(tilesB), nilJSON(gridB), nilJSON(bufB), rec.PlacementUsed, rec.PlacementTotal, isAuto, savedAt,
	)
	if err != nil {
		return fmt.Errorf("sqlSetSave upsert: %w", err)
	}
	// 回读服务器实际写入的 updatedAt（毫秒级由 DB 生成）
	var uat time.Time
	if err := mysqlHolder.QueryRowContext(ctx, "SELECT updated_at FROM save_records WHERE uid = ? LIMIT 1", uid).Scan(&uat); err == nil {
		rec.UpdatedAt = uat.UTC()
	}
	return nil
}

func tilesToInts(t []uint8) []int {
	if len(t) == 0 {
		return nil
	}
	r := make([]int, len(t))
	for i := range t {
		r[i] = int(t[i])
	}
	return r
}

func nilJSON(b []byte) interface{} {
	if len(b) == 0 {
		return nil
	}
	return string(b)
}

// sqlSetSaveWithCheck 乐观锁。成功返回 (true,false,serverUpdatedAt)；冲突返回 (false,true,serverUpdatedAt)
func sqlSetSaveWithCheck(uid uint, rec *model.GameSaveRecord, expectUpdatedAt time.Time, expectZero bool) (ok bool, conflict bool, serverUpdatedAt time.Time) {
	if mysqlHolder == nil {
		return false, false, time.Time{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// ===== 读当前状态（用 SELECT ... FOR UPDATE 原子） =====
	// MySQL 8.0 默认 RR 隔离级，SELECT FOR UPDATE 够防双写竞态
	tx, err := mysqlHolder.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		log.Printf("[store-mysql] beginTx error (non-fatal, try write anyway): %v", err)
		// 降级：不做锁直接写（仍在 expectZero + UPDATED_AT 比对）
		tx = nil
	} else {
		defer func() { _ = tx.Rollback() }()
	}
	// 查现存
	var (
		hasExisting  bool
		curUpdatedAt time.Time
	)
	q := "SELECT updated_at FROM save_records WHERE uid = ? LIMIT 1"
	if tx != nil {
		q += " FOR UPDATE"
	}
	var scanRow *sql.Row
	if tx != nil {
		scanRow = tx.QueryRowContext(ctx, q, uid)
	} else {
		scanRow = mysqlHolder.QueryRowContext(ctx, q, uid)
	}
	if err := scanRow.Scan(&curUpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			hasExisting = false
		} else {
			return false, false, time.Time{}
		}
	} else {
		hasExisting = true
		curUpdatedAt = curUpdatedAt.UTC()
	}
	// ===== 冲突判定逻辑和内存版保持完全一致 =====
	if expectZero {
		if hasExisting {
			return false, true, curUpdatedAt
		}
	} else if expectUpdatedAt.IsZero() {
		// 兼容模式：不检查
	} else {
		if !hasExisting {
			return false, true, time.Time{}
		}
		if !sameMs(curUpdatedAt, expectUpdatedAt) {
			return false, true, curUpdatedAt
		}
	}
	// ===== 写入（在同一事务内保证原子性，读-校验-写不被打断） =====
	tilesB, _ := jsonMarshalBytes(tilesToInts(rec.Tiles))
	gridB, _ := jsonMarshalBytes(rec.Grid)
	bufB, _ := jsonMarshalBytes(rec.ActiveBuffs)
	isAuto := int8(0)
	if rec.IsAuto {
		isAuto = 1
	}
	savedAt := rec.SavedAt.Truncate(time.Millisecond)
	insertSQL := `
INSERT INTO save_records
  (uid, version, phase, luck_level, gold, base_hp, base_max_hp, wave_index,
   tiles, grid, active_buffs, placement_used, placement_total, is_auto, saved_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON DUPLICATE KEY UPDATE
  version         = VALUES(version),
  phase           = VALUES(phase),
  luck_level      = VALUES(luck_level),
  gold            = VALUES(gold),
  base_hp         = VALUES(base_hp),
  base_max_hp     = VALUES(base_max_hp),
  wave_index      = VALUES(wave_index),
  tiles           = VALUES(tiles),
  grid            = VALUES(grid),
  active_buffs    = VALUES(active_buffs),
  placement_used  = VALUES(placement_used),
  placement_total = VALUES(placement_total),
  is_auto         = VALUES(is_auto),
  saved_at        = VALUES(saved_at)
`
	args := []interface{}{
		uint64(uid), rec.Version, rec.Phase, rec.LuckLevel, rec.Gold, rec.BaseHP, rec.BaseMaxHP, rec.WaveIndex,
		nilJSON(tilesB), nilJSON(gridB), nilJSON(bufB), rec.PlacementUsed, rec.PlacementTotal, isAuto, savedAt,
	}
	if tx != nil {
		if _, err := tx.ExecContext(ctx, insertSQL, args...); err != nil {
			return false, false, time.Time{}
		}
		if err := tx.Commit(); err != nil {
			return false, false, time.Time{}
		}
	} else {
		if _, err := mysqlHolder.ExecContext(ctx, insertSQL, args...); err != nil {
			return false, false, time.Time{}
		}
	}
	// 回读 DB 生成的 updatedAt（ON UPDATE CURRENT_TIMESTAMP(3)）
	if err := mysqlHolder.QueryRowContext(ctx, "SELECT updated_at FROM save_records WHERE uid = ? LIMIT 1", uid).Scan(&rec.UpdatedAt); err == nil {
		rec.UpdatedAt = rec.UpdatedAt.UTC()
	}
	return true, false, rec.UpdatedAt
}
