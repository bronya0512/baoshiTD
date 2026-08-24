package model

import "encoding/json"

// TowerLevel 塔等级数据（对应 openapi TowerConfig.levels.item）
type TowerLevel struct {
	Level       int     `json:"level"`
	BaseDamage  float64 `json:"baseDamage"`
	AttackRange float64 `json:"attackRange"` // 格
	AttackSpeed float64 `json:"attackSpeed"` // 次/秒
	Cost        int     `json:"cost"`
	UpgradeCost int     `json:"upgradeCost"`
}

// TowerConfig 塔配置（openapi TowerConfig）
type TowerConfig struct {
	ID           uint         `json:"id"`
	Name         string       `json:"name"`
	Code         string       `json:"code,omitempty"`    // v4: 可选内部标识，如 FUSION_EPIC
	Element      string       `json:"element"`           // fire/ice/thunder/poison/light/dark / mixed (special)
	Rarity       string       `json:"rarity"`            // common/rare/epic/legendary（v2 新增）
	Special      bool         `json:"special,omitempty"` // v4: true = 只能通过 C 类配方产出，不参与 AB 类合成与 Roll
	SpineAsset   string       `json:"spineAsset,omitempty"`
	Description  string       `json:"description,omitempty"`
	Levels       []TowerLevel `json:"levels"`
	CanTargetFly bool         `json:"canTargetFly"`
	// ---- MVP 扩展：OpenAPI 里没有，但 spec.md 里要求 AOE ----
	// 放这里供前端直接使用；同时在 levels[0] 里通过 attackSpeed 推 attackInterval。
	IsAOE       bool    `json:"isAOE"`
	AOERadiusPx float64 `json:"aoeRadiusPx"`
	Color       string  `json:"color,omitempty"` // 画 Canvas 用（CSS 颜色）
	// ---- v4 特殊塔专属：被动增益 ID + 文案 ----
	PassiveID   string `json:"passiveId,omitempty"`
	PassiveDesc string `json:"passiveDesc,omitempty"`
	// ---- V4-7 能量 / 技能解耦：每塔独立配置，允许多塔共享同一个 energyCfgId / skillId ----
	EnergyCfgId string `json:"energyCfgId,omitempty"` // 对应 energy-cfgs.json 的 id；空字符串 => 前端用默认 normal
	SkillId     string `json:"skillId,omitempty"`     // 对应 tower-skills.json 的 id；空字符串 => 前端用默认 double_strike
	// ---- V4-9 伤害类型：physical（缺省，减法护甲）/ magic（百分比法抗）/ true（无视护甲与法抗） ----
	DamageType  string `json:"damageType,omitempty"`
}

// TowerEnergyCfg 塔能量配置（V4-7 独立文件 conf/game/energy-cfgs.json）
// 能量充能规则：每塔独立；允许多塔共享同一个 id（解耦 skill/energy）
type TowerEnergyCfg struct {
	ID        string  `json:"id"`             // 主键：如 normal/fast/slow/ultra_fast
	Max       float64 `json:"max"`            // 能量上限（满能即释放技能）。缺省兜底 = 100
	PerAttack float64 `json:"perAttack"`      // 每次开火 +X 能量。缺省兜底 = 1
	PerSecond float64 `json:"perSecond"`      // 每秒 +X 能量（battleTick.dt * perSecond 累加到当前）。缺省兜底 = 1
	Desc      string  `json:"desc,omitempty"` // 人类可读描述（UI 调试展示）
}

