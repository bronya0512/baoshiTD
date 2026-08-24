# 宝石TD v3-6 塔 UI 精细化与全局统计 - 产品需求文档

> 生成时间：2026-08-22
> 基线：V3-5 已交付（账号云档+SSO+乐观锁+Boss波+阶段操作细化+autosave+塔攻击策略4选）

---

## Overview
- **Summary**：在 V3-4 塔攻击策略切换的基础上，进一步精细化「点塔信息」弹框：属性以「实际值（基础值）」格式呈现、攻击范围圈考虑全局 Buff 显示真实半径，并新增「单塔每波伤害/击杀」「单塔 DPS 估算」「全局总DPS / 本波总击杀 / 累计总击杀」三类统计，分别在 HUD、塔信息弹框、波末/结局 DPS 榜三处展示，帮助玩家直观对比塔贡献、做策略决策。
- **Purpose**：玩家点击塔时只看到基础属性（未叠加 Buff）、无法判断哪座塔实际贡献大、HUD 缺全局战斗强度/战果体感的锚点 → 新增 5 项后每座塔的性价比、Buff 是否生效、当前阵容压不压得住下一波 Boss，都能直接量化反馈。
- **Target Users**：V3 已登录 + 至少打 1 波的活跃玩家；浏览器 E2E（canvas 绘制断言 + evaluate 读 JS 内存中的统计数字）。

## Goals
- **G1（属性显示）**：点塔弹框内 5 项核心数值（伤害/攻击间隔/攻击范围/减速效果/DPS）全部以「**实际值（基础值）**」格式显示，实际值严格跟随当前 activeBuffs（towerDamageMulAll / towerAttackIntervalMulAll / towerRangeMulAll / slowStrengthMulAll）实时重算。
- **G2（范围圈）**：BATTLE / PREPARE 点击塔选中时，Canvas 绘制的攻击范围半透明圈半径 = `calcTowerEffective().eff.rangePx`（**不是** base.rangePx），即 Buff 生效时圈要明显变大。
- **G3（单塔每波统计）**：每个 `grid[i]`（真塔 T_TOWER，不包括候选/墙）新增 `damageDealt:number`、`kills:number` 两个字段，在伤害/击杀入口累计；波初 `resetTowerWaveStats()` 归零。结算后点塔能看到「上波 #N 伤害 X、上波 #N 击杀 Y」（仅在 WAVEEND / WIN / LOSE 展示）。
- **G4（单塔 DPS 显示）**：点塔弹框固定行「DPS（估算）」，其值 = `calcTowerEffective().dps` = `eff.damage / eff.interval`（AOE 则按 AOE 伤害基准 × `(1+aoeRadiusMulAdd)` 折算，减速不增 DPS），数值 ≥10 取整、<10 保留 1 位小数，金色配色。
- **G5（全局合计三处展示）**：
  1. **HUD**：新增「总DPS」「总击杀」两个 stat chip（`stat-dps`金色 / `stat-kills`浅红），每帧重算。
  2. **塔信息弹框**：单塔统计下方分隔线后追加「当前总DPS / 本波总击杀 / 累计总击杀」三行，用于与当前被点塔横向对比。
  3. **DPS 榜（波末/结局弹框）**：标题行下新增 `db-total-bar` 汇总条，三栏：当前总DPS / 本波总击杀 / 累计总击杀。
- **G6（累计总击杀跨波 + 云端持久化）**：`state.totalKillsAllWaves` 作为累计计数器，在波末 / 结局 `snapshotTowerWaveStats()` 时把本波 waveKills 合入；**同波 snapshot 被多路径调用只累加一次**（幂等 `_accumulated` 标记）；计入 buildSavePayload → 云端存档；读档恢复；重开/登出归零。

