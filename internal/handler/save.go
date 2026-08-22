package handler

import (
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
// 为避免 ShouldBindJSON 强类型报错，先 map[string]interface{} 接收再转；MVP 直接用宽松结构体
type SavePOSTBody struct {
	Version        int         `json:"version"`
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
}

// SaveGetResponse GET返回：无存档 data=null，否则 SaveRecord 数据
type SaveGetResponse struct {
	HasSave bool                  `json:"hasSave"`
	Record  *model.GameSaveRecord `json:"record,omitempty"`
}

// saveSetResponse POST成功返回
type saveSetResponse struct {
	Saved   bool      `json:"saved"`
	IsAuto  bool      `json:"isAuto"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// SaveGET GET /api/save
func SaveLoad(c *gin.Context) {
	uid := middleware.UIDFromCtx(c)
	if uid == 0 {
		response.Unauthorized(c, "无效用户")
		return
	}
	rec := store.GetSave(uid)
	if rec == nil {
		// 无存档：返回200 data=null 方案
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
	// 3.12 防作弊：BATTLE阶段禁止写入（除非是服务器端强制？MVP 用户永远不能写BATTLE）
	if body.Phase == "BATTLE" {
		response.Forbidden(c, "战斗中禁止保存(防作弊)，请等待波末或重开")
		return
	}
	now := time.Now().UTC()
	// 对Tiles不做长度校验（前端决定）
	rec := &model.GameSaveRecord{
		Version:        body.Version,
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
	store.SetSave(uid, rec)
	response.Success(c, saveSetResponse{
		Saved:     true,
		IsAuto:    body.IsAuto,
		UpdatedAt: now,
	})
}
