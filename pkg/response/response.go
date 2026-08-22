package response

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Response 统一响应结构
type Response struct {
	Code      int         `json:"code"`
	Status    string      `json:"status"`
	Data      interface{} `json:"data,omitempty"`
	Message   string      `json:"message,omitempty"`
	Timestamp time.Time   `json:"timestamp"`
}

// Success 成功响应
func Success(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, Response{
		Code:      http.StatusOK,
		Status:    "success",
		Data:      data,
		Timestamp: time.Now().UTC(),
	})
}

// Created 创建成功响应
func Created(c *gin.Context, data interface{}) {
	c.JSON(http.StatusCreated, Response{
		Code:      http.StatusCreated,
		Status:    "success",
		Data:      data,
		Timestamp: time.Now().UTC(),
	})
}

// NoContent 删除成功响应
func NoContent(c *gin.Context) {
	c.Status(http.StatusNoContent)
}

// BadRequest 参数错误响应
func BadRequest(c *gin.Context, msg string) {
	c.JSON(http.StatusBadRequest, Response{
		Code:    http.StatusBadRequest,
		Status:  "error",
		Message: msg,
	})
}

// NotFound 资源不存在响应
func NotFound(c *gin.Context, msg string) {
	c.JSON(http.StatusNotFound, Response{
		Code:    http.StatusNotFound,
		Status:  "error",
		Message: msg,
	})
}

// ServerError 服务器错误响应
func ServerError(c *gin.Context, msg string) {
	c.JSON(http.StatusInternalServerError, Response{
		Code:    http.StatusInternalServerError,
		Status:  "error",
		Message: msg,
	})
}
