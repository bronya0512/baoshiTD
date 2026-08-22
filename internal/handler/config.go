package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"baoshiTD/internal/model"
	"baoshiTD/pkg/response"
)

// ====================================================================
// 静态配置（MVP v2：内存常量，覆盖 spec 里 4r×6e=24 塔、luck、buffs、waves 新字段）
// ====================================================================

// --- 颜色（元素 CSS 色） ---
var elemColor = map[string]string{
	"fire":    "#fc8181",
	"ice":     "#63b3ed",
	"thunder": "#f6e05e",
	"poison":  "#68d391",
	"light":   "#faf089",
	"dark":    "#9f7aea",
}

// rarityName: 中文 rarity 名
var rarityCN = map[string]string{
	"common":    "普通",
	"rare":      "稀有",
	"epic":      "史诗",
	"legendary": "传说",
}

// rarityTpl: 基础模板（按稀有度）
// dmgMul / rangeInCells / attackInterval(s) / isAOE / aoeRadiusPx
type rarityTpl struct {
	dmgMul        float64
	rangeInCells  float64
	attackIntv    float64
	isAOE         bool
	aoeRadiusPx   float64
}

var rarityTemplates = map[string]rarityTpl{
	"common":    {1.00, 2, 0.9, false, 0},
	"rare":      {1.50, 2, 0.8, false, 0},
	"epic":      {2.20, 3, 0.7, true,  40},
	"legendary": {3.00, 3, 0.6, true,  56},
}

// elemBonus: 元素加成乘数（对 baseDamage/attackInterval/range 进行乘法调整 + 附加效果）
type elemBonusTpl struct {
	damageMul    float64
	attackIntvMul float64
	rangeMul     float64
	slowOnHitPct float64 // 0..1
	slowOnHitSec float64
	// killBonusGoldChanceAdd01 不在塔基础数据里，在塔 elementBonus 文本里作为附加效果
	killBonusAdd float64
}

var elemBonus = map[string]elemBonusTpl{
	// fire: 伤害 +20%
	"fire":    {damageMul: 1.20, attackIntvMul: 1.0, rangeMul: 1.0},
	// ice:  射速 +20%（间隔 ×0.83）+ 减速 30% 2s
	"ice":     {damageMul: 1.0, attackIntvMul: 0.83, rangeMul: 1.0, slowOnHitPct: 0.30, slowOnHitSec: 2.0},
	// thunder: 射程 +15%
	"thunder": {damageMul: 1.0, attackIntvMul: 1.0, rangeMul: 1.15},
	// poison: 伤害 +10% + 减速 20% 1.5s（用"毒减速"模拟毒）
	"poison":  {damageMul: 1.10, attackIntvMul: 1.0, rangeMul: 1.0, slowOnHitPct: 0.20, slowOnHitSec: 1.5},
	// light:  射速 +10% + killBonusGoldChance +0.15
	"light":   {damageMul: 1.0, attackIntvMul: 0.91, rangeMul: 1.0, killBonusAdd: 0.15},
	// dark: 伤害 +10% + 射程 +10% + killBonusGoldChance +0.10
	"dark":    {damageMul: 1.10, attackIntvMul: 1.0, rangeMul: 1.10, killBonusAdd: 0.10},
}

