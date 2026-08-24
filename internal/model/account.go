package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"time"
)

// Account 玩家账号（v3-1 MVP 先内存存，后续替换为SQLite users表）
type Account struct {
	ID               uint      `json:"uid"`
	Username         string    `json:"username"`
	PasswordHash     string    `json:"-"` // 永不序列化
	CreatedAt        time.Time `json:"created_at"`
	ActiveSessionJti string    `json:"-"` // 单点登录：当前唯一有效JWT的jti（新登录会覆盖，旧token立刻失效）
	ActiveSessionAt  time.Time `json:"-"` // 该jti发放时间（调试用）
	// V4-1: 跨局持久化（V4-2/V4-7 用；DB 中 users 表列 JSON/INT 存储；若从未写入则 nil / 0）
	UnlockedMaps          []string `json:"unlockedMaps,omitempty"` // e.g. ["map-1","map-2"] 或 map id 字符串集
	TalentNodes           []string `json:"talentNodes,omitempty"`  // 已点亮天赋节点 id 列表
	TalentPointsAvailable int      `json:"talentPointsAvailable"`  // 可用天赋点数
}

// RegisterRequest 注册请求
type RegisterRequest struct {
	Username string `json:"username" binding:"required,min=2,max=32"`
	Password string `json:"password" binding:"required,min=6,max=64"`
}

// LoginRequest 登录请求
type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// TokenResponse 登录/注册成功返回
type TokenResponse struct {
	UID      uint   `json:"uid"`
	Username string `json:"username"`
	Token    string `json:"token"` // JWT
	Expires  int64  `json:"exp"`   // Unix秒
}

// GameSaveRecord 游戏存档（V4-1 升级：复合 PK (uid, mapId, difficulty)，每个"难度×地图"桶各一份独立存档）
// 老 V3 存档（只有 uid PK）：读档时自动补默认 mapId=1 / difficulty="normal"（AC-20 兼容）
type GameSaveRecord struct {
	Version        int         `json:"version"`    // 存档格式版本 (2 = V4-1；老 V3=1 加载兼容)
	MapId          int         `json:"mapId"`      // V4-1：地图 ID（默认 1=草原）
	Difficulty     string      `json:"difficulty"` // V4-1：难度 ("normal"|"hard"|"nightmare")
	Phase          string      `json:"phase"`      // MENU / PREPARE / RESERVE / BATTLE / WAVEEND / WIN / LOSE
	LuckLevel      int         `json:"luckLevel"`
	Gold           int         `json:"gold"`
	BaseHP         int         `json:"baseHP"`
	BaseMaxHP      int         `json:"baseMaxHP,omitempty"`
	WaveIndex      int         `json:"waveIndex"`
	Tiles          []uint8     `json:"tiles,omitempty"` // 地图tile快照；MarshalJSON转为int数组（Go默认[]uint8→base64不可读）
	Grid           interface{} `json:"grid,omitempty"`  // 前端grid数组对象 (含塔instId/towerCfgId/wall等)
	ActiveBuffs    interface{} `json:"activeBuffs,omitempty"`
	PlacementUsed  int         `json:"placementUsed,omitempty"`
	PlacementTotal int         `json:"placementTotal,omitempty"`
	IsAuto         bool        `json:"isAuto,omitempty"` // 是否自动存档
	SavedAt        time.Time   `json:"savedAt"`
	UpdatedAt      time.Time   `json:"updatedAt"`
}

// MarshalJSON 修复 []uint8(Tiles) 默认base64编码 → int数组，与MapDetail.Tiles保持一致
func (r GameSaveRecord) MarshalJSON() ([]byte, error) {
	type aliasT struct {
		Version        int         `json:"version"`
		MapId          int         `json:"mapId"`
		Difficulty     string      `json:"difficulty"`
		Phase          string      `json:"phase"`
		LuckLevel      int         `json:"luckLevel"`
		Gold           int         `json:"gold"`
		BaseHP         int         `json:"baseHP"`
		BaseMaxHP      int         `json:"baseMaxHP,omitempty"`
		WaveIndex      int         `json:"waveIndex"`
		Tiles          interface{} `json:"tiles,omitempty"`
		Grid           interface{} `json:"grid,omitempty"`
		ActiveBuffs    interface{} `json:"activeBuffs,omitempty"`
		PlacementUsed  int         `json:"placementUsed,omitempty"`
		PlacementTotal int         `json:"placementTotal,omitempty"`
		IsAuto         bool        `json:"isAuto,omitempty"`
		SavedAt        time.Time   `json:"savedAt"`
		UpdatedAt      time.Time   `json:"updatedAt"`
	}
	a := aliasT{
		Version:        r.Version,
		MapId:          r.MapId,
		Difficulty:     r.Difficulty,
		Phase:          r.Phase,
		LuckLevel:      r.LuckLevel,
		Gold:           r.Gold,
		BaseHP:         r.BaseHP,
		BaseMaxHP:      r.BaseMaxHP,
		WaveIndex:      r.WaveIndex,
		Grid:           r.Grid,
		ActiveBuffs:    r.ActiveBuffs,
		PlacementUsed:  r.PlacementUsed,
		PlacementTotal: r.PlacementTotal,
		IsAuto:         r.IsAuto,
		SavedAt:        r.SavedAt,
		UpdatedAt:      r.UpdatedAt,
	}
	if len(r.Tiles) > 0 {
		ints := make([]int, len(r.Tiles))
		for i := range r.Tiles {
			ints[i] = int(r.Tiles[i])
		}
		a.Tiles = ints
	} else {
		a.Tiles = r.Tiles
	}
	// 用 alias 序列化避免递归 MarshalJSON
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(a); err != nil {
		return nil, fmt.Errorf("GameSaveRecord Marshal: %w", err)
	}
	out := buf.Bytes()
	// Encode 会追加换行
	if len(out) > 0 && out[len(out)-1] == '\n' {
		out = out[:len(out)-1]
	}
	return out, nil
}
