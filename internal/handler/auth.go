package handler

import (
	"strings"

	"baoshiTD/internal/middleware"
	"baoshiTD/internal/model"
	"baoshiTD/internal/store"
	"baoshiTD/pkg/response"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// ============================================================
// Auth Handler：register + login
// ============================================================

func hashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}
func verifyPassword(pw, hashed string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hashed), []byte(pw)) == nil
}

// Register POST /api/auth/register
func AuthRegister(c *gin.Context) {
	var req model.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误(用户名≥2 且 密码≥6): "+err.Error())
		return
	}
	uname := strings.TrimSpace(req.Username)
	if len(uname) < 2 {
		response.BadRequest(c, "用户名至少2个字符")
		return
	}
	if len(req.Password) < 6 {
		response.BadRequest(c, "密码至少6个字符")
		return
	}
	if store.AccountByName(uname) != nil {
		response.Conflict(c, "用户名已存在")
		return
	}
	hp, err := hashPassword(req.Password)
	if err != nil {
		response.ServerError(c, "密码加密失败: "+err.Error())
		return
	}
	a := store.CreateAccount(uname, hp)
	token, exp, jti, err := middleware.GenerateJWT(a.ID, a.Username, 7)
	if err != nil {
		response.ServerError(c, "生成 token 失败: "+err.Error())
		return
	}
	// 单点登录：注册成功即建立一个有效会话；后续再登录会覆盖 jti 把这个会话踢掉
	store.SetActiveSession(a.ID, jti)
	resp := model.TokenResponse{UID: a.ID, Username: a.Username, Token: token, Expires: exp}
	response.Created(c, resp)
}

// Login POST /api/auth/login
func AuthLogin(c *gin.Context) {
	var req model.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误: "+err.Error())
		return
	}
	uname := strings.TrimSpace(req.Username)
	a := store.AccountByName(uname)
	if a == nil || !verifyPassword(req.Password, a.PasswordHash) {
		response.Unauthorized(c, "用户名或密码错误")
		return
	}
	token, exp, jti, err := middleware.GenerateJWT(a.ID, a.Username, 7)
	if err != nil {
		response.ServerError(c, "生成 token 失败: "+err.Error())
		return
	}
	// 单点登录核心：每次登录生成新 jti，覆盖 Account.ActiveSessionJti
	// 此时旧浏览器 Tab 中的旧 JWT 在下次调 /api/save 等受保护接口时，
	// AuthRequired 比对 jti 不一致 → 返回 40101 kicked → 前端自动 logout + toast
	store.SetActiveSession(a.ID, jti)
	resp := model.TokenResponse{UID: a.ID, Username: a.Username, Token: token, Expires: exp}
	response.Success(c, resp)
}
