# 宝石塔防 MVP — 实现任务清单

> 规范 ID: `tower-defense-mvp`
> 语言: 中文
> 依赖: `.trae/specs/tower-defense-mvp/spec.md`
> 分解原则: 每个任务 = 一个可独立 self-verify 的 vertical slice

---

## 任务总览与依赖图（文字）

```
T1 后端 /api/config 四个 handler ─┐
T2 前端 fallback config           ├─► T3 游戏主入口 + 配置加载
T3 TD 主入口 / 配置加载 / HUD UI  ─┐
T4 地图渲染 + 数据结构            ├─► T5 A* 寻路
T5 A* 寻路 + 堵路预检查          ─┴─► T6 放塔系统
T6 放塔系统（选择/校验/扣费）         ─┬─► T7 敌人波次
T7 敌人波次生成 / 行进 / 扣基地 HP     ├─► T8 战斗循环
T8 战斗循环（塔攻击/子弹/AOE/HP条）   ─┼─► T9 胜负 & 重开
T9 胜负遮罩 + 重开                    │
T10 宝石掉落 / 背包 / 合成 / 装备     ─┴─► T11 联调
T11 端到端联调 + AC 自检 + 性能自测   = 终点
```

---

## Task 1: 后端 `/api/config/*` 静态 JSON Handler 实现

**Status**: pending
**Priority**: high
**覆盖 AC**: AC-10
**依赖**: 无
**修改文件**:
- 新增 `internal/handler/config.go`
- 修改 `internal/router/router.go`（注册 `GET /api/config/towers | /enemies | /gems | /waves/:mapId` 到该 handler 对应方法）
- 若需要共享常量/结构体，新增 `internal/model/config.go`（TowerConfig/EnemyConfig/GemConfig/WaveConfig 结构体）

### Task TR
- **TR-1.1 (rule)**：服务器启动后，用 PowerShell 命令分别请求 4 个接口，全部返回 HTTP 200 + `Content-Type: application/json`，且响应体是数组/对象 JSON 无语法错误。
  - 可观测命令：
    ```powershell
    foreach ($p in '/api/config/towers','/api/config/enemies','/api/config/gems','/api/config/waves/1') {
      $r = Invoke-WebRequest -Uri "http://localhost:8080$p" -UseBasicParsing;
      "$p -> $($r.StatusCode)  ContentType=$($r.Headers['Content-Type'])  Body120=$($r.Content.Substring(0,[Math]::Min(120,$r.Content.Length)))"
    }
    ```
  - 通过条件：每个 StatusCode=200；ContentType 包含 application/json；Body 可 `ConvertFrom-Json` 无异常。
- **TR-1.2 (rule)**：每个响应的「关键字段」类型与 openapi.yaml 契约一致（按 MVP 的最小字段集）：
  - towers[]：每个必须有 `id (string)`、`name (string)`、`cost (int >= 0)`、`range (number, 单位格)`、`damage (number)`、`attackInterval (number 秒 > 0)`、`isAOE (bool)`、`aoeRadiusPx (number)`、`color (string, CSS color)`
  - enemies[]：每个必须有 `id (string)`、`name (string)`、`hpMax (number > 0)`、`speed (number 格/秒)`、`rewardCoin (int >= 0)`、`damageToBase (int >= 1)`、`gemDropChance (number 0..1)`、`color (string)`、`radiusPx (number)`
  - gems：`tiers: {1..4: attrMulDamage, attrMulAttackInterval, attrMulRange, slowOnHitPct01, slowOnHitSec, killGemChanceAdd01}` × 5 元素；`dropWeights`：按 tier×元素 的权重数
  - waves[mapId=1]：数组，每波 `{ wave: int, groups: [{enemyId, count, intervalSec, delaySec}] }`，至少 6 波且 HP/COUNT 递增
- **TR-1.3 (rule)**：请求 `/api/config/waves/999`（不存在 mapId）返回 404 或空数组，不 panic / 不挂。通过条件：HTTP 4xx 或 200+空数组；服务仍能响应其他接口。

---

## Task 2: 前端 `web/js/config-fallback.js` 兜底数据

**Status**: pending
**Priority**: high
**覆盖 AC**: AC-11
**依赖**: Task1（可并行，因为 fallback 字段结构和后端输出完全相同）

### 说明
把与 Task1 完全相同的 4 份数据写成前端 JS 模块，暴露为 `window.TD_FALLBACK = { towers, enemies, gems, waves: { 1: [...] } }`。当 fetch 任一接口失败时就用它。也暴露 `window.TD_FALLBACK_SCHEMA = { ... }` 方便单测比对后端 JSON。

