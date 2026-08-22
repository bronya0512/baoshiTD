# 宝石TD MVP v2 任务分解
AC 编号与 [spec.md](./spec.md) 第 6 节完全对齐。每条任务写：父 AC、目标、前置、Test Requirements（rule/rubric）、完成证据。

---

## Task 1 (v2): 后端配置契约（luck/buffs/24towers/waves+placementPerWave）+ 路由 + model + handler
- **父 AC**：AC-3.4.1, AC-3.5.1, AC-3.8.1, AC-3.2.1, AC-CONTRACT-FALLBACK
- **目标**：在 `internal/{model,handler}` 与 `router` 里新增契约：
  - `GET /api/config/luck` 返回初始等级 + 5 级配置。
  - `GET /api/config/buffs` 返回 rollCostGold + buffs[≥8] + rollRarityWeights[1..5]。
  - `GET /api/config/towers` 现在返回 24 条 (4 rar × 6 elem)；TowerConfig 新增 `rarity` 字段。
  - `WaveConfig` 新增 `placementPerWave: number`（waves[].placementPerWave = 5，默认值）。
  - 保持 `/api/config/enemies/maps/maps/:id/waves/:mapId` 向后兼容，只增量，不删字段（不破坏 v1 UI 使用者）。v2 **不实现** `/api/config/gems`（用户明确：无宝石背包/装备/合成，掉落直接转金币），所以 `/api/config/gems` 保留老数据但前端不再依赖。
- **前置**：无
- **Test Requirements**：
  - TR-1.1 (rule): 运行 `scripts/td-api-contract-test-v2.ps1`，其中断言：
    - towers.length == 24；`$_.rarity × element` 笛卡尔积不重复（去重后=24）。
    - towers[0..23].levels[0]：baseDamage/attackRange/attackSpeed/isAOE/aoeRadiusPx 非缺。
    - luck.initialLevel == 1；luck.levels.length >= 4；`sort by level` 连续 1..N；每级都有 towerRarityWeights + **bonusRarityWeights**（宝石概念已移除，改为奖励掉落稀有度权重）。
    - buffs.rollCostGold > 0；buffs.buffs.length >= 8；buffs.rollRarityWeights 含 key 1..luck.maxLevel。
    - waves/:mapId 每波含 placementPerWave（默认 5）+ rewardGold（波末奖励金）。
  - TR-1.2 (rule): 拒绝路径仍然返回 404（/api/config/waves/999、/api/config/luck/999、/api/config/buffs/999 都不 panic）。
  - TR-1.3 (rule): maps/1 仍返回 tiles=384 数字数组（MarshalJSON 不回归）。
- **输出**：contract 脚本 ALL PASS 截图/日志作为完成证据。

## Task 2 (v2): Fallback + ConfigLoader/Adapt 同步 v2 字段
- **父 AC**：AC-CONTRACT-FALLBACK, AC-3.4.1, AC-3.5.1, AC-3.8.1
- **目标**：
  - `td-config-fallback.js` 新增 `luck`、`buffs`；`towers` 改成 24 条；`waves[].placementPerWave`、`waves[].rewardGold`；`enemies[*].killBaseGold`、`enemies[*].dropBonusRate`。
  - `td-config-loader.js` adapt 新增：
    - `luck` 解包 + `nextLevel(L)` 返回 `{cost, towerWeights, bonusWeights}`；
    - `rollTowerByLuck(L, randomFn)` 封装 Roll 塔算法（唯一实现源）；
    - `rollBonusRarityByLuck(L, randomFn)` 封装 Roll 稀有度奖励算法（唯一实现源，返回 rarityKey，在 game 层用 `bonusGoldMap[rarity]` 换金币）；
    - `applyBuffs(state.buffsActive, baseStats)` 返回合并乘数对象（`damageMul / attackIntervalMul / rangeMul / killGoldMul / slowMul`）；
    - `bonusGoldMap = {common:5, rare:15, epic:40, legendary:100}` 集中导出。
- **前置**：Task 1 completed。
- **Test Requirements**：
  - TR-2.1 (rule): `scripts/td-fallback-vs-backend-v2.ps1` 比较 towers 长度=24；luck.levels 每级 upgradeCostGold、塔稀有度权重 key 集合、buffs.rollCostGold 完全一致；waves 每波 placementPerWave=5；maps/1 tiles hash 仍然一致。失败=FAIL。
  - TR-2.2 (rule): 离线加载测试：浏览器直接用 `file://` 打开 `tower-defense.html`（BrowserUse 本地静态路径测一下），期望 `source: fallback(...)`、towersById[24 entries OK]、luck.levels[0] 存在、buffs.buffs[0] 存在。失败=FAIL。
  - TR-2.3 (rubric): 关键算法的唯一性：在代码中全局 grep "random.*tower" / "roll.*tower" / "Math.random" 只允许在 `rollTowerByLuck / rollBonusRarityByLuck / rollBuff` 三处用于游戏随机；任何其余 Math.random 都必须是视觉抖动。scale: 0-2 分：零违规=2；1 处违规=1；2+ 处=0；pass >= 2。
