package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// MySQL 管理：连接池 + 建表
// 设计目标：
//   - 环境变量 TD_MYSQL_DSN 为空时返回 (nil, nil) — 表示"请求用内存模式"，上层应降级 fallback
//   - 连接/建表任何失败返回 error，由上层决定 fallback 还是 panic
//   - 表结构完全和 model.Account / GameSaveRecord 对应，启动时用 CREATE TABLE IF NOT EXISTS 自动建（幂等）

// MySQLHolder 保存 *sql.DB 连接池，供 SQL store 层复用
type MySQLHolder struct {
	*sql.DB
	DSN string
}

// ConnectMySQL 读取 TD_MYSQL_DSN 并连接、Ping、建表。
// 返回 (nil, nil) 表示用户没有配置 MySQL DSN（要求走内存模式）。
func ConnectMySQL() (*MySQLHolder, error) {
	dsn := getEnv("TD_MYSQL_DSN")
	if dsn == "" {
		return nil, nil
	}
	d, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("mysql open failed: %w", err)
	}
	// 基础池参数 — MVP 规模，5 开 20 够用
	d.SetMaxOpenConns(20)
	d.SetMaxIdleConns(5)
	d.SetConnMaxLifetime(1 * time.Hour)
	d.SetConnMaxIdleTime(10 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := d.PingContext(ctx); err != nil {
		_ = d.Close()
		return nil, fmt.Errorf("mysql ping failed: %w", err)
	}
	h := &MySQLHolder{DB: d, DSN: dsn}
	if err := h.ensureSchema(ctx); err != nil {
		_ = d.Close()
		return nil, fmt.Errorf("mysql ensureSchema failed: %w", err)
	}
	log.Printf("[db-mysql] ✅ 连接成功 DSN=%q pool=(open=%d idle=%d)", redactPass(dsn), d.Stats().OpenConnections, d.Stats().Idle)
	return h, nil
}

// redactPass 日志中隐藏 DSN 密码片段
func redactPass(dsn string) string {
	// DSN 样式 user:pass@tcp(addr)/dbname?opt
	for i := 0; i < len(dsn); i++ {
		if dsn[i] == ':' {
			for j := i + 1; j < len(dsn); j++ {
				if dsn[j] == '@' {
					return dsn[:i+1] + "***" + dsn[j:]
				}
			}
		}
	}
	return dsn
}

// ensureSchema 建 users + save_records 表（幂等 IF NOT EXISTS）+ 旧表 ALTER 迁移
func (h *MySQLHolder) ensureSchema(ctx context.Context) error {
	if h == nil || h.DB == nil {
		return errors.New("mysql holder not initialized")
	}
	// users 表 — 字段对齐 model.Account
	usersSchema := `
CREATE TABLE IF NOT EXISTS users (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '账号ID',
  username                 VARCHAR(64)  NOT NULL COMMENT '用户名（小写唯一）',
  password_hash            VARCHAR(255) NOT NULL COMMENT 'bcrypt hash',
  created_at               DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间 UTC',
  active_session_jti       VARCHAR(64)  NOT NULL DEFAULT '' COMMENT 'SSO 单点登录互斥：当前唯一有效JWT的jti；空=兼容旧会话',
  active_session_at        DATETIME(3)  NULL DEFAULT NULL COMMENT '该jti发放时间 UTC',
  unlocked_maps            JSON         NULL COMMENT 'V4-1: 已解锁的地图id数组，如["map-1","map-2"]',
  talent_nodes             JSON         NULL COMMENT 'V4-1: 已点亮天赋节点id列表',
  talent_points_available  INT          NOT NULL DEFAULT 0 COMMENT 'V4-1: 可用天赋点数',
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='宝石TD 玩家账号'`

	// save_records 表 — 每 (uid, map_id, difficulty) 1 条存档
	saveSchema := `
CREATE TABLE IF NOT EXISTS save_records (
  uid              BIGINT UNSIGNED NOT NULL COMMENT '对应 users.id',
  map_id           INT          NOT NULL DEFAULT 1 COMMENT 'V4-1: 地图ID（1=草原）',
  difficulty       VARCHAR(16)  NOT NULL DEFAULT 'normal' COMMENT 'V4-1: 难度 normal/hard/nightmare',
  version          INT          NOT NULL DEFAULT 1 COMMENT '存档格式版本（2=V4-1，V3=1）',
  phase            VARCHAR(16)  NOT NULL DEFAULT 'MENU' COMMENT '阶段：MENU/PREPARE/RESERVE/BATTLE/WAVEEND/WIN/LOSE',
  luck_level       INT          NOT NULL DEFAULT 1,
  gold             INT          NOT NULL DEFAULT 0,
  base_hp          INT          NOT NULL DEFAULT 0,
  base_max_hp      INT          NOT NULL DEFAULT 0,
  wave_index       INT          NOT NULL DEFAULT 0,
  tiles            JSON         NULL COMMENT 'tiles 数组（uint8→int 序列化）',
  grid             JSON         NULL COMMENT 'grid 数组对象（塔配置/墙/CAND等）',
  active_buffs     JSON         NULL COMMENT '激活中的 Buff 列表',
  placement_used   INT          NOT NULL DEFAULT 0,
  placement_total  INT          NOT NULL DEFAULT 0,
  is_auto          TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1=自动存档 0=手动',
  saved_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '乐观锁比对的版本戳',
  PRIMARY KEY (uid, map_id, difficulty),
  CONSTRAINT fk_saves_uid_users FOREIGN KEY (uid) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='宝石TD 当前存档（每账号 地图×难度 各1条）'`

	for name, stmt := range map[string]string{"users": usersSchema, "save_records": saveSchema} {
		if _, err := h.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("create table %s failed: %w", name, err)
		}
	}

	// ===== 旧表列迁移：users 可能已有表但缺 V4-1 列；INFORMATION_SCHEMA 检查后 ALTER =====
	if err := h.ensureUsersColumns(ctx); err != nil {
		return err
	}
	if err := h.ensureSaveRecordsPK(ctx); err != nil {
		return err
	}
	return nil
}