### Task TR
- **TR-2.1 (rule)**：F12 Console `typeof TD_FALLBACK.towers === 'object' && TD_FALLBACK.towers.length >= 2 && typeof TD_FALLBACK.enemies[0].hpMax === 'number'` 返回 `true`。通过条件：true。
- **TR-2.2 (rule)**：后端关闭（任务 TR-1.1 命令失败）后，刷新 Demo 页，TD game state 里 `game.towers[0]` / `game.enemies[0]` 仍然从 fallback 拿到了数据。可观测：Console `TD_GAME.state.configLoaded === true && TD_GAME.state.configSource === 'fallback'`。返回 true 通过。

---

## Task 3: 主入口 `web/tower-defense.html` + HUD UI

**Status**: pending
**Priority**: high
**覆盖 AC**: AC-1, AC-11
**依赖**: Task2（fallback 存在以保证页面不空）

### 交付
- 新文件 `web/tower-defense.html`：顶部 HUD（❤️ HP / 💰 金币 / 🌊 波次 / ▶ 开始下一波 按钮）；左栏塔工具；右栏宝石背包+一键合成；中央 Canvas 864×576
- 新文件 `web/js/td-game.js`：`TD_CONFIG` 常量集中；`TD_GAME` 单例；`init()` 做 4 个接口 fetch + fallback；DOMContentLoaded 即 `init()`
- 可选：新建 `web/css/td.css`（如果 style.css 不够用）；style.css 如果能撑得住就复用

### Task TR
- **TR-3.1 (rule)**：打开 `http://localhost:8080/web/tower-defense.html`，肉眼看到 4 部分 UI；DevTools Console 0 红 error。通过条件：截图 + Console 空。
- **TR-3.2 (rule)**：HUD 初始数值 = `❤️ HP 20/20 | 💰 500 | 🌊 1 / 8`；未开始任何波时「开始下一波」按钮可点，「重开」按钮不可见。通过条件：截图。
- **TR-3.3 (rule)**：停掉后端（Ctrl+C server），刷新页面仍然通过 3.1 / 3.2。证据：先停 server 后再截图。

---

## Task 4: 地图渲染（Canvas 2D）+ 数据结构

**Status**: pending
**Priority**: high
**覆盖 AC**: AC-1
**依赖**: Task3

### 交付
- 数据结构：`map: { cols: 24, rows: 16, tiles: Uint8Array 长度 384, start: [x,y], end: [x,y] }`，tile 值 `0=草地 / 1=石头 / 2=S / 3=E`；并提供 `tileAt(x,y)` / `isWalkable(x,y, ignoreEntityAt?)` / `isBuildable(x,y)`
- Canvas 渲染：每格 36px；草地浅绿 / 石头灰 / S 红色方框带 S 字 / E 蓝色方框带 E 字；塔先以占位（等 Task6 画塔形）
- 内置 1 张默认 map：边界不是石头，但 S=(1,8)、E=(22,8)，中间围出一些石头走廊，保证至少一条路径，且玩家想放塔不会一开始就堵死
- 提供 `render(ctx, dt)` 主循环钩子（60FPS requestAnimationFrame）

### Task TR
- **TR-4.1 (rule)**：截图显示 S 红、E 蓝、有石头走廊、网格整齐、尺寸 864×576。通过条件：肉眼满足。
- **TR-4.2 (rule)**：Console `TD_GAME.state.map.start = [1,8], map.end=[22,8]; TD_GAME.map.isWalkable(22,8) === true; TD_GAME.map.isWalkable(5,5 某石头格) === false; TD_GAME.map.isBuildable(5,5) === false; TD_GAME.map.isBuildable(1,8) === false（S 不可建）`。通过条件：全部 true。
- **TR-4.3 (rule)**：rAF 循环 30 秒无内存泄漏（Chrome Task Manager 内存增长 ≤ 20MB）。证据：Task Manager 截图前后对比。

---

## Task 5: A* 寻路 + 堵路预检查

**Status**: pending
**Priority**: high
**覆盖 AC**: AC-3, AC-4, FR2.2
**依赖**: Task4

