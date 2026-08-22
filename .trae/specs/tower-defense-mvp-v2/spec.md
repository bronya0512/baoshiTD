# 宝石TD · MVP v2 规格（玩法规则重制）

## 1. 问题 / 用户 / 目标
- **问题**：MVP v1 的玩法（自由花金币建塔 + 建塔数量无限）与用户想要的"云顶式运气/放塔 5 次/保留 1 塔/波末升级运气等级"不一致，需要把整体玩法规则、经济、配置契约、UI 交互全面重做。
- **用户**：浏览器访问 `http://localhost:8080/td` 直接游玩的玩家；后端提供配置契约给前端，前端单机可运行（无后端时用 fallback）。
- **目标（MVP v2 必达）**：
  1. **每波放置系统**：开始波次前给玩家 5 次"放置到空地 → 随机 Roll 塔"的机会，放完 5 次必须选 1 保留为真塔，其余 4 座自动变"墙（可通行=False，可手动免费拆除）"。
  2. **运气等级系统（全局永久，配置化）**：1~5 级（默认）。每级配置：`升级需金币 / 塔稀有度权重 / 奖励掉落稀有度权重`。玩家仅能在波次结束时花金币升级（可连续升多级，金币够就行），升级保留到游戏结束。
  3. **金币经济 v2**：放置塔不再消耗金币；**没有宝石背包、没有装备宝石、没有合成（用户明确要求）**。金币来源 = 击杀敌人（基础 + 按稀有度 roll 的额外奖励）+ 波末奖励金币；用途 = 升级运气等级 / 花金币 Roll 全局永久增益 Buff。拆墙免费；v2 不实现"合成"。
  4. **增益抽取（配置化）**：花指定金币 roll 一次 Buff（例如：全体塔攻击+15%、射速+20%、击杀金币+20%、减速+20% 等），重复抽取可叠加或升级，全部配置化。
  5. **防封死拒绝**：任何动作（把 4 座变墙、拆墙（边界情况）、保留选择、在放置阶段放一个 Roll 结果）**只要导致 S→E 4 向 A* 无路可走，就拒绝该动作并提示**。
  6. **简易塔池（简单版 A）**：4 稀有度 × 6 元素 = 24 塔。属性 = 基础模板 × 稀有度倍率 × 元素加成；模板按稀有度决定 AOE/单体/攻速；元素决定颜色和附加效果（减速/攻击倍率/范围倍率/击杀概率额外奖励金）。
  7. **A* 开放地图仍然保留**：敌人 4 向寻路，石走廊（不可建，不可拆）与玩家的"墙"（不可建但**可免费拆除**）在寻路里都视为障碍。
  8. **后端契约变更同步到 fallback**：前端不管是走后端 `/api/config/*` 还是 `file://` fallback，字段完全一致，游戏代码只用同一套 adapt。

## 2. 非目标（不做）
- 不做 Spine 接入（MVP v2 仍然是 Canvas 2D 几何渲染；"刻晴可用"作为渲染资产不受影响）。
- 不做账号/登录/持久化存档（保持 v1 仅内存）。
- 不做排行榜、社交、Docker 构建验证（Docker 仍未安装，环境限制）。
- 不做云顶的商店刷新机制（用户明确说"没有商店"）。
- 不做波内升级运气等级（只能波末）。

