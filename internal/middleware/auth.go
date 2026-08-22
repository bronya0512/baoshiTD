package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"strings"
	"time"

	"baoshiTD/internal/store"
	"baoshiTD/pkg/response"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

var jwtSecret = []byte("baoshiTD-dev-secret-change-me-in-prod-xxxxxxxxx")

func init() {
	if s := os.Getenv("TD_JWT_SECRET"); s != "" && len(s) >= 16 {
		jwtSecret = []byte(s)
	}
}

// JwtClaims TD 自定义 claims
type JwtClaims struct {
	UID      uint   `json:"uid"`
	Username string `json:"un"`
	jwt.RegisteredClaims
}

// newJti 生成随机会话ID（16字节 hex = 32字符，够用且无歧义）
func newJti() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// 概率极低，fallback 用纳秒时间戳 + 随机组合
		return hex.EncodeToString([]byte(time.Now().Format("20060102150405.000000000")))
	}
	return hex.EncodeToString(b)
}

// GenerateJWT 生成 Token (7天过期默认) + 返回 jti（用于单点登录写到 Account.ActiveSessionJti）
func GenerateJWT(uid uint, username string, days int) (token string, expUnix int64, jti string, err error) {
	if days <= 0 {
		days = 7
	}
	exp := time.Now().Add(time.Duration(days) * 24 * time.Hour)
	jti = newJti()
	claims := JwtClaims{
		UID:      uid,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti, // jti — 单点登录互斥校验核心
			ExpiresAt: jwt.NewNumericDate(exp),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "baoshiTD",
			Subject:   username,
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tok, e := t.SignedString(jwtSecret)
	return tok, exp.Unix(), jti, e
}

// AuthRequired JWT 中间件：解析 Authorization: Bearer <token>，写入 ctx uid/username
// 同时做单点登录互斥校验：JWT 的 jti 必须等于 Account.ActiveSessionJti，否则视为"别处登录"踢下线
func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.GetHeader("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			response.Unauthorized(c, "缺少 Authorization: Bearer <token>")
			c.Abort()
			return
		}
		raw := strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
		if raw == "" {
			response.Unauthorized(c, "token 为空")
			c.Abort()
			return
		}
		claims := &JwtClaims{}
		tok, err := jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return jwtSecret, nil
		})
		if err != nil || !tok.Valid {
			response.Unauthorized(c, "token 无效或已过期："+err.Error())
			c.Abort()
			return
		}
		// --- 单点登录互斥校验 ---
		jti := claims.RegisteredClaims.ID
		ok, needKick := store.CheckActiveSession(claims.UID, jti)
		if !ok {
			if needKick {
				// 明确告诉前端：是别的地方登录顶掉了，前端按约定自动 logout + toast
				response.KickByOtherSession(c, "您的账号已在其他地方登录，当前会话已下线（单点登录互斥）。")
			} else {
				response.Unauthorized(c, "账号不存在或会话无效")
			}
			c.Abort()
			return
		}
		c.Set("uid", claims.UID)
		c.Set("username", claims.Username)
		c.Set("jti", jti)
		c.Next()
	}
}

// UIDFromCtx 从 Gin Context 拿 uid (AuthRequired 之后一定存在)
func UIDFromCtx(c *gin.Context) uint {
	v, _ := c.Get("uid")
	u, _ := v.(uint)
	return u
}