### 交付
- 函数 `AStar.findPath(map, fromXY, toXY, {blockedXY?})`：4 向、曼哈顿启发式；返回 `[[x,y], ...]` 或 null（无路径）
- 每次放塔前调用 `findPath(S, E, { blockedXY: [tx,ty] }) == null ? 拒绝 : 允许`（FR2.2 预检查）
- 放塔成功后，`game.recomputeAllEnemyPaths()`：对每个在途敌人，从其当前格重新算到 E 的最短路径替换其 path
- 诊断：Canvas hover 时，如果已选塔工具，半透明绿=可/红=不可；若红是因为堵死，hover 显示 tooltip「堵死路径」

### Task TR
- **TR-5.1 (rule)**：在地图中手动放一排塔从 top 到 bottom 堵住 E-S 之间所有通道（例如 X=10 整列除石头外全部放塔），尝试放最后一块时：**失败**、金币不变、页面右上角 toast 或 HUD 条显示「此处会堵死路径，不能放塔」。证据：截图 + toast 文本。
- **TR-5.2 (rule)**：不放塔时 `findPath(S, E)` 返回的路径长度 ≤ 30（4 向最短路不会很长）。证据：Console `JSON.stringify(TD_PATH_DEBUG.length)` 值 ≤ 30。
- **TR-5.3 (rule)**：敌人 Task7 实现后（可提前用 mock），敌人走到一半时在其前方放塔挡住旧路径，敌人立刻改路绕开，不卡住也不穿墙。证据：10s 录屏或 5 帧截图序列。

---

## Task 6: 放塔系统（工具栏 + 校验 + 扣费 + 塔攻击数据挂接）

**Status**: pending
**Priority**: high
**覆盖 AC**: AC-2, AC-1 (塔 UI 部分)
**依赖**: Task5

### 交付
- 工具栏：箭塔（cost=100, range=3格, damage=15, attackInterval=0.7s, 单体, 蓝绿色圆+箭）/ 炮塔（cost=200, range=2格, damage=25, interval=1.2s, AOE radiusPx=40, 橙色方+火花）
- 点击塔按钮 → 选中态（按钮背景高亮） → hover Canvas 预览 → 点击放塔
  - 草地：若通过 FR2.2 预检查、金币够 → 扣钱、塔入 `game.towers[]`、刷新 walkable map
  - 不满足：不扣钱、提示（toast 3 秒）
- ESC / 右键 / 再点一次塔按钮 → 取消选中；放塔成功后保持选中（便于连放多个同类）
- 塔 Canvas 渲染：圆/方 + 攻击范围半透明圈（仅选中工具时显示所有塔攻击范围）
- 每塔保存 `lastAttackAt (ms timestamp)`，战斗循环 Task8 会基于此决定何时发射

### Task TR
- **TR-6.1 (rule)**：金币 500 → 连放 5 个箭塔（-100×5）→ HUD 金币 = 0；第 6 个点击草地 → toast「金币不足」，塔不出现。证据：截图 HUD 金币 = 0 + toast。
- **TR-6.2 (rule)**：选中炮塔 → 石头格 hover 红 → 点击 → 提示「只能放在草地」。证据：toast 截图。
- **TR-6.3 (rule)**：放 1 个塔 → 选不同塔工具 → hover 塔已占格 → 红禁止 → 点击不操作。证据：截图。
- **TR-6.4 (rule)**：`TD_GAME.state.towers[0].isAOE === (cannon_tower ? true : false)`。证据：放完两者，Console 各 check 一次。

---

## Task 7: 敌人波次生成 / 沿路径行进 / 到达扣基地 HP

**Status**: pending
**Priority**: high
**覆盖 AC**: AC-4, AC-6 (HP 归零触发失败条件之一)
**依赖**: Task6（有放塔才能证明塔不会阻挡波次生成，但波次生成本身独立，所以依赖上允许先和 Task6 串行避免耦合）

### 交付
- 波次数据：通过 waves config 读取；玩家点击「开始下一波」→ 若当前波无剩余生成任务/无存活敌人才允许（否则按钮禁用）
- 敌人实例字段：`{uid, typeId, hp, hpMax, speed, rewardCoin, damageToBase, path[], pathIdx, px, py（像素坐标）, color, radiusPx}`
- 帧循环里 `advanceEnemy(e, dt)`：按当前段方向前进；到达 path[pathIdx+1] 中心 → `pathIdx++`；到达 E 段则 `damageBase(e.damageToBase)` + `killEnemy(e, {reward:false, gem:false})`
- 波次进度 HUD 实时显示