## 3. 功能需求
### 3.1 游戏阶段状态机
```
MENU → PREPARE(波 N)
          ├─放置阶段：剩余 N 次放置机会（N = config.waves[i].placementPerWave，缺省 5）
          │   ①点击空地(草地tile=0 或 墙tile=4) → 扣机会 → **确定位置后**按 luckLevel 的 towerRarityWeights roll 塔 → 立在该格(标记为 候选塔)
          │   ②不提供撤销。放置 1 次生效后不可撤回。（用户明确要求"放置规则是先确定位置，再随机生成防御塔，不能撤销"）
          │   ③放置到 N/N：进入保留选择阶段，UI 弹出"请点击 1 座保留"（只能选 1）
          │     └ 选完后：该格变真塔(tile=5)；其他4格变墙(tile=4)；
          │        └ 变更前先跑 A* 拒绝：如果 S→E 失去连通，整次"保留操作"不生效并提示「此选择会封死路径，请换一座保留或拆墙」
          ├─点击【开始波次】（此时必须已经完成保留选择（放置=0 且已选保留））
          → FIGHTING
              ├─ 敌人按 WaveConfig.groups 生成，A* 走最短可行路径
              ├─ 真塔攻击、计算死亡奖励（按敌人 baseGold × killGoldMulAll；此外按 luckLevel.bonusRarityWeights roll 一次稀有度，对应额外奖励金 common=5/rare=15/epic=40/legendary=100，写 msg）
              ├─ 玩家可在此阶段：免费拆自己的墙（先跑连通性 gate，仅拒绝 S→E 完全无路的操作）
              ├─ 【胜负】基地血量 0 = LOSE；所有波打完且基地>0 = WIN
          → WAVE_END
              ├─ 发放：波末奖励金币（= waves[i].rewardGold）
              ├─ 显示【升级运气】面板：当前等级 / 下一级升级需金币 / 可点升级（连续升多级也行）
              ├─ 显示【抽取增益】面板：Buff 表(配置化)，点一次花多少金币 Roll 一次什么 Buff；永久叠加
              ├─ 点【进入下一波】：回到 PREPARE(N+1)，重置 5 次放置
END
```

**rule AC-3.1 (状态机覆盖)**：UI 顶部必须有"阶段状态条"，明确显示 `阶段：PREPARE/FIGHTING/WAVE_END/MENU/WIN/LOSE`。

### 3.2 放置规则 + 候选塔 Roll 算法
- `placementPerWave = config.waves[i].placementPerWave`（缺省 5）。
- 候选塔 roll：
  1. 取 `config.luck.levels[L-1].towerRarityWeights`（map[rarityKey]weight），加权随机选 rarityKey。
  2. 从 `config.towers where rarity==rarityKey` 均匀随机选 1。
  3. 把"随机种子/结果"写入 msg/console，便于复现。
- **rule AC-3.2.1 (Roll 可观测)**：每次 roll 在 msg 区域打印 `[放置 X/N] Roll 塔={name} (rarity, element) seed=...`；N=waves[i].placementPerWave（缺省 5）；X 从 1..N。
- **rule AC-3.2.2 (无撤销)**：HUD 不得出现"撤销"按钮；任何调用"撤销放置"的内部 API（实现中若存在）必须抛错（TDD：BrowserUse 确认无 DOM 元素 `#btn-undo`）。
- **rule AC-3.2.3 (保留选择防封死)**：保留选择提交前必须通过 `地图在"1 真塔+4 墙"情况下的连通性`判断。不满足→拒绝+红色 msg。
- **rule AC-3.2.4 (直接放在墙上)**：放置阶段，若目标格上一状态是"墙（tile=4）"，允许把放置机会落在上面（覆盖）。选完保留后该格要么真塔要么墙。

### 3.3 墙 / 石走廊 / 基地 / 起点 通行规则
- **石走廊 tile=1**：不可通行，不可建造，不可拆除。
- **墙 tile=4**：不可通行，不可建造，**可免费拆除（FIGHTING/PREPARE/WAVE_END 都能拆）**；拆除时"拒绝封死"仅对 S→E 没路的情况需要拒绝（拆墙通常更连通，一般不会触发拒绝，除非 bug）。
- **真塔 tile=5**：不可通行，不可建造，可拆除（提供"拆塔"付费/免费？ → 默认规则：真塔**不能拆**（避免玩家把唯一保留的塔拆了丢失玩法）；MVP v2 先不开放拆塔。若用户后续要拆，加配置开关。）
- **S/E tile=2/3**：永远可通行，不可建造，不可拆除。
- **草地 tile=0**：可通行，可建造（可被放置为 候选塔/墙）。

**rule AC-3.3 (Tile 语义)**：
  - 对任意 `tile!=0 且 tile!=4 且 tile!=候选塔(显示态但内部仍=0)`，放置阶段的放置动作直接拒绝。
  - 对 tile=1 任何拆除动作拒绝。

