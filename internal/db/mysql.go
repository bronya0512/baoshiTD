package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
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
	dsn := os.Getenv("TD_MYSQL_DSN")
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

// ensureSchema 建 users + save_records 表（幂等 IF NOT EXISTS）
func (h *MySQLHolder) ensureSchema(ctx context.Context) error {
	if h == nil || h.DB == nil {
		return errors.New("mysql holder not initialized")
	}
	// users 表 — 字段对齐 model.Account
	usersSchema := `
CREATE TABLE IF NOT EXISTS users (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '账号ID',
  username            VARCHAR(64)  NOT NULL COMMENT '用户名（小写唯一）',
  password_hash       VARCHAR(255) NOT NULL COMMENT 'bcrypt hash',
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间 UTC',
  active_session_jti  VARCHAR(64)  NOT NULL DEFAULT '' COMMENT 'SSO 单点登录互斥：当前唯一有效JWT的jti；空=兼容旧会话',
  active_session_at   DATETIME(3)  NULL DEFAULT NULL COMMENT '该jti发放时间 UTC',
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='宝石TD 玩家账号'`

	// save_records 表 — 每账号最多 1 条（uid PK），对齐 model.GameSaveRecord
	// tiles/grid/activeBuffs 用 JSON 存（MySQL 8.0 原生 JSON 类型，方便查询，不解析也不影响性能）
	saveSchema := `
CREATE TABLE IF NOT EXISTS save_records (
  uid              BIGINT UNSIGNED NOT NULL COMMENT '对应 users.id；每账号 1 条',
  version          INT          NOT NULL DEFAULT 1 COMMENT '存档格式版本',
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
  PRIMARY KEY (uid),
  CONSTRAINT fk_saves_uid_users FOREIGN KEY (uid) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='宝石TD 当前存档（每账号1条）'`

	for name, stmt := range map[string]string{"users": usersSchema, "save_records": saveSchema} {
		if _, err := h.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("create table %s failed: %w", name, err)
		}
	}
	return nil
}