### Task TR
- **TR-7.1 (rule)**：点「开始第 1 波」→ 敌人按配置 interval 从 S 逐个生成（可见）。证据：每 1 秒截 1 张图，连续 3 张里敌人数量递增。
- **TR-7.2 (rule)**：允许第一波敌人在没有塔时全部跑到终点 → 基地 HP 降低为 `20 - N*damageToBase`（N 是到达数量），到达 0 后触发失败遮罩（同 AC-6）。证据：HUD HP 下降过程截图至少 2 帧 + 失败遮罩 1 张。
- **TR-7.3 (rule)**：敌人每次前进像素正确（速度 ~ 1.5格/秒 * 36px/s，1秒走 54px）。证据：Console `timeDiff=1s; pyDiff = e.py_now - e.py_1s_ago; Math.abs(pyDiff - 54) <= 6` 返回 true（允许 6px 舍入误差/方向偏差）。

---

## Task 8: 战斗循环（塔攻击 / 子弹 / AOE / 敌人 HP 条）

**Status**: pending
**Priority**: high
**覆盖 AC**: AC-5
**依赖**: Task7

### 交付
- 每帧遍历所有塔：`now - lastAttackAt >= attackInterval*1000` → 从敌人列表中选最近 E 的（即 pathIdx 最大 + 段内进度最大）敌人在攻击范围内作为目标
  - 单体：push 子弹 `{from, to, speed, damage, targetEnemyUid}`，life=2.5 秒最大
  - AOE：推一个延迟命中（`delayMs`，可选 200ms 视觉飞行）→ 到达后按半径对所有敌人扣相同伤害
- 敌人 HP ≤ 0 → `killEnemy(e, rewardCoin=true, gem=true, dropGemChance)`
- 子弹飞行：每帧前进，若命中目标（距离 ≤ 半径）扣血并移除子弹
- HP 条：每个敌人 Canvas 顶部画一条彩色窄条（绿→黄→红渐变）
- 伤害飘字：扣血后在敌人头顶显示 `-15` 等（保留 ~0.8s）

### Task TR
- **TR-8.1 (rule)**：放 5 个箭塔在关键位置 → 开始第 1 波 → 敌人血量下降并最终清零死亡；场上最终 0 存活敌人；HUD 金币 + 奖励金币之和 = `kill_count * rewardCoin`。证据：开始前后金币截图 + 截图 0 存活敌人。
- **TR-8.2 (rule)**：放 2 个炮塔 → 放一波敌人挤成一团 → 一发 AOE 命中至少 3 个（半径圈截图），3 个都掉相同伤害。证据：飘字截图 3 个同数值。
- **TR-8.3 (rule)**：HP 条数值严格按 `cur/hpMax` 缩放；敌人有 `hpMax=100, hp=35` 时条长 35% 长度、红色。证据：Console 读数值 + 截图对比长度。

---

## Task 9: 胜负遮罩 + 重开

**Status**: pending
**Priority**: high
**覆盖 AC**: AC-6
**依赖**: Task8

### 交付
- 遮罩：半透明黑层 + 白色大文字 + 一个重开按钮（居中）
- 胜利：`currentWaveIndex === waves.length - 1 && spawningDone && aliveEnemies === 0`
- 失败：`baseHp <= 0`
- 重开：调用 `game.reset()` → 还原 map 临时格、清空 towers/enemies/bullets/gems；HUD HP/金币/波次恢复初始；遮罩消失；重置 spawn queue

### Task TR
- **TR-9.1 (rule)**：无塔 → 跑前几波 → HP 降到 0 → 立即出现失败遮罩 + 「重开」按钮。证据：遮罩截图。
- **TR-9.2 (rule)**：作弊模式（临时在 Console 设 `TD_GAME.cheatOneShotKill = true`，扣血 × 10 或直接 killAllEnemies；若已提供 cheat 就用），打最后一波 → 胜利遮罩出现。证据：胜利遮罩截图。
- **TR-9.3 (rule)**：点「重开」→ HUD 回到 `HP=20 金币=500 波次=1/8`，场上 0 塔 0 敌人。证据：HUD 截图 + 空塔空敌 Canvas 截图。

---

## Task 10: 宝石掉落 / 背包 / 合成 / 装备

**Status**: pending
**Priority**: high
**覆盖 AC**: AC-7, AC-8
**依赖**: Task9（可以先做宝石掉落但背包 UI 独立放 Canvas 外）