// makeTower24 生成 4×6=24 条静态 TowerConfig，每 (rarity, element) 唯一
func makeTower24() []model.TowerConfig {
	rarities := []string{"common", "rare", "epic", "legendary"}
	elements := []string{"fire", "ice", "thunder", "poison", "light", "dark"}
	// 塔 baseDamage 锚定：common 单体 base 40 就够（MVP 数值简单化）
	const commonBaseDmg = 40.0
	out := make([]model.TowerConfig, 0, 24)
	id := uint(1)
	for _, r := range rarities {
		tpl := rarityTemplates[r]
		for _, e := range elements {
			eb := elemBonus[e]
			damage := commonBaseDmg * tpl.dmgMul * eb.damageMul
			attackIntv := tpl.attackIntv * eb.attackIntvMul
			attackSpeed := 1.0 / attackIntv // 契约里保留 attackSpeed（次/秒）
			attRange := tpl.rangeInCells * eb.rangeMul
			desc := rarityCN[r] + "·" + e + "塔"
			out = append(out, model.TowerConfig{
				ID:           id,
				Name:         desc,
				Element:      e,
				Rarity:       r,
				Description:  desc,
				Levels: []model.TowerLevel{
					{
						Level: 1,
						BaseDamage: damage,
						AttackRange: attRange,
						AttackSpeed: attackSpeed,
						Cost: 0,          // v2 无建塔成本（保留字段兼容 v1）
						UpgradeCost: 0,
					},
				},
				CanTargetFly: r != "epic", // 史诗 AOE 一般为地面；其余可打飞（MVP 简单规则）
				IsAOE:        tpl.isAOE,
				AOERadiusPx:  tpl.aoeRadiusPx,
				Color:        elemColor[e],
			})
			id++
		}
	}
	return out
}

var configTowers = makeTower24()

var configEnemies = []model.EnemyConfig{
	{
		ID: 1, Name: "小兵", Type: "normal",
		BaseHP: 60, Speed: 54,
		Armor: 0, Resistances: map[string]float64{},
		Flying: false, IsBoss: false, IsElite: false, DropGemRate: 0.25,
		KillBaseGold: 10, DropBonusRate: 0.30,
		RewardCoin: 12, DamageToBase: 1, Color: "#68d391", RadiusPx: 11,
	},
	{
		ID: 2, Name: "疾行者", Type: "swift",
		BaseHP: 40, Speed: 90,
		Armor: 0, Resistances: map[string]float64{"light": 0.2},
		Flying: false, IsBoss: false, IsElite: false, DropGemRate: 0.20,
		KillBaseGold: 8, DropBonusRate: 0.25,
		RewardCoin: 10, DamageToBase: 1, Color: "#63b3ed", RadiusPx: 10,
	},
	{
		ID: 3, Name: "重甲兵", Type: "heavy",
		BaseHP: 220, Speed: 36,
		Armor: 0.30, Resistances: map[string]float64{"fire": 0.20},
		Flying: false, IsBoss: false, IsElite: true, DropGemRate: 0.40,
		KillBaseGold: 22, DropBonusRate: 0.45,
		RewardCoin: 28, DamageToBase: 2, Color: "#a0aec0", RadiusPx: 14,
	},
	{
		ID: 4, Name: "元素精英", Type: "elite",
		BaseHP: 360, Speed: 45,
		Armor: 0.15, Resistances: map[string]float64{"ice": 0.40, "thunder": 0.40},
		Flying: false, IsBoss: false, IsElite: true, DropGemRate: 0.55,
		KillBaseGold: 35, DropBonusRate: 0.55,
		RewardCoin: 45, DamageToBase: 3, Color: "#d53f8c", RadiusPx: 15,
	},
	{
		ID: 5, Name: "BOSS", Type: "boss",
		BaseHP: 2400, Speed: 30,
		Armor: 0.35, Resistances: map[string]float64{},
		Flying: false, IsBoss: true, IsElite: true, DropGemRate: 1.0,
		KillBaseGold: 200, DropBonusRate: 1.0,
		RewardCoin: 300, DamageToBase: 10, Color: "#9b2c2c", RadiusPx: 22,
	},
}