// TowerSkill 塔技能配置（V4-7 独立文件 conf/game/tower-skills.json）
// 类型 skillType：
//   - damage_mult   = 蓄势/重击型：命中时，finalDamageOverride 乘以 damageMul（叠在 AOE/弹射链/副弹 之前统一乘）
//   - armor_pierce  = 穿甲型：额外无视 armorIgnorePct（0~1）目标护甲 + 同时乘 damageMul（默认1.3）
//   - 其他类型（slow/freezecast/autocast/passive 持续生效等）将来扩展。
type TowerSkill struct {
	ID             string  `json:"id"`             // 主键：double_strike / heavy_strike / armor_pierce / frost_explosion ...
	Name           string  `json:"name"`           // 展示名：蓄势一击 / 重击 / 穿甲爆破 / 冰爆术
	Desc           string  `json:"desc,omitempty"` // 技能详情（弹窗展示）
	Icon           string  `json:"icon,omitempty"` // emoji 图标（💥🔨🛡️❄️）
	SkillType      string  `json:"skillType"`      // damage_mult | armor_pierce （后续扩展 autocast / passive）
	DamageMul      float64 `json:"damageMul"`      // 伤害倍率（>=1）。缺省兜底 = 2.0
	ArmorIgnorePct float64 `json:"armorIgnorePct"` // armor_pierce: 0~1，1.0 = 完全无视护甲。缺省 0。零值也序列化避免前端 NaN
	SlowMul        float64 `json:"slowMul"`        // 附带减速：乘算倍率（1 不减速）。1.0=不变，0.5=减速50%。缺省 1
	SlowTicksSec   float64 `json:"slowTicksSec"`   // 减速持续秒数（<=0 不施加）。缺省 0
}

// EnemySkill 敌人/BOSS 主动技能（V4 Task 8）
// firstAtSec: 首次进入战斗多少秒后触发；everySec: 循环间隔（=0 表示只触发一次）
// durationSec: 预警持续时间（meteor 画红圈等）；extra: 技能专属参数（meteor radius / ice slowMul 等）
type EnemySkill struct {
	ID           string                 `json:"id"`                     // "meteor" / "ice"
	FirstAtSec   float64                `json:"firstAtSec"`             // 首触发计时（相对该敌人 spawn 后 battleElapsed 累计）
	EverySec     float64                `json:"everySec"`               // 循环周期，0 表示只放 1 次
	WarningSec   float64                `json:"warningSec,omitempty"`   // 预警时长（秒），默认 1.0
	DurationSec  float64                `json:"durationSec,omitempty"`  // 效果持续（如 ice 冻结 2s）
	WarningColor string                 `json:"warningColor,omitempty"` // Canvas 预警色，如 "#ef4444"
	Extra        map[string]interface{} `json:"extra,omitempty"`        // 技能专属参数（meteor.radiusPx / meteor.stunSec / ice.freezeSec / ice.slowMul 等）
}

// EnemySplitConfig 分裂者死亡产出配置
type EnemySplitConfig struct {
	EnemyID uint `json:"enemyId"` // 分裂出的敌人 cfg id（例如 FAST）
	Count   int  `json:"count"`   // 分裂数量，例如 2
}

// EnemyConfig 敌人配置（openapi EnemyConfig）
type EnemyConfig struct {
	ID          uint               `json:"id"`
	Name        string             `json:"name"`
	Type        string             `json:"type"` // normal/flying/heavy/swift/resistant/elite/boss/shield/healer/summoner/fast/splitter
	SpineAsset  string             `json:"spineAsset,omitempty"`
	SpineLevel  string             `json:"spineLevel,omitempty"`
	BaseHP      float64            `json:"baseHP"`
	Speed       float64            `json:"speed"` // 像素/秒
	Armor       float64            `json:"armor"`
	MagicResist float64            `json:"magicResist,omitempty"` // V4-9 法抗 0~100（百分比减免，仅对 magic 伤害类型生效）
	Resistances map[string]float64 `json:"resistances"`
	Flying      bool               `json:"flying"`
	IsBoss      bool               `json:"isBoss"`
	IsElite     bool               `json:"isElite"`
	DropGemRate float64            `json:"dropGemRate"` // 保留（v1 兼容），v2 不再作为主路径
	// ---- v2 简化（无宝石背包）：击杀金币 + 额外奖励命中概率 ----
	KillBaseGold  int     `json:"killBaseGold"`  // 基础击杀金币
	DropBonusRate float64 `json:"dropBonusRate"` // 死亡时按 luck 进行 bonusRarity roll 的命中概率 0..1
	// ---- MVP 扩展 ----
	RewardCoin   int     `json:"rewardCoin"`
	DamageToBase int     `json:"damageToBase"`
	Color        string  `json:"color,omitempty"`
	RadiusPx     float64 `json:"radiusPx"`
	// ---- V4 Task 7：5 种新精英专属数值 ----
	Shield          float64           `json:"shield,omitempty"`          // SHIELD 初始护盾值（真实伤害优先抵扣，>0 才生效）
	HealPerSec      float64           `json:"healPerSec,omitempty"`      // HEALER：每秒对范围内友军治疗量（>0 才生效）
	HealRadiusCells float64           `json:"healRadiusCells,omitempty"` // HEALER：治疗半径（格），默认 2
	SummonEveryNSec float64           `json:"summonEveryNSec,omitempty"` // SUMMONER：每隔 N 秒召唤，>0 生效
	SummonSpawnID   uint              `json:"summonSpawnId,omitempty"`   // SUMMONER：召唤哪一种 enemy（cfg id），默认 FAST
	SummonCountPer  int               `json:"summonCountPer,omitempty"`  // SUMMONER：每次召唤数量，默认 2
	SplitInto       *EnemySplitConfig `json:"splitInto,omitempty"`       // SPLITTER：死亡时分裂配置
	// ---- V4 Task 8：BOSS 主动技能数组 ----
	Skills []EnemySkill `json:"skills,omitempty"` // 主动技能列表（meteor / ice 等）
}