### 交付
- 敌人死亡 `gemDropChance` × `全局光加成（MVP 先只看敌人配置）` → 按 gems.dropWeights 随机出一个元素+等级的宝石实例 `{uid, element, level}`
- 掉落：在死亡位置（Canvas 上）画一个小宝石（菱形/不同颜色对应元素），点击后消失，加入背包第一个空位
- 背包 UI：6×10 网格 + 「一键合成」按钮：按 `{element, level}` 聚合，**从等级 1 开始往上**扫描，每 ≥3 相同就合 1 个 level+1，直到某轮没有可合成
- 装备：点击一颗宝石（高亮选中）→ 点 Canvas 上一塔 → 塔 `gems[]` 推入该宝石，背包删除；若塔 gemSlots 已满，toast「宝石槽已满」。属性加成在战斗循环中按塔当前 gems 计算（塔的 `effectiveDamage = damage * 乘积(火宝石加成) * ...` / 攻击 `effectiveInterval = attackInterval * 乘积(水 gem = 0.83 每颗)` / 范围 `effectiveRange = range * 乘积(风 1.15)` / 土：子弹命中后给敌人挂 slow（速度乘以 0.7 持续 2s，可叠加但 MVP 只覆盖一层）/ 光：该塔击杀时 `dropChance *= 乘积(1 + 光 gem 0.15)`
- 背包「全部出售换金币」MVP 不提供（FR 非目标）

### Task TR
- **TR-10.1 (rule)**：至少 20 只敌人死亡 → 宝石背包中至少 1 颗（实际按概率；若没出就多打 2 波，或 cheat 改 `gemDropChance *= 2`，直到有）。点击死亡格上漂浮宝石后消失，背包 count +1。证据：截图背包新增 +1。
- **TR-10.2 (rule)**：凑齐 3 个同元素 1 级 → 点「一键合成」→ 3 消失，1 个 2 级同元素出现。重复到 2→3、3→4。尝试 4 级再合成时（若没有其他 4 级）不操作。证据：每档前后背包截图对比（count -2，level +1）。
- **TR-10.3 (rule)**：选 1 个火宝石 → 点某箭塔 → Console 读取 `TD_GAME.state.towers[x].effectiveDamage` 比默认 `damage` 增加 ~20%（即 15 → 18），且下一次攻击飘字是加后伤害（≈18）。证据：截图伤害飘字新值 + Console `effectiveDamage` 打印。
- **TR-10.4 (rule)**：风宝石 × 1 → 装备炮塔 → `effectiveRangePx = old*1.15` 精准到 ±0.5px。证据：攻击范围圆比原来大（截图对比），Console `effectiveRangePx` 验证。
- **TR-10.5 (rule)**：塔 3 槽塞满 → 再点一宝石 + 点该塔 → toast「宝石槽已满」。证据：toast 截图。

---

## Task 11: 端到端联调 / 所有 AC 自检 / 性能自检

**Status**: pending
**Priority**: high
**覆盖 AC**: AC-9, AC-12, AC-1~AC-11 最后交叉复核
**依赖**: Task1~Task10 全部 completed

### 交付
- 自测 checklist：逐个跑 AC-1 ~ AC-12（除了需要独立 review 的 rubric 9 由独立 reviewer 再评），记录每条 evidence（截图命令/日志）
- 性能测试：Chrome Performance 录制 10s（40 敌人 + 15 塔，打一波），平均 FPS ≥ 55；若没达标，优化（例如减少每塔每帧全量遍历找最近敌人，改为空间分桶或缓存敌人距离排序）——若 FPS 已达标不做优化。
- 发现的致命 bug 回退到对应 Task 作为 in_progress 修复，直到 AC 都通过。

### Task TR
- **TR-11.1 (rule)**：书面 checklist 每一条 AC-1~AC-8、AC-10、AC-11 写了「通过 + 证据」。未通过不得标记完成。
- **TR-11.2 (rule)**：Performance 截图平均 FPS 曲线 ≥ 55 持续 ≥ 8 秒。
- **TR-11.3 (rubric - AC-9，作为实现者自评不替代独立 reviewer 最终评分)**：
  游玩 3 分钟，打分 0/1/2，写 2 行理由。通过阈值 ≥ 1（自身评分达不到 1 → 立即修 bug，重测）。

---

## 取消任务规则

任何任务想取消（例如用户决定不做宝石合成 MVP）需要显式批准；取消后在本文件该任务下面写：

```
### Status: cancelled
### Cancelled By: user (approval: 2026-08-22 回复：xxx)
### Reason: 原因
```

并且需要保证被取消任务覆盖的 AC 由**其他任务重新覆盖**（若没有其他任务覆盖，视为 AC 空洞，不能 Review 通过）。
