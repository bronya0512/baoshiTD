# 宝石TD v2 → Beta 完整化路线图
> 生成时间：2026-08-22
> 基线：v2 MVP（7 Task ALL PASS：状态机/连通Gate/运气/Buff/战斗循环/LOSE-WIN/性能0.088ms/帧）

---

## 0. 当前状态基线（✅ 已完成）
- 后端 `/api/config/*`（maps/enemies/towers/waves/luck/buffs）7 接口 + 契约 26/26 PASS
- 前端 fallback + loader/adapter 三层一致（fallback vs backend 20/20 PASS）
- 状态机：MENU → PREPARE(5次放置/运气Roll塔) → RESERVE(选1/其余4变墙) → BATTLE(A*+攻击公式) → WAVEEND(升级运气/抽Buff) → (下一波 / WIN / LOSE)
- terrainGate（place/reserve_tower/to_wall/demolish_wall）单入口 → 4AC 通过（封死拒绝+回滚）
- 运气 Lv1~5：升级费 60/120/240/500 金；towerRarityWeights 与 bonusRarityWeights 配置化
- 金币经济：killBaseGold + 稀有度奖励Roll + wave.rewardGold；消耗：升级运气 / 抽 Buff(40金/次 叠加)
- 24塔(4rar×6elem) / 8波 / 10条Buff；伤害公式：baseDamage × BuffMul × (1-armor·0.5) × (1-resist)
- ice(30%/2s)、poison(20%/1.5s) 减速；AOE塔支持aoeRadiusPx；light(+15%奖励Roll)、dark(+10%奖励Roll)
- UI：HUD 7 指标 / Buff栏聚合×N / 消息日志 / RESERVE WAVEEND END 三模态 / 鼠标高亮红/蓝框
- canvas 2D 渲染（0.088ms/帧 << 16.67ms）
- 部署骨架：Dockerfile + docker-compose.yml + .dockerignore（待 Docker 安装后验证）

---

## 1. Phase V3 — 功能完善（3-4 天，优先度最高）