// configLuck: 5 档运气
func makeConfigLuck() model.LuckConfig {
	level := func(lv int, costGold *int, tower map[string]int, bonus map[string]int) model.LuckLevel {
		return model.LuckLevel{
			Level:              lv,
			UpgradeCostGold:    costGold,
			TowerRarityWeights: tower,
			BonusRarityWeights: bonus,
		}
	}
	g := func(x int) *int { return &x }
	return model.LuckConfig{
		InitialLevel: 1,
		Levels: []model.LuckLevel{
			level(1, nil,
				map[string]int{"common": 70, "rare": 25, "epic": 4, "legendary": 1},
				map[string]int{"common": 70, "rare": 25, "epic": 4, "legendary": 1}),
			level(2, g(60),
				map[string]int{"common": 55, "rare": 35, "epic": 8, "legendary": 2},
				map[string]int{"common": 60, "rare": 32, "epic": 6, "legendary": 2}),
			level(3, g(120),
				map[string]int{"common": 40, "rare": 40, "epic": 15, "legendary": 5},
				map[string]int{"common": 50, "rare": 38, "epic": 10, "legendary": 2}),
			level(4, g(240),
				map[string]int{"common": 25, "rare": 40, "epic": 28, "legendary": 7},
				map[string]int{"common": 40, "rare": 40, "epic": 16, "legendary": 4}),
			level(5, g(500),
				map[string]int{"common": 15, "rare": 35, "epic": 38, "legendary": 12},
				map[string]int{"common": 30, "rare": 40, "epic": 22, "legendary": 8}),
		},
	}
}

var configLuck = makeConfigLuck()

// configBuffs: Roll 单价 40，Buff 池 10 条
func float64Ptr(v float64) *float64 { return &v }

func makeConfigBuffs() model.BuffsConfig {
	f := float64Ptr
	buffs := []model.BuffConfigItem{
		{ID: "atk_1", Name: "攻击+15%", Rarity: "common", Effect: model.BuffEffect{TowerDamageMulAll: f(1.15)}},
		{ID: "atk_2", Name: "攻击+25%", Rarity: "rare",   Effect: model.BuffEffect{TowerDamageMulAll: f(1.25)}},
		{ID: "atk_3", Name: "攻击+40%", Rarity: "epic",   Effect: model.BuffEffect{TowerDamageMulAll: f(1.40)}},
		{ID: "spd_1", Name: "射速+20%", Rarity: "common", Effect: model.BuffEffect{TowerAttackIntervalMulAll: f(0.83)}},
		{ID: "spd_2", Name: "射速+35%", Rarity: "rare",   Effect: model.BuffEffect{TowerAttackIntervalMulAll: f(0.74)}},
		{ID: "rng_1", Name: "射程+15%", Rarity: "common", Effect: model.BuffEffect{TowerRangeMulAll: f(1.15)}},
		{ID: "gold_1", Name: "击杀金币+20%", Rarity: "rare", Effect: model.BuffEffect{KillGoldMulAll: f(1.20)}},
		{ID: "gold_2", Name: "击杀金币+40%", Rarity: "epic", Effect: model.BuffEffect{KillGoldMulAll: f(1.40)}},
		{ID: "slow_1", Name: "减速效果+20%", Rarity: "rare", Effect: model.BuffEffect{SlowStrengthMulAll: f(1.20)}},
		{ID: "lucky_1", Name: "奖励命中+10%", Rarity: "epic", Effect: model.BuffEffect{KillBonusGoldChanceAddAll: f(0.10)}},
	}
	// RollRarityWeights: 1..5 档
	rollW := map[string]map[string]int{
		"1": {"common": 70, "rare": 25, "epic":  4, "legendary": 1},
		"2": {"common": 60, "rare": 32, "epic":  7, "legendary": 1},
		"3": {"common": 50, "rare": 35, "epic": 13, "legendary": 2},
		"4": {"common": 40, "rare": 35, "epic": 20, "legendary": 5},
		"5": {"common": 30, "rare": 35, "epic": 28, "legendary": 7},
	}
	return model.BuffsConfig{
		RollCostGold:      40,
		Buffs:             buffs,
		RollRarityWeights: rollW,
	}
}

var configBuffs = makeConfigBuffs()