// GemElementBonus 元素基础加成（GemConfig.elements[].baseBonus）
type GemElementBonus struct {
	AttrMulDamage         float64 `json:"attrMulDamage,omitempty"`
	AttrMulAttackInterval float64 `json:"attrMulAttackInterval,omitempty"` // 攻击间隔倍率 (0.83 = +20% 攻速)
	AttrMulRange          float64 `json:"attrMulRange,omitempty"`
	SlowOnHitPct01        float64 `json:"slowOnHitPct01,omitempty"`     // 0..1，例如 0.3=30% 减速
	SlowOnHitSec          float64 `json:"slowOnHitSec,omitempty"`       // 持续秒数
	KillGemChanceAdd01    float64 `json:"killGemChanceAdd01,omitempty"` // 0..1，额外掉率
}

// GemElement 宝石元素
type GemElement struct {
	Key       string          `json:"key"` // fire/ice/thunder/poison/light/dark
	Name      string          `json:"name"`
	Color     string          `json:"color"`
	BaseBonus GemElementBonus `json:"baseBonus"`
}

// GemRarity 宝石稀有度/等级
type GemRarity struct {
	Key        string  `json:"key"` // common/rare/epic/legendary/mythic
	Name       string  `json:"name"`
	Multiplier float64 `json:"multiplier"`
	DropRate   float64 `json:"dropRate"` // 加权掉落概率
}

// SynRule 合成规则（GemConfig.synthesisRules[i]）
type SynRule struct {
	Inputs []string `json:"inputs"`
	Output SynOut   `json:"output"`
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
	Wave             int         `json:"wave"`
	Groups           []WaveGroup `json:"groups"`
	Reward           WaveReward  `json:"reward,omitempty"`
	IsBossWave       bool        `json:"isBossWave,omitempty"`
	PlacementPerWave int         `json:"placementPerWave"` // v2 新增：本波 PREPARE 给玩家多少次放置（缺省 5）
	RewardGold       int         `json:"rewardGold"`       // v2 新增：波末直接发放的奖励金币（便于 fallback 对比，同时保留 Reward.Gold）
}

// ====================================================================
// v2 新增：运气等级 + 全局增益 Buff 配置契约
// ====================================================================

// LuckLevel 单一运气等级条目（对应 /api/config/luck.levels[i]）
type LuckLevel struct {
	Level              int            `json:"level"`
	UpgradeCostGold    *int           `json:"upgradeCostGold"`    // 一级为 null；其余为正整数
	TowerRarityWeights map[string]int `json:"towerRarityWeights"` // rarity -> weight
	BonusRarityWeights map[string]int `json:"bonusRarityWeights"` // rarity -> weight（替代 gemRarityWeights）
}

// LuckConfig 运气等级系统整体
type LuckConfig struct {
	InitialLevel int         `json:"initialLevel"`
	Levels       []LuckLevel `json:"levels"`
}

