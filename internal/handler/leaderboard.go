package handler

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"baoshiTD/internal/middleware"
	"baoshiTD/internal/store"

	"github.com/gin-gonic/gin"
)

// LeaderboardList 返回 (mapId × difficulty) 组合下排行榜 TopK
// GET /api/td/leaderboard?mapId=1&difficulty=normal&k=10
// —— 所有参数可选，默认 (1, normal, 10)
func LeaderboardList(c *gin.Context) {
	mapId, _ := strconv.Atoi(strings.TrimSpace(c.Query("mapId")))
	if mapId <= 0 {
		mapId = 1
	} else if mapId > 3 {
		mapId = 3
	}
	difficulty := strings.ToLower(strings.TrimSpace(c.Query("difficulty")))
	switch difficulty {
	case "normal", "hard", "nightmare":
	default:
		difficulty = "normal"
	}
	k, _ := strconv.Atoi(strings.TrimSpace(c.Query("k")))
	if k <= 0 {
		k = 10
	}
	if k > 50 {
		k = 50
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	rows, err := store.TopLeaderboard(ctx, mapId, difficulty, k)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"ok":         false,
			"msg":        err.Error(),
			"mapId":      mapId,
			"difficulty": difficulty,
			"k":          k,
			"rows":       []interface{}{},
		})
		return
	}
	if rows == nil {
		rows = []store.LeaderboardRow{}
	}
	c.JSON(http.StatusOK, gin.H{
		"ok":         true,
		"mapId":      mapId,
		"difficulty": difficulty,
		"k":          k,
		"rows":       rows,
		"queriedAt":  time.Now().UnixMilli(),
	})
}

// AccountTalentsPatch 登录态更新 talentNodes / talentPointsAvailable
// PATCH /api/td/account/talents (JWT Required)
// Body: { talentNodes: ["dmg1",...], talentPointsAvailable: 5 }
func AccountTalentsPatch(c *gin.Context) {
	uid := middleware.UIDFromCtx(c)
	if uid == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "msg": "需要先登录"})
		return
	}
	var body struct {
		TalentNodes           []string `json:"talentNodes"`
		TalentPointsAvailable *int     `json:"talentPointsAvailable,omitempty"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "msg": "invalid body: " + err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := store.PatchTalents(ctx, uid, body.TalentNodes, body.TalentPointsAvailable); err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AccountUnlockedMapsPatch 登录态更新 unlockedMaps
// PATCH /api/td/account/unlocked (JWT Required)
// Body: { unlockedMaps: [1, 2] } 或 map {1:true, 2:true}（都兼容）
func AccountUnlockedMapsPatch(c *gin.Context) {
	uid := middleware.UIDFromCtx(c)
	if uid == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "msg": "需要先登录"})
		return
	}
	var body struct {
		UnlockedMaps interface{} `json:"unlockedMaps"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "msg": "invalid body: " + err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := store.PatchUnlockedMaps(ctx, uid, body.UnlockedMaps); err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
