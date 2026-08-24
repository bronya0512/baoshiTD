// Package config loads all static game configuration from ./conf/game/*.json
// files at startup (and optionally on reload), replacing the previously
// hard-coded Go data inside internal/handler/config.go.
//
// Layout (relative to the project working directory where baoshitd-server is
// started, i.e. the repository root):
//
//	conf/
//	  game/
//	    towers.json            → GET /api/config/towers
//	    enemies.json           → GET /api/config/enemies
//	    luck.json              → GET /api/config/luck
//	    buffs.json             → GET /api/config/buffs
//	    gems.json              → GET /api/config/gems
//	    maps-list.json         → GET /api/config/maps
//	    map-<id>.json          → GET /api/config/maps/:id   (tiles come from here)
//	    waves-<mapId>.json     → GET /api/config/waves/:mapId
//	    td-config-fallback.js  → frontend fallback JS (served by static /conf/ route)
//	  server/
//	    app.example.yaml       → server-side runtime config template (not loaded here)
//
// Notes
//
//   - Go's //go:embed directive disallows ".." and files outside the package
//     directory, so this loader deliberately uses runtime os.ReadFile against
//     a configurable base directory.
//   - The server is expected to be launched from the repo root;
//     restart.bat already does this. If needed, call SetBaseDir() before
//     Reload() to override the location.
//   - MapDetail.Tiles is []uint8 in memory, but JSON stores it as a plain
//     number array, so we decode via a raw struct and convert afterwards.
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"sync"

	"baoshiTD/internal/model"
)

// BaseDir is the directory containing "game/*.json" files. It is a relative
// path by default, resolved against the server's working directory (which
// should be the repository root when launched by restart.bat).
// Change via SetBaseDir before calling Reload if needed.
var (
	baseMu   sync.RWMutex
	_baseDir = filepath.Join("conf", "game")

	cacheMu   sync.RWMutex
	_towers   []model.TowerConfig
	_specialT []model.TowerConfig
	_recipes  []model.SynRecipe
	_enemies  []model.EnemyConfig
	_luck     model.LuckConfig
	_buffs    model.BuffsConfig
	_gems     model.GemConfig
	_mapsList []model.MapInfo
	_maps     map[uint]model.MapDetail    // id -> detail
	_waves    map[uint][]model.WaveConfig // mapId -> waves
	// ===== V4-7 能量 / 技能 解耦：独立 JSON 池 =====
	_energyCfgs []model.TowerEnergyCfg // conf/game/energy-cfgs.json
	_skills     []model.TowerSkill     // conf/game/tower-skills.json
	_loaded     bool
)

// SetBaseDir overrides the directory where game JSON files live.
// Pass an absolute or relative path.
func SetBaseDir(dir string) {
	baseMu.Lock()
	defer baseMu.Unlock()
	_baseDir = dir
}

// BaseDir returns the currently configured base directory.
func BaseDir() string {
	baseMu.RLock()
	defer baseMu.RUnlock()
	return _baseDir
}

func readJSONFile(dir, name string, out interface{}) error {
	path := filepath.Join(dir, name)
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("config: read %s: %w", path, err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("config: parse %s: %w", path, err)
	}
	return nil
}

// mapDetailRaw is an intermediate struct solely for decoding map-<id>.json,
// because model.MapDetail.Tiles has json:"-" (the model uses a custom
// MarshalJSON to emit tiles as []int, so we must decode them manually).
type mapDetailRaw struct {
	ID              uint                  `json:"id"`
	Name            string                `json:"name"`
	Theme           string                `json:"theme"`
	Difficulty      int                   `json:"difficulty"`
	MaxWaves        int                   `json:"maxWaves"`
	ThumbnailURL    string                `json:"thumbnailUrl,omitempty"`
	BackgroundImage string                `json:"backgroundImage,omitempty"` // V4 地图背景图
	Environment     model.MapEnvironment  `json:"environment,omitempty"`
	GridWidth       int                   `json:"gridWidth"`
	GridHeight      int                   `json:"gridHeight"`
	CellSize        int                   `json:"cellSize"`
	SpawnPoints     []model.MapSpawnPoint `json:"spawnPoints"`
	Checkpoints     []model.MapCheckpoint `json:"checkpoints,omitempty"`
	Base            model.MapBase         `json:"base"`
	BuildableCells  [][2]int              `json:"buildableCells,omitempty"`
	LavaCells       [][2]int              `json:"lavaCells,omitempty"`
	Tiles           []int                 `json:"tiles"`
}