// BuffEffect Buff 的属性乘数效果（未列出字段 = 0/nil 即不生效）
type BuffEffect struct {
	TowerDamageMulAll         *float64 `json:"towerDamageMulAll,omitempty"`         // e.g. 1.15 = +15% 全体塔伤害
	TowerAttackIntervalMulAll *float64 `json:"towerAttackIntervalMulAll,omitempty"` // e.g. 0.83 = 缩短攻击间隔 ≈+20% 射速
	TowerRangeMulAll          *float64 `json:"towerRangeMulAll,omitempty"`          // e.g. 1.15 = 全体塔射程 +15%
	KillGoldMulAll            *float64 `json:"killGoldMulAll,omitempty"`            // e.g. 1.20 = 击杀金币 +20%
	SlowStrengthMulAll        *float64 `json:"slowStrengthMulAll,omitempty"`        // e.g. 1.20 = 冰塔减速效果 +20%
	KillBonusGoldChanceAddAll *float64 `json:"killBonusGoldChanceAddAll,omitempty"` // e.g. 0.10 = 额外奖励命中概率 +0.10（加算）
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
	RollCostGold      int                       `json:"rollCostGold"`      // 抽一次花费
	Buffs             []BuffConfigItem          `json:"buffs"`             // Buff 池（>=8条）
	RollRarityWeights map[string]map[string]int `json:"rollRarityWeights"` // key = luckLevel(1..N) string → rarity→weight
}

// MapEnvironment 地图环境 Buff（V4-2 多地图：grass/lava/ice 各自塔/敌乘数 + onTick 钩子）
//
//	乘数全部为倍率，1.0 = 不生效；塔的 Mul 在 calcTowerEffective() 尾部乘入；
//	敌人的 Mul 在 spawnEnemy/stepEnemy 时应用；onTick=lava_damage_5hp 时敌人
//	在 T_LAVA tile 上每 0.5s 受 5 HP 真实伤害。
type MapEnvironment struct {
	ID           string  `json:"id"`               // grass / lava / ice
	Name         string  `json:"name"`             // 草原平原 / 熔岩洞穴 / 冰霜高地
	TowerMul     MulSet  `json:"towerMul"`         // 对塔生效的 Buff 乘数
	EnemyMul     MulSet  `json:"enemyMul"`         // 对敌人生效的 Buff 乘数
	OnTick       string  `json:"onTick,omitempty"` // "lava_damage_5hp" / ""
	LavaDmg      float64 `json:"lavaDmg,omitempty"`
	LavaEverySec float64 `json:"lavaEverySec,omitempty"`
}

// MulSet 一组属性乘数（用于塔/敌人环境 Buff；nil 指针 = 用 1.0 默认）
type MulSet struct {
	DamageMul         *float64 `json:"damageMul,omitempty"`         // 塔：伤害；敌：对基地伤害
	AttackIntervalMul *float64 `json:"attackIntervalMul,omitempty"` // 塔：攻击间隔；敌：攻速
	RangeMul          *float64 `json:"rangeMul,omitempty"`          // 塔：范围
	SpeedMul          *float64 `json:"speedMul,omitempty"`          // 敌：移动速度
	HPMul             *float64 `json:"hpMul,omitempty"`             // 敌：HP 上限（冰霜 ctrl3 -5%）
	ArmorMul          *float64 `json:"armorMul,omitempty"`
}

