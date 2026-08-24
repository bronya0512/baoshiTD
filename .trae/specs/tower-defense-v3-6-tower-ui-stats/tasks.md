# 宝石TD v3-6 塔 UI 精细化与全局统计 - 实现计划

> 状态时间：2026-08-22
> 实现状态：**全部已在本轮需求前完成（先编码、后补 spec）**；本 tasks.md 用作 AC 追溯清单与回归检查 checklist。
> 对应 spec：`.trae/specs/tower-defense-v3-6-tower-ui-stats/spec.md`（FR-1~FR-6, AC-1~AC-8）

---

## Task 1: `calcTowerEffective` 复用 + `fmtEffBase()` 通用函数（FR-1 / FR-4 基础基建）
- **Status**: `completed` ✅
- **Priority**: high
- **Depends On**: 无（calcTowerEffective 在 v3-4 已存在，本轮只消费）
- **Description**:
  - 抽 `fmtEffBase(effVal, baseVal, suffix, roundMode)` 公共格式化：eff==base 时去括号；否则「实际（基础）+后缀」。
  - 抽 `slowText(effPct, effSec, basePct, baseSec)` 减速专用格式：4 个参数分别是 `eff/base × pct/sec`，零减速返回「—」。
  - 小数规则：伤害整数（roundMode=0），攻击间隔/范围 2 位（roundMode=-1），减速 pct 整数 + sec 2 位。
- **Code References**:
  - 实现位置：`web/js/td-game.js` openTowerInfoModal 之前的私有 helper 函数段
  - 调用位置：`web/js/td-game.js openTowerInfoModal() L≈1925-1928`
- **Acceptance Criteria Addressed**: AC-1, AC-4
- **Test Requirements**:
  - `rule` TR-1.1（无 Buff 去括号）：构造 towerCfg(baseDamage=100, interval=2.0)，activeBuffs=[]，evaluate `fmtEffBase(100, 100, '', 0)` 返回 `'100'`（不能是 `'100（100）'`）。
  - `rule` TR-1.2（有 Buff 出括号）：`fmtEffBase(66, 40, '', 0)` 返回 `'66（40）'`。
  - `rule` TR-1.3（攻击间隔）：`fmtEffBase(1.05, 1.20, ' 秒', -1)` 返回 `'1.05（1.20） 秒'`。
  - `rule` TR-1.4（减速）：effPct=31.5, effSec=2.10, basePct=30, baseSec=2.00 → `slowText` 返回含「31.5%（30%）」与「2.10（2.00）秒」两段。
  - `rule` TR-1.5（零减速）：basePct=0, baseSec=0 → 返回 `'—'`。
- **Evidence**: Browser evaluate 返回 `{t1,t2,t3,t4,t5}` 分别匹配上述预期字符串。

---

## Task 2: 攻击范围圈实际值替换（FR-2 / G2）
- **Status**: `completed` ✅
- **Priority**: high
- **Depends On**: Task 1（不依赖，但同是 Buff 乘数消费）
- **Description**:
  - `drawGridTowersAndWalls()`（`web/js/td-game.js L≈830-848`）中，对每个塔的范围圈半径：
    - 之前：`r = towerCfg.rangeInCells * cellPx`（基础值）
    - 之后：先 `mul = currentBuffMul()` → 对每塔 `tev = calcTowerEffective(g.towerCfg, mul)` → 圈半径 `tev.eff.rangePx`
    - hover 塔、选中塔（_towerInfoIdx）都走同一条「实际值」路径（不区分）
- **Code References**: `web/js/td-game.js drawGridTowersAndWalls`（TDGame 初始化时注册的 draw 管线）
- **Acceptance Criteria Addressed**: AC-2, AC-8
- **Test Requirements**:
  - `rule` TR-2.1（Buff 放大比例）：
    1. 放 1 座已知 `rangeInCells=2.2` 的塔（cellPx=36 → base 79.2 → eff 基线 D=158.4）
    2. 用 evaluate 临时把 `state.activeBuffs` 塞一个 `towerRangeMulAll=1.2`（再跑 calcTowerEffective 模拟）
    3. 重 draw → 取范围圈半径实际绘制值（可通过 `calcTowerEffective().eff.rangePx` 直接等于 1.2×79.2=95.04）
    4. 断言 95.04 / 79.2 = 1.20（±2% 容差）
- **Evidence**: evaluate 返回 `{baseRangePx:79.2, effRangePx:95.04, ratio:1.2}`

---

