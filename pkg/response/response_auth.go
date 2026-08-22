package response

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Unauthorized 未登录/登录失效响应 (401)
func Unauthorized(c *gin.Context, msg string) {
	c.JSON(http.StatusUnauthorized, Response{
		Code:      http.StatusUnauthorized,
		Status:    "error",
		Message:   msg,
		Timestamp: time.Now().UTC(),
	})
}

// Forbidden 禁止操作(作弊/权限)响应 (403)
func Forbidden(c *gin.Context, msg string) {
	c.JSON(http.StatusForbidden, Response{
		Code:      http.StatusForbidden,
		Status:    "error",
		Message:   msg,
		Timestamp: time.Now().UTC(),
	})
}

// Conflict 资源冲突(重复注册)响应 (409)
func Conflict(c *gin.Context, msg string) {
	c.JSON(http.StatusConflict, Response{
		Code:      http.StatusConflict,
		Status:    "error",
		Message:   msg,
		Timestamp: time.Now().UTC(),
	})
}
