package main

import (
	"fmt"
	"log"

	"baoshiTD/internal/db"
	"baoshiTD/internal/router"
	"baoshiTD/internal/store"
)

// @title 八字TD API
// @version 0.1.0
// @description 基于 OpenSpec 模式的 Go 后端
// @host localhost:8080
// @BasePath /api
func main() {
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

	r := router.Setup()

	port := ":8080"
	fmt.Printf("🚀 服务启动中...\n")
	fmt.Printf("📖 API 文档: http://localhost%s/docs\n", port)
	fmt.Printf("📋 OpenAPI: http://localhost%s/openapi.yaml\n", port)
	fmt.Printf("🖥️  前端页面: http://localhost%s/\n", port)
	fmt.Printf("🔍 健康检查: http://localhost%s/api/health\n", port)
	fmt.Printf("💾 存储: MySQL=%s   Redis=%s\n",
		ifelse(myHolder != nil, "ON(持久化)", "OFF(内存/Fallback)"),
		ifelse(rdHolder != nil, "ON(SSO缓存+TTL)", "OFF(无缓存)"))

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
