// Command gen-json-config is a ONE-OFF tool that reproduces the EXACT static
// game content that used to live in internal/handler/config.go and writes it
// to conf/game/*.json as UTF-8 (no BOM) using Go's encoding/json.
//
// Run once from the repository root:
//
//	go run ./cmd/gen-json-config
//
// It can be safely deleted afterwards; it is not imported by the server.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"baoshiTD/internal/model"
)

// ---- 数据 ----------------------------------------------------------------
// 数值完全对应原 internal/handler/config.go 里的硬编码，保持严格一致。

var elemColor = map[string]string{
	"fire": "#fc8181", "ice": "#63b3ed", "thunder": "#f6e05e",
	"poison": "#68d391", "light": "#faf089", "dark": "#9f7aea",
}
var rarityCN = map[string]string{"common": "普通", "rare": "稀有", "epic": "史诗", "legendary": "传说"}

type rarityTpl struct {
	dmgMul, rangeInCells, attackIntv, aoeRadiusPx float64
	isAOE                                         bool
}

var rarityTemplates = map[string]rarityTpl{
	"common":    {1.00, 2, 0.9, 0, false},
	"rare":      {1.50, 2, 0.8, 0, false},
	"epic":      {2.20, 3, 0.7, 40, true},
	"legendary": {3.00, 3, 0.6, 56, true},
}

type elemBonusTpl struct {
	damageMul, attackIntvMul, rangeMul, slowOnHitPct, slowOnHitSec, killBonusAdd float64
}

var elemBonus = map[string]elemBonusTpl{
	"fire":    {damageMul: 1.20, attackIntvMul: 1.0, rangeMul: 1.0},
	"ice":     {damageMul: 1.0, attackIntvMul: 0.83, rangeMul: 1.0, slowOnHitPct: 0.30, slowOnHitSec: 2.0},
	"thunder": {damageMul: 1.0, attackIntvMul: 1.0, rangeMul: 1.15},
	"poison":  {damageMul: 1.10, attackIntvMul: 1.0, rangeMul: 1.0, slowOnHitPct: 0.20, slowOnHitSec: 1.5},
	"light":   {damageMul: 1.0, attackIntvMul: 0.91, rangeMul: 1.0, killBonusAdd: 0.15},
	"dark":    {damageMul: 1.10, attackIntvMul: 1.0, rangeMul: 1.10, killBonusAdd: 0.10},
}

func makeTower24() []model.TowerConfig {
	rarities := []string{"common", "rare", "epic", "legendary"}
	elements := []string{"fire", "ice", "thunder", "poison", "light", "dark"}
	const commonBaseDmg = 40.0
	out := make([]model.TowerConfig, 0, 24)
	id := uint(1)
	for _, r := range rarities {
		tpl := rarityTemplates[r]
		for _, e := range elements {
			eb := elemBonus[e]
			damage := commonBaseDmg * tpl.dmgMul * eb.damageMul
			attackIntv := tpl.attackIntv * eb.attackIntvMul
			attackSpeed := 1.0 / attackIntv
			attRange := tpl.rangeInCells * eb.rangeMul
			desc := rarityCN[r] + "·" + e + "塔"
			out = append(out, model.TowerConfig{
				ID:          id,
				Name:        desc,
				Element:     e,
				Rarity:      r,
				Description: desc,
				Levels: []model.TowerLevel{
					{
						Level:       1,
						BaseDamage:  damage,
						AttackRange: attRange,
						AttackSpeed: attackSpeed,
						Cost:        0,
						UpgradeCost: 0,
					},
				},
				CanTargetFly: r != "epic",
				IsAOE:        tpl.isAOE,
				AOERadiusPx:  tpl.aoeRadiusPx,
				Color:        elemColor[e],
			})
			id++
		}
	}
	return out
}

