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

	// === 双开覆盖写防护（存档乐观锁）===
	// ifMatchUpdatedAt: 客户端上次从服务器读到（或上次 save 返回）的存档 updatedAt（ISO 字符串）。
	//  - 若客户端从无存档开始保存，传空字符串 或 "ZERO"（走 expectZero=true）
	//  - 服务器拿该时间戳与服务器现存存档的 UpdatedAt 按毫秒级比对
	//  - 不一致则返回 40901 冲突（说明在此期间另一 Tab/浏览器已写入过），前端提示读档
	IfMatchUpdatedAt string `json:"ifMatchUpdatedAt,omitempty"`
	// ifNoneExist: 与上面等价，true=期望存档不存在
	IfNoneExist bool `json:"ifNoneExist,omitempty"`
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
	// === 乐观锁解析 & 检查 ===
	// 规则优先级：
	//   1. body.IfNoneExist=true                   → 期望服务器存档不存在 (expectZero)
	//   2. body.IfMatchUpdatedAt in ["","ZERO"]    → 期望服务器存档不存在 (同上，客户端友好写法)
	//   3. body.IfMatchUpdatedAt = RFC3339 字符串   → 解析成时间戳，与服务器现存存档比对毫秒级相等
	//   4. 未提供 / 解析失败                        → 兼容模式直接写（旧前端/契约测试）
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
			// 解析失败 → 视为未提供（兼容性 fallback），不报错，走兼容模式
		}
	}
	ok, conflict, serverAt := store.SetSaveWithCheck(uid, rec, expectUpdatedAt, expectZero)
	if conflict {
		msg := "存档版本冲突（该账号的存档已在其他页面/浏览器更新过，请先读档）。"
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