- **输出**：PS 脚本 PASS；BrowserUse 离线测试截图/eval 结果。

## Task 3 (v2): A* 连通性 Gate（唯一实现源 + 拒绝封死测试用例）
- **父 AC**：AC-3.9.1, AC-3.9.2, AC-3.3, AC-3.2.2
- **目标**：在 `td-game.js`（或独立 `td-pathing.js`）实现：
  - `findPath4Dir(tiles, cols, rows, fromXY, toXY)` — 4 方向 A*。障碍 tile：1/4/5 + 候选塔覆盖的格通过参数传入障碍集合。
  - `canApplyChange(tilesBefore, op)`：op 是 `{type:'place'|'reserve'|'demolishWall', payload:{...}}`，对 tilesBefore 应用更改后跑 A*，返回 `{ok:true, newTiles}` 或 `{ok:false, reason}`。**注意：撤销放置不实现（AC-3.2.2）所以 undo 不进 gate。**
  - 所有 3 类地形写操作都走 gate，不通过就 msg 拒绝。
- **前置**：Task 2 completed。
- **Test Requirements**：
  - TR-3.1 (rule): 用 BrowserUse 在一个"已知会封死"的场景（S(1,8) 上下左右 4 格 + 路径中间点共 5 格全部变墙）执行"保留选择写操作"，期望拒绝 + tiles hash 不变（console/eval 读）。
  - TR-3.2 (rule): 预置一条 24×16 的"石头走廊 + 2 个缺口"地图，A* 返回路径长度 = BFS 最短期望长度（误差 0）。
  - TR-3.3 (rubric): 代码中 grep 所有"会改 tiles"的赋值写操作全走 gate；不通过 gate 直接赋值出现 0 次 = 2 分；1 处=1 分；>1 = 0；pass >= 2。
- **输出**：BrowserUse eval 拒绝结果 + 路径长度 eval。

## Task 4 (v2): HUD / 阶段状态条 / 放置 N 次 / Roll 塔 / 保留选择 UI / 免费拆墙 / Buff 面板 / HP 条
- **父 AC**：AC-3.1, AC-3.2.1~4, AC-3.3, AC-3.7.1, AC-3.10.1
- **目标**：改造 `tower-defense.html` + `td-game.js` + `td.css`：
  - 阶段状态条：MENU / PREPARE（放置 X/N）/ FIGHTING / WAVE_END / WIN / LOSE。
  - 放置 N 次：点击空地/墙 Roll 塔 → 落在该格（带 Rarity 色 + 元素名）。剩余次数 = placementPerWave - used；HUD 大字显示。**不实现撤销按钮**（满足 AC-3.2.2，用户明确要求先定位置再 Roll，不可撤销）。
  - 放置满 N/N 后，UI 自动进入"保留选择模态盖层"：点击 N 座中的一座（其他 N-1 座灰+标注"变墙"），弹出确认。
  - 免费"拆墙"按钮（FIGHTING / PREPARE / WAVE_END 都能按，选中工具后点墙生效）。
  - **侧边栏 = Buff 激活清单 + 消息日志**；删除宝石背包/合成/装备面板（满足 AC-3.7.1，页面 DOM 不出现 gems-panel / btn-craft / btn-equip-gem）。
  - HP 条 + 金币 + 当前运气等级。
- **前置**：Task 3 completed。
- **Test Requirements**：
  - TR-4.1 (rule): BrowserUse：初始阶段=PREPARE；点击地图 N 个不同格子（N=waves[0].placementPerWave 缺省=5）后：剩余次数=0，且进入保留选择态（有 modal 文本"请点击 1 座保留"）。
  - TR-4.2 (rule): **无撤销**：页面 DOM 不存在任何 `id=btn-undo` 或文本含"撤销"的交互按钮（BrowserUse eval 验证）。
  - TR-4.3 (rule): **无宝石 UI**：页面 DOM 不存在 `#gems-panel`、`#gem-inventory`、`#btn-craft`、`#btn-equip-gem`。
  - TR-4.4 (rule): msg 区域出现 N 条 "[放置 X/N] Roll 塔=..." 日志（N=5，唯一实现源，验证 AC-3.2.1）。
  - TR-4.5 (rule): 保留选择后，1 座保留格 tile=5（真塔），其他 N-1 座 tile=4（墙）。eval tiles 验证。
  - TR-4.6 (rule): 拆墙按钮点一块玩家的墙后 tile 回到 0（草地）。石头走廊尝试拆墙被拒绝。
  - TR-4.7 (rubric): UI 布局不溢出（window=1366x768 下不出现横向滚动）=2；轻微溢出但能玩=1；严重溢出=0；pass>=2。
- **输出**：BrowserUse eval + 阶段状态截图。

## Task 5 (v2): 波末升级运气等级 UI + 金币抽 Buff UI（连续升级 + Roll）
- **父 AC**：AC-3.4.2, AC-3.5.1, AC-3.5.2
- **目标**：WAVE_END 面板新增两块：
  - (A) 升级运气：当前 L / 下一级 cost / 升级按钮（可连点，直到金币不够或满级），msg 打印。
  - (B) 抽 Buff：显示 Roll 价格 / 已激活 Buff 列表 / Roll 按钮；结果叠加显示。
  - **不实现合成面板/按钮**（v2 无宝石，取消合成）。
