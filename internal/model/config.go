package model

import "encoding/json"

// TowerLevel 塔等级数据（对应 openapi TowerConfig.levels.item）
type TowerLevel struct {
	Level         int     `json:"level"`
	BaseDamage    float64 `json:"baseDamage"`
	AttackRange   float64 `json:"attackRange"`   // 格
	AttackSpeed   float64 `json:"attackSpeed"`   // 次/秒
	Cost          int     `json:"cost"`
	UpgradeCost   int     `json:"upgradeCost"`
}

// TowerConfig 塔配置（openapi TowerConfig）
type TowerConfig struct {
	ID           uint          `json:"id"`
	Name         string        `json:"name"`
	Element      string        `json:"element"` // fire/ice/thunder/poison/light/dark
	Rarity       string        `json:"rarity"`  // common/rare/epic/legendary（v2 新增）
	SpineAsset   string        `json:"spineAsset,omitempty"`
	Description  string        `json:"description,omitempty"`
	Levels       []TowerLevel  `json:"levels"`
	CanTargetFly bool          `json:"canTargetFly"`
	// ---- MVP 扩展：OpenAPI 里没有，但 spec.md 里要求 AOE ----
	// 放这里供前端直接使用；同时在 levels[0] 里通过 attackSpeed 推 attackInterval。
	IsAOE        bool    `json:"isAOE"`
	AOERadiusPx  float64 `json:"aoeRadiusPx"`
	Color        string  `json:"color,omitempty"`       // 画 Canvas 用（CSS 颜色）
}

// EnemyConfig 敌人配置（openapi EnemyConfig）
type EnemyConfig struct {
	ID           uint               `json:"id"`
	Name         string             `json:"name"`
	Type         string             `json:"type"` // normal/flying/heavy/swift/resistant/elite/boss
	SpineAsset   string             `json:"spineAsset,omitempty"`
	SpineLevel   string             `json:"spineLevel,omitempty"`
	BaseHP       float64            `json:"baseHP"`
	Speed        float64            `json:"speed"`        // 像素/秒
	Armor        float64            `json:"armor"`
	Resistances  map[string]float64 `json:"resistances"`
	Flying       bool               `json:"flying"`
	IsBoss       bool               `json:"isBoss"`
	IsElite      bool               `json:"isElite"`
	DropGemRate  float64            `json:"dropGemRate"` // 保留（v1 兼容），v2 不再作为主路径
	// ---- v2 简化（无宝石背包）：击杀金币 + 额外奖励命中概率 ----
	KillBaseGold int                `json:"killBaseGold"`   // 基础击杀金币
	DropBonusRate float64           `json:"dropBonusRate"`  // 死亡时按 luck 进行 bonusRarity roll 的命中概率 0..1
	// ---- MVP 扩展 ----
	RewardCoin   int                `json:"rewardCoin"`
	DamageToBase int                `json:"damageToBase"`
	Color        string             `json:"color,omitempty"`
	RadiusPx     float64            `json:"radiusPx"`
}

// GemElementBonus 元素基础加成（GemConfig.elements[].baseBonus）
type GemElementBonus struct {
	AttrMulDamage           float64 `json:"attrMulDamage,omitempty"`
	AttrMulAttackInterval   float64 `json:"attrMulAttackInterval,omitempty"` // 攻击间隔倍率 (0.83 = +20% 攻速)
	AttrMulRange            float64 `json:"attrMulRange,omitempty"`
	SlowOnHitPct01          float64 `json:"slowOnHitPct01,omitempty"`          // 0..1，例如 0.3=30% 减速
	SlowOnHitSec            float64 `json:"slowOnHitSec,omitempty"`            // 持续秒数
	KillGemChanceAdd01      float64 `json:"killGemChanceAdd01,omitempty"`      // 0..1，额外掉率
}

// GemElement 宝石元素
type GemElement struct {
	Key       string           `json:"key"` // fire/ice/thunder/poison/light/dark
	Name      string           `json:"name"`
	Color     string           `json:"color"`
	BaseBonus GemElementBonus  `json:"baseBonus"`
}

// GemRarity 宝石稀有度/等级
type GemRarity struct {
	Key        string  `json:"key"`   // common/rare/epic/legendary/mythic
	Name       string  `json:"name"`
	Multiplier float64 `json:"multiplier"`
	DropRate   float64 `json:"dropRate"`   // 加权掉落概率
}

// SynRule 合成规则（GemConfig.synthesisRules[i]）
type SynRule struct {
	Inputs []string `json:"inputs"`
	Output SynOut  `json:"output"`
}

// SynOut 合成产物
type SynOut struct {
	Element       string `json:"element,omitempty"`
	Rarity        string `json:"rarity,omitempty"`
	SpecialEffect string `json:"specialEffect,omitempty"`
}

// GemConfig 宝石配置（openapi GemConfig）
type GemConfig struct {
	Elements       []GemElement `json:"elements"`
	Rarities       []GemRarity  `json:"rarities"`
	SynthesisRules []SynRule    `json:"synthesisRules,omitempty"`
}

// WaveGroup 波次里的敌人组
type WaveGroup struct {
	EnemyID  uint    `json:"enemyId"`
	Count    int     `json:"count"`
	Interval float64 `json:"interval"`
	Delay    float64 `json:"delay"`
}

// WaveReward 波次奖励
type WaveReward struct {
	Gold     int `json:"gold"`
	GemRolls int `json:"gemRolls"` // 保留兼容
}