### 3.4 运气等级配置契约（新增）
新增 `GET /api/config/luck` 返回：
```json
{ "initialLevel": 1,
  "levels": [
    { "level": 1,
      "upgradeCostGold": null,
      "towerRarityWeights": {"common":70,"rare":25,"epic":4,"legendary":1},
      "bonusRarityWeights": {"common":70,"rare":25,"epic":4,"legendary":1} },
    { "level": 2,
      "upgradeCostGold": 60,
      "towerRarityWeights": {"common":55,"rare":35,"epic":8,"legendary":2},
      "bonusRarityWeights": {"common":60,"rare":32,"epic":6,"legendary":2} },
    ...(5档)
  ] }
```
- **rule AC-3.4.1**：`levels.length >= 4`；`level[0].upgradeCostGold == null`；`level[i+1].level == level[i].level + 1`；所有 weight 之和 > 0。
- **rule AC-3.4.2**：波末升级 UI 必须显示当前 L、下一级 cost、重复点击时可连续升级（直到没有下一级或金币不足）。升级信息写入 msg `[运气 Lv X→Y] 花费 120 金`。

### 3.5 金币经济 v2 + 全局增益抽取（新增）
新增 `GET /api/config/buffs` 返回：
```json
{
  "rollCostGold": 40, // 抽一次 40 金
  "buffs": [
    { "id": "atk_1", "name": "攻击+15%", "rarity": "common",
      "effect": { "towerDamageMulAll": 1.15 } },
    { "id": "spd_1", "name": "射速+20%", "rarity": "common",
      "effect": { "towerAttackIntervalMulAll": 0.83 } },
    { "id": "gold_1","name": "击杀金币+20%","rarity":"rare",
      "effect": { "killGoldMulAll": 1.20 } },
    { "id": "slow_1","name": "减速效果+20%","rarity":"rare",
      "effect": { "slowStrengthMulAll": 1.20 } },
    ...
  ],
  "rollRarityWeights": {
    "1": {"common":70,"rare":25,"epic":4,"legendary":1},  // Lv1 抽 Buff 的稀有度权重（和塔分开）
    "2": {...},
    ...
  }
}
```
- **规则**：每次 Roll 花 `rollCostGold`，在 `luckLevel` 对应的 `rollRarityWeights` 选稀有度，再在 buffs 里按稀有度均匀抽一条。效果**永久叠加**（如果 `towerDamageMulAll` 再抽到一次，则 1.15×1.15=1.3225）。
- **rule AC-3.5.1**：Roll 结果显示在 msg + 侧边 Buff 清单（列出现有 Buff 名称×层数/倍数）。金币不足则禁用按钮。
- **rule AC-3.5.2**：塔/敌人/战斗在使用属性时，必须把所有 Buff 的乘数合并。战斗日志里（调试开关）打印最终伤害公式 `finalDamage = base × rarityMul × elementBonus × luckBuffMul × damageMulAll(1.3225) × (1 - enemyArmor) × resist(元素)`。

### 3.6 敌人/波次/基地血量 (保留 v1，小改)
- 波次配置：在 `WaveConfig` 顶层新增 `placementPerWave: number`（缺省 5），不同波可以调整次数。
- 波次奖励字段：`waves[i].rewardGold`（波末发放）；敌人 5 条（小兵/疾行者/重甲/精英/BOSS）保留，每条有 `killBaseGold` 和 `dropBonusRate`（死亡时按 luckLevel.bonusRarityWeights roll 稀有度，命中则给对应额外金币：common=5 / rare=15 / epic=40 / legendary=100，这张表在 adapt 层集中定义为 `rarity → bonusGoldMap`）。基地 HP = `mapsDetail[1].base.hp = 20` 不变。

### 3.7 （无宝石背包 / 无装备 / 无合成）— v2 简化
- 用户明确：v2 **不做宝石背包、不做装备宝石、不做合成**。所有之前的"宝石掉落/合成/背包/装备"概念全部取消。
- 保留"稀有度奖励 Roll"作为金币扩展来源（见 3.6），不进入库存，直接金币入账，UI 只需要 msg 日志 + Buff 清单（Buff 是全局叠加不是装备）。
- 侧边栏只需要：Buff 激活清单 + 消息日志。不再有宝石库存面板。

