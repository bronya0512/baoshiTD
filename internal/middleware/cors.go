package middleware

import (
	"time"

	"github.com/gin-gonic/gin"
)

// CORS 跨域资源共享中间件
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		c.Header("Access-Control-Max-Age", "86400")

		// 预检请求直接返回
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

// CacheControl 静态资源缓存控制
func CacheControl(maxAge time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 开发阶段禁用缓存，方便调试
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		c.Header("Pragma", "no-cache")
		c.Header("Expires", "0")
		c.Next()
	}
}