// WaveConfig 波次配置（openapi WaveConfig）
type WaveConfig struct {
	Wave              int         `json:"wave"`
	Groups            []WaveGroup `json:"groups"`
	Reward            WaveReward  `json:"reward,omitempty"`
	IsBossWave        bool        `json:"isBossWave,omitempty"`
	PlacementPerWave  int         `json:"placementPerWave"`   // v2 新增：本波 PREPARE 给玩家多少次放置（缺省 5）
	RewardGold        int         `json:"rewardGold"`         // v2 新增：波末直接发放的奖励金币（便于 fallback 对比，同时保留 Reward.Gold）
}

// ====================================================================
// v2 新增：运气等级 + 全局增益 Buff 配置契约
// ====================================================================

// LuckLevel 单一运气等级条目（对应 /api/config/luck.levels[i]）
type LuckLevel struct {
	Level              int               `json:"level"`
	UpgradeCostGold    *int              `json:"upgradeCostGold"`   // 一级为 null；其余为正整数
	TowerRarityWeights map[string]int    `json:"towerRarityWeights"` // rarity -> weight
	BonusRarityWeights map[string]int    `json:"bonusRarityWeights"` // rarity -> weight（替代 gemRarityWeights）
}

// LuckConfig 运气等级系统整体
type LuckConfig struct {
	InitialLevel int         `json:"initialLevel"`
	Levels       []LuckLevel `json:"levels"`
}

// BuffEffect Buff 的属性乘数效果（未列出字段 = 0/nil 即不生效）
type BuffEffect struct {
	TowerDamageMulAll           *float64 `json:"towerDamageMulAll,omitempty"`           // e.g. 1.15 = +15% 全体塔伤害
	TowerAttackIntervalMulAll   *float64 `json:"towerAttackIntervalMulAll,omitempty"`   // e.g. 0.83 = 缩短攻击间隔 ≈+20% 射速
	TowerRangeMulAll            *float64 `json:"towerRangeMulAll,omitempty"`            // e.g. 1.15 = 全体塔射程 +15%
	KillGoldMulAll              *float64 `json:"killGoldMulAll,omitempty"`              // e.g. 1.20 = 击杀金币 +20%
	SlowStrengthMulAll          *float64 `json:"slowStrengthMulAll,omitempty"`          // e.g. 1.20 = 冰塔减速效果 +20%
	KillBonusGoldChanceAddAll   *float64 `json:"killBonusGoldChanceAddAll,omitempty"`   // e.g. 0.10 = 额外奖励命中概率 +0.10（加算）
}

// BuffConfigItem 单条 Buff（buffs[i]）
type BuffConfigItem struct {
	ID     string     `json:"id"`     // e.g. atk_1
	Name   string     `json:"name"`   // e.g. 攻击+15%
	Rarity string     `json:"rarity"` // common/rare/epic/legendary
	Effect BuffEffect `json:"effect"`
}

// BuffsConfig 全局增益抽取配置
type BuffsConfig struct {
	RollCostGold      int                 `json:"rollCostGold"`      // 抽一次花费
	Buffs             []BuffConfigItem    `json:"buffs"`             // Buff 池（>=8条）
	RollRarityWeights map[string]map[string]int `json:"rollRarityWeights"` // key = luckLevel(1..N) string → rarity→weight
}

// MapInfo 地图元信息
type MapInfo struct {
	ID          uint   `json:"id"`
	Name        string `json:"name"`
	Theme       string `json:"theme"`
	Difficulty  int    `json:"difficulty"`
	MaxWaves    int    `json:"maxWaves"`
	ThumbnailURL string `json:"thumbnailUrl,omitempty"`
}

// MapSpawnPoint 出生点
type MapSpawnPoint struct {
	X int `json:"x"`
	Y int `json:"y"`
}

// MapBase 基地
type MapBase struct {
	X  int `json:"x"`
	Y  int `json:"y"`
	HP int `json:"hp"`
}

// MapDetail 地图详情（含网格）
type MapDetail struct {
	MapInfo
	GridWidth     int             `json:"gridWidth"`
	GridHeight    int             `json:"gridHeight"`
	CellSize      int             `json:"cellSize"`
	SpawnPoints   []MapSpawnPoint `json:"spawnPoints"`
	Base          MapBase         `json:"base"`
	BuildableCells [][2]int       `json:"buildableCells,omitempty"` // 可建造集合（MVP 可以不用，因为前端默认 tile=0 即草地可建）
	// ---- MVP 内置的地图 tile：0=草 1=石 2=S 3=E，长度 GridWidth*GridHeight ----
	Tiles         []uint8         `json:"-"`
}

// MapDetailTilesExport 用于 MarshalJSON 时导出 tiles 为数字数组（而不是 encoding/json 默认的 base64 byte 串）
func (m MapDetail) MarshalJSON() ([]byte, error) {
	out := map[string]interface{}{
		"id":             m.ID,
		"name":           m.Name,
		"theme":          m.Theme,
		"difficulty":     m.Difficulty,
		"maxWaves":       m.MaxWaves,
		"thumbnailUrl":   m.ThumbnailURL,
		"gridWidth":      m.GridWidth,
		"gridHeight":     m.GridHeight,
		"cellSize":       m.CellSize,
		"spawnPoints":    m.SpawnPoints,
		"base":           m.Base,
	}
	if len(m.BuildableCells) > 0 { out["buildableCells"] = m.BuildableCells }
	tiles := make([]int, len(m.Tiles))
	for i, v := range m.Tiles { tiles[i] = int(v) }
	out["tiles"] = tiles
	return json.Marshal(out)
}