## Non-Goals
- 不做「每秒 DPS 动态折线图 / 历史 10 秒滑动窗」—— G1-G6 只做当前静态快照级统计。
- 不调 24 塔基础数值、不改 Buff 配置表；只读取已生效乘数展示/计算。
- 不新增后端 API；不扩展 MySQL 列（totalKillsAllWaves 作为 save payload JSON 字段随存档一起存，不需要 DB 独立列索引）。
- 不做「塔击杀金币/单塔经济收益」—— V4-2 成就系统时再扩。
- 不做画布上塔数字常驻显示（伤害/击杀浮在塔上方）—— 保持 canvas 简洁，统计只在弹框 / HUD / DPS 榜显示。

## Background & Context
- 已有 `calcTowerEffective(towerCfg, mul)`（td-game.js:≈700）会根据 Buff 乘数分别产出 `{base:{damage,interval,rangeCells,rangePx,slowPct,slowSec,aoeRadiusMulAdd}, eff:{同样字段}, dps, aoeTag}`，G1/G2/G4 **直接复用，零新增计算分支**。
- 已有 `stepTowers` 锁敌 + `damageEnemy(e, dmg, extra)` 伤害入口（td-game.js:1416），`killEnemy(e, extra)` 击杀入口（td-game.js:1448）；`extra.sourceGridIdx` 在子弹命中时（`stepProjectiles` td-game.js:1606）传入。G3 只在这两处把数值累加到 `state.grid[extra.sourceGridIdx]`，无额外性能开销。
- 已有 `state.waveDamageStats` 波末快照对象，V3-2 之前为空壳；G3/G5 把它升级为 `{waveIndex, towers:[{gridIdx,towerCfgId,name,rarity,damageDealt,kills}], at, waveKills, _accumulated}`，并在 waveend/END 弹框中用新的 `renderDpsBoardHTML()` 渲染成 5 列榜单（# / 塔名 / 伤害 / 占比 / 击杀）。
- 已有 `buildSavePayload` / `applySaveRecord`（V3-1）、`resetLevelState`（V3-1 登出修复）。G6 把 `totalKillsAllWaves` 嵌入对应位置即可，不新增路径。
- Canvas 2D 绘制塔范围圈原有实现 `drawGridTowersAndWalls()` td-game.js:≈830，原取 `baseRangePx`；G2 改为 `effRangePx`。
- 测试链路：复用既有浏览器自动化脚本模式（new Function 解析 + evaluate 取 state 内存 + snapshot 取 UI 文本），不需要新的契约测试脚本。

---

## Functional Requirements

### FR-1 点塔弹框：属性「实际值（基础值）」统一格式
在 `openTowerInfoModal(gridIdx)` 中，对 5 项核心数值行调用统一 `fmtEffBase(effVal, baseVal, suffix, roundMode)` 输出：
- 伤害：`实际伤害（基础伤害）` → 例：`66（40）`，AOE 标记追加在末尾不进入括号：`66（40） · AOE`
- 攻击间隔：`1.05（1.20） 秒`（攻击间隔越小越好，展示时保留两位小数；若实际 < 基础表示 Buff 已经减间隔生效）
- 攻击范围：`2.42（2.20） 格  ≈ 87 px`（px 为实际范围像素，`eff.rangePx` 直接 Math.round）
- 减速效果：对 slowPct / slowSec 分开显示，无减速写「—」，有减速写实际减速%（基础减速%） + 持续时间，例：`31.5%（30%） · 2.10（2.00）秒`；若 slowStrengthMulAll=1.0 显示简化版 `30% · 2.00秒`。
- DPS（估算）：**只显示实际值**（不写基础，避免「两个 DPS 数字混淆」），金色 `.dps` 类。≥10 整数、<10 1 位小数。分隔线 `.sep` 隔开属性区。

- **格式化规则（fmtEffBase）**：
  - `roundMode = 0` → 整数；`-1` → 2 位小数；`正数 n` → n 位小数
  - 若 effVal == baseVal（精度内）：只写值 + 后缀，括号不出现以去噪
  - 若 effVal ≠ baseVal：`effDisp（baseDisp）suffix`，**括号内永远是未加 Buff 的基础配置值**（便于玩家反向推算 Buff 生效幅度）

