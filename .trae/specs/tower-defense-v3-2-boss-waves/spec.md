# 宝石TD v3-2 Boss 波 - 产品需求文档

## Overview
- **Summary**: 在现有 8 波节奏中，加入 wave3 / wave6 / wave8(=最终波) 三只 Boss，通过"更高血量、更高伤害、更大半径、更宽 HP bar、更红配色、[BOSS] 角标"与普通小兵形成节奏差异；Boss 死亡奖励 Roll × 2（稀有度各 Roll 一次，稀有度标签+金币分条写日志）。
- **Purpose**: 当前 8 波全是普通小兵/精英（无节奏起伏）→ 通关没难度差，玩家无"扛住 Boss"的成就感；加入 3 个 Boss 波后，玩家必须在 PREPARE 用 5 次 Roll 机会提前构筑，提升策略深度与留存。
- **Target Users**: 宝石TD v2 MVP 已登录玩家；浏览器 E2E 测试链路（契约 26 + E2E 4 步）。

## Goals
- G1: 8 波中 **wave3 / wave6 / wave8** 为 Boss 波（`WaveConfig.IsBossWave=true`）。
- G2: Boss 波内至少生成 1 只 `EnemyConfig.IsBoss=true` 的 Boss 敌人；血量 ≈ 同波普通小兵 ×20、基地伤害 ≈ ×5、半径 ≈ ×2.5。
- G3: canvas 上 Boss 一眼可识别：**更红的体色 / [BOSS] 角标 / HP bar 更宽（普通 1.0× → Boss 1.6× 并加厚 1.5px 描边）**。
- G4: 击杀 Boss 时，`dropBonusRate` 基础命中后 **独立 roll 两次 bonusRarity**（roll 两次不是概率翻倍；失败也只浪费一次机会），分别入账金币并合并日志 `★击杀 Boss 名 Roll1→[稀]+30 Roll2→[史]+100`。
- G5: 向后兼容（非 Boss 波、普通小兵表现不回归；老存档 `IsBoss` 为零值时绘制走普通分支）。

## Non-Goals
- 不做 Boss 技能（冲撞/召唤/护盾/狂暴）—— V3-2 只做强数值 + 视觉 + Roll×2。
- 不调塔 24 基础数值（塔基础伤害保持 40 锚点，后续 V4-1 再扩到 40）。
- 不新增后端 API（只用既有 `/api/config/enemies`、`/api/config/waves/:mapId` 契约里新增字段）。
- 不引入 Spine 动画 Boss（V4-3 再做，本期保持 canvas 2D 方块级绘制 + 角标 + 血条加宽加厚）。

## Background & Context
- 已有数据结构就绪（**未赋值**，但 JSON 字段兼容）：
  - `internal/model/config.go:44` `EnemyConfig.IsBoss bool \`json:"isBoss"\``
  - `internal/model/config.go:122` `WaveConfig.IsBossWave bool \`json:"isBossWave,omitempty"\``
- 前端已有敌人绘制 `web/js/td-game.js:819 drawEnemies()`：`r = cfg.radiusPx || 11` 圆 + 简单 HP bar；缺少：`[BOSS]` 角标、Boss 血条 1.6× 宽 + 更粗描边、Boss 体色偏红。
- 前端已有击杀奖励逻辑 `td-game.js:1325 killEnemy()`：`Math.random() < rollChance → rollBonusRarityByLuck 1 次 → 入账 + 日志`。需要：当 `e.cfg.isBoss === true` 时 roll 两次（不改变 rollChance 命中判定本身）。
- 契约测试路径：
  - `scripts/td-api-contract-test-v2.ps1`（已有 waves + enemies 断言，追加 Boss 字段断言）
  - `scripts/td-fallback-vs-backend-v2.ps1`（fallback 与后端 20/20 对齐校验，追加 3 个 Boss 波 + 1 Boss 敌人字段对齐）

## Functional Requirements

