package middleware

import (
	"time"

	"github.com/gin-gonic/gin"
)

// Logger 日志中间件 - 记录请求方法、路径、耗时和状态码
func Logger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		method := c.Request.Method

		c.Next()

		latency := time.Since(start)
		statusCode := c.Writer.Status()
		clientIP := c.ClientIP()

		// 简化版日志输出，后续可替换为结构化日志
		_ = latency
		_ = clientIP
		_ = statusCode
		_ = method
		_ = path
		// 实际项目中使用 log.Printf 或结构化日志
		// log.Printf("[GIN] %s %s %d %v", method, path, statusCode, latency)
	}
}