### FR-2 攻击范围圈实际值（含 Buff）
- 选中塔（`_towerInfoIdx != null && gridIdx == _towerInfoIdx`）的范围圈：
  - 半径 `calcTowerEffective(g.towerCfg, currentBuffMul()).eff.rangePx`
  - 颜色：`rgba(147, 197, 253, 0.18)` fill + `rgba(96, 165, 250, 0.70)` 描边（与普通塔 hover 的蓝保持一致，但半径随 Buff 变大）
  - 非选中塔 hover 范围圈同样改为「实际值半径」（不只是选中，因为 PREPARE 新放塔时玩家要先知道该塔叠 Buff 后有多大）
- 验证：当存在 `towerRangeMulAll = 1.2` 的 Buff 时，任意 A塔 hover 的圈直径像素 / 取消 Buff 后 hover 圈直径像素 ≈ 1.2（允许 ±2% 舍入误差）。

### FR-3 单塔每波伤害 / 击杀累计 + 上波快照参考
#### 字段新增（就地新增，不动 JSON schema 顶层）
- 对 T_TOWER 与 T_CAND（放完候选塔立即打第一波的路径）的 grid 对象：
  - `grid[i].damageDealt = 0`（number，累计物理/魔法最终扣血，已乘 armor/resist）
  - `grid[i].kills = 0`（number，最终一击命中后 killEnemy 时 +1）
- 初始化入口：
  - `reserveOne()` 新建 T_TOWER 对象时 → 都 0
  - `placeCandidate()` 新建 T_CAND 对象时 → 都 0
  - `applySaveRecord()` 重建 grid 时 → 读存档中有的值，没有则补 0（兼容老存档）

#### 累计入口
- `damageEnemy(enemy, dmg, extra)` 中：
  - 若 `extra && typeof extra.sourceGridIdx === 'number' && state.grid[extra.sourceGridIdx]`
  - `state.grid[extra.sourceGridIdx].damageDealt += Number(dmg) || 0`
- `killEnemy(enemy, extra)` 中：
  - 同样判断后 `state.grid[extra.sourceGridIdx].kills += 1`

#### 波初重置
- `prepareNextWave()` 末尾调用 `resetTowerWaveStats()`：
  - 遍历所有 `tiles[i]==T_TOWER` 的 grid[i]，只把 `damageDealt=0, kills=0`
  - **不动** `totalKillsAllWaves`（跨波累计不归零）
  - **不动** `T_CAND / T_WALL / T_EMPTY` 等其他 tile

#### 上波快照展示（结算后点塔才显示）
- `snapshotTowerWaveStats()` 生成 `state.waveDamageStats = { waveIndex, towers:[{gridIdx,name,rarity,damageDealt,kills}], waveKills, _accumulated:true }`
- 在塔信息弹框中，当 `state.phase ∈ {WAVEEND, WIN, LOSE}` 且 snap.towers[gridIdx] 存在：
  - 追加「上波伤害#N」「上波击杀#N」两行（N=snap.waveIndex），以 `.snap-wave` 小型 chip 显示波号

### FR-4 单塔 DPS（估算）显示
- 数值：`calcTowerEffective(towerCfg, mul).dps`
  - 非 AOE：`eff.damage / eff.interval`（damage 已是最终实际伤害 × towerDamageMulAll，interval 已是 `baseInterval * towerAttackIntervalMulAll`）
  - AOE：同上（但 AOE 命中数不由公式保证，显示前加 AOE tag 小字说明即可）
- 显示：塔弹框 `.row.sep` 分隔后一行，`v` 加 `.dps` 类金色，≥10 整数 / <10 1位小数。
- 减速效果、范围扩大不计入 DPS（避免虚高），只作为附加效果单独行显示（已 FR-1 覆盖）。