- **前置**：Task 4 completed。
- **Test Requirements**：
  - TR-5.1 (rule): 用 BrowserUse 注入 500 金（eval：`TDGame.getState().gold = 500; renderHUD();`），连点升级按钮 → 运气等级 1→2→3→4→5，msg 日志出现 4 次升级。
  - TR-5.2 (rule): Buff 抽取 2 次相同 id=atk_1，合并后 `state.buffsActive.towerDamageMulAll` 约等于 `1.15*1.15=1.3225`（误差 <= 1e-3）。
  - TR-5.3 (rule): 金币不足（设置为 0）时 Roll 按钮与升级按钮均 disabled。
- **输出**：eval 检查结果。

## Task 6 (v2): 敌人波次 / A* 移动 / 战斗 / 攻击公式 / Buff 乘数应用 / 金币结算
- **父 AC**：AC-3.5.2, AC-3.6, AC-3.7.1, AC-3.10.1
- **目标**：
  - 战斗循环：requestAnimationFrame 驱动，FIGHTING 阶段按 groups 生成敌人（WaveConfig.groups[i].delay+interval）。
  - 敌人按 4 向 A* 走；每次路径格遇到"新出现的墙/塔"（玩家在 FIGHTING 里拆墙）时，当前帧重新寻路。
  - 真塔攻击：按 adapt 后的 `rangeInCells/baseDamage/attackInterval/isAOE`，选择"距离终点最近"的优先目标。
  - 攻击公式：`finalDamage = baseDamage × rarityMul × elementBonus × buffsActive.towerDamageMulAll × (1 - enemyArmor) × max(0, 1 - resistances[towerElement])`；在 tower 首次攻击时 console 打印该公式一次。
  - 真塔死亡？不实现；基地 HP 按敌人 damageToBase 扣；敌人到达 E（基地格）则扣血+消失。
  - **金币结算**：敌人死亡时：
    - `killGold = enemy.killBaseGold × buffsActive.killGoldMulAll` 入账；
    - 若 Math.random < enemy.dropBonusRate + elementBonus（塔 killBonusGoldChanceAdd01），则调用 `rollBonusRarityByLuck(state.luckLevel)` 得 rarityKey，再按 `bonusGoldMap[rarity]` 发放额外金币，写 msg `[奖励] rare +15 金`。
  - **不再有宝石掉落/装备**（AC-3.7.1 自动通过）。
- **前置**：Task 5 completed。
- **Test Requirements**：
  - TR-6.1 (rule): 用 eval 注入 `buffsActive = {towerDamageMulAll:1.3225}` 再放一座真塔单攻无抗敌人 10 次；期望总伤害 = 无 buff 总伤害 × 1.3225 ± 0.5%。
  - TR-6.2 (rule): A* 路径在 FIGHTING 中把一堵"通路的墙"拆了后，敌人下一步的实际朝向由"旧路径"变成绕过（eval `enemies[0].path[0]` 前后不同）。
  - TR-6.3 (rule): 敌人到达 E 格后，基地 hp -= 敌人 damageToBase。
  - TR-6.4 (rule): 注入敌人 dropBonusRate = 1.0，luckyLevel=1，击杀 30 个小兵后，state.gold 的增量中至少有 1 条来自 bonusGoldMap（日志中出现 `[奖励]` 且实际金币增加量超过 killBaseGold × 数量）。
- **输出**：eval 伤害比、路径朝向切换、HP 变化、奖励日志。

## Task 7 (v2): WIN/LOSE 面板 + 重启 + End2End 测试脚本 + 性能 rubric
- **父 AC**：AC-3.10.1, AC-PERF, AC-OBS, AC-COVER
- **目标**：
  - LOSE/WIN 面板：覆盖 Canvas，显示本局统计 + 重开按钮，重开后重置一切（luck=1 / 金币 初始 300 / tiles 重建 / 状态机 = PREPARE）。
  - 提供 `scripts/td-end2end.ps1`：调用 BrowserUse 无头跑通"5 次放置→保留→开波→Wave1 敌人走完→波末升级运气→抽取 Buff→重开"循环，记录日志，退出码 0 当且仅当全部成功。
- **前置**：Task 6 completed。
- **Test Requirements**：
  - TR-7.1 (rule): `td-end2end.ps1` exit 0，日志里包含 `LOSE` 或 `WIN`（取决于 8 波是否通关）；重开后 state.luckLevel = 1，state.tiles hash = 初始 hash。
  - TR-7.2 (rubric): AC-PERF 60fps Performance 面板截图。
  - TR-7.3 (rubric): AC-OBS 五类日志（roll/luck/buff/拒绝封死/胜负）都出现在 console。
- **输出**：脚本退出码、截图、console 抓屏。

---

## 依赖图（DAG）
```
Task1 ──┐
        ▼
Task2 ──┐
        ▼
Task3 ──┐
        ▼
Task4 ──┐
        ▼
Task5 ──┐
        ▼
Task6 ──┐
        ▼
Task7
```