### 3.8 塔 (简单版 A：4 稀有度 × 6 元素 = 24)
`config.towers = 24 条。`
- `rarity ∈ {common, rare, epic, legendary}`
- `element ∈ {fire, ice, thunder, poison, light, dark}`
- 基础模板（按稀有度）：
  - 稀有度倍率 dmgMul：common=1.00 / rare=1.50 / epic=2.20 / legendary=3.00；范围 rangeInCells：2 / 2 / 3 / 3；攻击间隔 0.9 / 0.8 / 0.7 / 0.6；cost 已删除（不再用金币建塔）。
  - AOE 属性：legendary 与 epic 才带 AOE（例如 3/4 档稀有度 × ice 元素就 AOE 冰减速），其他单体。具体在生成器里写死一条默认的 rarity→ AOE 规则（配置表全部展开为静态 TowerConfig，避免前端算模板）。
- 元素加成：对齐 v1 的元素 baseBonus 语义（`attrMulDamage` / `attrMulAttackInterval` / `attrMulRange` / `slowOnHitPct01` / `killBonusGoldChanceAdd01`），直接应用到塔（最后一项 = 死亡时额外奖励金 roll 的命中概率加算）。
- **rule AC-3.8.1**：`towers.length == 24`；每 (rarity,element) 唯一存在一条；每条都有 `levels[0]` 带 baseDamage / attackRange / attackSpeed（仍然保留 attackSpeed 字段，在 adapt 转 attackInterval），加上 `isAOE`/`aoeRadiusPx`。

### 3.9 拒绝封死 (A* 连通性 gate)
所有"会改变地形的写操作"都要先应用到一个临时的 tiles 副本里跑 A*（起点 spawnPoints[0] → 终点 base {x,y}，4 向，障碍=1/4/5 以及 候选塔所在格视为障碍）。无路就拒绝。
- **写入操作清单**：放置 Roll（当前规则下，放置=不可逆写入）、保留选择（最大风险点：4 座变墙很容易堵死）、拆除墙（通常更连通，但统一走 gate 只检查操作后是否仍连通，拒绝"拆完后 S→E 更不连通"这种边界 bug 情况，实际上拆墙几乎永远是或等连通，所以不会拒绝）、新建塔（目前没有新建塔直接购买，所以只有 roll 放置）。
- 注意：**撤销放置不提供**，所以"撤销"不进入 gate。
- **rule AC-3.9.1**：所有写入操作在拒绝时都会在 msg 区域输出 `[拒绝] 此操作会封死 S→E 路径，请换一个位置或选择其他组合`。
- **rule AC-3.9.2 (TDD)**：准备一个"已知会堵死"的保留选择（让 S 上、下、左、右、中间都变成墙），自动化测试里操作拒绝次数 ≧ 1，且 tiles 未变。

### 3.10 胜负
- **LOSE**：基地 hp <= 0 → 展示失败面板（波末升级和 Buff 面板隐藏，出现重开按钮）。
- **WIN**：所有波全部结束（当前 waveIndex == maxWaves && 最后一波敌人清空）→ 展示胜利面板，给出本局统计（保留塔数量、运气等级、最终 Buff 数量、最终金币）。
- **rule AC-3.10.1**：HUD 的生命条（td.css 里已有 hp-bar class）显示 `hp/hpMax`；LOSE/WIN 必须覆盖 Canvas 并阻止任何新的操作。

## 4. 非功能需求
- **配置单一实现源**：所有曲线（luck 等级、升级金币、塔/奖励稀有度权重；Buff 配置；towers 24 条；waves 8 条；enemies 5 条；map 24x16）都在后端写静态 Go 数组，fallback.js 和后端输出字段一致（通过 24 塔数量、luck.levels 长度对比验证）。
- **前端离线可用**：若请求后端超时 3s，自动退回 fallback，玩家用 file:// 打开 tower-defense.html 也能玩（同样规则）。
- **性能 rubric**：Canvas 864×576，60fps，敌人 150 个 + 真塔最多 8 × 8 = 64 座（8波 × 每波 1 保留塔），使用 requestAnimationFrame 单循环，不掉帧（Chrome DevTools Performance 面板 FPS 曲线在 55~60 之间的时间 ≥ 90%）。
- **可观测 rubric**：每次 Roll 操作、升级运气、抽取 Buff、拒绝封死、胜负判定 都有 msg 日志 + console.log；关键数据（当前地图 tiles 哈希、连通性耗时、roll 塔次数）在 console 输出，便于调参。