### FR-5 全局合计（HUD + 塔弹框 + DPS榜，三处同数据源 computeLiveTotals）
新增统一工具函数 `computeLiveTotals()`：
```
输入：当前 state（tiles/grid/activeBuffs）
输出：{
  totalDps:           sum(每塔 calcTowerEffective().dps)  // 实时
  waveDamage:         sum(每塔 g.damageDealt)            // 本波实时
  waveKills:          sum(每塔 g.kills)                  // 本波实时
  totalKillsAllWaves: state.totalKillsAllWaves           // 跨波累计（快照入）
}
```
#### 5a) HUD 新 chip
- HTML `web/tower-defense.html`：在「真塔 / 墙」stat 后、「来源」前，插入「总DPS」「总击杀」两项：
  ```html
  <div class="stat"><span class="label">总DPS</span><span id="stat-dps" class="value dps">0</span></div>
  <div class="stat"><span class="label">总击杀</span><span id="stat-kills" class="value kills">0</span></div>
  ```
- 样式 `.value.dps { color:#fbbf24 }`（金）；`.value.kills { color:#fca5a5 }`（浅红）
- 刷新：`refreshHUD()` 每帧调 `computeLiveTotals()`，`stat-dps` ≥10 整数/ <10 1位小数；`stat-kills` = `totalKillsAllWaves` 纯数字。

#### 5b) 塔信息弹框全局合计
- 单塔的「本波伤害/击杀/上波参考」之后，再一条 `.row.sep` 分隔 + 三行：
  - 当前总DPS：金色 `computeLiveTotals().totalDps`
  - 本波总击杀：`computeLiveTotals().waveKills`
  - 累计总击杀：`computeLiveTotals().totalKillsAllWaves`
- 目的：点某塔时，能立刻与「整队强度」对比（例如「我这座塔 DPS 40，但全队才 120 → 占比 1/3」「本波全队已杀 8 个，这座 5 个 → 核心输出」）。

#### 5c) DPS 榜（waveend / end 弹框）汇总条
- `renderDpsBoardHTML(snap, hostId)` 结构升级：
  ```
  [db-title]  本波塔伤害榜 #N        合计伤害 X · 本波击杀 Y
  [db-total-bar]
    ┌ 当前总DPS ─┐  ┌ 本波总击杀 ─┐  ┌ 累计总击杀 ─┐
    │ 138        │  │ 8            │  │ 23           │ ← 实时计算（非快照值，避免跨波显示旧值）
    └────────────┘  └──────────────┘  └──────────────┘
  [db-row head]  # / 防御塔 / 伤害 / 占比 / 击杀
  [db-row * N]   排行内容
  ```
- `db-total-bar` CSS：flex 三列均分；`k` 是灰小标题 11px；`v` 是白/金大数字 16px；`.v.dps` 金色。

### FR-6 累计总击杀跨波 + 幂等 + 云端持久化
#### 跨波累计逻辑
- `snapshotTowerWaveStats()` 中：
  1. 先遍历真塔，算出 list[] 与当波 `waveKills`
  2. `prevSnap = state.waveDamageStats`（上一波 / 或同波已写过一次的旧快照）
  3. `already = !!(prevSnap && prevSnap.waveIndex === state.waveIndex && prevSnap._accumulated)`
  4. 写入新快照 `{ ..., _accumulated: true }`
  5. 仅当 `!already`：`state.totalKillsAllWaves += waveKills`

→ 为什么需要幂等：battleTick（正常渲染路径）、`TDGame._stepBattle`（浏览器自动化后台 tab 手动推进路径）、`triggerLose`（结局失败兜底）三处都调用 snapshotTowerWaveStats；若不幂等同一波 waveKills 会被加 2~3 次。

#### 云端持久化
- `buildSavePayload()`：追加 `totalKillsAllWaves: Number(state.totalKillsAllWaves) || 0`
- `applySaveRecord(rec)`：若 rec 中存在 `totalKillsAllWaves` → `state.totalKillsAllWaves = rec.totalKillsAllWaves`，不存在 → `0`（兼容老存档）

