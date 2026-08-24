//go:build !windows

package db

import "os"

// getEnv 非 Windows 平台直接用 os.Getenv（没有 HKCU 注册表的概念）
func getEnv(key string) string {
	return os.Getenv(key)
}