## 5. 约束 / 依赖 / 假设 / 开放问题
- 约束：
  - 运行环境未装 Docker / Node.js，所以所有验证脚本必须**能用 PowerShell 5.1 + Go 1.25 + BrowserUse**跑通；不能依赖 Node。
  - v1 的 `tiles` base64 编码 bug 已在 v1 里修（用 MarshalJSON 输出 []int），v2 保持不变。
- 依赖：v1 实现的 `td-api-contract-test.ps1` 框架继续复用；`td-fallback-vs-backend.ps1` 继续复用（但要加 luck/buffs/24塔 字段）。
- 假设：
  - 用户希望"波次 5 次放置机会"是**每波重置**（而不是"全局 5 次"）。
  - 玩家在保留选择时**必须**选 1 座（不能"全部变墙+0 真塔"，否则玩法会直接崩）。
- 开放问题（当前 v2 里按默认处理，若你要改请在 review 提出）：
  1. 真塔是否可拆除？→ 默认否。
  2. 波末运气升级是否有金币够就"连续升"？→ 默认是。
  3. 抽 Buff 是否允许同一 Buff 无限叠加？→ 默认是（按乘法叠加，越叠收益边际递减，避免数值爆炸）。
  4. 放置 5 次后"变墙"的那些墙，如果下一波玩家继续"直接放在墙上"，放 Roll 塔的候选塔覆盖了墙，该格最后再次根据保留结果要么塔要么墙？→ 默认是。

## 6. 验收标准
（都是 rule 或者 rubric，无二义）

1. **rule AC-COVER**：v2 所有 Acceptance Criterion 都在 tasks.md 中至少对应 1 条 Task-local TR。
2. **rule AC-3.1**：阶段状态条 6 态正确切换（PREPARE→FIGHTING→WAVE_END→PREPARE；LOSE/WIN 覆盖）。
3. **rule AC-3.2.x**（x=1~4）：见第 3.2 节。
4. **rule AC-3.3**：Tile 通行/建造/拆除的 6 条规则全部被 UI 行为强制执行。
5. **rule AC-3.4.1**：`/api/config/luck` 返回契约字段正确。
6. **rule AC-3.4.2**：波末升级面板 UI 实现连续升级 + msg 日志。
7. **rule AC-3.5.1**：抽取 Buff UI + Buff 清单 + 金币不足灰。
8. **rule AC-3.5.2**：伤害公式里 Buff 乘数生效（单测级验证：无 Buff vs 两条 atk_1 的期望伤害比 = 1/(1.15²)）。
9. **rule AC-3.7.1（已删除=PASS 默认）**：v2 不实现宝石背包/装备/合成；此条视为自动通过。验收时 BrowserUse 验证页面 DOM 中不存在 `id=gems-panel` / `id=gem-inventory` / `id=btn-craft` / `id=btn-equip-gem` 等元素。
10. **rule AC-3.8.1**：towers = 24，每 (rarity,element) 唯一，levels 字段完整。
11. **rule AC-3.9.1 & AC-3.9.2**：连通性 gate 一致实现 + 至少 1 次拒绝行为自动化验证。
12. **rule AC-3.10.1**：HP HUD 正确；LOSE/WIN 面板存在并阻断操作。
13. **rule AC-CONTRACT-FALLBACK**：fallback.js 输出 towers.length=24 且 luck.levels 长度/每级 upgradeCostGold/塔稀有度权重 key 集合 == 后端返回（PS 脚本自动对比）。
14. **rubric AC-PERF**：60fps 压测（MVP v2 end2end 跑 8 波，Performance 面板 55fps+ ≥ 90%）。阈值 0-1 分：>=90%=2 分；>=70%<90%=1 分；<70%=0 分；Pass≥2 分。
15. **rubric AC-OBS**：日志可观测性（msg+console）。评分：全部 5 类关键事件都能找到日志 = 2 分；少 1 类 = 1 分；2 类以上缺失 = 0 分；Pass≥2 分。
