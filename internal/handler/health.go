package handler

import (
	"time"

	"baoshiTD/pkg/response"

	"github.com/gin-gonic/gin"
)

// HealthCheck 健康检查
// @Summary 健康检查
// @Description 检查服务是否正常运行
// @Tags Health
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Router /api/health [get]
func HealthCheck(c *gin.Context) {
	response.Success(c, gin.H{
		"status":    "ok",
		"message":   "Service is running",
		"timestamp": time.Now().UTC(),
	})
}