// configGems 仍然保留（v1 兼容），但 v2 前端不再依赖
var configGems = model.GemConfig{
	Elements: []model.GemElement{
		{Key: "fire",  Name: "火", Color: "#e53e3e",
			BaseBonus: model.GemElementBonus{AttrMulDamage: 1.20}},
		{Key: "ice",   Name: "水", Color: "#3182ce",
			BaseBonus: model.GemElementBonus{AttrMulAttackInterval: 0.83, SlowOnHitPct01: 0.30, SlowOnHitSec: 2.0}},
		{Key: "thunder", Name: "风", Color: "#ecc94b",
			BaseBonus: model.GemElementBonus{AttrMulRange: 1.15}},
		{Key: "poison", Name: "土", Color: "#38a169",
			BaseBonus: model.GemElementBonus{SlowOnHitPct01: 0.20, SlowOnHitSec: 1.5}},
		{Key: "light", Name: "光", Color: "#faf089",
			BaseBonus: model.GemElementBonus{KillGemChanceAdd01: 0.15}},
		{Key: "dark",  Name: "暗", Color: "#805ad5",
			BaseBonus: model.GemElementBonus{AttrMulDamage: 1.10, KillGemChanceAdd01: 0.10}},
	},
	Rarities: []model.GemRarity{
		{Key: "common",    Name: "1阶", Multiplier: 1.00, DropRate: 0.60},
		{Key: "rare",      Name: "2阶", Multiplier: 1.50, DropRate: 0.28},
		{Key: "epic",      Name: "3阶", Multiplier: 2.20, DropRate: 0.10},
		{Key: "legendary", Name: "4阶", Multiplier: 3.00, DropRate: 0.02},
	},
}

// buildDefaultMapTiles 构造 24×16 默认地图（两条石头走廊中间横贯走廊 + 两个缺口）
func buildDefaultMapTiles(cols, rows int) []uint8 {
	N := cols * rows
	tiles := make([]uint8, N)
	idx := func(x, y int) int { return y*cols + x }
	set := func(x, y int, v uint8) {
		if x >= 0 && x < cols && y >= 0 && y < rows { tiles[idx(x,y)] = v }
	}
	for x := 4; x <= 20; x++ {
		set(x, 5, 1)
		set(x, 11, 1)
	}
	// 走廊两个缺口
	set(4, 5, 0);  set(4, 6, 0);  set(4, 7, 0);  set(4, 8, 0);  set(4, 9, 0);  set(4, 10, 0); set(4, 11, 0)
	set(20, 5, 0); set(20, 6, 0); set(20, 7, 0); set(20, 8, 0); set(20, 9, 0); set(20, 10, 0)
	set(1, 8, 2)
	set(22, 8, 3)
	return tiles
}

const defaultCols = 24
const defaultRows = 16
const defaultCell = 36

var configMapInfoList = []model.MapInfo{
	{ID: 1, Name: "草原平原", Theme: "grassland", Difficulty: 1, MaxWaves: 8},
}

var configMaps = map[uint]model.MapDetail{
	1: {
		MapInfo:    configMapInfoList[0],
		GridWidth:  defaultCols,
		GridHeight: defaultRows,
		CellSize:   defaultCell,
		SpawnPoints: []model.MapSpawnPoint{{X: 1, Y: 8}},
		Base: model.MapBase{X: 22, Y: 8, HP: 20},
		Tiles:        buildDefaultMapTiles(defaultCols, defaultRows),
	},
}

// wave: 按 spec v2 加 placementPerWave=5、rewardGold=Reward.Gold（waves[i].Reward.Gold 兼容）
func wave(waveIdx int, placementPerWave int, rewardGold int, rewardGemRolls int, isBoss bool, groups []model.WaveGroup) model.WaveConfig {
	return model.WaveConfig{
		Wave:             waveIdx,
		Groups:           groups,
		Reward:           model.WaveReward{Gold: rewardGold, GemRolls: rewardGemRolls},
		IsBossWave:       isBoss,
		PlacementPerWave: placementPerWave,
		RewardGold:       rewardGold,
	}
}

