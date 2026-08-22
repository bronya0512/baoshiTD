package main

import (
	"fmt"
	"log"

	"baoshiTD/internal/router"
)

// @title 八字TD API
// @version 0.1.0
// @description 基于 OpenSpec 模式的 Go 后端
// @host localhost:8080
// @BasePath /api
func main() {
	r := router.Setup()

	port := ":8080"
	fmt.Printf("🚀 服务启动中...\n")
	fmt.Printf("📖 API 文档: http://localhost%s/docs\n", port)
	fmt.Printf("📋 OpenAPI: http://localhost%s/openapi.yaml\n", port)
	fmt.Printf("🖥️  前端页面: http://localhost%s/\n", port)
	fmt.Printf("🔍 健康检查: http://localhost%s/api/health\n", port)

	if err := r.Run(port); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}