// Reload reloads every JSON file from the configured base directory,
// overwriting the in-memory cache. It is safe to call multiple times.
// An error on any file is returned immediately; partial state may exist,
// so callers should crash or refuse to start if Reload fails.
func Reload() error {
	dir := BaseDir()
	if _, err := os.Stat(dir); err != nil {
		return fmt.Errorf("config: base dir %s unavailable: %w", dir, err)
	}

	towers := []model.TowerConfig{}
	if err := readJSONFile(dir, "towers.json", &towers); err != nil {
		return err
	}
	enemies := []model.EnemyConfig{}
	if err := readJSONFile(dir, "enemies.json", &enemies); err != nil {
		return err
	}
	luck := model.LuckConfig{}
	if err := readJSONFile(dir, "luck.json", &luck); err != nil {
		return err
	}
	buffs := model.BuffsConfig{}
	if err := readJSONFile(dir, "buffs.json", &buffs); err != nil {
		return err
	}
	gems := model.GemConfig{}
	if err := readJSONFile(dir, "gems.json", &gems); err != nil {
		return err
	}
	mapsList := []model.MapInfo{}
	if err := readJSONFile(dir, "maps-list.json", &mapsList); err != nil {
		return err
	}

	// maps: one file per map listed in maps-list.json
	maps := make(map[uint]model.MapDetail, len(mapsList))
	for _, mi := range mapsList {
		raw := mapDetailRaw{}
		fname := "map-" + strconv.FormatUint(uint64(mi.ID), 10) + ".json"
		if err := readJSONFile(dir, fname, &raw); err != nil {
			return err
		}
		tiles := make([]uint8, len(raw.Tiles))
		for i, v := range raw.Tiles {
			if v < 0 {
				v = 0
			}
			if v > 255 {
				v = 255
			}
			tiles[i] = uint8(v)
		}
		md := model.MapDetail{
			MapInfo: model.MapInfo{
				ID: mi.ID, Name: mi.Name, Theme: mi.Theme,
				Difficulty: mi.Difficulty, MaxWaves: mi.MaxWaves,
				ThumbnailURL:    raw.ThumbnailURL,
				BackgroundImage: raw.BackgroundImage,
				Environment:     raw.Environment,
			},
			GridWidth:      raw.GridWidth,
			GridHeight:     raw.GridHeight,
			CellSize:       raw.CellSize,
			SpawnPoints:    raw.SpawnPoints,
			Checkpoints:    raw.Checkpoints,
			Base:           raw.Base,
			BuildableCells: raw.BuildableCells,
			LavaCells:      raw.LavaCells,
			Tiles:          tiles,
		}
		maps[mi.ID] = md
	}

	// waves: one file per map
	waves := make(map[uint][]model.WaveConfig, len(mapsList))
	for _, mi := range mapsList {
		var ws []model.WaveConfig
		fname := "waves-" + strconv.FormatUint(uint64(mi.ID), 10) + ".json"
		if err := readJSONFile(dir, fname, &ws); err != nil {
			return err
		}
		waves[mi.ID] = ws
	}

	// ---- v4 新增：特殊塔 + 合成/进化 C 类配方 ----
	var specialT []model.TowerConfig
	if err := readJSONFile(dir, "special-towers.json", &specialT); err != nil {
		return err
	}
	// Force Special=true as defensive check (JSON already set it).
	for i := range specialT {
		specialT[i].Special = true
	}
	var recipes []model.SynRecipe
	if err := readJSONFile(dir, "recipes.json", &recipes); err != nil {
		return err
	}

	// ===== V4-7 能量 / 技能 解耦：两个独立 JSON =====
	var energyCfgs []model.TowerEnergyCfg
	if err := readJSONFile(dir, "energy-cfgs.json", &energyCfgs); err != nil {
		return err
	}
	var towerSkills []model.TowerSkill
	if err := readJSONFile(dir, "tower-skills.json", &towerSkills); err != nil {
		return err
	}

	cacheMu.Lock()
	_towers = towers
	_specialT = specialT
	_recipes = recipes
	_enemies = enemies
	_luck = luck
	_buffs = buffs
	_gems = gems
	_mapsList = mapsList
	_maps = maps
	_waves = waves
	_energyCfgs = energyCfgs
	_skills = towerSkills
	_loaded = true
	cacheMu.Unlock()
	return nil
}

func mustLoad() {
	cacheMu.RLock()
	ok := _loaded
	cacheMu.RUnlock()
	if ok {
		return
	}
	if err := Reload(); err != nil {
		panic(err)
	}
}

// --- typed accessors ---

func GetTowers() []model.TowerConfig {
	mustLoad()
	cacheMu.RLock()
	defer cacheMu.RUnlock()
	return _towers
}

// GetSpecialTowers returns v4 special towers only (all Special=true; 不能从 Roll 出)
func GetSpecialTowers() []model.TowerConfig {
	mustLoad()
	cacheMu.RLock()
	defer cacheMu.RUnlock()
	return _specialT
}

// GetRecipes returns v4 C 类进化配方
func GetRecipes() []model.SynRecipe {
	mustLoad()
	cacheMu.RLock()
	defer cacheMu.RUnlock()
	return _recipes
}
func GetEnemies() []model.EnemyConfig {
	mustLoad()
	cacheMu.RLock()
	defer cacheMu.RUnlock()
	return _enemies
}
func GetLuck() model.LuckConfig { mustLoad(); cacheMu.RLock(); defer cacheMu.RUnlock(); return _luck }
func GetBuffs() model.BuffsConfig {
	mustLoad()
	cacheMu.RLock()
	defer cacheMu.RUnlock()
	return _buffs
}
func GetGems() model.GemConfig { mustLoad(); cacheMu.RLock(); defer cacheMu.RUnlock(); return _gems }
func GetMapsList() []model.MapInfo {
	mustLoad()
	cacheMu.RLock()
	defer cacheMu.RUnlock()
	return _mapsList
}

func GetMapDetail(id uint) (model.MapDetail, bool) {
	mustLoad()
	cacheMu.RLock()
	defer cacheMu.RUnlock()
	m, ok := _maps[id]
	return m, ok
}

func GetWaves(mapId uint) ([]model.WaveConfig, bool) {
	mustLoad()
	cacheMu.RLock()
	defer cacheMu.RUnlock()
	w, ok := _waves[mapId]
	return w, ok
}

// ===== V4-7 能量 / 技能 解耦：独立 getter =====
func GetEnergyCfgs() []model.TowerEnergyCfg {
	mustLoad()
	cacheMu.RLock()
	defer cacheMu.RUnlock()
	return _energyCfgs
}
func GetTowerSkills() []model.TowerSkill {
	mustLoad()
	cacheMu.RLock()
	defer cacheMu.RUnlock()
	return _skills
}
