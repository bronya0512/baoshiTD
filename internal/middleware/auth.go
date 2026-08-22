package middleware

import (
	"os"
	"strings"
	"time"

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

// GenerateJWT 生成 Token (7天过期默认)
func GenerateJWT(uid uint, username string, days int) (string, int64, error) {
	if days <= 0 {
		days = 7
	}
	exp := time.Now().Add(time.Duration(days) * 24 * time.Hour)
	claims := JwtClaims{
		UID:      uid,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(exp),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "baoshiTD",
			Subject:   username,
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tok, err := t.SignedString(jwtSecret)
	return tok, exp.Unix(), err
}

// AuthRequired JWT 中间件：解析 Authorization: Bearer <token>，写入 ctx uid/username
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
		c.Set("uid", claims.UID)
		c.Set("username", claims.Username)
		c.Next()
	}
}

// UIDFromCtx 从 Gin Context 拿 uid (AuthRequired 之后一定存在)
func UIDFromCtx(c *gin.Context) uint {
	v, _ := c.Get("uid")
	u, _ := v.(uint)
	return u
}