func makeEnemies() []model.EnemyConfig {
	return []model.EnemyConfig{
		{ID: 1, Name: "小兵", Type: "normal", BaseHP: 60, Speed: 54, Armor: 0, Resistances: map[string]float64{}, Flying: false, IsBoss: false, IsElite: false, DropGemRate: 0.25, KillBaseGold: 10, DropBonusRate: 0.30, RewardCoin: 12, DamageToBase: 1, Color: "#68d391", RadiusPx: 11},
		{ID: 2, Name: "疾行者", Type: "swift", BaseHP: 40, Speed: 90, Armor: 0, Resistances: map[string]float64{"light": 0.2}, Flying: false, IsBoss: false, IsElite: false, DropGemRate: 0.20, KillBaseGold: 8, DropBonusRate: 0.25, RewardCoin: 10, DamageToBase: 1, Color: "#63b3ed", RadiusPx: 10},
		{ID: 3, Name: "重甲兵", Type: "heavy", BaseHP: 220, Speed: 36, Armor: 0.30, Resistances: map[string]float64{"fire": 0.20}, Flying: false, IsBoss: false, IsElite: true, DropGemRate: 0.40, KillBaseGold: 22, DropBonusRate: 0.45, RewardCoin: 28, DamageToBase: 2, Color: "#a0aec0", RadiusPx: 14},
		{ID: 4, Name: "元素精英", Type: "elite", BaseHP: 360, Speed: 45, Armor: 0.15, Resistances: map[string]float64{"ice": 0.40, "thunder": 0.40}, Flying: false, IsBoss: false, IsElite: true, DropGemRate: 0.55, KillBaseGold: 35, DropBonusRate: 0.55, RewardCoin: 45, DamageToBase: 3, Color: "#d53f8c", RadiusPx: 15},
		{ID: 5, Name: "BOSS", Type: "boss", BaseHP: 2400, Speed: 30, Armor: 0.35, Resistances: map[string]float64{}, Flying: false, IsBoss: true, IsElite: true, DropGemRate: 1.0, KillBaseGold: 200, DropBonusRate: 1.0, RewardCoin: 300, DamageToBase: 10, Color: "#9b2c2c", RadiusPx: 22},
		{ID: 6, Name: "BOSS·炎狱领主", Type: "boss", BaseHP: 1200, Speed: 32, Armor: 0.20, Resistances: map[string]float64{"fire": 0.30}, Flying: false, IsBoss: true, IsElite: false, DropGemRate: 1.0, KillBaseGold: 200, DropBonusRate: 1.0, RewardCoin: 300, DamageToBase: 5, Color: "#991b1b", RadiusPx: 28},
	}
}

func pInt(x int) *int         { return &x }
func pF64(x float64) *float64 { return &x }

func makeLuck() model.LuckConfig {
	level := func(lv int, costGold *int, tower, bonus map[string]int) model.LuckLevel {
		return model.LuckLevel{Level: lv, UpgradeCostGold: costGold, TowerRarityWeights: tower, BonusRarityWeights: bonus}
	}
	return model.LuckConfig{
		InitialLevel: 1,
		Levels: []model.LuckLevel{
			level(1, nil, m("common", 70, "rare", 25, "epic", 4, "legendary", 1), m("common", 70, "rare", 25, "epic", 4, "legendary", 1)),
			level(2, pInt(60), m("common", 55, "rare", 35, "epic", 8, "legendary", 2), m("common", 60, "rare", 32, "epic", 6, "legendary", 2)),
			level(3, pInt(120), m("common", 40, "rare", 40, "epic", 15, "legendary", 5), m("common", 50, "rare", 38, "epic", 10, "legendary", 2)),
			level(4, pInt(240), m("common", 25, "rare", 40, "epic", 28, "legendary", 7), m("common", 40, "rare", 40, "epic", 16, "legendary", 4)),
			level(5, pInt(500), m("common", 15, "rare", 35, "epic", 38, "legendary", 12), m("common", 30, "rare", 40, "epic", 22, "legendary", 8)),
		},
	}
}

func m(kv ...interface{}) map[string]int {
	out := map[string]int{}
	for i := 0; i+1 < len(kv); i += 2 {
		out[kv[i].(string)] = kv[i+1].(int)
	}
	return out
}

