package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"baoshiTD/internal/config"
	"baoshiTD/internal/db"
	"baoshiTD/internal/router"
	"baoshiTD/internal/store"

	"github.com/gin-gonic/gin"
)

// dailyLogWriter writes logs to logs/server.YYYY-MM-DD.log and rotates
// automatically when the local date changes (detected on each Write).
// It is safe for concurrent use via an internal mutex.
type dailyLogWriter struct {
	mu       sync.Mutex
	dir      string
	prefix   string
	date     string // "YYYY-MM-DD" of the currently opened file
	file     *os.File
	openErr  error
	teardown func() // optional finalizer hook (unused for now)
}

// newDailyLogWriter creates (or reuses) a log file under dir with name prefix
// followed by "-YYYY-MM-DD.log". Dir is auto-created if missing.
func newDailyLogWriter(dir, prefix string) (*dailyLogWriter, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create log dir %s: %w", dir, err)
	}
	d := &dailyLogWriter{dir: dir, prefix: prefix}
	if err := d.rotate(time.Now()); err != nil {
		return nil, err
	}
	return d, nil
}

// todayKey returns YYYY-MM-DD for a given time, in local timezone.
func (d *dailyLogWriter) todayKey(t time.Time) string {
	y, m, day := t.Date()
	return fmt.Sprintf("%04d-%02d-%02d", y, int(m), day)
}

// filePath returns the absolute log file path for a given date key.
func (d *dailyLogWriter) filePath(dateKey string) string {
	return filepath.Join(d.dir, fmt.Sprintf("%s-%s.log", d.prefix, dateKey))
}

// rotate closes the current file (if any) and opens the file for `t`'s date.
// Caller must hold d.mu.
func (d *dailyLogWriter) rotate(t time.Time) error {
	key := d.todayKey(t)
	if d.file != nil && key == d.date {
		return nil // already on this date
	}
	if d.file != nil {
		_ = d.file.Close()
		d.file = nil
	}
	p := d.filePath(key)
	f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		d.openErr = err
		return fmt.Errorf("open log file %s: %w", p, err)
	}
	d.date = key
	d.file = f
	d.openErr = nil
	return nil
}

// Write implements io.Writer. It checks the local date on every call so that
// long-running processes (days/weeks) keep writing to the correct day file
// without an external rotator or cron.
func (d *dailyLogWriter) Write(p []byte) (int, error) {
	now := time.Now()
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.date == "" || d.todayKey(now) != d.date {
		if err := d.rotate(now); err != nil {
			// Fail open: drop file writes but never block callers.
			// Stdout (the other half of MultiWriter) still shows them.
			return len(p), nil
		}
	}
	if d.file == nil {
		return len(p), nil
	}
	n, err := d.file.Write(p)
	return n, err
}

// Sync flushes the current file to disk. Safe no-op if nothing opened.
func (d *dailyLogWriter) Sync() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.file != nil {
		return d.file.Sync()
	}
	return nil
}

// Close syncs and closes the current file. After Close, Write becomes a no-op.
func (d *dailyLogWriter) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.file != nil {
		err := d.file.Close()
		d.file = nil
		d.date = ""
		return err
	}
	return nil
}

// setupLogging MUST be called as the very first thing in main() so that every
// subsequent output (banner, MySQL/Redis connection messages, GIN access logs,
// panics) is captured both on stdout and in a date-stamped file under logs/.
//
// Returns:
//   - dailyWriter: for optional explicit Sync/Close by the caller
//   - todayLogPath: absolute path of today's log file (for startup banner)
//   - err: non-fatal; if non-nil we still proceed with stdout-only so the
//     server keeps running instead of refusing to start because of a log dir
//     permission quirk.
func setupLogging() (dailyWriter *dailyLogWriter, todayLogPath string, err error) {
	logDir := "logs"
	dw, err := newDailyLogWriter(logDir, "server")
	if err != nil {
		// Fail-open: server must still start. Keep logging to stdout only.
		log.Printf("[main] WARN logs dir unavailable, falling back to stdout only: %v", err)
		return nil, "", err
	}

	// Tee: every log line goes to BOTH stdout AND today's date-stamped file.
	// - For restart.bat start (background): stdout is swallowed by cmd /B,
	//   but the file side survives -> users read logs/server-YYYY-MM-DD.log.
	// - For restart.bat console / dev / go run .: stdout shows live output in
	//   terminal AND the file side keeps a persistent disk copy.
	mw := io.MultiWriter(os.Stdout, dw)
	log.SetOutput(mw)
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)

	// GIN writes access logs via gin.DefaultWriter and errors via
	// gin.DefaultErrorWriter. Route both through the same tee.
	gin.DefaultWriter = mw
	gin.DefaultErrorWriter = mw

	return dw, dw.filePath(dw.date), nil
}

// @title 八字TD API
// @version 0.1.0
// @description 基于 OpenSpec 模式的 Go 后端
// @host localhost:8080
// @BasePath /api
func main() {
	dw, todayLog, _ := setupLogging() // best-effort; err already logged if any
	if dw != nil {
		defer dw.Close()
	}

	// ============ 存储层初始化：连接 MySQL + Redis，启动失败自动降级到内存模式 ============
	myHolder, errMy := db.ConnectMySQL()
	if errMy != nil {
		log.Printf("[main] ⚠️  MySQL 连接/初始化失败，降级：%v", errMy)
		myHolder = nil
	}
	rdHolder, errRd := db.ConnectRedis()
	if errRd != nil {
		log.Printf("[main] ⚠️  Redis 连接失败，降级（SSO 将仅依赖 MySQL/内存 jti 校验）：%v", errRd)
		rdHolder = nil
	}
	store.Init(myHolder, rdHolder)

	// ============ 游戏配置加载：conf/game/*.json — 缺失则直接 Fail-Fast ============
	if err := config.Reload(); err != nil {
		log.Fatalf("[main] 游戏配置加载失败（conf/game 目录或文件缺失/损坏）: %v", err)
	}
	log.Printf("[main] ✅ 游戏配置加载完成 (baseDir=%s)", config.BaseDir())

	r := router.Setup()

	port := ":" + os.Getenv("TD_PORT")
	if port == ":" {
		port = ":8080" // 默认 8080，可用环境变量 TD_PORT 覆盖（与 Dockerfile/compose 声明一致）
	}
	// Use log.Printf (NOT fmt.Printf) so startup banner is written into the
	// date-stamped log file as well -- otherwise only stdout sees it.
	log.Println("============================================================")
	log.Printf("🚀 服务启动中...")
	log.Printf("📖 API 文档: http://localhost%s/docs", port)
	log.Printf("📋 OpenAPI: http://localhost%s/openapi.yaml", port)
	log.Printf("🖥️  前端页面: http://localhost%s/", port)
	log.Printf("🔍 健康检查: http://localhost%s/api/health", port)
	log.Printf("💾 存储: MySQL=%s   Redis=%s",
		ifelse(myHolder != nil, "ON(持久化)", "OFF(内存/Fallback)"),
		ifelse(rdHolder != nil, "ON(SSO缓存+TTL)", "OFF(无缓存)"))
	if todayLog != "" {
		log.Printf("📄 日志文件 (today): %s", todayLog)
	}
	log.Println("============================================================")

	if err := r.Run(port); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}

func ifelse(cond bool, a, b string) string {
	if cond {
		return a
	}
	return b
}
