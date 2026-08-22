package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"time"
)

// Account 玩家账号（v3-1 MVP 先内存存，后续替换为SQLite users表）
type Account struct {
	ID           uint      `json:"uid"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"` // 永不序列化
	CreatedAt    time.Time `json:"created_at"`
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

// GameSaveRecord 游戏存档（按 uid 唯一 => MVP 每个账号 1 个当前存档 + 1 个 autosave 也合成这一个，version递增）
// 后续 SQLite save表：uid PK FK, phase luckLevel gold baseHP waveIndex TEXT(tiles JSON) TEXT(grid JSON) TEXT(buffs JSON) isAuto updatedAt
type GameSaveRecord struct {
	Version        int         `json:"version"`      // 存档格式版本 (1)
	Phase          string      `json:"phase"`        // MENU / PREPARE / RESERVE / BATTLE / WAVEEND / WIN / LOSE
	LuckLevel      int         `json:"luckLevel"`
	Gold           int         `json:"gold"`
	BaseHP         int         `json:"baseHP"`
	BaseMaxHP      int         `json:"baseMaxHP,omitempty"`
	WaveIndex      int         `json:"waveIndex"`
	Tiles          []uint8     `json:"tiles,omitempty"`   // 地图tile快照；MarshalJSON转为int数组（Go默认[]uint8→base64不可读）
	Grid           interface{} `json:"grid,omitempty"`    // 前端grid数组对象 (含塔instId/towerCfgId/wall等)
	ActiveBuffs    interface{} `json:"activeBuffs,omitempty"`
	PlacementUsed  int         `json:"placementUsed,omitempty"`
	PlacementTotal int         `json:"placementTotal,omitempty"`
	IsAuto         bool        `json:"isAuto,omitempty"` // 是否自动存档
	SavedAt        time.Time   `json:"savedAt"`
	UpdatedAt      time.Time   `json:"updatedAt"`
}

// MarshalJSON 修复 []uint8(Tiles) 默认base64编码 → int数组，与MapDetail.Tiles保持一致
func (r GameSaveRecord) MarshalJSON() ([]byte, error) {
	// 先把 Tiles 换成 []int
	type aliasT struct {
		Version        int         `json:"version"`
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
		a.Tiles = r.Tiles // nil 保持 omit
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