func makeBuffs() model.BuffsConfig {
	buffs := []model.BuffConfigItem{
		{ID: "atk_1", Name: "攻击+15%", Rarity: "common", Effect: model.BuffEffect{TowerDamageMulAll: pF64(1.15)}},
		{ID: "atk_2", Name: "攻击+25%", Rarity: "rare", Effect: model.BuffEffect{TowerDamageMulAll: pF64(1.25)}},
		{ID: "atk_3", Name: "攻击+40%", Rarity: "epic", Effect: model.BuffEffect{TowerDamageMulAll: pF64(1.40)}},
		{ID: "spd_1", Name: "射速+20%", Rarity: "common", Effect: model.BuffEffect{TowerAttackIntervalMulAll: pF64(0.83)}},
		{ID: "spd_2", Name: "射速+35%", Rarity: "rare", Effect: model.BuffEffect{TowerAttackIntervalMulAll: pF64(0.74)}},
		{ID: "rng_1", Name: "射程+15%", Rarity: "common", Effect: model.BuffEffect{TowerRangeMulAll: pF64(1.15)}},
		{ID: "gold_1", Name: "击杀金币+20%", Rarity: "rare", Effect: model.BuffEffect{KillGoldMulAll: pF64(1.20)}},
		{ID: "gold_2", Name: "击杀金币+40%", Rarity: "epic", Effect: model.BuffEffect{KillGoldMulAll: pF64(1.40)}},
		{ID: "slow_1", Name: "减速效果+20%", Rarity: "rare", Effect: model.BuffEffect{SlowStrengthMulAll: pF64(1.20)}},
		{ID: "lucky_1", Name: "奖励命中+10%", Rarity: "epic", Effect: model.BuffEffect{KillBonusGoldChanceAddAll: pF64(0.10)}},
	}
	rollW := map[string]map[string]int{
		"1": m("common", 70, "rare", 25, "epic", 4, "legendary", 1),
		"2": m("common", 60, "rare", 32, "epic", 7, "legendary", 1),
		"3": m("common", 50, "rare", 35, "epic", 13, "legendary", 2),
		"4": m("common", 40, "rare", 35, "epic", 20, "legendary", 5),
		"5": m("common", 30, "rare", 35, "epic", 28, "legendary", 7),
	}
	return model.BuffsConfig{RollCostGold: 40, Buffs: buffs, RollRarityWeights: rollW}
}

func makeGems() model.GemConfig {
	return model.GemConfig{
		Elements: []model.GemElement{
			{Key: "fire", Name: "火", Color: "#e53e3e", BaseBonus: model.GemElementBonus{AttrMulDamage: 1.20}},
			{Key: "ice", Name: "水", Color: "#3182ce", BaseBonus: model.GemElementBonus{AttrMulAttackInterval: 0.83, SlowOnHitPct01: 0.30, SlowOnHitSec: 2.0}},
			{Key: "thunder", Name: "风", Color: "#ecc94b", BaseBonus: model.GemElementBonus{AttrMulRange: 1.15}},
			{Key: "poison", Name: "土", Color: "#38a169", BaseBonus: model.GemElementBonus{SlowOnHitPct01: 0.20, SlowOnHitSec: 1.5}},
			{Key: "light", Name: "光", Color: "#faf089", BaseBonus: model.GemElementBonus{KillGemChanceAdd01: 0.15}},
			{Key: "dark", Name: "暗", Color: "#805ad5", BaseBonus: model.GemElementBonus{AttrMulDamage: 1.10, KillGemChanceAdd01: 0.10}},
		},
		Rarities: []model.GemRarity{
			{Key: "common", Name: "1阶", Multiplier: 1.00, DropRate: 0.60},
			{Key: "rare", Name: "2阶", Multiplier: 1.50, DropRate: 0.28},
			{Key: "epic", Name: "3阶", Multiplier: 2.20, DropRate: 0.10},
			{Key: "legendary", Name: "4阶", Multiplier: 3.00, DropRate: 0.02},
		},
	}
}

const (
	defaultCols = 24
	defaultRows = 16
	defaultCell = 36
)

func buildDefaultMapTiles(cols, rows int) []uint8 {
	N := cols * rows
	tiles := make([]uint8, N)
	idx := func(x, y int) int { return y*cols + x }
	set := func(x, y int, v uint8) {
		if x >= 0 && x < cols && y >= 0 && y < rows {
			tiles[idx(x, y)] = v
		}
	}
	for x := 4; x <= 20; x++ {
		set(x, 5, 1)
		set(x, 11, 1)
	}
	for _, y := range []int{5, 6, 7, 8, 9, 10, 11} {
		set(4, y, 0)
		set(20, y, 0)
	}
	set(1, 8, 2)
	set(22, 8, 3)
	return tiles
}

func mapsList() []model.MapInfo {
	return []model.MapInfo{{ID: 1, Name: "草原平原", Theme: "grassland", Difficulty: 1, MaxWaves: 8}}
}