### FR-1 (配置契约扩展：EnemyConfig Boss 字段)
- 后端 `makeEnemies()` 至少新增 1 条 Boss 敌人：`id=6 / name="BOSS·炎狱领主" / type="boss" / IsBoss=true / Flying=false / IsElite=false / BaseHP ≈ 普通小兵 ×20（例：普通 80 → Boss 1600）/ Speed 不高于普通兵 0.6×（例：普通 60 → Boss 36）/ Armor 0.2 / Resistances: fire 0.3 / KillBaseGold 普通×20（例：普通 2 → Boss 40）/ DropBonusRate 1.0（必 Roll）/ radiusPx = 普通 radiusPx × 2.5 向上取整（普通 r=11 → Boss r=28）/ color="#991b1b"。
- 前端 fallback `ENEMIES` 同步：enemy6 新增上述 Boss（与 fallback 数值表完全一致，走 td-fallback-vs-backend-v2 对齐校验）。

### FR-2 (配置契约扩展：Wave 3/6/8 Boss 波)
- 后端 `makeWavesForV2(mapId=1, totalWaves=8)` 中 wave index=3/6/8（1-based）满足：
  - `WaveConfig.IsBossWave=true`
  - `groups[]` 末尾至少包含 1 个 `enemyId=6` 的 Boss WaveGroup（`Count=1`、`Delay=最后一个小兵 group 完成 0.5s 后`、`Interval` 无意义=0）
  - `RewardGold`：Boss 波比非 Boss 波 +50 金（wave3 rewardGold ≥ 100 / wave6 ≥ 150 / wave8=FINAL ≥ 300）。
- 前端 fallback WAVES 数组同 3/6/8 数据一致。

### FR-3 (前端适配 loader：Boss 字段)
- `td-config-loader.js adapt()` 中 enemies 适配：保证 `isBoss` 作为顶层 bool 保留，`radiusPx` 存在，否则按 cfg.radius fallback（普通 11）。

### FR-4 (canvas Boss 视觉一眼可辨)
在 `td-game.js drawEnemies()` 里，对 `cfg.isBoss === true` 的敌人：
1. **本体**：填色 = `cfg.color`（深红），`ctx.lineWidth = 2.5`（普通 1.5），描边色 = `"#fecaca"` 或 `rgba(248,113,113,0.9)`（带辉光感）。
2. **HP bar**：`barW = (r*2+4) * 1.6`（普通 26 → Boss 约 94px）；`barH = 6`（普通 4）；底色 #111827（更深）；血量比 `ratio>0.5` 用 `#dc2626`（Boss 即便是满血也偏红 — 与小兵绿半血区分）；`ratio <= 0.5` → `#b91c1c`；`ratio <= 0.25` → `#7f1d1d`；描边 1.5px。
3. **[BOSS] 角标**：敌人头顶 HP bar 上方再画 1 个深色 `fillRect` 角标框（w=36, h=12），内部 `fillStyle="#fee2e2"` + `font="bold 10px sans-serif"` + `textAlign="center"` 写 `"BOSS"`。
4. **slow 标识**仍保留在 HP bar 下（宽=4 高=4 深蓝方点）。

### FR-5 (击杀 Boss 奖励 Roll×2 + 日志)
在 `td-game.js killEnemy()` 里：
- 命中稀有度 Roll 后：
  - 普通小兵：保持 1 Roll 现状
  - `cfg.isBoss === true`：独立调用 `rollBonusRarityByLuck()` **两次**（记为 rar1, rar2），分别按 `bonusGoldMap` 取值 bGold1 + bGold2，`state.gold` 与 `state.waveBonusGold` 各累加 bGold1+bGold2。
- 日志格式：
  - 普通击杀：保持 `击杀奖励 Roll→[稀有]+15 金币` / `击杀 敌人名，+X 金`
  - Boss 击杀：
    1. 基础金币行仍然打印：`击杀 BOSS·炎狱领主，+40 金`
    2. 新单独 `log('s', '★击杀 Boss ' + enemyName + '  Roll1→[' + rarityLabel(rar1) + ']+' + b1 + '  Roll2→[' + rarityLabel(rar2) + ']+' + b2 + ' 合计+' + (b1+b2) + ' 金币')` （若某一次 Roll 未命中概率门则 rar 文本显示 `未命中 +0` 并 b=0）

