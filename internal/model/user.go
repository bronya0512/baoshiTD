package model

import "time"

// User 用户模型
// @Description 用户信息
type User struct {
	ID        uint      `json:"id" example:"1"`
	Name      string    `json:"name" binding:"required" example:"张三"`
	Email     string    `json:"email" binding:"required,email" example:"zhangsan@example.com"`
	CreatedAt time.Time `json:"created_at"`
}

// UserRequest 创建/更新用户请求
type UserRequest struct {
	Name  string `json:"name" binding:"required" example:"张三"`
	Email string `json:"email" binding:"required,email" example:"zhangsan@example.com"`
}