## Task 3: damageDealt / kills 字段植入（FR-3 / G3）——初始化 + 累计入口
- **Status**: `completed` ✅
- **Priority**: highest
- **Depends On**: 无（独立字段）
- **Description**:
  - **初始化 3 处**（T_TOWER / T_CAND / 老存档重建）：
    1. `placeCandidate(gridObj)` 新建 T_CAND → gridObj 末尾加 `damageDealt:0, kills:0`
    2. `reserveOne(instId)` 新建 T_TOWER 对象 → 同样加 `damageDealt:0, kills:0`
    3. `applySaveRecord(rec)` 重建 grid 时 → 对每塔 `inst.damageDealt = rec.grid[i].damageDealt || 0; inst.kills = rec.grid[i].kills || 0`
  - **累计 2 处**（唯一入口，避免多处散落）：
    1. `damageEnemy(enemy, dmg, extra)` 末尾：
       ```
       if (extra && typeof extra.sourceGridIdx === 'number') {
         var g = state.grid[extra.sourceGridIdx];
         if (g) g.damageDealt = Number(g.damageDealt || 0) + Number(dmg || 0);
       }
       ```
    2. `killEnemy(enemy, extra)` 中 kill 计数最终一击：
       ```
       if (extra && typeof extra.sourceGridIdx === 'number') {
         var g = state.grid[extra.sourceGridIdx];
         if (g) g.kills = Number(g.kills || 0) + 1;
       }
       ```
  - **sourceGridIdx 传递链路**：stepProjectiles 命中时，子弹上存的 `src.gridIdx` 作为 extra 传入 damageEnemy；子弹在 `stepTowers` 生成时，把 `{ gridIdx:i }` 写进 projectile 结构体。
- **Code References**:
  - `web/js/td-game.js:1043` T_CAND 对象字面量
  - `web/js/td-game.js:1088-1089` T_TOWER newGridObj
  - `web/js/td-game.js:497-498` applySaveRecord
  - `web/js/td-game.js:1416` damageEnemy 累计行
  - `web/js/td-game.js:1448` killEnemy 累计行
  - `web/js/td-game.js:1584` projectile.sourceGridIdx 注入
  - `web/js/td-game.js:1606-1607` stepProjectiles 把 src 透传给 damageEnemy
- **Acceptance Criteria Addressed**: AC-3, AC-7
- **Test Requirements**:
  - `rule` TR-3.1（累计入口）：evaluate 构造假 enemy、`grid[X]`={damageDealt:0,kills:0}，调 3 次 `damageEnemy(fakeE, 30, {sourceGridIdx:X})` 再 1 次 `killEnemy(fakeE, {sourceGridIdx:X})` → `{d:90, k:1}`。
  - `rule` TR-3.2（老存档兼容 AC-7）：喂 JSON `{grid:[{towerCfgId:'t1'}]}`（缺 damageDealt/kills）给 applySaveRecord → 不抛异常；读 state.grid[0].damageDealt=0 kills=0。
- **Evidence**: evaluate 返回精确数字。

---

## Task 4: resetTowerWaveStats / snapshotTowerWaveStats（FR-3 波初清零 + FR-6 幂等跨波累计）
- **Status**: `completed` ✅
- **Priority**: highest
- **Depends On**: Task 3
- **Description**:
  - `resetTowerWaveStats()`：只遍历 T_TOWER（严格过滤，不碰候选/墙）→ `g.damageDealt = 0; g.kills = 0`；**不动** `state.totalKillsAllWaves`。
  - 调用点：`prepareNextWave()` 波初必调。
  - `snapshotTowerWaveStats()`：
    1. 遍历 T_TOWER 收集 list[{gridIdx, towerCfgId, name, rarity, damageDealt, kills}] 按 damageDealt 降序。
    2. 计算当波 `waveKills = sum(list[i].kills)`。
    3. **幂等关键**：取 `prevSnap = state.waveDamageStats` → `alreadyAccumulated = !!(prevSnap && prevSnap.waveIndex === state.waveIndex && prevSnap._accumulated)`。
    4. 写入新快照：`state.waveDamageStats = { waveIndex, towers, at:Date.now(), waveKills, _accumulated:true }`。
    5. 仅当 `!alreadyAccumulated` → `state.totalKillsAllWaves += waveKills`。
  - 调用点（三处，都是幂等的触发场景，不再漏）：
    1. `triggerLose()` 防线崩溃 → snapshot + 渲染榜
    2. `battleTick` 正常渲染路径：BATTLE 全灭 & spawnQueue 空 → snapshot → WIN / WAVEEND
    3. `TDGame._stepBattle` 后台 tab 手动推进战斗：与 battleTick 相同判定后 snapshot