## Non-Functional Requirements
- **NFR-1 不回归 7 项契约测试**：`scripts/td-api-contract-test-v2.ps1` 新增断言后 PASS 数 ≥ 当前（≥26），FAIL=0；`scripts/td-fallback-vs-backend-v2.ps1` ≥ 20/20 对齐 PASS。
- **NFR-2 画布性能**：Boss 视觉渲染（额外 1 个 fillRect + 1 次文字绘制 + 1 次加粗描边）不得使单帧 `draw()` 时间 > 1.0ms（基线 MVP 0.088ms/帧，+Boss 单只绘制也应 < 0.3ms 增量）。
- **NFR-3 存档兼容**：V3-1 已保存存档（state.save 包含旧敌人 id 数组）加载时无 Boss 不会崩；新存档含 Boss 也能正常 BATTLE。

## Constraints
- **Technical**: 契约必须通过 HTTP（不允许只改 fallback 不改后端 config 生成器）；Boss 敌人 id 保持连续：现有 1-5 normal/elite → id=6。
- **Business**: wave8 必须是最终 Boss 波，`maxWaves=8` 不改动（与 roadmap 现有 8 波一致）；`placementPerWave=5` Boss 波也保持 5（不给额外放置，保证数值 ROI 纯靠升级运气 + 抽 Buff）。
- **Dependencies**: 无外部依赖（canvas 2D + 已有 Gin 路由），不需要 Node/Docker 环境安装。

## Assumptions
- 玩家能理解 wave3/6/8 为 Boss 波（Banner phase 文本里 `isBossWave === true` 时自动提示「本波为 BOSS 波」：`PREPARE 放置剩余 5 / 5 【BOSS 波】`）。
- "奖励 Roll×2"与"双倍概率"语义不同：采用更保守的 **命中后 roll 两次**，不会误让玩家以为 Boss 的 dropBonusRate 翻倍。

## Open Questions
无。数值严格按 roadmap（血 20 × / 伤害 5 × / 半径 2.5 ×）实施。

---

## Acceptance Criteria

### AC-1: 配置契约（Enemies）里有至少 1 条 Boss 且 Boss 数值达到 20×HP / ×5 基地伤害 / ×2.5 半径
- **Type**: `rule`
- **Given**: 后端运行 GET `/api/config/enemies` 返回 JSON 数组（包含 `id=6`）；fallback `td-config-fallback.js` 有同 id enemy6。
- **When**: 比较 enemy6 (Boss) 与 enemy1 (普通 normal) 的字段。
- **Then**: enemy6.IsBoss==true / type=="boss" / BaseHP ≥ enemy1.BaseHP × 19.5 / radiusPx ≥ enemy1.radiusPx × 2.4 / KillBaseGold ≥ enemy1.KillBaseGold × 19；后端 & fallback 两条数据 id6 全部字段 == 相等（数值字段 Float64 绝对误差 ≤ 1e-9）。
- **Pass Condition**: 3 个 HTTP 断言 PASS + fallback-vs-backend 追加对齐断言 1 条 PASS。
- **Evidence**: `scripts/td-api-contract-test-v2.ps1` 新断言 + `scripts/td-fallback-vs-backend-v2.ps1` 追加断言。

### AC-2: 配置契约（Waves）wave3/6/8 为 BossWave；RewardGold 阶梯；每个 BossWave 至少 1 个 boss enemyId group
- **Type**: `rule`
- **Given**: 后端 `GET /api/config/waves/1` 返回 8 条 waves 数组（1-based 索引）。
- **When**: 遍历 waves[2], waves[5], waves[7]（3/6/8 零基）。
- **Then**: `IsBossWave === true`；每个 `groups[]` 至少包含 1 个 `enemyId==6`；RewardGold: wave3≥100 / wave6≥150 / wave8≥300。
- **Pass Condition**: 3×BossWave + 3×groups contain id6 + 3×RewardGold 阈值 = 共 9 个子条件全 true。
- **Evidence**: `scripts/td-api-contract-test-v2.ps1` 新增断言 PASS。

