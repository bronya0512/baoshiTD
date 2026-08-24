package handler

import (
	"strconv"
	"strings"
	"time"

	"baoshiTD/internal/middleware"
	"baoshiTD/internal/model"
	"baoshiTD/internal/store"
	"baoshiTD/pkg/response"

	"github.com/gin-gonic/gin"
)

// ============================================================
// Save Handler
// - GET  /api/save    读取当前账号存档（无存档返回 data=null）
// - POST /api/save    写入（BATTLE 阶段返回 403 防作弊）
// 每个账号 1 个存档格（MVP 简单版）
// ============================================================

// SavePOSTBody 允许的存档字段（契约测试字段一致）
type SavePOSTBody struct {
	Version        int         `json:"version"`
	MapId          int         `json:"mapId"`      // V4-1: 存档的地图ID（1=草原；缺省=1）
	Difficulty     string      `json:"difficulty"` // V4-1: 存档的难度 normal/hard/nightmare（缺省=normal）
	Phase          string      `json:"phase" binding:"required"`
	LuckLevel      int         `json:"luckLevel"`
	Gold           int         `json:"gold"`
	BaseHP         int         `json:"baseHP"`
	BaseMaxHP      int         `json:"baseMaxHP"`
	WaveIndex      int         `json:"waveIndex"`
	Tiles          []uint8     `json:"tiles"`
	Grid           interface{} `json:"grid"`
	ActiveBuffs    interface{} `json:"activeBuffs"`
	PlacementUsed  int         `json:"placementUsed"`
	PlacementTotal int         `json:"placementTotal"`
	IsAuto         bool        `json:"isAuto"`

	// === 双开覆盖写防护（存档乐观锁）===
	IfMatchUpdatedAt string `json:"ifMatchUpdatedAt,omitempty"`
	IfNoneExist      bool   `json:"ifNoneExist,omitempty"`
}

// SaveGetResponse GET返回：无存档 data=null，否则 SaveRecord 数据
type SaveGetResponse struct {
	HasSave bool                  `json:"hasSave"`
	Record  *model.GameSaveRecord `json:"record,omitempty"`
}

// saveSetResponse POST成功返回
type saveSetResponse struct {
	Saved     bool      `json:"saved"`
	IsAuto    bool      `json:"isAuto"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// parseMapDifficulty 从 query/body 解析 (mapId, difficulty)，缺省走 (1/"normal")
func parseMapDifficulty(mapIdRaw string, difficultyRaw string, bodyMapId int, bodyDiff string) (int, string) {
	mapId := bodyMapId
	if mapIdRaw != "" {
		if v, err := strconv.Atoi(mapIdRaw); err == nil && v > 0 {
			mapId = v
		}
	}
	difficulty := strings.ToLower(strings.TrimSpace(bodyDiff))
	if difficultyRaw != "" {
		difficulty = strings.ToLower(strings.TrimSpace(difficultyRaw))
	}
	if mapId == 0 {
		mapId = 1
	}
	if difficulty == "" {
		difficulty = "normal"
	}
	// 白名单（防止写入脏值）
	switch difficulty {
	case "normal", "hard", "nightmare":
	default:
		difficulty = "normal"
	}
	return mapId, difficulty
}

// SaveGET GET /api/save
// Query: mapId=1&difficulty=normal（缺省分别为 1/normal；即 V3 唯一桶）
func SaveLoad(c *gin.Context) {
	uid := middleware.UIDFromCtx(c)
	if uid == 0 {
		response.Unauthorized(c, "无效用户")
		return
	}
	mapId, difficulty := parseMapDifficulty(c.Query("mapId"), c.Query("difficulty"), 0, "")
	rec := store.GetSave(uid, mapId, difficulty)
	if rec == nil {
		response.Success(c, nil)
		return
	}
	response.Success(c, rec)
}

// SaveSave POST /api/save
func SaveSave(c *gin.Context) {
	uid := middleware.UIDFromCtx(c)
	if uid == 0 {
		response.Unauthorized(c, "无效用户")
		return
	}
	var body SavePOSTBody
	if err := c.ShouldBindJSON(&body); err != nil {
		response.BadRequest(c, "存档数据格式错误: "+err.Error())
		return
	}
	// 3.12 防作弊：BATTLE阶段禁止写入
	if body.Phase == "BATTLE" {
		response.Forbidden(c, "战斗中禁止保存(防作弊)，请等待波末或重开")
		return
	}
	mapId, difficulty := parseMapDifficulty("", "", body.MapId, body.Difficulty)
	now := time.Now().UTC()
	rec := &model.GameSaveRecord{
		Version:        body.Version,
		MapId:          mapId,
		Difficulty:     difficulty,
		Phase:          body.Phase,
		LuckLevel:      body.LuckLevel,
		Gold:           body.Gold,
		BaseHP:         body.BaseHP,
		BaseMaxHP:      body.BaseMaxHP,
		WaveIndex:      body.WaveIndex,
		Tiles:          body.Tiles,
		Grid:           body.Grid,
		ActiveBuffs:    body.ActiveBuffs,
		PlacementUsed:  body.PlacementUsed,
		PlacementTotal: body.PlacementTotal,
		IsAuto:         body.IsAuto,
		SavedAt:        now,
		UpdatedAt:      now,
	}
	// 乐观锁解析
	var expectUpdatedAt time.Time
	expectZero := false
	if body.IfNoneExist {
		expectZero = true
	} else if body.IfMatchUpdatedAt != "" {
		if body.IfMatchUpdatedAt == "ZERO" {
			expectZero = true
		} else {
			if parsed, pe := time.Parse(time.RFC3339Nano, body.IfMatchUpdatedAt); pe == nil {
				expectUpdatedAt = parsed
			} else if parsed2, pe2 := time.Parse(time.RFC3339, body.IfMatchUpdatedAt); pe2 == nil {
				expectUpdatedAt = parsed2
			}
		}
	}
	ok, conflict, serverAt := store.SetSaveWithCheck(uid, rec, expectUpdatedAt, expectZero)
	if conflict {
		msg := "存档版本冲突（该账号的地图×难度存档已在其他页面/浏览器更新过，请先读档）。"
		if !serverAt.IsZero() {
			msg += "服务器存档时间: " + serverAt.UTC().Format(time.RFC3339)
		}
		response.SaveVersionConflict(c, msg)
		return
	}
	if !ok {
		response.ServerError(c, "写入存档失败（内部状态错误）")
		return
	}
	response.Success(c, saveSetResponse{
		Saved:     true,
		IsAuto:    body.IsAuto,
		UpdatedAt: serverAt,
	})
}