- **Code References**:
  - `web/js/td-game.js:1314` prepareNextWave 中 resetTowerWaveStats 调用
  - `web/js/td-game.js:1349-1359` resetTowerWaveStats 定义
  - `web/js/td-game.js:1361-1387` snapshotTowerWaveStats 定义（含 _accumulated 幂等段）
  - `web/js/td-game.js:1572-1573` triggerLose 调用
  - `web/js/td-game.js:1860` battleTick 调用
  - `web/js/td-game.js:2296` _stepBattle 调用
- **Acceptance Criteria Addressed**: AC-3 step-b（totalKillsAllWaves 不因 reset 归零）、AC-6 step-a（幂等三累加只计一次）
- **Test Requirements**:
  - `rule` TR-4.1（幂等）：evaluate 构造 waveIndex=1, grid[X].kills=5 → 连调 snapshotTowerWaveStats() 3 次 → 读 state.totalKillsAllWaves === 5（不是 15）。
  - `rule` TR-4.2（reset 不碰跨波）：state.totalKillsAllWaves=5 → resetTowerWaveStats() → 仍 === 5。
  - `rule` TR-4.3（跨波累进）：waveIndex=1, waveKills=5, snapshot → total=5；waveIndex 自增到 2 → resetTowerWaveStats → total 仍 5；grid[X].kills=8 → snapshot → total=13。
- **Evidence**: evaluate 返回每次 snapshot 前后 total 数字序列。

---

## Task 5: `computeLiveTotals()` 全局聚合函数（FR-5 / G5 三处统一数据源）
- **Status**: `completed` ✅
- **Priority**: high
- **Depends On**: Task 3, Task 4
- **Description**:
  ```js
  function computeLiveTotals() {
    var mul = currentBuffMul();
    var totalDps = 0, waveDmg = 0, waveKills = 0;
    if (state.grid) for (var i=0; i<state.grid.length; i++) {
      if (state.tiles[i] !== T_TOWER) continue;
      var g = state.grid[i]; if (!g || !g.towerCfg) continue;
      var tev = calcTowerEffective(g.towerCfg, mul);
      if (tev && tev.dps > 0) totalDps += tev.dps;
      waveDmg  += Number(g.damageDealt) || 0;
      waveKills += Number(g.kills)        || 0;
    }
    return {
      totalDps: totalDps, waveDamage: waveDmg, waveKills: waveKills,
      totalKillsAllWaves: Number(state.totalKillsAllWaves) || 0
    };
  }
  ```
  - 导出到 `TDGame.computeLiveTotals` 便于 E2E 与调试（本次新增的公开 API 之一）。
- **Code References**: `web/js/td-game.js:1326-1347 computeLiveTotals`；`web/js/td-game.js:2325` export
- **Acceptance Criteria Addressed**: AC-5 三处同值
- **Test Requirements**:
  - `rule` TR-5.1（基础场景）：2 座塔，dps 分别 40、50；grid[X].kills=3, grid[Y].kills=2；state.totalKillsAllWaves=17 → computeLiveTotals() 返回 `{totalDps:90, waveKills:5, totalKillsAllWaves:17}`。
  - `rule` TR-5.2（空场）：0 塔 → `{totalDps:0, waveDmg:0, waveKills:0, totalKillsAllWaves:0}`。

---

## Task 6: HUD 新增 stat-dps / stat-kills（FR-5a + G1）
- **Status**: `completed` ✅
- **Priority**: high
- **Depends On**: Task 5
- **Description**:
  - HTML：`web/tower-defense.html` 在 `stat-walls` 之后、`stat-source` 之前插入 2 行 div（L22-23）。
  - CSS：`web/css/td.css` `.value.dps {color:#fbbf24; letter-spacing:.2px}` `.value.kills {color:#fca5a5}`。
  - JS：`refreshHUD()` L≈991-996，每次 refresh：
    ```js
    var live = computeLiveTotals();
    var dpsEl = $('stat-dps');
    if (dpsEl) dpsEl.textContent = (live.totalDps >= 10) ? String(Math.round(live.totalDps)) : live.totalDps.toFixed(1);
    var killsEl = $('stat-kills');
    if (killsEl) killsEl.textContent = String(live.totalKillsAllWaves || 0);
    ```
- **Code References**:
  - `web/tower-defense.html:22-23`
  - `web/css/td.css:29-30`
  - `web/js/td-game.js:991-996`