var configWaves = map[uint][]model.WaveConfig{
	1: {
		wave(1, 5, 50,  0, false, []model.WaveGroup{
			{EnemyID: 1, Count: 8,  Interval: 1.0, Delay: 0},
		}),
		wave(2, 5, 60,  0, false, []model.WaveGroup{
			{EnemyID: 1, Count: 10, Interval: 0.8, Delay: 0},
			{EnemyID: 2, Count: 4,  Interval: 1.2, Delay: 4.0},
		}),
		wave(3, 5, 80,  0, false, []model.WaveGroup{
			{EnemyID: 2, Count: 10, Interval: 0.6, Delay: 0},
			{EnemyID: 1, Count: 12, Interval: 0.7, Delay: 3.0},
		}),
		wave(4, 5, 100, 0, false, []model.WaveGroup{
			{EnemyID: 3, Count: 4,  Interval: 2.0, Delay: 0},
			{EnemyID: 1, Count: 16, Interval: 0.6, Delay: 2.0},
		}),
		wave(5, 5, 120, 0, false, []model.WaveGroup{
			{EnemyID: 2, Count: 16, Interval: 0.45, Delay: 0},
			{EnemyID: 3, Count: 6,  Interval: 1.6,  Delay: 3.0},
		}),
		wave(6, 5, 150, 0, false, []model.WaveGroup{
			{EnemyID: 4, Count: 2,  Interval: 3.0, Delay: 0},
			{EnemyID: 1, Count: 20, Interval: 0.5, Delay: 1.0},
			{EnemyID: 2, Count: 10, Interval: 0.6, Delay: 6.0},
		}),
		wave(7, 5, 200, 0, false, []model.WaveGroup{
			{EnemyID: 3, Count: 10, Interval: 1.2, Delay: 0},
			{EnemyID: 4, Count: 3,  Interval: 4.0, Delay: 4.0},
		}),
		wave(8, 5, 500, 0, true, []model.WaveGroup{
			{EnemyID: 1, Count: 20, Interval: 0.3, Delay: 0},
			{EnemyID: 3, Count: 8,  Interval: 1.0, Delay: 2.0},
			{EnemyID: 4, Count: 4,  Interval: 2.5, Delay: 6.0},
			{EnemyID: 5, Count: 1,  Interval: 0,   Delay: 15.0},
		}),
	},
}

// ====================================================================
// Handlers
// ====================================================================

func ConfigListTowers(c *gin.Context) { response.Success(c, configTowers) }
func ConfigListEnemies(c *gin.Context) { response.Success(c, configEnemies) }
func ConfigGetGems(c *gin.Context)    { response.Success(c, configGems) }

// ConfigGetLuck GET /api/config/luck（v2 新增）
func ConfigGetLuck(c *gin.Context)     { response.Success(c, configLuck) }

// ConfigGetBuffs GET /api/config/buffs（v2 新增）
func ConfigGetBuffs(c *gin.Context)    { response.Success(c, configBuffs) }

func ConfigListMaps(c *gin.Context)    { response.Success(c, configMapInfoList) }

func ConfigGetMapDetail(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil { response.BadRequest(c, err.Error()); return }
	m, ok := configMaps[uint(id)]
	if !ok { response.NotFound(c, "地图不存在"); return }
	response.Success(c, m)
}

func ConfigGetWaves(c *gin.Context) {
	mapId, err := strconv.ParseUint(c.Param("mapId"), 10, 32)
	if err != nil { response.BadRequest(c, err.Error()); return }
	w, ok := configWaves[uint(mapId)]
	if !ok { response.NotFound(c, "该地图暂无波次"); return }
	response.Success(c, w)
}