### AC-3: 前端 Boss 视觉：Boss 敌人 canvas 绘制 1.6× HP bar / [BOSS] 角标 / 深红体色 / 描边 2.5px
- **Type**: `rule`
- **Given**: 浏览器 `/td` → 注册登录 → 「DEBUG 快速跳到 W3」或手动打到 wave3 PREPARE → 保留 1 真塔 → BATTLE 阶段首只 Boss 出现（canvas 上能看到）。
- **When**: 使用 `browser_snapshot` 截取画布，Boss 圆心已知。
- **Then**: `TDGame.getState().enemies[0].cfg.isBoss === true`，canvas 上该 enemy 的 pixel 在 BoundingBox(center ± radius*1.6, 2) 中至少 1 像素为 `fee2e2` ([BOSS] 标签色)；在 HP bar 区域像素有 `dc2626` 深红（满血 Boss 色）。
- **Pass Condition**: bool(isBoss) ∧ ∃ pixel == fee2e2 ∧ ∃ pixel == dc2626。
- **Evidence**: `browser_evaluate` 返回 JSON `{hasBoss: true, bossPixelFound: true, redBarFound: true}`（或通过 snapshot 中的 HP bar 更宽/BOSS 文本角标肉眼截图归档）。

### AC-4: 击杀 Boss 奖励 Roll×2 生效
- **Type**: `rule`
- **Given**: Boss 敌人 dropBonusRate=1.0（100% 命中），所以每次击杀必触发 Roll 且 ×2。
- **When**: 在测试中注入 state：`cfg.isBoss=true` enemy → 直接 `killEnemy()`；或通过浏览器 E2E wave3 战斗击杀 Boss 后查日志。
- **Then**: 日志中包含字符串 `★击杀 Boss` 且包含 `Roll1→[` 和 `Roll2→[`；两次 rar 文本存在；合计金币 state.waveBonusGold 增量 == b1+b2；waveKillGold 增量仍为 baseGold × buffMul（普通击杀 + Boss 击杀 区分在日志而非 baseGold 公式）。
- **Pass Condition**: 日志正则 `/★击杀 Boss.*Roll1→\[.*\].*Roll2→\[.*\]/` 匹配。
- **Evidence**: browser E2E snapshot 的 消息日志 包含该行（e28 文本块）。

### AC-5: 画布性能与契约不回归
- **Type**: `rule`
- **Given**: 8080 服务运行。
- **When**: 顺序执行：`td-api-contract-test-v2.ps1` + `td-fallback-vs-backend-v2.ps1` + `td-auth-save-contract-test.ps1`。
- **Then**: FAIL=0（所有套件 PASS）；浏览器调试 draw() 单帧时间（`performance.now` 测 30 次平均）≤ 1.0ms。
- **Pass Condition**: 3 个套件 FAIL 计数 0；avgDrawMs ≤ 1.0。
- **Evidence**: 3 套件 exit code 0；evaluate 中 draw 30 次 ms 报告。

### AC-6: 游戏节奏与 Boss 识别质量
- **Type**: `rubric`
- **Dimension**: Boss 波节奏辨识度 + 视觉 Boss 辨识度
- **Scale**: 1-5
- **Anchors**: 1 = wave3/6/8 跟普通波完全没区别；3 = Boss 波有 banner 文本提示且 Boss 身形大一圈、血量厚、血条较长；5 = banner、日志 `进入第 3 波 ★BOSS 波`、canvas 身形/体色/描边/HP bar/[BOSS] 角标 5 处差异全开 + Boss Roll×2 文本星号突出。
- **Pass Threshold**: >= 4
- **Evidence**: 浏览器 E2E wave3→BATTLE 的 Banner 文本块 phase 提示、snapshot 截图、消息日志 3 波入场星号提示。