### V3-1 存档 + 用户系统（SQLite + JWT）
**为什么：** 刷新白玩 = 0 黏性
**验收：**
- POST /api/auth/register (username+password bcrypt) → 200 {token, uid}
- POST /api/auth/login → 200 {token} ；错误密码 401
- JWT 7 天过期；HS256，secret 从 env 读（缺省开发用占位符）
- GET/POST /api/save：save = { luckLevel, gold, baseHP, waveIndex, tiles[], grid[{instId,towerCfgId,pos}], activeBuffs[], version } JSON TEXT 列
- PREPARE/WAVEEND/MENU 可读；BATTLE 读返回 403（防作弊）
- 顶部 HUD 新增"昵称·保存·读取·退出"按钮；END modal 自动 autosave
**子任务：**
1. go get github.com/golang-jwt/jwt/v5 + github.com/mattn/go-sqlite3（或 modernc.org/sqlite 纯 Go）
2. internal/model/save.go + internal/model/user.go
3. internal/handler/auth.go + internal/handler/save.go
4. internal/router/router.go 加 /api/auth/*  /api/save 路由；auth 路由组用 JWTMiddleware
5. save 契约脚本 scripts/td-auth-save-contract-test.ps1（20断言）
6. tower-defense.html 加 login/register/save/load 模态
7. td-game.js 加 saveGame/loadGame 函数

### V3-2 Boss 波
**为什么：** 8 波小兵无节奏起伏
**验收：**
- wave3 / wave6 / wave8(=Final) 分别 Boss：血 ×20 / 伤害 ×5 / 半径×2.5
- EnemyConfig 新增 isBoss: bool；WaveConfig groups[].boss=true
- canvas Boss：[BOSS] 角标 + HP bar 更宽 + 颜色更红
- 击杀 Boss 强制奖励 Roll×2；日志 "★击杀 Boss 名 Roll1→[稀]+30 Roll2→[史]+100"

### V3-3 阶段操作细化
**为什么：** 明确阶段边界防误操作
**改动：**
- PREPARE：空地 Roll塔(扣次数) / 墙免费拆 / 塔看属性
- BATTLE：空地点击msg=战斗中不可放置 / 墙免费拆(过Gate) / 塔看属性
- RESERVE/WAVEEND：地图点击全部锁定 msg=当前阶段不可操作

### V3-4 塔攻击策略切换（可选）
- 每塔4策略：最近 / 最远(pathIdx最大) / 血最多 / 血最少
- 点塔信息弹框内可切换

### V3-5 自动保存
- 每进入 WAVEEND 自动触发 autosave 槽
- LOSE 后 END modal 显示 [从 autosave(wave末)恢复] 按钮

---

## 2. Phase V4 — 内容丰富（5-7 天）

### V4-1 配置规模扩展
| 项 | 当前 | 目标 | 增量备注 |
|---|---|---|---|
| 塔 | 24 | ≥40 | 每元素+1专属机制：fire点燃DOT/ice冻结/thunder连锁/poison叠毒/light溅射/dark吸血 |
| 敌人 | ~2 种小兵 | ≥15 | 飞行兵(仅thunder/light50%伤害) / 装甲兵armor0.4 / 分裂兵(死后×2) / 治疗兵(周期回血) / 快速兵 |
| Buff | 10 | ≥30 | AOE半径+20% / 击杀掉5金 / 2%免费Buff券 / -30%基地扣血 |
| 波 | 8 | 20 | boss @1,5,10,15,20；生成间隔 0.8→0.25s 递减 |
**关键：** 数值曲线 Excel 预模拟：LuckLv1 20波平均金、塔期望价值、升级ROI、DPS曲线。

### V4-2 成就系统（10条起步）
- 首胜 / 30波 / 传说×3在场 / 拆墙100次 / 运气Lv5 / Buff×10叠加 / 零损血 / 击杀×Boss / 单波≥100金 / 满墙通关
- save.achievements[]；HUD 成就按钮弹窗

### V4-3 Spine 动画集成（大项，3-4 天独立）
- 复用 `web/vendor/spine-core.js`(已patch) + `spine-webgl.js` + `GLTexture`处理
- Spine只负责塔/敌人/子弹/爆炸；网格/HP/范围仍canvas 2D
- 关键：animationState.apply后 updateWorldTransform前设 skeleton.x/y/scaleX/scaleY（Lessons Learned）
- 命名：英文文件名（ke_qing / blue_fire_boss），严禁中文路径 + 严禁Paint改PNG尺寸

### V4-4 音效与BGM
- ~20 个 sfx（6元素开火/2命中/击杀/拆墙/保留塔/升级运气/抽Buff分稀有度/LOSE/WIN）
- 3 首 BGM：PREPARE / BATTLE / WAVEEND

---

## 3. Phase V5 — 生产就绪（2-3 天）

### V5-1 Docker 验证（必做）
- Docker Desktop for Windows (WSL2) 安装
- `docker compose up --build` → 浏览器 `http://localhost:8080` → 全契约+游戏流程回归
- Dockerfile 加 `HEALTHCHECK --interval=30s CMD curl -f http://localhost:8080/api/config/maps || exit 1`
- .dockerignore 排除 assets/spine/ 原始工程、scripts/、.trae/、*.md

### V5-2 前端打包 + gzip
- 零Node：PowerShell `Get-Content td-config-fallback.js,td-config-loader.js,td-game.js | Set-Content td-bundle.js` 并在HTML替换引用
- Gin 加 `github.com/gin-contrib/gzip`；静态 Cache-Control max-age=3600

### V5-3 排行榜 + 安全
- GET /api/leaderboard?sort=waves-luck-buffs Top 100
- CORS：生产 Access-Control-Allow-Origin 限定具体域名
- JWT：HS256 强密钥（可选升级 RS256）

### V5-4 错误监控 + 埋点
- 后端 zap/logrus 写文件
- 前端 window.onerror / unhandledrejection → POST /api/report
- 阶段转换 / Roll塔稀有度 / Buff抽取结果 上报做数据真实性检查

### V5-5 平衡自动化测试
- Playwright / BrowserUse 100局随机：LuckLv1~5 通关率分布、HP剩余分布、金币产出vs升级消耗比
- 不平衡 → 只调后端 config 生成器（契约驱动，前端零改动）

### V5-6 合规 & 资源安全
- Spine 英文文件名 + Texture Packer 出 PNG（Paint改PNG = 废）
- 中文路径零容忍

---

## 4. 立即执行顺序（本周建议按 ROI）

| 优先级 | 项 | 耗时 | 价值 |
|---|---|---|---|
| 1 | V3-1 SQLite存档+JWT登录 | 1天 | 0黏性→可持续玩 |
| 2 | V3-2 Boss波×3 | 4h | 游戏节奏立刻有 |
| 3 | V5-1 Docker验证 | 4h | 部署FAIL消除 |
| 4 | V4-2 成就×10 | 4h | 短期目标感 |
| 5 | V4-1 塔40+波20 | 2天 | 内容量×2.5 |
| 6 | V4-3 Spine集成 | 3天 | 美术从方块→方舟级 |
| 7 | V4-4 音效+BGM | 1天 | 沉浸感 |
