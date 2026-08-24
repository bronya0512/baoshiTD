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

// sqlScanAccount 从 sql.Row 中扫 Account 字段（含 V4-1 新增的 unlockedMaps/talentNodes/可用点数）
// 若列不存在（旧 schema 过渡） → 由上层的 fallback Scan 或 schema 保证。这里按统一全字段 SELECT 处理。
func sqlScanAccount(row *sql.Row) (*model.Account, error) {
	var (
		a            model.Account
		activeSessAt sql.NullTime
		unlockedJSON sql.NullString
		talentJSON   sql.NullString
	)
	err := row.Scan(&a.ID, &a.Username, &a.PasswordHash, &a.CreatedAt,
		&a.ActiveSessionJti, &activeSessAt, &unlockedJSON, &talentJSON, &a.TalentPointsAvailable)
	if err != nil {
		return nil, err
	}
	if activeSessAt.Valid {
		a.ActiveSessionAt = activeSessAt.Time
	}
	if unlockedJSON.Valid && unlockedJSON.String != "" && unlockedJSON.String != "null" {
		_ = json.Unmarshal([]byte(unlockedJSON.String), &a.UnlockedMaps)
	}
	if talentJSON.Valid && talentJSON.String != "" && talentJSON.String != "null" {
		_ = json.Unmarshal([]byte(talentJSON.String), &a.TalentNodes)
	}
	return &a, nil
}

