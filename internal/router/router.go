package router

import (
	"baoshiTD/internal/handler"
	"baoshiTD/internal/middleware"
	"time"

	"github.com/gin-gonic/gin"
)

// Setup 配置路由
func Setup() *gin.Engine {
	// 创建引擎
	r := gin.Default()

	// 中间件
	r.Use(middleware.Logger())
	r.Use(middleware.CORS())

	// ============ 静态资源缓存 ============
	r.Use(middleware.CacheControl(24 * time.Hour))

	// ============ 静态文件 ============
	// 提供 Swagger UI 和 OpenAPI Spec
	r.Static("/docs", "./web/swagger")
	r.StaticFile("/openapi.yaml", "./api/openapi.yaml")
	// 提供前端页面
	r.Static("/web", "./web")
	r.StaticFile("/td", "./web/tower-defense.html")
	// 提供 Spine 等静态资产
	r.Static("/assets", "./assets")
	r.StaticFile("/", "./web/index.html")
	// conf/: 前端可直接访问 conf/game/*.js 等配置资源
	r.Static("/conf", "./conf")

	// ============ API 路由 ============
	v1 := r.Group("/api")
	{
		// Health
		v1.GET("/health", handler.HealthCheck)

		// Auth (公开)
		v1.POST("/auth/register", handler.AuthRegister)
		v1.POST("/auth/login", handler.AuthLogin)

		// Save (JWT组)
		sv := v1.Group("/save")
		sv.Use(middleware.AuthRequired())
		{
			sv.GET("", handler.SaveLoad)
			sv.POST("", handler.SaveSave)
		}

		// User
		v1.GET("/users", handler.GetUsers)
		v1.POST("/users", handler.CreateUser)
		v1.GET("/users/:id", handler.GetUser)
		v1.PUT("/users/:id", handler.UpdateUser)
		v1.DELETE("/users/:id", handler.DeleteUser)

		// Game config（MVP v2：towers / enemies / gems / maps / maps/:id / waves/:mapId / luck / buffs）
		// v4 扩展：special-towers / recipes
		cfg := v1.Group("/config")
		{
			cfg.GET("/towers", handler.ConfigListTowers)
			cfg.GET("/enemies", handler.ConfigListEnemies)
			cfg.GET("/gems", handler.ConfigGetGems)
			cfg.GET("/maps", handler.ConfigListMaps)
			cfg.GET("/maps/:id", handler.ConfigGetMapDetail)
			cfg.GET("/waves/:mapId", handler.ConfigGetWaves)
			cfg.GET("/luck", handler.ConfigGetLuck)
			cfg.GET("/buffs", handler.ConfigGetBuffs)
			// ---- v4 ----
			cfg.GET("/special-towers", handler.ConfigListSpecialTowers)
			cfg.GET("/recipes", handler.ConfigGetRecipes)
			// ===== V4-7 能量 / 技能 解耦：独立池 API =====
			cfg.GET("/energy-cfgs", handler.ConfigGetEnergyCfgs)
			cfg.GET("/tower-skills", handler.ConfigGetTowerSkills)
			// ---- 热重载 ----
			cfg.POST("/reload", handler.ConfigReload)
		}

		// V4-6 TD（不做 /api/td）：排行榜 + 账号状态 PATCH（JWT 保护）
		td := v1.Group("/td")
		{
			// 公开：排行榜（任何人可读 Top10）
			td.GET("/leaderboard", handler.LeaderboardList)

			// 登录态：同步天赋 / 地图解锁
			tdAuth := td.Group("")
			tdAuth.Use(middleware.AuthRequired())
			{
				tdAuth.PATCH("/account/talents", handler.AccountTalentsPatch)
				tdAuth.PATCH("/account/unlocked", handler.AccountUnlockedMapsPatch)
			}
		}
	}

	return r
}