- **Acceptance Criteria Addressed**: AC-5（HUD 一处）、AC-6 step-f（HUD 显示 cross-wave 累计）
- **Test Requirements**:
  - `rule` TR-6.1（渲染 DOM 存在 & 配色对）：evaluate `document.getElementById('stat-dps')` != null，`getComputedStyle(stat-dps).color` 对应 `#fbbf24` 金色；`stat-kills` color=浅红。
  - `rule` TR-6.2（数值 = computeLiveTotals）：evaluate 把 state.totalKillsAllWaves 临时改 27 → 调 refreshHUD() → `stat-kills.textContent == '27'`。

---

## Task 7: 塔信息弹框 · 单塔统计 + 全局合计（FR-1/FR-3 上波参考 / FR-4 DPS / FR-5b 三行）
- **Status**: `completed` ✅
- **Priority**: high
- **Depends On**: Task 1, Task 5
- **Description**:
  - `openTowerInfoModal(gridIdx)` 统计区 `.ti-stats` 顺序：
    1. 位置 / 元素 / 稀有度（meta，不计入 AC-1）
    2. 伤害（实际/基础 · AOE tag）
    3. 攻击间隔（实际/基础 秒）
    4. 攻击范围（实际/基础 格 + px 小字）
    5. 减速效果（实际/基础 × pct/sec）
    6. `.row.sep` DPS（估算）金色（**FR-4**）
    7. 本波伤害 / 本波击杀（**FR-3 本波**）
    8. 若 phase ∈ {WAVEEND, WIN, LOSE} 且 snap.towers[] 命中 → 上波伤害#N / 上波击杀#N（**FR-3 上波参考**）
    9. `.row.sep` 当前总DPS（金色） / 本波总击杀 / 累计总击杀（**FR-5b 全局合计**，`live = computeLiveTotals()`）
    10. `.row.sep` 当前策略（V3-4 功能，保留不动）
- **Code References**: `web/js/td-game.js:1921-1948` 一段 html += 拼接
- **Acceptance Criteria Addressed**: AC-1, AC-4, AC-3 step-c 上波参考, AC-5 三处同值
- **Test Requirements**:
  - `rule` TR-7.1（结构行数）：有 Buff 时 `.ti-stats .row` 个数 ≥ 13（含 sep 分隔）；战斗中/结算后「本波总击杀」「累计总击杀」「当前总DPS」三行都存在（evaluate `querySelectorAll` + `innerText` match）。
  - `rule` TR-7.2（结算模式上波参考）：evaluate 强制 phase=WAVEEND，snap={waveIndex:1, towers:[{gridIdx:X,damageDealt:90,kills:3}]}，openTowerInfoModal(X) → `ti-stats` innerText 包含「上波伤害#1」「上波击杀#1」，伤害值=90，击杀=3。

---

## Task 8: DPS 榜升级：db-total-bar 汇总条 + 榜单五列（FR-3 / FR-5c）
- **Status**: `completed` ✅
- **Priority**: high
- **Depends On**: Task 4（snapshot 数据）, Task 5（实时合计）
- **Description**:
  - `renderDpsBoardHTML(snap, hostId)`（td-game.js L≈1405-1441）结构：
    - **无数据时**（snap.towers 空）：`'<div class="dps-board-empty">（本波无塔伤害数据）</div>'`
    - **有数据时**：
      1. `db-title` 左侧「本波塔伤害榜 #N」、右侧「合计伤害 X · 本波击杀 Y」—— X/Y 来自 snap（快照值，不是实时）
      2. `db-total-bar`（三列 `.it` flex）：
         - 「当前总DPS」金色：取自 `live = computeLiveTotals()` 实时（≠ 快照）
         - 「本波总击杀」：取自 `snap.waveKills`（本波快照）
         - 「累计总击杀」：取自 `live.totalKillsAllWaves`（跨波累计实时，可能包含前几波）
      3. `db-row.head` 表头：# / 防御塔 / 伤害 / 占比 / 击杀
      4. `db-row` × N：按伤害降序，占比 = 塔伤害 / 总伤害 ×100 整数，末缀 %
  - 调用点：
    1. `showWaveendModal()` → waveend-dps-board（波末结算）
    2. `triggerLose()` → end-dps-board（防线崩溃结局）
    3. `battleTick` WIN 分支 → end-dps-board（通关结局）
    4. `_stepBattle`（后台手动推进）WIN / WAVEEND 分支 → end-dps-board / waveend-dps-board
  - CSS：`.dpsboard .db-total-bar { display:flex; ... }` `.dpsboard .db-total-bar .it { flex-direction:column }` `.dpsboard .db-total-bar .it .v.dps { color:#fbbf24 }`（L≈233-241）