func sqlAccountByName(username string) (*model.Account, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	row := mysqlHolder.QueryRowContext(ctx,
		"SELECT id, username, password_hash, created_at, active_session_jti, active_session_at,"+
			" unlocked_maps, talent_nodes, talent_points_available "+
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
		"SELECT id, username, password_hash, created_at, active_session_jti, active_session_at,"+
			" unlocked_maps, talent_nodes, talent_points_available "+
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

// sqlGetSave 按 (uid, mapId, difficulty) 三元组取一份存档。
// V3 兼容：客户端传 mapId=0 或 difficulty="" 时，取 map_id=1 AND difficulty='normal' 的那一份（老 V3 存档迁移到此桶）
func sqlGetSave(uid uint, mapId int, difficulty string) (*model.GameSaveRecord, error) {
	if mysqlHolder == nil {
		return nil, errors.New("mysql holder nil")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if mapId == 0 {
		mapId = 1
	}
	if difficulty == "" {
		difficulty = "normal"
	}
	var (
		rec                     model.GameSaveRecord
		tilesJSON, gJSON, bJSON sql.NullString
		savedAt, updatedAt      sql.NullTime
		isAutoInt               int8
	)
	row := mysqlHolder.QueryRowContext(ctx,
		`SELECT version, map_id, difficulty, phase, luck_level, gold, base_hp, base_max_hp, wave_index,
		        tiles, grid, active_buffs, placement_used, placement_total, is_auto, saved_at, updated_at
		 FROM save_records WHERE uid = ? AND map_id = ? AND difficulty = ? LIMIT 1`,
		uid, mapId, difficulty)
	err := row.Scan(
		&rec.Version, &rec.MapId, &rec.Difficulty, &rec.Phase, &rec.LuckLevel, &rec.Gold,
		&rec.BaseHP, &rec.BaseMaxHP, &rec.WaveIndex,
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
	// 回填默认值（老数据 schema 级别有 DEFAULT，但这里仍做防御性兜底）
	if rec.MapId == 0 {
		rec.MapId = 1
	}
	if rec.Difficulty == "" {
		rec.Difficulty = "normal"
	}
	return &rec, nil
}

// sqlSetSave 按复合 PK upsert。注意 rec.MapId/rec.Difficulty 必须有有效值；0/"" 会被重置为默认。
func sqlSetSave(uid uint, rec *model.GameSaveRecord) error {
	if mysqlHolder == nil {
		return errors.New("mysql holder nil")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if rec.MapId == 0 {
		rec.MapId = 1
	}
	if rec.Difficulty == "" {
		rec.Difficulty = "normal"
	}
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
  (uid, map_id, difficulty, version, phase, luck_level, gold, base_hp, base_max_hp, wave_index,
   tiles, grid, active_buffs, placement_used, placement_total, is_auto, saved_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
		uint64(uid), rec.MapId, rec.Difficulty,
		rec.Version, rec.Phase, rec.LuckLevel, rec.Gold, rec.BaseHP, rec.BaseMaxHP, rec.WaveIndex,
		nilJSON(tilesB), nilJSON(gridB), nilJSON(bufB), rec.PlacementUsed, rec.PlacementTotal, isAuto, savedAt,
	)
	if err != nil {
		return fmt.Errorf("sqlSetSave upsert: %w", err)
	}
	// 回读服务器实际写入的 updatedAt
	var uat time.Time
	if err := mysqlHolder.QueryRowContext(ctx,
		"SELECT updated_at FROM save_records WHERE uid = ? AND map_id = ? AND difficulty = ? LIMIT 1",
		uid, rec.MapId, rec.Difficulty).Scan(&uat); err == nil {
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
	if rec.MapId == 0 {
		rec.MapId = 1
	}
	if rec.Difficulty == "" {
		rec.Difficulty = "normal"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// ===== 读当前状态（用 SELECT ... FOR UPDATE 原子） =====
	tx, err := mysqlHolder.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		log.Printf("[store-mysql] beginTx error (non-fatal, try write anyway): %v", err)
		tx = nil
	} else {
		defer func() { _ = tx.Rollback() }()
	}
	var (
		hasExisting  bool
		curUpdatedAt time.Time
	)
	q := "SELECT updated_at FROM save_records WHERE uid = ? AND map_id = ? AND difficulty = ? LIMIT 1"
	if tx != nil {
		q += " FOR UPDATE"
	}
	var scanRow *sql.Row
	if tx != nil {
		scanRow = tx.QueryRowContext(ctx, q, uid, rec.MapId, rec.Difficulty)
	} else {
		scanRow = mysqlHolder.QueryRowContext(ctx, q, uid, rec.MapId, rec.Difficulty)
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
	// ===== 冲突判定 =====
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
	// ===== 写入 =====
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
  (uid, map_id, difficulty, version, phase, luck_level, gold, base_hp, base_max_hp, wave_index,
   tiles, grid, active_buffs, placement_used, placement_total, is_auto, saved_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
		uint64(uid), rec.MapId, rec.Difficulty,
		rec.Version, rec.Phase, rec.LuckLevel, rec.Gold, rec.BaseHP, rec.BaseMaxHP, rec.WaveIndex,
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
	// 回读 DB 生成的 updatedAt
	if err := mysqlHolder.QueryRowContext(ctx,
		"SELECT updated_at FROM save_records WHERE uid = ? AND map_id = ? AND difficulty = ? LIMIT 1",
		uid, rec.MapId, rec.Difficulty).Scan(&rec.UpdatedAt); err == nil {
		rec.UpdatedAt = rec.UpdatedAt.UTC()
	}
	return true, false, rec.UpdatedAt
}

// ==================== V4-6 T14：排行榜 ====================

// LeaderboardRow 排行榜条目（save_records JOIN users 取玩家名）
type LeaderboardRow struct {
	Uid         uint   `json:"uid"`
	Username    string `json:"username"` // 账号名；若 guest/missing 则 "玩家#UID"
	Guest       bool   `json:"guest"`    // true = 没有 username（游客 或 匿名）
	MapId       int    `json:"mapId"`
	Difficulty  string `json:"difficulty"`
	WaveIndex   int    `json:"waveIndex"`   // 达到的波次（越大越好）
	Gold        int    `json:"gold"`        // 存档时金币
	BaseHP      int    `json:"baseHP"`      // 存档时剩余基地血量
	BaseMaxHP   int    `json:"baseMaxHP"`   // 存档时基地最大血量
	LuckLevel   int    `json:"luckLevel"`   // 存档时运气等级
	UpdatedAtMs int64  `json:"updatedAtMs"` // 存档更新时间（Unix ms）
	Rank        int    `json:"rank"`        // 从 1 开始（前端用于显示序号，由 TopLeaderboard 返回填充）
}

// TopLeaderboard 查询 (mapId × difficulty) 组合下按波次/Gold/HP 排序的 TopK
// 若 MySQL 未连接 → 返回空数组 + nil error（前端展示"暂无排行"占位）
func TopLeaderboard(ctx context.Context, mapId int, difficulty string, limit int) ([]LeaderboardRow, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	if mapId <= 0 {
		mapId = 1
	}
	switch difficulty {
	case "", "normal", "hard", "nightmare":
	default:
		difficulty = "normal"
	}
	if mysqlHolder == nil {
		return []LeaderboardRow{}, nil
	}
	querySQL := `
SELECT
  r.uid,
  COALESCE(u.username, ''),
  r.map_id,
  r.difficulty,
  r.wave_index,
  r.gold,
  r.base_hp,
  r.base_max_hp,
  r.luck_level,
  r.updated_at
FROM save_records r
LEFT JOIN users u ON u.id = r.uid
WHERE r.map_id = ? AND r.difficulty = ?
ORDER BY r.wave_index DESC, r.gold DESC, r.base_hp DESC, r.updated_at ASC
LIMIT ?`
	rows, err := mysqlHolder.QueryContext(ctx, querySQL, mapId, difficulty, limit)
	if err != nil {
		return nil, fmt.Errorf("topLeaderboard query: %w", err)
	}
	defer rows.Close()
	out := make([]LeaderboardRow, 0, limit)
	rank := 1
	for rows.Next() {
		var (
			uid   uint
			uname string
			mid   int
			diff  string
			wv    int
			gold  int
			bhp   int
			bmax  int
			luck  int
			upd   time.Time
		)
		if err := rows.Scan(&uid, &uname, &mid, &diff, &wv, &gold, &bhp, &bmax, &luck, &upd); err != nil {
			return nil, fmt.Errorf("topLeaderboard scan: %w", err)
		}
		guest := false
		displayName := uname
		if displayName == "" {
			guest = true
			displayName = fmt.Sprintf("玩家#%d", uid)
		}
		row := LeaderboardRow{
			Uid:         uid,
			Username:    displayName,
			Guest:       guest,
			MapId:       mid,
			Difficulty:  diff,
			WaveIndex:   wv,
			Gold:        gold,
			BaseHP:      bhp,
			BaseMaxHP:   bmax,
			LuckLevel:   luck,
			UpdatedAtMs: upd.UnixMilli(),
			Rank:        rank,
		}
		out = append(out, row)
		rank++
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("topLeaderboard rowsErr: %w", err)
	}
	return out, nil
}

// PatchTalents 更新 users.talent_nodes（JSON []string）以及可选 talent_points_available
// 任何一个为 nil/空则跳过（只更新传了的）。MySQL 不可用时返回 error
func PatchTalents(ctx context.Context, uid uint, nodes []string, pointsAvail *int) error {
	if uid == 0 {
		return fmt.Errorf("uid=0")
	}
	if mysqlHolder == nil {
		return fmt.Errorf("mysql not connected")
	}
	if len(nodes) == 0 {
		nodes = []string{}
	}
	if ctx == nil {
		ctx = context.Background()
	}
	var nodesJSON []byte
	var err error
	if nodesJSON, err = json.Marshal(nodes); err != nil {
		return fmt.Errorf("marshal talentNodes: %w", err)
	}
	if pointsAvail != nil {
		_, err = mysqlHolder.ExecContext(ctx,
			"UPDATE users SET talent_nodes = ?, talent_points_available = ? WHERE id = ? LIMIT 1",
			string(nodesJSON), *pointsAvail, uid)
	} else {
		_, err = mysqlHolder.ExecContext(ctx,
			"UPDATE users SET talent_nodes = ? WHERE id = ? LIMIT 1",
			string(nodesJSON), uid)
	}
	if err != nil {
		return fmt.Errorf("update talents: %w", err)
	}
	return nil
}

// PatchUnlockedMaps 更新 users.unlocked_maps（JSON），兼容两种输入：
//   - 整数数组 [1,2] → 存为 JSON array 字符串
//   - map {1:true, 2:true,...} → 提取 keys 成数组
func PatchUnlockedMaps(ctx context.Context, uid uint, unlockedMaps interface{}) error {
	if uid == 0 {
		return fmt.Errorf("uid=0")
	}
	if mysqlHolder == nil {
		return fmt.Errorf("mysql not connected")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ids := []int{}
	switch v := unlockedMaps.(type) {
	case nil:
		ids = []int{}
	case []int:
		ids = v
	case []string:
		for _, s := range v {
			n, err := strconv.Atoi(s)
			if err == nil && n > 0 {
				ids = append(ids, n)
			}
		}
	case []interface{}:
		for _, i := range v {
			switch iv := i.(type) {
			case float64:
				if int(iv) > 0 {
					ids = append(ids, int(iv))
				}
			case string:
				n, err := strconv.Atoi(iv)
				if err == nil && n > 0 {
					ids = append(ids, n)
				}
			case int:
				if iv > 0 {
					ids = append(ids, iv)
				}
			}
		}
	case map[string]interface{}:
		for k, val := range v {
			switch bv := val.(type) {
			case bool:
				if !bv {
					continue
				}
			case nil:
				continue
			}
			n, err := strconv.Atoi(k)
			if err == nil && n > 0 {
				ids = append(ids, n)
			}
		}
	default:
		// 兜底：JSON-marshal 原始值
		raw, err := json.Marshal(unlockedMaps)
		if err != nil {
			return fmt.Errorf("marshal unlockedMaps fallback: %w", err)
		}
		_, err = mysqlHolder.ExecContext(ctx,
			"UPDATE users SET unlocked_maps = ? WHERE id = ? LIMIT 1", string(raw), uid)
		return err
	}
	// 去重 + 排序（稳定 JSON）
	seen := map[int]struct{}{}
	uniq := []int{}
	for _, n := range ids {
		if n <= 0 {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		uniq = append(uniq, n)
	}
	if len(uniq) == 0 {
		uniq = []int{}
	}
	raw, err := json.Marshal(uniq)
	if err != nil {
		return fmt.Errorf("marshal uniq ids: %w", err)
	}
	_, err = mysqlHolder.ExecContext(ctx,
		"UPDATE users SET unlocked_maps = ? WHERE id = ? LIMIT 1", string(raw), uid)
	if err != nil {
		return fmt.Errorf("update unlocked_maps: %w", err)
	}
	return nil
}
