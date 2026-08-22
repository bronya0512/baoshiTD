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

// KickByOtherSession 单点登录互斥：账号在别处登录 → 401 + code=40101（前端识别到后自动登出本地账号并弹提示）
func KickByOtherSession(c *gin.Context, msg string) {
	c.JSON(http.StatusUnauthorized, Response{
		Code:      40101, // 子错误码：单点登录互斥踢下线（401 大分类 + 01 子场景）
		Status:    "kicked",
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

// Conflict 资源冲突(重复注册/存档乐观锁冲突)响应 (409)
func Conflict(c *gin.Context, msg string) {
	c.JSON(http.StatusConflict, Response{
		Code:      http.StatusConflict,
		Status:    "error",
		Message:   msg,
		Timestamp: time.Now().UTC(),
	})
}

// SaveVersionConflict 存档乐观锁冲突专用：409 code=40901 前端提示"其他页面/浏览器已更新过存档"
func SaveVersionConflict(c *gin.Context, msg string) {
	c.JSON(http.StatusConflict, Response{
		Code:      40901, // 子错误码：存档版本冲突（双开覆盖写拦截）
		Status:    "conflict_save",
		Message:   msg,
		Timestamp: time.Now().UTC(),
	})
}
