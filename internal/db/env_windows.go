//go:build windows

package db

import (
	"os"

	"golang.org/x/sys/windows/registry"
)

// getEnv 优先读进程环境变量；为空时 fallback 读 HKCU\Environment 注册表。
//
// 背景：Windows 上进程的环境变量块是"创建时快照"。如果用户用 setx / [Environment]::SetEnvironmentVariable(..., "User")
// 设置了 HKCU 环境变量，但没有重启终端/IDE，那么从旧终端派生出来的 Go 进程会继承旧的（空的）环境块，
// 导致 os.Getenv("TD_MYSQL_DSN") 等返回空串，后端误判"未配置数据库"而降级到内存模式。
// 本函数做一次兜底：进程 env 为空时，主动打开 HKCU\Environment 注册表键重新读取。
func getEnv(key string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	k, err := registry.OpenKey(registry.CURRENT_USER, `Environment`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer func() { _ = k.Close() }()
	v, _, err := k.GetStringValue(key)
	if err != nil {
		return ""
	}
	return v
}