// MapInfo 地图元信息
type MapInfo struct {
	ID              uint           `json:"id"`
	Name            string         `json:"name"`
	Theme           string         `json:"theme"`
	Difficulty      int            `json:"difficulty"`
	MaxWaves        int            `json:"maxWaves"`
	ThumbnailURL    string         `json:"thumbnailUrl,omitempty"`
	BackgroundImage string         `json:"backgroundImage,omitempty"` // V4-地图背景图；空则走前端纯色格
	Environment     MapEnvironment `json:"environment,omitempty"`     // V4-2 地图环境（maps-list.json 入口即可给出全局 Buff，避免每次查 detail）
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

// MapCheckpoint 必经检测点：敌人必须按顺序经过（起点 → checkpoints[0] → checkpoints[1] → … → 基地）
//
//	建造/拆墙的 terrainGate 会对每段独立跑 A*，任何一段不通就拒绝操作（防分段封路）
type MapCheckpoint struct {
	X int `json:"x"`
	Y int `json:"y"`
}

// MapDetail 地图详情（含网格）
type MapDetail struct {
	MapInfo
	GridWidth      int             `json:"gridWidth"`
	GridHeight     int             `json:"gridHeight"`
	CellSize       int             `json:"cellSize"`
	SpawnPoints    []MapSpawnPoint `json:"spawnPoints"`
	Base           MapBase         `json:"base"`
	Checkpoints    []MapCheckpoint `json:"checkpoints,omitempty"`    // V4 必经检测点（按顺序）；nil/空=老模式 S→E 直接
	BuildableCells [][2]int        `json:"buildableCells,omitempty"` // 可建造集合（MVP 可以不用，因为前端默认 tile=0 即草地可建）
	LavaCells      [][2]int        `json:"lavaCells,omitempty"`      // V4-2 熔岩地图：路径上的熔岩格（T_LAVA=7，可通行+扣血）
	// ---- MVP 内置的地图 tile：0=草 1=石 2=S 3=E 4=玩家墙 5=真塔 6=CP 7=T_LAVA，长度 GridWidth*GridHeight ----
	Tiles []uint8 `json:"-"`
}

// MapDetailTilesExport 用于 MarshalJSON 时导出 tiles 为数字数组（而不是 encoding/json 默认的 base64 byte 串）
func (m MapDetail) MarshalJSON() ([]byte, error) {
	out := map[string]interface{}{
		"id":              m.ID,
		"name":            m.Name,
		"theme":           m.Theme,
		"difficulty":      m.Difficulty,
		"maxWaves":        m.MaxWaves,
		"thumbnailUrl":    m.ThumbnailURL,
		"backgroundImage": m.BackgroundImage,
		"gridWidth":       m.GridWidth,
		"gridHeight":      m.GridHeight,
		"cellSize":        m.CellSize,
		"spawnPoints":     m.SpawnPoints,
		"base":            m.Base,
	}
	// V4-2 Environment：如果不为空(grsss 默认也写出,方便前端识别)就输出
	if m.Environment.ID != "" {
		out["environment"] = m.Environment
	}
	if len(m.Checkpoints) > 0 {
		out["checkpoints"] = m.Checkpoints
	}
	if len(m.BuildableCells) > 0 {
		out["buildableCells"] = m.BuildableCells
	}
	if len(m.LavaCells) > 0 {
		out["lavaCells"] = m.LavaCells
	}
	tiles := make([]int, len(m.Tiles))
	for i, v := range m.Tiles {
		tiles[i] = int(v)
	}
	out["tiles"] = tiles
	return json.Marshal(out)
}

// ====================================================================
// v4：进化配方（C 类合成 / recipes.json）
// ====================================================================

// RecipeInput 配方表中单条材料槽位
type RecipeInput struct {
	Slot            int     `json:"slot"`
	RarityRequired  string  `json:"rarityRequired"`            // common/rare/epic/legendary
	ElementRequired *string `json:"elementRequired,omitempty"` // 非空=指定具体元素；nil=任意元素
	AllowSpecial    bool    `json:"allowSpecial"`              // 是否允许使用 special 真塔作为该槽材料
}

// SynRecipe V4 合成/进化 C 类配方（对应 conf/game/recipes.json）
type SynRecipe struct {
	ID                           string        `json:"id"`
	Name                         string        `json:"name"`
	Rarity                       string        `json:"rarity"`                                  // 产物稀有度（固定）
	OutputTowerId                uint          `json:"outputTowerId"`                           // 对应 special-towers.json 里的特殊塔 id
	Note                         string        `json:"note,omitempty"`                          // 人类可读配方说明（UI 展示）
	Inputs                       []RecipeInput `json:"inputs"`                                  // 材料槽，目前固定 3 个
	InputSlotsAllDistinctElement bool          `json:"inputSlotsAllDistinctElements,omitempty"` // true=材料元素必须互不相同
	AtLeastOneHasElement         bool          `json:"atLeastOneHasElement,omitempty"`          // 条件校验：至少 1 座塔有非空元素
	TwoEpicsMustDifferElement    bool          `json:"twoEpicsMustDifferElement,omitempty"`     // 针对 RAIGATEKI 类：2 座 epic 必须元素不同
	InputsMustBeDifferentTower   bool          `json:"inputsMustBeDifferentTower,omitempty"`    // 不允许重复使用同一 gridIdx
	AllowSpecialAsInput          bool          `json:"allowSpecialAsInput,omitempty"`           // 整体：配方是否接受 special 塔作为材料
}
