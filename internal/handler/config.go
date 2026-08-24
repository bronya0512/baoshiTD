package handler

import (
	"net"
	"os"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"baoshiTD/internal/config"
	"baoshiTD/pkg/response"
)

// ====================================================================
// Handlers — All static game data is now sourced from ./conf/game/*.json
// via baoshiTD/internal/config package.  The previous 7 groups of
// hard-coded Go variables (towers / enemies / luck / buffs / gems /
// maps / waves) have been fully retired from this file.
// ====================================================================

func ConfigListTowers(c *gin.Context)  { response.Success(c, config.GetTowers()) }
func ConfigListEnemies(c *gin.Context) { response.Success(c, config.GetEnemies()) }
func ConfigGetGems(c *gin.Context)     { response.Success(c, config.GetGems()) }

// ConfigListSpecialTowers GET /api/config/special-towers (v4)
func ConfigListSpecialTowers(c *gin.Context) { response.Success(c, config.GetSpecialTowers()) }

// ConfigGetRecipes GET /api/config/recipes (v4：进化/合成 C 类配方)
func ConfigGetRecipes(c *gin.Context) { response.Success(c, config.GetRecipes()) }

// ConfigGetLuck GET /api/config/luck
func ConfigGetLuck(c *gin.Context) { response.Success(c, config.GetLuck()) }

// ConfigGetBuffs GET /api/config/buffs
func ConfigGetBuffs(c *gin.Context) { response.Success(c, config.GetBuffs()) }

// ===== V4-7 能量 / 技能 解耦：独立 JSON 池 API =====
// ConfigGetEnergyCfgs GET /api/config/energy-cfgs
func ConfigGetEnergyCfgs(c *gin.Context) { response.Success(c, config.GetEnergyCfgs()) }

// ConfigGetTowerSkills GET /api/config/tower-skills
func ConfigGetTowerSkills(c *gin.Context) { response.Success(c, config.GetTowerSkills()) }

func ConfigListMaps(c *gin.Context) { response.Success(c, config.GetMapsList()) }

func ConfigGetMapDetail(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	m, ok := config.GetMapDetail(uint(id))
	if !ok {
		response.NotFound(c, "地图不存在")
		return
	}
	response.Success(c, m)
}

func ConfigGetWaves(c *gin.Context) {
	mapId, err := strconv.ParseUint(c.Param("mapId"), 10, 32)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	w, ok := config.GetWaves(uint(mapId))
	if !ok {
		response.NotFound(c, "该地图暂无波次")
		return
	}
	response.Success(c, w)
}

// isLoopbackIP 检查客户端 IP 是否为本地回环地址 (127.0.0.1 / ::1)
func isLoopbackIP(ipStr string) bool {
	ip := net.ParseIP(strings.TrimSpace(ipStr))
	if ip == nil {
		return false
	}
	return ip.IsLoopback()
}

// ConfigReload POST /api/config/reload
// 重新加载 conf/game/*.json 下所有配置文件到内存。
// 简易保护：仅允许本地回环 IP 访问，或携带正确的 X-Reload-Token 请求头。
// Token 从环境变量 TD_RELOAD_TOKEN 读取，未设置时仅允许本地 IP。
func ConfigReload(c *gin.Context) {
	// --- 权限校验 ---
	clientIP := c.ClientIP()
	allowed := isLoopbackIP(clientIP)

	expectedToken := os.Getenv("TD_RELOAD_TOKEN")
	if !allowed && expectedToken != "" {
		givenToken := c.GetHeader("X-Reload-Token")
		if givenToken != "" && givenToken == expectedToken {
			allowed = true
		}
	}

	if !allowed {
		response.Forbidden(c, "reload not allowed from this address (use 127.0.0.1 or set X-Reload-Token header)")
		return
	}

	// --- 执行重载 ---
	if err := config.Reload(); err != nil {
		c.JSON(500, gin.H{
			"code":  500,
			"msg":   "config reload failed",
			"error": err.Error(),
		})
		return
	}

	response.Success(c, gin.H{
		"reloaded":   true,
		"towers":     len(config.GetTowers()),
		"enemies":    len(config.GetEnemies()),
		"maps":       len(config.GetMapsList()),
		"specials":   len(config.GetSpecialTowers()),
		"recipes":    len(config.GetRecipes()),
		"energyCfgs": len(config.GetEnergyCfgs()),
		"skills":     len(config.GetTowerSkills()),
	})
}