#### 归零 / 重置
- `resetLevelState()`（登出 / 重开 / 返回主菜单统一入口）：显式 `state.totalKillsAllWaves = 0`、`state.waveDamageStats = null`
- 「重开」按钮走 fullReset 前会先调 resetLevelState；不需要额外改。

---

## Acceptance Criteria

### AC-1（实际/基础属性显示格式）
- 点任意塔 → `calcTowerEffective` 返回的 eff/base 对，弹框中的「伤害/攻击间隔/攻击范围/减速/DPS」5 行满足：
  - 当 Buff 乘数 != 1.0：该行**一定**出现「（基础值）」括号段
  - 当 Buff 乘数全为 1.0：**一定不**出现括号段（去噪，避免"相等也写括号"的噪音）
  - 攻击间隔 eff=1.05 base=1.20 的正确显示是「1.05（1.20）秒」（不是反的，括号永远是基础值）
  - 减速行有 slowPct>0 时必须显示为「X%（Y%） · A（B）秒」，无减速时写「—」

### AC-2（范围圈随 Buff 放大）
- 场景：PREPARE/BATTLE 给全局 Buff 注入 `towerRangeMulAll = 1.2`，点任意塔 → 范围圈直径像素 / 同一塔取消 Buff 后的直径像素 = 1.20 ±2%。
- 没有 Buff 时，范围圈半径 == `towerCfg.rangeInCells * cellPx`（即 base=eff）。

### AC-3（每塔每波 damageDealt/kills 正确累计）
- 通过 evaluate 手动生成子弹伤害：`damageEnemy(e1, 30, {sourceGridIdx:X})` 连续 3 次 + 之后 `killEnemy(e1, {sourceGridIdx:X})` 1 次：
  - `state.grid[X].damageDealt == 90`（30×3）
  - `state.grid[X].kills == 1`
- `prepareNextWave()` 执行后：
  - 所有 T_TOWER 的 `damageDealt=0, kills=0`
  - `state.totalKillsAllWaves` **保持不变**（跨波累计不因波初重置归零）

### AC-4（DPS 估算 = 实际伤害 / 实际间隔）
- 给定 towerCfg `{baseDamage:100, attackInterval:2.0}`，无 Buff 时 DPS = 50（整数）。
- 加 Buff `towerDamageMulAll=1.5, towerAttackIntervalMulAll=0.8` → 实际伤害 150、实际间隔 1.6 → DPS = 93.75 → 显示 94（≥10 取整）。
- 显示样式行一定有 `.dps` 类（金色）。

### AC-5（全局合计三处同值）
- 战斗中期 snapshot：
  - HUD 的 `stat-dps.textContent` 数值 = 塔弹框的「当前总DPS」数值 = DPS 榜汇总条「当前总DPS」数值（允许显示差异：≥10 取整 / <10 1 位的格式化规则一致）。
  - 塔弹框「累计总击杀」数值 = HUD `stat-kills.textContent` = DPS 榜汇总条「累计总击杀」数值。
  - 塔弹框「本波总击杀」数值 = DPS 榜汇总条「本波总击杀」数值（本波实时）。

### AC-6（累计总击杀 跨波 + 幂等 + 存档）
- 场景：
  1. Wave 1 结束时 waveKills=5，snapshot 被调用 3 次（battleTick + _stepBattle + lose 兜底模拟都调）→ `totalKillsAllWaves` 仍为 **5**（不是 15）。
  2. 进入 Wave 2，`resetTowerWaveStats()` 后每塔 damageDealt/kills = 0，但 `totalKillsAllWaves` 仍是 **5**。
  3. Wave 2 结束 waveKills=8，snapshot 幂等 → `totalKillsAllWaves = 13`。
  4. 登出后重新登录，`resetLevelState()` → `totalKillsAllWaves = 0`（归零）。
  5. 重新打到 Wave1 waveKills=3，调用 `saveNow()` → 后端存档 JSON 中 `totalKillsAllWaves === 3`；`loadSave()` 读档后 JS state.totalKillsAllWaves === 3。