func mapDetail1() model.MapDetail {
	return model.MapDetail{
		MapInfo:     mapsList()[0],
		GridWidth:   defaultCols,
		GridHeight:  defaultRows,
		CellSize:    defaultCell,
		SpawnPoints: []model.MapSpawnPoint{{X: 1, Y: 8}},
		Base:        model.MapBase{X: 22, Y: 8, HP: 20},
		Tiles:       buildDefaultMapTiles(defaultCols, defaultRows),
	}
}

func wave(waveIdx, placementPerWave, rewardGold, rewardGemRolls int, isBoss bool, groups []model.WaveGroup) model.WaveConfig {
	return model.WaveConfig{
		Wave:             waveIdx,
		Groups:           groups,
		Reward:           model.WaveReward{Gold: rewardGold, GemRolls: rewardGemRolls},
		IsBossWave:       isBoss,
		PlacementPerWave: placementPerWave,
		RewardGold:       rewardGold,
	}
}
func g(enemyID, count int, interval, delay float64) model.WaveGroup {
	return model.WaveGroup{EnemyID: uint(enemyID), Count: count, Interval: interval, Delay: delay}
}

func waves1() []model.WaveConfig {
	return []model.WaveConfig{
		wave(1, 5, 50, 0, false, []model.WaveGroup{g(1, 8, 1.0, 0)}),
		wave(2, 5, 50, 0, false, []model.WaveGroup{g(1, 10, 0.8, 0), g(2, 4, 1.2, 4.0)}),
		wave(3, 5, 100, 0, true, []model.WaveGroup{g(2, 10, 0.6, 0), g(1, 12, 0.7, 3.0), g(6, 1, 0, 12.0)}),
		wave(4, 5, 50, 0, false, []model.WaveGroup{g(3, 4, 2.0, 0), g(1, 16, 0.6, 2.0)}),
		wave(5, 5, 50, 0, false, []model.WaveGroup{g(2, 16, 0.45, 0), g(3, 6, 1.6, 3.0)}),
		wave(6, 5, 150, 0, true, []model.WaveGroup{g(4, 2, 3.0, 0), g(1, 20, 0.5, 1.0), g(2, 10, 0.6, 6.0), g(6, 1, 0, 12.0)}),
		wave(7, 5, 50, 0, false, []model.WaveGroup{g(3, 10, 1.2, 0), g(4, 3, 4.0, 4.0)}),
		wave(8, 5, 300, 0, true, []model.WaveGroup{g(1, 20, 0.3, 0), g(3, 8, 1.0, 2.0), g(4, 4, 2.5, 6.0), g(6, 1, 0, 16.0), g(5, 1, 0, 22.0)}),
	}
}

// ---- 写文件 ----------------------------------------------------------------

func writeJSON(outDir, name string, obj interface{}) error {
	raw, err := json.MarshalIndent(obj, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal %s: %w", name, err)
	}
	path := filepath.Join(outDir, name)
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	fmt.Printf("  wrote %s (%d bytes)\n", path, len(raw))
	return nil
}

func main() {
	outDir := filepath.Join("conf", "game")
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		panic(err)
	}

	steps := []struct {
		name string
		obj  interface{}
	}{
		{"towers.json", makeTower24()},
		{"enemies.json", makeEnemies()},
		{"luck.json", makeLuck()},
		{"buffs.json", makeBuffs()},
		{"gems.json", makeGems()},
		{"maps-list.json", mapsList()},
		{"map-1.json", mapDetail1()}, // MapDetail.MarshalJSON 会把 tiles 输出为 []int
		{"waves-" + strconv.Itoa(1) + ".json", waves1()},
	}
	for _, s := range steps {
		if err := writeJSON(outDir, s.name, s.obj); err != nil {
			panic(err)
		}
	}

	// Sanity checks
	t := makeTower24()
	fmt.Printf("\n--- sanity ---\n  towers: %d (first common.fire baseDamage=%.12g, last legendary.dark id=%d)\n  waves count: %d\n",
		len(t), t[0].Levels[0].BaseDamage, t[23].ID, len(waves1()))
	md := mapDetail1()
	fmt.Printf("  map tiles: cols=%d rows=%d total=%d; tile @ spawn(1,8)=%d base(22,8)=%d\n",
		md.GridWidth, md.GridHeight, len(md.Tiles),
		md.Tiles[8*defaultCols+1], md.Tiles[8*defaultCols+22])
}
