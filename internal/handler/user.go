package handler

import (
	"strconv"
	"time"

	"baoshiTD/internal/model"
	"baoshiTD/pkg/response"

	"github.com/gin-gonic/gin"
)

// 内存存储 - 简化脚手架，后续可替换为数据库
var userStore = make(map[uint]model.User)
var userIDCounter uint = 1

// GetUsers 获取用户列表
// @Summary 获取用户列表
// @Tags User
// @Produce json
// @Success 200 {array} model.User
// @Router /api/users [get]
func GetUsers(c *gin.Context) {
	users := make([]model.User, 0)
	for _, u := range userStore {
		users = append(users, u)
	}
	response.Success(c, users)
}

// CreateUser 创建用户
// @Summary 创建用户
// @Tags User
// @Accept json
// @Produce json
// @Param request body model.UserRequest true "用户信息"
// @Success 201 {object} model.User
// @Failure 400 {object} response.Response
// @Router /api/users [post]
func CreateUser(c *gin.Context) {
	var req model.UserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误: "+err.Error())
		return
	}

	user := model.User{
		ID:        userIDCounter,
		Name:      req.Name,
		Email:     req.Email,
		CreatedAt: time.Now(),
	}
	userStore[userIDCounter] = user
	userIDCounter++

	response.Created(c, user)
}

// GetUser 获取单个用户
// @Summary 获取单个用户
// @Tags User
// @Produce json
// @Param id path int true "用户ID"
// @Success 200 {object} model.User
// @Failure 404 {object} response.Response
// @Router /api/users/{id} [get]
func GetUser(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		response.BadRequest(c, "无效的用户ID")
		return
	}

	user, ok := userStore[uint(id)]
	if !ok {
		response.NotFound(c, "用户不存在")
		return
	}

	response.Success(c, user)
}

// UpdateUser 更新用户
// @Summary 更新用户
// @Tags User
// @Accept json
// @Produce json
// @Param id path int true "用户ID"
// @Param request body model.UserRequest true "用户信息"
// @Success 200 {object} model.User
// @Failure 400 {object} response.Response
// @Failure 404 {object} response.Response
// @Router /api/users/{id} [put]
func UpdateUser(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		response.BadRequest(c, "无效的用户ID")
		return
	}

	user, ok := userStore[uint(id)]
	if !ok {
		response.NotFound(c, "用户不存在")
		return
	}

	var req model.UserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误: "+err.Error())
		return
	}

	user.Name = req.Name
	user.Email = req.Email
	userStore[uint(id)] = user

	response.Success(c, user)
}

// DeleteUser 删除用户
// @Summary 删除用户
// @Tags User
// @Param id path int true "用户ID"
// @Success 204
// @Failure 404 {object} response.Response
// @Router /api/users/{id} [delete]
func DeleteUser(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		response.BadRequest(c, "无效的用户ID")
		return
	}

	if _, ok := userStore[uint(id)]; !ok {
		response.NotFound(c, "用户不存在")
		return
	}

	delete(userStore, uint(id))
	response.NoContent(c)
}