// ensureUsersColumns 对老 users 表缺列时安全 ADD COLUMN
func (h *MySQLHolder) ensureUsersColumns(ctx context.Context) error {
	needCols := map[string]string{
		"unlocked_maps":           "ADD COLUMN unlocked_maps JSON NULL COMMENT 'V4-1: 已解锁的地图id数组' AFTER active_session_at",
		"talent_nodes":            "ADD COLUMN talent_nodes JSON NULL COMMENT 'V4-1: 已点亮天赋节点id列表' AFTER unlocked_maps",
		"talent_points_available": "ADD COLUMN talent_points_available INT NOT NULL DEFAULT 0 COMMENT 'V4-1: 可用天赋点数' AFTER talent_nodes",
	}
	rows, err := h.QueryContext(ctx, "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'")
	if err != nil {
		return fmt.Errorf("check users columns: %w", err)
	}
	defer rows.Close()
	have := map[string]bool{}
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return err
		}
		have[c] = true
	}
	for col, ddl := range needCols {
		if !have[col] {
			if _, err := h.ExecContext(ctx, "ALTER TABLE users "+ddl); err != nil {
				return fmt.Errorf("alter users add %s: %w", col, err)
			}
			log.Printf("[db-mysql] ✅ users 表新增列: %s", col)
		}
	}
	return nil
}

// ensureSaveRecordsPK 对老 save_records（uid 单 PK）升级到 (uid,map_id,difficulty) 复合 PK
// 兼容策略：
//  1. 缺 map_id / difficulty 列 → ADD + 把存量行填充 DEFAULT 1/'normal'
//  2. PRIMARY KEY 仍是 (uid) → DROP PK + ADD PK(uid,map_id,difficulty)
func (h *MySQLHolder) ensureSaveRecordsPK(ctx context.Context) error {
	rows, err := h.QueryContext(ctx, "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'save_records'")
	if err != nil {
		return fmt.Errorf("check save_records columns: %w", err)
	}
	defer rows.Close()
	have := map[string]bool{}
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return err
		}
		have[c] = true
	}
	if !have["map_id"] {
		if _, err := h.ExecContext(ctx, "ALTER TABLE save_records ADD COLUMN map_id INT NOT NULL DEFAULT 1 COMMENT 'V4-1: 地图ID' AFTER uid"); err != nil {
			return fmt.Errorf("alter save_records add map_id: %w", err)
		}
		log.Printf("[db-mysql] ✅ save_records 表新增列: map_id (默认值 1 填充存量)")
	}
	if !have["difficulty"] {
		if _, err := h.ExecContext(ctx, "ALTER TABLE save_records ADD COLUMN difficulty VARCHAR(16) NOT NULL DEFAULT 'normal' COMMENT 'V4-1: 难度' AFTER map_id"); err != nil {
			return fmt.Errorf("alter save_records add difficulty: %w", err)
		}
		log.Printf("[db-mysql] ✅ save_records 表新增列: difficulty (默认值 normal 填充存量)")
	}
	// 检查 PRIMARY KEY 是否仍是 (uid)
	var pkDef string
	pkRow := h.QueryRowContext(ctx, `
SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'save_records' AND CONSTRAINT_NAME = 'PRIMARY'
GROUP BY CONSTRAINT_NAME`)
	if err := pkRow.Scan(&pkDef); err == nil && pkDef != "" && pkDef != "uid,map_id,difficulty" {
		// 重建 PK（先删后加；注意 FK 依赖 uid 列本身不变，安全）
		if _, err := h.ExecContext(ctx, "ALTER TABLE save_records DROP PRIMARY KEY, ADD PRIMARY KEY (uid, map_id, difficulty)"); err != nil {
			return fmt.Errorf("alter save_records rebuild PK: %w", err)
		}
		log.Printf("[db-mysql] ✅ save_records PK 从 %q 升级为 (uid,map_id,difficulty)", pkDef)
	}
	return nil
}