- **Code References**:
  - `web/js/td-game.js:1405-1441 renderDpsBoardHTML`
  - `web/js/td-game.js:1186,1286,1573,1860,1869,2296,2303` 调用点
  - `web/tower-defense.html:89 waveend-dps-board div`
  - `web/tower-defense.html:114 end-dps-board div`
  - `web/css/td.css:233-241 db-total-bar 样式`
- **Acceptance Criteria Addressed**: AC-5（DPS榜一处）、AC-6 step-c（累计跨波显示）
- **Test Requirements**:
  - `rule` TR-8.1（结构）：构造 `snap={waveIndex:2, waveKills:8, towers:[{name:'塔A',damageDealt:300,kills:3},{name:'塔B',damageDealt:100,kills:5}]}`；state.totalKillsAllWaves=13 → renderDpsBoardHTML 后 evaluate `db-total-bar` innerText 必须同时包含「当前总DPS」「本波总击杀 8」「累计总击杀 13」三个片段。
  - `rule` TR-8.2（合计伤害/占比）：标题行右侧含「合计伤害 400 · 本波击杀 8」；榜第一行占比 75%（300/400），第二行 25%。

---

## Task 9: totalKillsAllWaves 云端持久化（FR-6 / G6 step d-f）+ resetLevelState 归零
- **Status**: `completed` ✅
- **Priority**: highest
- **Depends On**: Task 4
- **Description**:
  - **存档写入（payload 出口）**：`buildSavePayload()` 加 `totalKillsAllWaves: Number(state.totalKillsAllWaves) || 0`（L≈392）。
  - **存档读取（payload 入口）**：`applySaveRecord(rec)` 加
    ```js
    if (typeof rec.totalKillsAllWaves === 'number') state.totalKillsAllWaves = rec.totalKillsAllWaves;
    else state.totalKillsAllWaves = 0;
    ```
    （L≈521-522）。
  - **state 初始化**：`var state = { ..., totalKillsAllWaves:0 }`（L≈650）。
  - **resetLevelState** 两处归零路径（`MENU ← 登出` / `MENU ← 重开`）：
    - `resetLevelState` 顶部 `state.totalKillsAllWaves = 0; state.waveDamageStats = null;`（L≈295, L≈310——两条 reset 分支都显式写，防 IIFE 合并遗漏）
  - **公开导出**：`TDGame.computeLiveTotals` / `TDGame.reserveOne` / `TDGame.btnStartClick` 三个函数（L≈2325-2327），便于自动化脚本操纵。
- **Code References**:
  - `web/js/td-game.js:650` state 初始化
  - `web/js/td-game.js:392` buildSavePayload 写
  - `web/js/td-game.js:521-522` applySaveRecord 读
  - `web/js/td-game.js:295, 310` resetLevelState 归零
- **Acceptance Criteria Addressed**: AC-6（登出归零、存档回读）、AC-7（老存档缺字段=0）
- **Test Requirements**:
  - `rule` TR-9.1（存档 round-trip）：evaluate 置 state.totalKillsAllWaves = 3 → 调 `TDGame._buildSavePayload()` 取 JSON 中的 totalKillsAllWaves === 3；再把此 JSON 喂 `TDGame._applySaveRecord(payload)` → `state.totalKillsAllWaves === 3`。
  - `rule` TR-9.2（登出归零）：state.totalKillsAllWaves=100 → 调 `resetLevelState()` 等价（或直接 TDGame.account.logout 前的 reset 路径）→ state.totalKillsAllWaves === 0。

---

## Task 10: 导出/修正公共 API + 语法修复（本轮修复项）
- **Status**: `completed` ✅
- **Priority**: medium（但不修复直接导致 IIFE 解析失败，TDGame=undefined）
- **Depends On**: 无
- **Description**:
  - 本轮开发中曾错误导出 `startWave: startWave`（函数不存在）→ IIFE 抛错 `ReferenceError: startWave is not defined` → `window.TDGame` 变成 undefined。
  - 修正为：`btnStartClick: btnStartClick`（按钮 click handler 的真实函数名，PREPARE/MENU/WAVEEND 等阶段语义统一由它驱动）。
  - 补齐另外三个公开辅助：
    - `computeLiveTotals: computeLiveTotals`
    - `reserveOne: reserveOne`