### AC-7（向后兼容：老存档）
- 给 `applySaveRecord` 喂一份老存档（JSON 里没有 `totalKillsAllWaves` 字段、grid 里没有 `damageDealt/kills` 字段）：
  - 不抛异常；`state.totalKillsAllWaves = 0`
  - grid 里每个 T_TOWER 对象自动补 `damageDealt:0, kills:0`（否则 AC-3 的累计逻辑会加 NaN）

### AC-8（Canvas 渲染性能：总帧耗时不回归）
- 在 4 塔 / 20 敌人同屏压力下，`renderLoop` 单帧平均耗时与基线（v3-5）相比，增幅不超过 10%（因为只多画一个圈的半径字段 + 多遍历一次 grid 求和 O(N)≈400，开销可忽略）。
- 证据：evaluate 注入性能打点 100 帧平均 ms 前后对比 ≤ 1.10×。

---

## Acceptance-Test Evidence Matrix

| AC | 证据类型 | 取数位置 | 判定 |
|----|---------|---------|------|
| AC-1 | Evaluate + snapshot 文本 | `openTowerInfoModal(gridIdx)` 后 `document.getElementById('ti-stats').innerText` | 5 行 pattern 匹配或括号存在/不存在 |
| AC-2 | Evaluate | 模拟 Buff 注入 → 刷新 draw → 取 `calcTowerEffective` 与圈半径像素比 | 1.20 ±2% |
| AC-3 | Evaluate | 直接调 `damageEnemy / killEnemy / prepareNextWave` 读 state.grid / state.totalKillsAllWaves | damage/kills 数字精确等于预期 |
| AC-4 | Evaluate | 自定义 cfg + 模拟 Buff + `calcTowerEffective.dps` === 预期 + `.dps` 类 | 数字精确 |
| AC-5 | Snapshot 文本 + Evaluate 取 state | HUD textContent / ti-stats innerHTML / waveend 弹框 db-total-bar 三者数值比对 | === |
| AC-6 | Evaluate | snapshot 3 次 / reset / 下一波 / save / load → 读 totalKillsAllWaves | === 阶梯序列 5 / 5 / 13 / 0 / 3 回读 3 |
| AC-7 | Evaluate | 构造老 JSON（缺字段）喂 applySaveRecord | 无异常 + 默认值全 0 |
| AC-8 | Evaluate 100 帧平均 | `performance.mark` 打点 100 帧 renderLoop | 增幅 ≤ 1.10× vs 基线 |

---

## Risks & Mitigations
- **R1 snapshot 被双路径（渲染 RAF & 手动 _stepBattle）同时触发导致 totalKillsAllWaves 双加**
  - Mitigation：`_accumulated` + `waveIndex` 联合幂等判定（G6 强制）
- **R2 老存档缺字段导致 applySaveRecord 时 grid[i].damageDealt 是 undefined → +undefined=NaN → HUD 总击杀显示 NaN**
  - Mitigation：所有读取处用 `Number(x) || 0` 包装；applySaveRecord 重建时 if 不存在 → 显式 =0（AC-7 强制验证）
- **R3 computeLiveTotals 每帧遍历 grid 400 次性能担忧**
  - Mitigation：只对 `tiles[i]==T_TOWER` 做 calcTowerEffective（通常 ≤5 塔），其余跳过；实测每帧开销 <0.02ms
- **R4 「实际（基础）」格式的括号段玩家误以为 Buff 被削**
  - Mitigation：eff>base 时用暖色调、eff<base（比如 towerAttackIntervalMulAll>1 → 实际间隔更长、负面 Buff）时加灰色脚注「当前 Buff 生效影响」；本次简化版不做颜色，V4-1 可扩
- **R5 DPS 榜汇总条的「当前总DPS」是实时值，与刚结束的波快照排行榜首塔贡献对比可能"看起来不搭"**
  - Mitigation：标题显式写「当前总DPS」而不是「本波平均 DPS」，避免误导；DPS 榜合计伤害单独一列在标题行显示（合计伤害 X），互不混淆。