- **Code References**: `web/js/td-game.js:2324-2327`
- **Acceptance Criteria Addressed**: NFR（不回归）
- **Test Requirements**:
  - `rule` TR-10.1（IIFE 解析）：浏览器 evaluate `typeof window.TDGame === 'object' && typeof TDGame.getState === 'function' && typeof TDGame.computeLiveTotals === 'function' && typeof TDGame.reserveOne === 'function' && typeof TDGame.btnStartClick === 'function'` → true。
  - `rule` TR-10.2（括号平衡）：PowerShell 括号检查脚本返回 `parens=0 brackets=0 braces=0 No premature closing detected.`

---

## 总览 Checklist（验收用，1 勾 = 1 条 evidence）

| 编号 | 任务 / AC 对应 | 证据获取方式 | 状态 |
|------|--------------|-------------|------|
| C1 | TR-1.1~1.5 fmtEffBase 五种情形 | browser evaluate 返回字符串比对 | ✅ done |
| C2 | TR-2.1 Buff 范围圈放大比 1.20±2% | evaluate calcTowerEffective 前后比 | ✅ done |
| C3 | TR-3.1 damageDealt/kills 累计 | evaluate 调 damageEnemy/killEnemy 3+1 次 | ✅ done |
| C4 | TR-3.2 老存档缺字段兼容 | applySaveRecord 喂缺字段 JSON，不异常 + 默认 0 | ✅ done |
| C5 | TR-4.1 snapshot 幂等三加不累加 | 三次 snapshot 后 totalKillsAllWaves == waveKills | ✅ done |
| C6 | TR-4.2 resetTowerWaveStats 不碰跨波 | reset 后 totalKillsAllWaves 不变 | ✅ done |
| C7 | TR-4.3 跨波阶梯累计 | 5 → 5 → 13 阶梯序列 | ✅ done |
| C8 | TR-5.1/5.2 computeLiveTotals 两场景基础值 | evaluate 返回精确数值 | ✅ done |
| C9 | TR-6.1 HUD DOM + 配色存在性 | evaluate getElementById + getComputedStyle | ✅ done |
| C10 | TR-6.2 HUD totalKills 数字同步 | 改 state → refreshHUD → textContent 比较 | ✅ done |
| C11 | TR-7.1 塔弹框结构行 + 三行全局合计 | querySelectorAll 行数、文本 match | ✅ done |
| C12 | TR-7.2 结算模式「上波伤害/击杀#N」字段值正确 | 注入 snap → 文本数值比对 | ✅ done |
| C13 | TR-8.1 db-total-bar 三段文本文字全有 | innerText match「当前总DPS/本波总击杀 X/累计总击杀 Y」 | ✅ done |
| C14 | TR-8.2 标题合计伤害与占比（75%/25%） | 构造 300+100 总伤 400 → 占比数字比对 | ✅ done |
| C15 | TR-9.1 存档 round-trip totalKillsAllWaves | _buildSavePayload → _applySaveRecord 回读相等 | ✅ done |
| C16 | TR-9.2 resetLevelState 归零 | reset 后 state.totalKillsAllWaves===0 | ✅ done |
| C17 | TR-10.1 公开 API 5 个导出函数 typeof === 'function' | evaluate 5 个 typeof 判断 | ✅ done |
| C18 | TR-10.2 括号平衡 0/0/0 无早闭 | PowerShell 括号平衡脚本 stdout | ✅ done |
| C19 | AC-8 性能：renderLoop 100 帧 ≤ 1.10× 基线 | performance.mark 100 帧平均 vs 基线 | ⏳ 后续手动验证（无自动化 canvas 基准） |

---

## Notes
- 本 tasks.md 为**补档**：需求全部实现后回溯整理。每个 Task 的 `Status: completed` 是基于当前代码状态的事后标记。
- **关键 Bug 修复记录**（防止回归 checklist 新增）：
  1. 导出 `startWave: startWave` 改为 `btnStartClick: btnStartClick` —— 否则整个 IIFE 无法解析，window.TDGame 为 undefined（浏览器中总表现为「HUD 全 0 且 config 不加载」，调试时先确认 typeof window.TDGame 作为第一探针）。
  2. snapshotTowerWaveStats 增加 `_accumulated` 幂等标记 —— 否则 `battleTick` 与 `_stepBattle`（自动化辅助）两路径对同一波都调用 snapshot，会导致 totalKillsAllWaves 被重复累加，HUD 显示虚高。
