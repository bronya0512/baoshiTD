# 宝石TD V4 实现任务清单
> 对应 spec：`.trae/specs/tower-defense-v4/spec.md`（FR-1.1 ~ FR-7.4, AC-1 ~ AC-20, R-1 ~ R-5）
> 依赖顺序：V4-1 → (V4-2 + 后端 save/lb schema 升级并行) → V4-3 → V4-4 → V4-5 → V4-6 → V4-7(talent + lb + spine + mobile)
> 注：每条任务包含「Depends On」「AC 映射」「Test Requirements (rule/rubric)」「完成证据」

---

## 【Phase 1: 基础基建与入口】

### Task 1: 难度 / 地图 chip 与选择器 UI（FR-1.1, AC-1, AC-2）
- **Status**: pending
- **Priority**: high
- **Depends On**: 无（V4-1 入口，只改 MENU UI 与 state 字段；save 表 schema 升级为并行 Task 3）
- **Description**:
  1. `web/tower-defense.html`：HUD 行（account-chip 同一行最左）加两个 chip：`#difficulty-chip` / `#map-chip`。
  2. MENU 阶段的 control-panel 区域（btn-start 上方）新增两个横向 choice bar：
     - `#difficulty-choices`：3 个 Tab `.diff-tab.normal.active / .hard / .nightmare`
     - `#map-choices`：3 个 Tab `.map-tab.grass.active / .lava.disabled / .ice.disabled`（lava/ice 在 V4-2 前 disabled 灰显 V4-2 解锁）
  3. `td-game.js`：state 新增 `difficulty: 'normal'|'hard'|'nightmare'`、`mapId: 1`、`difficultyMul: {hp:1, speed:1, gold:1, baseHP:20}`。
  4. Tab 点击时 `state.difficulty/mapId` 立即更新，chip 文本同步（困难 tab 点 → chip 变「困难 1.8×HP 1.15×速 1.3×金 15HP」）。
- **ACs Addressed**: AC-1, AC-2（桶分离 Task 3 完成后再整体回归测）
- **Test Requirements**:
  - `rule` TR-1.1：点击「困难」tab → evaluate `state.difficulty === 'hard' && state.difficultyMul.hp === 1.8 && state.difficultyMul.baseMaxHP === 15`。
  - `rule` TR-1.2：初始状态，`#map-choices .map-tab.lava.disabled` 存在。
  - `rule` TR-1.3：点「噩梦」tab → chip 显示包含「噩梦 3.0」。
- **Evidence**: evaluate 返回 `{d, m, chipD, chipM, lavaDisabled}` 4 项全部通过。

### Task 2: 难度倍率在开局/升级/敌人出怪三处生效（FR-1.2, AC-1）
- **Status**: pending
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  1. `prepareNextWave()` 末尾：
     - `state.baseMaxHP = state.difficultyMul.baseMaxHP; state.baseHP = state.baseMaxHP;`
     - 波末奖励 `rewardGold = Math.round(rewardGold * state.difficultyMul.gold)`；`killEnemy` 掉落 `bonusGoldMap[rarity]` 同样乘 `difficultyMul.gold`。
  2. 敌人 spawn 时：`enemy.cfg` 派生副本 `{...cfg, hp: cfg.hp * diffMul.hp, speed: cfg.speed * diffMul.speed}`（直接写 `enemy.hp *= ..., enemy.maxHP *= ..., enemy.speed *= ...`，避免改 cfg 引用）。
  3. 锁难度：一旦 `state.waveIndex >= 1`（PREPARE 之后），Tab 点击只改显示但 `difficultyMul` 不再重算（锁定生效，写 msg「本难度已锁定，想换难度请点重开」）。
- **ACs Addressed**: AC-1
- **Test Requirements**:
  - `rule` TR-2.1：开局点困难 → spawnQueue 第一只 enemy 生成后 `enemy.maxHP == normalEnemy.baseHP * 1.8 (±2%)`。
  - `rule` TR-2.2：准备阶段点了困难 → 波末奖励 gold ≥ 普通波奖励 gold × 1.3。
  - `rule` TR-2.3：准备阶段（waveIndex===1）再次点「噩梦」tab → 返回 msg 含「锁定」文本，`state.difficultyMul.hp` 仍= 1.8 未变 3.0。
- **Evidence**: evaluate 返回 `{enemyMaxHPvsBaseline1_8, rewardRatio, afterLockStill1_8}` 3 项 pass。

### Task 3: save_records 表升级 uid → (uid, map_id, difficulty) 复合 PK + users 新列（FR-1.3, FR-2.3, FR-7.1, FR-7.2）
- **Status**: pending
- **Priority**: high
- **Depends On**: 无（并行可做；但依赖 Task 1 定义好 mapId/difficulty 字段名）
- **Description**:
  1. `internal/db/mysql.go` ensureSchema：把 save_records 改 schema：
     - 新增列 `map_id INT NOT NULL DEFAULT 1, difficulty VARCHAR(16) NOT NULL DEFAULT 'normal'`。
     - 旧 PK uid → DROP，新 PK `PRIMARY KEY (uid, map_id, difficulty)`，新 FK 保留。
     - 用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS / DROP PRIMARY KEY / ADD PRIMARY KEY` 分步执行（兼容已有表）。
  2. users 表加 3 列：
     - `unlocked_maps JSON NULL DEFAULT NULL`（V4-2 解锁）
     - `talent_nodes JSON NULL DEFAULT NULL`（V4-7 天赋）
     - `talent_points_available INT NOT NULL DEFAULT 0`（V4-7）
  3. `model.GameSaveRecord` 结构升级：加 MapId, Difficulty 两字段；对应 JSON tag & store_db.go scan/value 映射。
  4. store 的 SaveSave / SaveLoad 改成按 (uid, mapId, difficulty) 读写：V3-6 老存档无这两列时，读出来补默认 1/normal。
- **ACs Addressed**: AC-2, AC-16（天赋）, AC-20（兼容）
- **Test Requirements**:
  - `rule` TR-3.1：写入两份存档 save(uid=1,map=1,diff=normal) 与 save(uid=1,map=1,diff=hard) 分别 gold=100/200 → 然后 load(hard) 返回 gold=200。
  - `rule` TR-3.2：users 表 ALTER 后能 INSERT 含 talent_nodes JSON 数组的行。
  - `rule` TR-3.3：老存档（无 mapId/difficulty，只 uid PK 的 records 迁移后）读出来 mapId=1 difficulty=normal。
- **Evidence**: SQL + Go unit test 分别返回 3 项结果；或浏览器 evaluate 通过「存两档→读档」模拟。

---

## 【Phase 2: 多地图与环境】

### Task 4: 后端 config 扩展 + fallback.js 填 3 张地图（FR-2.1, FR-2.2, AC-3, AC-4, AC-20）
- **Status**: pending
- **Priority**: high
- **Depends On**: Task 3（schema 不需要但 mapId 契约一致；fallback 不依赖后端可并行，但通常先加 config 层）
- **Description**:
  1. `web/js/td-config-fallback.js`：新增 mapId=2（熔岩）mapId=3（冰霜）两张地图的 `getMapsDetail(mapId)`、`getWaves(mapId)`：
     - 熔岩：路径多 2 个直角弯、tiles 若干 T_LAVA=7 分布在路径旁；waves 中 3/6/8 Boss + 精英更多。
     - 冰霜：路径分叉（先分两支，合流在中间）、环境 enemyMul.attackSpeed=0.85、towerMul.towerAttackIntervalMulAll=0.95（更快）。
     - 每张 cfg.mapDetail 新增 `environment`：`{id: 'grass'|'lava'|'ice', name, towerMul, enemyMul, onTickHook}`。
  2. `web/js/td-config-loader.js` adapt 阶段：`cfg.mapDetail.environment = cfg.mapDetail.environment || defaultGrassEnv;`。
  3. `internal/handler/config.go`：`ConfigGetMapDetail` / `ConfigGetWaves` 按 `:id` 返回 mapId=2/3。
- **ACs Addressed**: AC-3, AC-4, AC-20（fallback 没 environment 时默认 grass 兼容旧）
- **Test Requirements**:
  - `rule` TR-4.1：冰霜地图 1 座 ice 非元素 common 塔 → interval ≤ 草原同塔 interval × 0.952。
  - `rule` TR-4.2：熔岩地图，敌人在 lava tile 上 1s tick 后 hp 减少 = base -10（至少 -8 容差）。
  - `rule` TR-4.3：草原地图（缺 environment 字段的旧 cfg）开局不抛错。
- **Evidence**: evaluate 返回 `{iceSpeedR_ok, lavaDmg_ok, noEnvCompatible_ok}`。

### Task 5: 环境 Buff 生效点（calcTowerEffective/stepEnemy/onTick 三处）+ 地图解锁（FR-2.2, FR-2.3, AC-3, AC-4, AC-5）
- **Status**: pending
- **Priority**: high
- **Depends On**: Task 1 (state.mapId) + Task 4 (cfg.environment)
- **Description**:
  1. `calcTowerEffective()` 最后：把 `cfg.environment.towerMul` 乘到 eff（在 activeBuffs 之后）。
  2. `stepEnemy`：先乘 `cfg.environment.enemyMul.speed / attackSpeed`；熔岩 onTick 每 0.5s 扣血。
  3. 地图解锁：`state.waveIndex` 达到 4 + WIN / LOSE trigger 时 → `POST /api/users/:id/unlock-map` 或更简单：save 时同时 upsert users.unlocked_maps = JSON 合并；下次 reload 从 users 新列读 → `state.unlocked = {lava:true}`。
  4. `#map-choices .map-tab.lava` disabled 解除逻辑：`state.unlocked?.lava === true`。
- **ACs Addressed**: AC-3, AC-4, AC-5
- **Test Requirements**:
  - `rule` TR-5.1：草原通关到 wave=4 → 刷用户 unlocked_maps → 下一次 MENU 时 lava tab 不再 disabled。
  - `rule` TR-5.2：冰霜环境下 enemy.attackSpeed ≤ baseline × 0.85。
- **Evidence**: evaluate 返回 unlock 状态 + enemy attackSpeed。

---

## 【Phase 3: 塔合成】

### Task 6: 三按钮（升级A/合成B/进化C）· 无距离限制 · 最后素材格落点 + C 类准备阶段高光 + 配方提示条（FR-3.1~FR-3.5, AC-6A/6B/6C/6D/7）
- **Status**: pending
- **Priority**: medium
- **Depends On**: Task 4（cfg 契约）+ V4-5 Task 9（等级系统字段 level/branch）
- **Description**:
  1. **cfg 扩展**：`config-fallback.js` towersById 里新增 5 座 `special:true` 塔（FUSION_EPIC / DESTROYER_EPIC / AURORA_EPIC / GEMLORD_LEG / RAIGATEKI_LEG），字段 `rarity` 固定为配方表里的 epic / legendary；在 `cfg.towersById[id].special = true`。
  2. **C 类配方注册表 MERGE_RECIPES**：5 条（C-FUSION / C-DESTROYER / C-AURORA / C-GEMLORD / C-RAIGATEKI），每条含 `{recipeId, requires:[{towerCfgId?, rarity?, elementPredicate?, count?:anyOf}], output:'xxx', outputRarity:'epic|legendary', tabEmoji:'🔥⚡❄', tabLabel:'融合塔', desc:'...'}`；支持「任意 3 epic 其中至少 1 元素」用 predicate。
  3. **HUD 三按钮**：
     - 按钮 1：`#btn-upgrade`「⬆ 升级」（A 专属）；按钮 2：`#btn-merge`「🧪 合成」（B 专属）；按钮 3：`#btn-evolve`「💠 进化」（C 专属）。CSS：并排 inline-flex；disabled 灰。
     - disabled 规则：塔数量<2 时升级 disabled；塔数量<3 时合成/进化 disabled。
     - 三模式互斥：点按钮 A → `state.upgradeMode=true` 且 `mergeMode=evolveMode=false`，清空其他两类 selection。
  4. **state 字段**：
     - `upgradeSelection: [{gridIdx}]`（A，最多 2）、`mergeSelection: [{gridIdx}]`（B，最多 3）、`evolveSelection: [{gridIdx}]`（C，最多 3）。
     - `lastMergePlacedGridIdx: null`（用于 log 与闪光中心）。
  5. **onCanvasClick 扩展**：进入对应模式时点击真塔 T_TOWER → 按模式区分 special 塔准入：
     - 升级模式（A）/ 合成模式（B）：若 `grid[idx].special===true` → msg「特殊塔不可用于升级/合成，请另选普通塔或选择进化模式」并**拒绝**入列；普通塔允许 push（再次点击同塔则 pop）。
     - 进化模式（C）：special 真塔**允许**加入 evolveSelection（用于链式进化配方，如 FUSION_EPIC→GEMLORD_LEG）；再次点击同塔则 pop。
     - 已选塔 Canvas 高亮外框 + 角标「①②③」。
  6. **A 类升级流程**（selection 满 2 自动触发）：
     - 校验：cfgId 相同 && rarity 相同 && rarity≤epic && 2 座均 !special。
     - 不通过：canvas 顶部 chip 红字。
     - 通过：弹「升级预览 modal」——左 2 张源塔卡片；右预览（同类型稀有度+1 + max×1.25 数值 + 等级/策略继承说明）。
     - 取消：`upgradeSelection=[]`、关 modal、升级模式保持、源塔不动。
     - 确认：undo 快照 → 删 2 源塔 → 在 `upgradeSelection[1].gridIdx`（②最后点击格）落地新塔 → terrainGate；失败回滚 msg「路径封死」。成功：金色闪光（center=落位格）+ chip「升级成功 ARCHER common→rare」+ 清空 selection + 退出升级模式。
  7. **B 类合成流程**（满 3 触发）：
     - 校验：3 cfgId 互不相同 && rarity 相同 && rarity≤epic && 3 座均 !special。
     - 不通过：chip 红字（含「特殊塔仅能用于进化模式」若 case 匹配）。
     - 通过：弹「合成确认 modal」——**不显示产物 cfgId / 具体数值**，仅大字「产物稀有度：★★ rare（升一级）」+ 说明「随机普通塔、不含特殊塔」。
     - 取消：清空 mergeSelection、合成模式保持。
     - 确认：删 3 → 在 `mergeSelection[2].gridIdx`（③格）落地稀有度+1 随机普通塔（skipSpecial=true）→ terrainGate；成功 chip「合成成功 common→rare · 随机获得 XXX 塔」+ 闪光。天赋控制线点 5：B 类 10% 概率再跳一级（若已到 legendary 无法再跳，damage ×1.2 补偿）。
  8. **C 类进化流程 + 准备阶段高光 + 配方提示条**：
     - `detectEvolvable()`：进入 PREPARE phase 时调用；遍历 5 条 MERGE_RECIPES，扫描候选时**同时考虑普通塔和 special 塔**（因为 FUSION_EPIC 等特殊塔是允许的 epic 材料），若场上存在满足 requires 的真塔 → 返回可进化配方 id 数组；非空时给 `#btn-evolve` 加 CSS 类 `high-glow`（脉冲高光）。
     - 点「💠 进化」后画布顶部固定配方提示条 `<div id="evolve-recipe-bar">`：
       - 5 个 Tab 按钮（每条 1 个，emoji+tabLabel）。
       - 激活 Tab 显示 3 材料行：`材料名 + ✅/❌`；候选>1 时附「可用×N」；特殊塔满足条件时额外显示 emoji 提示（例：PYRO=✅ 可用×1 「其中 1 座为 元素融合塔 FUSION_EPIC」角标）。
     - evolveSelection 满 3：遍历 MERGE_RECIPES 找命中（多条命中选稀有度条件更高者）。
       - 未命中：chip 红字「不满足任何进化配方，请查看顶部提示」。
       - 命中：弹「进化预览 modal」——顶 recipeId label + 产物特殊塔卡片（special:true + 固定稀有度 + 特殊增益文案）+ 3 源卡（特殊源卡带金色边框标识）。
     - 取消：清空 evolveSelection、进化模式保持、提示条仍显示。
     - 确认：删 3 → 在 evolveSelection[2].gridIdx 落配方 output 塔（special:true）→ terrainGate；成功金色 chip「★ 进化成功：解锁【元素融合塔】」+ 闪光 + 重新 detectEvolvable() 刷新高光。
  9. **普通池隔离**：`rollTowerByLuckLevel(cfg, opts)` 新增 `opts.skipSpecial=true`（默认）；placeCandidate / 商店购买塔都传 true；B 类随机池也 skipSpecial。A/B 选择时 special 塔被拒绝入列、**C 选择允许 special 塔但仅能作为 C 的源**。产出端严格保证：只有 C 类确认执行会产出 `special:true` 塔。
  10. **闪光成功特效**：`drawFlash(targetGrid, 8, goldGradient)`，target = 落位格（= 最后点击素材格）。
  11. **log 标签**：`[MERGE-A]` / `[MERGE-B]` / `[MERGE-C]` 独立；C 类进化链式时多写一行「源塔包含 special: [cfgId 列表]」。
- **ACs Addressed**: AC-6A, AC-6B, AC-6C, AC-6D, AC-7
- **Test Requirements**:
  - `rule` TR-6A1（A 取消=重置）：点升级→选 2 座符合条件→点 modal 取消→`upgradeSelection.length===0` 且 2 源塔仍在原 grid。
  - `rule` TR-6A2（A 数值+落位+路径+拒绝special）：升级确认→落地 gridIdx===upgradeSelection[1].gridIdx；`cfgId==='ARCHER' && rarity==='rare'`；damage≥max*1.24（1.25±0.01）；另一源格 tile===T_EMPTY；`a*(start, base).pathExists===true`。另：场上已有 FUSION_EPIC（special:true）→ 升级模式点击它 → 不被加入 upgradeSelection，selection.length 保持不变且有 msg 提示。
  - `rule` TR-6B1（B modal 不泄漏产物）：打开合成确认 modal → modal.innerHTML 不含任意一条特殊塔 cfgId 字符串、不含普通产物 cfgId、不含产物数值。仅含「产物稀有度」或等价中文文案。
  - `rule` TR-6B2（B 落位+随机普通池+拒绝special）：合成确认→落地 gridIdx===mergeSelection[2].gridIdx；`rarity==='rare' && towerCfgById[id].special===false`；另两源格 T_EMPTY；a* 路径仍通。另：合成模式下点击 FUSION_EPIC（special:true）→ 不加入 mergeSelection 且 msg「特殊塔仅能用于进化模式」。
  - `rule` TR-6C1（准备阶段高光·含特殊塔作材料）：PREPARE 阶段、场上有 PYRO common + CRYO_EPIC(special) + ELECTRO common（注：配方 C-GEMLORD =「3 epic + 至少 1 元素」）→ 把 2 座升为 epic + 特殊塔 FUSION_EPIC(epic+元素) 作为候选 → `detectEvolvable()` 返回包含 `'C-GEMLORD'`；`#btn-evolve.classList.contains('high-glow')===true`。
  - `rule` TR-6C2（配方提示条可见 + 三材料勾选 + 特殊塔角标）：点进化→`#evolve-recipe-bar.offsetParent !== null`（可见）；激活 C-FUSION tab → 3 材料节点 PYRO/CRYO/ELECTRO 都显示「✅」或「可用 ×N」；若某材料是特殊塔候选（例如 FUSION_EPIC 代替 PYRO）→ 该节点显示 special 角标文字/样式。
  - `rule` TR-6C3（进化落位+产出 special + 特殊塔可作C材料）：选 2 座 epic 普通塔 + FUSION_EPIC(special:epic:元素) 3 座 → 命中 C-GEMLORD → 进化确认 → 落地 gridIdx===evolveSelection[2].gridIdx；产出 `cfgId==='GEMLORD_LEG' && rarity==='legendary' && towerCfgById[id].special===true`；验证 3 源塔中 1 座 special=true 的确实被计入 selection（length===3）。
  - `rule` TR-6D（隔离 300 次抽样·仅产出端过滤）：Roll 塔 100 次 + 商店购塔 100 次 + B 类随机池 100 次 → 300 条结果 cfgId 的 `towerCfgById[id].special` 全 false。
  - `rule` TR-6E（模式互斥+塔数禁用）：塔数 1 → 三按钮 disabled；塔数 2 → 合成/进化 disabled；点升级→点合成→`upgradeMode===false && upgradeSelection.length===0`。
- **Evidence**: evaluate 返回落位 gridIdx / rarity / cfgId / special + DOM 类名（high-glow / recipe-bar offsetParent / 特殊塔角标节点）+ selection 长度 + a* pathExists + 300 次抽样 special 布尔数组 + B modal innerHTML 截取片段 + C detectEvolvable 返回的配方 id 列表。

---

## 【Phase 4: 新精英 + BOSS 技能】

### Task 7: 5 种新精英 enemy 契约 + stepEnemy 扩展（FR-4.1, AC-8, AC-9）
- **Status**: completed
- **Priority**: high
- **Depends On**: Task 2（diff 倍率）+ Task 4（map waves 扩展）
- **Description**:
  1. `config-fallback.js` enemiesById 加 SHIELD(id=7)/HEALER(id=8)/SUMMONER(id=9)/FAST(id=10) / BOSS·熔岩暴君(id=11, splitInto FAST×2) 共 5+1 条（还有原 BOSS id=5/6），contract 含 `shield / healPerSec / summonEveryN / splitInto`。
  2. `internal/model/config.go EnemyConfig` 扩展：`Shield, HealPerSec, HealRadiusCells, SummonEveryNSec, SummonSpawnID, SummonCountPer, SplitInto, Skills, EnemySkill, EnemySplitConfig`。
  3. `damageEnemy` 入口护盾逻辑：`if enemy.shield>0 → absorb = min(enemy.shield, dmg); enemy.shield-=absorb; dealtToHp = dmg-absorb`。
  4. `stepEnemy` 新增 healPerSec：每 dt 搜 ±healRadiusCells 格盟友（同阵营）→ ally.hp = min(maxHP, ally.hp + healPerSec*dt)。
  5. `stepEnemy` 新增 summonEveryN：每 N 秒 → spawnEnemy(summonSpawnId) × SummonCountPer（立即 spawn，不走 spawnQueue），生成位置在召唤者 ±N 格。
  6. `killEnemy` 新增 splitInto：SPLITTER 死亡 → for(i→count) spawnEnemy(splitInto.enemyId)，坐标在死亡点附近 ±1 tile。
  7. **CONFIG-FIX**：`web/js/td-config-loader.js` adapt 阶段按 id 合并 fallback 缺失的敌人（后端 JSON 只有 1-6），**绝不修改任何磁盘 JSON 配置**。
- **ACs Addressed**: AC-8, AC-9
- **Test Requirements**:
  - `rule` TR-7.1：spawn SHIELD(shield=30, hp=200) → 40 伤后 shield=0 hp=190；再加 100 伤 → hp=90 ✅（浏览器 evaluate 返回 hp=90,shield=0）。
  - `rule` TR-7.2：HEALER healPerSec=12 radiusCells=2，1 秒内与受伤小兵（hp=50→62）位置重叠时 ✅（期望=62）。
  - 附加验证：SUMMONER every=6s spawnId=10 ×2；SPLIT(Boss11) enemyId=10 ×2；FAST speed=130；全部契约存在 & 目标 cfg 存在 ✅（enemiesById[id].targetExists=Y）。
  - 契约总数：`cfg.enemies.length=12`、id∈1..12 全在 ✅。
- **Evidence**: 浏览器 evaluate：count=12|e7=盾盒兵:shield=30|e8=治疗师:heal=12:r=2|e9=召唤师:every=6:id=10:x2|e10=极速者:speed=130|e11=BOSS·熔岩暴君:split={"enemyId":10,"count":2}|SHIELD_hp=90_shield=0(期望hp=90,shield=0)|HEAL_expected=62(期望=62)

### Task 8: BOSS meteor + ice 技能（FR-4.2, AC-10, AC-11）
- **Status**: completed
- **Priority**: high
- **Depends On**: Task 7（enemy 扩展）+ Task 4（waves 升级定义 Boss 触发）
- **Description**:
  1. 定义 Skill 契约：`internal/model/config.go EnemySkill = {id, firstAtSec, everySec, warningSec, durationSec, warningColor, extra}`；
     - BOSS·熔岩暴君(id=11)：`skills=[{id:'meteor', firstAtSec:10, everySec:15, warningSec:1.5, warningColor:'#ef4444', extra:{radiusCells:1.5, trueDamage:200, towerStunSec:1}}]`
     - BOSS·冰霜女王(id=12)：`skills=[{id:'ice',    firstAtSec:8,  everySec:18, warningSec:1.0, warningColor:'#3b82f6', extra:{freezeSec:2, slowMul:0.5, slowRemnantSec:4}}]`
  2. `castSkillsIfDue(dt)`：按 `casterE.skillStates[skill.id] = {elapsed, castAt, warningLeft, firing}` 独立推进，到 firstAt / every 周期触发预警 → firing 时 `_executeSkillCast` 命中。
  3. meteor 命中：`_applyMeteorImpact(fx)`
     - (1) 范围内敌人 `e.hp -= trueDamage`（**绕过 shield / armor / resistances**，真伤直接扣 HP）
     - (2) 范围内塔 `grid[idx].stunUntil = state.waveElapsed + towerStunSec`；`stepTowers` 内 `if nowWe < stunUntil continue;` 跳过攻击。
     - Canvas 画预警圆（闪烁 fill）+ 命中撞击闪光圆。
  4. ice freezer：`_executeSkillCast(ice)`
     - `state.iceUntil = waveElapsed + freezeSec`；`state.slowRemnantUntil = waveElapsed + freezeSec + slowRemnantSec`；`state.iceSlowMul = slowMul`
     - `battleTick` 冻结阶段 `if waveElapsed < iceUntil → dt = 0`（所有敌人 stepEnemy 推进 0，战斗动作"暂停"，仅 waveElapsed 继续增加）
     - 冻结后 (iceUntil, slowRemnantUntil] 区间 `effSpeed *= state.iceSlowMul`（例如 ×0.5）；waveElapsed ≥ slowRemnantUntil 清除状态。
     - Canvas 画蓝色冰冻蒙层 + 预警蓝层。
  5. `drawSkillFx()`：统一 meteorWarning / meteorImpact / iceWarning / freeze / slowRemnant 视觉，支持 DPR 缩放；无 Spine 依赖。
- **ACs Addressed**: AC-10, AC-11
- **Test Requirements**:
  - `rule` TR-8.1 METEOR：塔在命中格 → `grid[idx].stunUntil === 1`（waveElapsed=0 + stunSec=1）✅；对 enemy=50-shield/500-hp 应用真伤 200 → `afterHp=300 && shield=50`（shield 不变、证明绕过 shield 路径）✅。
  - `rule` TR-8.2 ICE：触发后 waveElapsed 推进 1s（冻结阶段 `dt=0`）→ 敌人位移 < 0.5px ✅（浏览器验证 `frozenEnemyNotMoved=true`）；冻结字段 `iceUntil=2, slowRemnantUntil=6, slowMul=0.5` ✅。
  - 附加验证：enemiesById[11].skills[0].id === 'meteor'；enemiesById[12].skills[0].id === 'ice'；extra.freezeSec=2 ✅。
- **Evidence**:
  - 浏览器 ICE：`{iceUntil:2, slowRem:6, slowMul:0.5, waveElapsed:0.05, enemyAfterFreeze1s:{px:100,py:100}, frozenEnemyNotMoved:true}`
  - 浏览器 METEOR：`{towerStunUntil:1, expectedStun:1, trueDamageTest:{afterHp:300, shieldUnchanged:true, expectedHp:300}, towerExists:true}`

---

## 【Phase 5: 塔升级 + L3 随机特殊效果】

### Task 9: 等级 / rollEffect 字段 + 数值契约（FR-5.1, FR-5.2, AC-12, AC-20）
- **Status**: pending
- **Priority**: high
- **Depends On**: 基础 grid 与塔 grid 已经存在
- **Description**:
  1. 所有 T_TOWER / T_CAND grid 对象新增字段：`level:0`、`rollEffect:null`（placeCandidate / reserveOne / applySaveRecord 三处初始化）。
  2. 定义常量 `LEVEL_UP_COST_L = [40, 80, 120]`（L0→1:40、L1→2:80、L2→3:120）。
  3. `calcTowerEffective()` 重写 level 与 rollEffect 数值：
     - level 1~3 累计线性：每级 damage×1.3、interval÷1.1（攻速 +10%）、rangeCells×1.05。
     - L3 rollEffect 叠加（按 effectId 分支）：
       - `effect_offense`: damage ×1.4，rangeCells ×1.15。
       - `effect_control`: 减速型塔 slowAmt += 25% 绝对值（原 slow 20% → 45%）；AOE 型塔 aoeRadius ×1.3；兜底攻速 ×1.2（interval÷1.2）。
       - `effect_double_shot`: 数值上不直接改 eff，在战斗层 fireTowerBullet 额外再选一个敌人攻击（见 Task 11）。
       - `effect_crit`: 攻击 15% 概率 damage ×2.5（战斗层 roll 判定，Canvas 红折线飞出）。
       - `effect_ricochet`: 命中后最多 2 跳 60% → 42% 伤害（战斗层链式判定，见 Task 11）。
  4. 存档兼容：v3 存档缺 level/rollEffect → 默认 0/null；V4-3 合成的继承逻辑里把 level/rollEffect 视为独立字段（合成 A/B/C 时：**等级继承 3/2 源塔最高 level；rollEffect 清空为 null（新塔需重新升级到 L3 再 Roll）**）。
- **ACs Addressed**: AC-12, AC-20
- **Test Requirements**:
  - `rule` TR-9.1：L0 dmg=100 → L1=130（±2%）；L2=169（±2%）；L3=219.7（169×1.3）。若手动把塔 rollEffect 设为 `'effect_offense'` → damage ≥ 219.7×1.4 = 307.6（±2%）。
  - `rule` TR-9.2：老 v3 存档读档 → grid 塔 level===0 && rollEffect===null。
  - `rule` TR-9.3：手动把塔 rollEffect 设为 `'effect_crit'` → 循环 20 次 `fireTowerBullet mock` → 至少 1 次 damage 达到 2.5×eff.damage × 0.98 以上（即 ≥ 有效 2.5 倍）。
- **Evidence**: evaluate 返回各层 damage；crit 20 次的 damage 数组；存档字段。

### Task 10: 升级按钮 UI + L3 随机 Roll 动画展示（FR-5.3, AC-12）
- **Status**: pending
- **Priority**: medium
- **Depends On**: Task 9
- **Description**:
  1. openTowerInfoModal 弹框底部新增「升级」按钮：`text='升至 L${level+1}（${cost} 金）'`，金币不够时灰 + 红字「金币不足」。
  2. 普通升级（L0→1 / L1→2）：扣 gold → level+1 → draw + refreshHUD + 关闭弹框重新弹 info（刷新显示新等级数值）。
  3. **L2→L3 特殊流程**：点按钮 → 扣 120 金 → level 升为 3 → 打开 `L3 Roll 动画 modal`：
     - 弹框中心 5 个效果大图标（⚔/❄/⚡/💥/🪢）快速切换（每 100ms 换一个，共 1.2s）。
     - 定格在实际 roll 结果 `effectId`（Math.random 5 选 1，等概率）。
     - 下方显示效果卡：图标 + 名字 + 具体数值说明 + 「确定」按钮。
     - 点确定 → `tower.rollEffect = effectId` 写入 grid、刷新塔卡右上角图标角标、关闭动画 modal、回到塔 info 弹框显示「已获得特殊效果」区块。
  4. L3 塔的「升级」按钮改文字「已满级」disabled。
  5. 塔 info 弹框 L3 显示：**「🎲 特殊效果」** 行 = 图标 + effect 名 + 数值文案。
  6. 拆塔确认 modal：若 L3 且 rollEffect!==null → 顶部黄色 chip「⚠ 此塔含特殊效果：XXX」提醒。
- **Test Requirements**:
  - `rule` TR-10.1：L2 塔 gold=120 → 点「升至 L3」→ gold=0 且 modal 出现（innerHTML 含 5 效果图标的 roll 容器节点）。1.5s 后 rollEffect !== null && level===3。
  - `rule` TR-10.2：L3 塔 → 升级按钮 disabled 且文字包含「已满级」。
  - `rule` TR-10.3：L3 塔拆塔 → 拆确认 modal 含「特殊效果」提示 chip。
- **Evidence**: evaluate gold、level、rollEffect、按钮 disabled、modal innerHTML 片段。

### Task 11: 战斗层双重打击 + 弹射链击 两效果实现（FR-5.2, AC-13, AC-13B）
- **Status**: pending
- **Priority**: high
- **Depends On**: Task 9 + Task 10
- **Description**:
  1. **effect_double_shot（双重打击）**：在 `fireTowerBullet` / `stepTowers` 的主目标攻击完成（主 bullet 命中/结算 damageEnemy）之后，若 `tower.rollEffect==='effect_double_shot'`，立即执行：
     - 候选敌人池 = `state.enemies` 中 alive===true、距离塔 grid 在 `eff.rangeCells` 内、且 **enemyId !== 主目标 enemyId** 的集合。
     - 若集合非空，选集合中与主目标不同、HP 最高的一个，调用 `damageEnemy(secondary, eff.damage × 0.8, tower, true)`（独立命中/元素/crit 判定）。
     - 视觉：Canvas 画一条从塔到 secondary 目标的较短绿色辅助子弹线。
  2. **effect_ricochet（弹射链击）**：主攻击命中后，若 `tower.rollEffect==='effect_ricochet'`，执行链式：
     - 当前敌人 = 主目标；当前伤害系数 = 0.6；剩余跳数 = 2。
     - while 剩余跳数>0：搜「±2 格范围内、与 currEnemy 不同、alive===true、且本次链尚未命中过」的最近敌人 nextEnemy；若无 break。
     - damageEnemy(nextEnemy, eff.damage × currMul × 0.7^(2-剩余跳数-1) 等价为 0.6、0.42)。
     - 标记已命中，currEnemy = nextEnemy，currMul ×= 0.7，剩余跳数 - 1。
     - 视觉：每次弹射画一段弯曲黄色虚线。
  3. **crit 视觉**：`if rollEffect==='effect_crit' && critRoll 命中` → 在命中 enemy 位置画红色折线 +1 帧飘出。
  4. Log tag：`[LEVEL-EFFECT]` 标注每次触发双重打击 / 弹射链击（便于调试时统计）。
- **ACs Addressed**: AC-13, AC-13B
- **Test Requirements**:
  - `rule` TR-11.1（双重打击）：effect_double_shot 的 L3 塔，范围内同时放 enemyA(主)、enemyB(另敌) → 触发 1 次 attack → 统计 damageEnemy 调用 2 次；第 2 次目标 enemy===enemyB；第 2 次 dmg === 第 1 次 dmg × 0.8（±5%）。
  - `rule` TR-11.2（弹射链击）：effect_ricochet 的 L3 塔，3 敌连成 ±2 格相邻 → 触发 1 次 attack → 统计 damageEnemy 调用 3 次；第 3 次伤害 ≥ eff.damage × 0.42 × 0.95。
- **Evidence**: evaluate 记录 damageEnemy 调用数组（targetId/dmg/t），Canvas 绘制元素标记。

---

## 【Phase 6: 波次商店】

### Task 12: WAVEEND modal 升级为 Tab 4 类商品（抽 Buff / 升运气 / 购买塔 / 预览）（FR-6.1, FR-6.2, AC-14, AC-15）
- **Status**: pending
- **Priority**: high
- **Depends On**: Phase 1/2 完成后（不直接依赖但 state.gold / difficulty 已经生效）
- **Description**:
  1. `showWaveendModal()`：HTML 重写为 4 个 Tab header + 4 个 body panels（抽 Buff / 升运气 / 购买塔 / 预览）+ 底部「开始下一波」大按钮。
  2. 抽 Buff Tab：单张卡片按钮 + 价格 40 + 剩余 5/x 次。点击 `rollBuffByLuckLevel()` → activeBuffs 合并（同 type 替换），gold 扣 40，剩余次减 1。
  3. 升运气 Tab：按钮显示「升至 Lv.${luckLevel+1}（${(luckLevel+1)*80} 金）」。gold 够 → luckLevel++，否则灰。
  4. 购买塔 Tab：按钮「Roll 随机塔 (120金)」点击后进入 buy-tower 放置模式（canvas 点空地 → Roll 1 座塔，T_TOWER 落地，不进候选/保留阶段，直接生效）。
  5. 预览 Tab：下一波 groups 表格（enemyId icon/数量 / delay / interval）。
- **ACs Addressed**: AC-14, AC-15
- **Test Requirements**:
  - `rule` TR-12.1：WAVEEND gold=120 → 点购买塔 → 光标变 buy-tower 模式 → 点空地 → tile=T_TOWER。gold=0。
  - `rule` TR-12.2：gold=30 → 抽 Buff 按钮 disabled + 显示灰色。
- **Evidence**: evaluate 返回 tile + gold。

---

## 【Phase 7: 综合收尾】

### Task 13: 天赋树 API + UI + 生效点（FR-7.1, AC-16, AC-17）
- **Status**: pending
- **Priority**: high
- **Depends On**: Task 3（users 列 talent_nodes + points）+ Task 9（calcTowerEffective 扩展天赋加成）
- **Description**:
  1. 后端：
     - handler 新增 `/api/account/talent GET`（返回 talent_nodes + talent_points_available）。
     - `/api/account/talent POST`（body: {nodeId: 'atk1'}）→ 校验：points>0、节点合法、没已点亮 → DB upsert + 返回新节点数组。
     - 在开局（init / DOMContentLoaded 后 / 登录状态变化后）调用 GET 并缓存到 `state.talentMul = {...}`。
  2. 前端天赋树 UI：全屏 modal 3 列 × 5 行节点。未点亮可点（消耗 1 点），已点亮金色。15 个 nodeId 与契约一致。
  3. 生效点：`calcTowerEffective()` 基础值 × talentMul 系数（在 environment 之前，最底层）；baseHP 初始值在 prepareNextWave 末尾 + talent 加成；初始 gold += talent 金币；波末奖励 × talent.goldMul。
- **ACs Addressed**: AC-16, AC-20（兼容老存档无 talent_nodes 时全 0 不报错）
- **Test Requirements**:
  - `rule` TR-13.1：账号 atk1 已点亮 → 新开局同塔 damage ≥ 未点亮 1.05 倍。
  - `rule` TR-13.2：未登录状态天赋点 API 返回 401，但本地仍能开局（所有 talent 系数=1）。
- **Evidence**: evaluate 返回 damage ratio。

### Task 14: 全局排行榜（FR-7.2, AC-17, R-5）
- **Status**: pending
- **Priority**: high
- **Depends On**: Task 3（表 schema）
- **Description**:
  1. `ensureSchema` 建表 `leaderboard_records`；Redis key 约定 `lb:{mapId}:{difficulty}:{type}`（ZSet）。
  2. 前端：在 triggerLose / WIN 分支（结局 2 处）计算 `{highestWave: waveIndex, totalKills: totalKillsAllWaves, fastestClearSec: runningSecSinceStart}` → POST `/api/lb/submit`。
  3. 后端 handler：按 (uid,map,diff,type) DB upsert 幂等 + Redis ZADD 仅当新分更高。
  4. 查询 `/api/lb?mapId=1&difficulty=normal&type=highestWave&page=0&pageSize=20` → 返回 `{top:[{rank,username,score}], myRank: {...}|null}`。
  5. 前端「🏆 榜」弹框显示下拉框（地图/难度/类型）+ 列表。
- **ACs Addressed**: AC-17
- **Test Requirements**:
  - `rule` TR-14.1：完成 WIN 结局 waveIndex=8 → 1s 后 GET lb top10 → uid 存在且 score=8。
  - `rule` TR-14.2：100 并发 submit 压力测试后 Redis ZSet 排序无串号/丢分（或至少无 panic/DB deadlock）。
- **Evidence**: HTTP response / wrk 压测结果。

### Task 15: Spine 动画接入 + 降级（FR-7.3, AC-19, R-3）
- **Status**: pending
- **Priority**: medium
- **Depends On**: 无（对 draw 管线解耦，随时可做）
- **Description**:
  1. Spine 初始化：`spineManager = { init, setTower, setEnemy, playMeteor, playIce }`。
     - init 尝试 WebGL canvas overlay：`canvas.width = stage.width * devicePixelRatio`，失败 `{ok:false}`。
  2. 所有塔 placeCandidate/reserveOne 时若 Spine 可用则 `spineManager.setTower(instId, cfg.rarity, gx,gy)` 注册 idle。
  3. `stepTowers` 攻击命中时调 `spineManager.setTower(instId).anim='attack'`。
  4. BOSS skill 触发 / ice freezer 调粒子 / 蓝色叠加层。
  5. 降级：任何 error → state.renderMode='canvas2d'，spine overlay hidden，完全走 v3 draw()。log('w', 'spine降级：'+msg)。
- **ACs Addressed**: AC-19, R-3
- **Test Requirements**:
  - `rule` TR-15.1：手动移除 spine-webgl.js 引用 → 刷新页面不抛异常 → 走完整「放 5 → 保留 → 战斗 10s → enemies>0」流程。
- **Evidence**: evaluate enemies>0 且 `state.renderMode==='canvas2d'`。

### Task 16: 移动端适配（FR-7.4, AC-18, R-4）
- **Status**: pending
- **Priority**: medium
- **Depends On**: 无（独立）
- **Description**:
  1. tower-defense.html 加 viewport meta。
  2. 新增 onResize listener（window resize）→ 根据 viewport w/h 重算 cell → 调 `applyCfg(state.cfg)` 重绘。
  3. canvas 上 touchstart/touchend 识别：
     - 单击：touchend 在 <60ms 且无移动 → 合成 MouseEvent click dispatch。
     - 长按：start 后 500ms 未移动 → dispatch openTowerInfoModal（用 cellFromEvt）。
     - 双指 pinch：记录两指距离，缩放 canvas.style.zoom 0.5-1.5。
  4. CSS `@media (max-width:768px)`：stat chip 33% 换行；所有 `button.btn` min-height 44px font-size 16px。
- **ACs Addressed**: AC-18, R-4
- **Test Requirements**:
  - `rule` TR-16.1：设置 `window.innerWidth=414`，触发 resize → canvas CSS 宽度 ≤ 414 高度 ≤ innerHeight*0.9。
  - `rule` TR-16.2：dispatch touchstart(center) → setTimeout 520ms touchend（长按）→ 触发 openTowerInfoModal 的行为（若该格是塔）。
- **Evidence**: evaluate canvas dimensions / modal present。

---

## 【全局 AC / Rubric 追溯映射表】

| AC | 对应任务 |
|---|---|
| AC-1 diff mul 生效 | Task 1 / Task 2 |
| AC-2 存档桶分离 | Task 3（DB） |
| AC-3 环境 Buff | Task 4 (fallback) + Task 5 (生效点) |
| AC-4 lava 伤害 | Task 4 + Task 5 |
| AC-5 地图解锁 | Task 5 |
| AC-6A A 类 2 同塔升稀同类型 | Task 6 |
| AC-6B B 类 3 异塔随机升稀 | Task 6 |
| AC-6C C 类配方产特殊塔 | Task 6 |
| AC-6D 特殊塔只来自配方（隔离） | Task 6 |
| AC-7 三模式交互（取消重置 / 最后素材格落点 / 准备阶段高光 + 配方提示条） | Task 6 |
| AC-8 护盾兵 | Task 7 |
| AC-9 治疗师治疗 | Task 7 |
| AC-10 meteor 眩晕 | Task 8 |
| AC-11 ice 冰冻 | Task 8 |
| AC-12 升级数值 + L3 随机效果（offense/crit 数值与存档兼容） | Task 9 / Task 10 |
| AC-13 双重打击（另选敌人额外攻击一次） | Task 11 |
| AC-13B 弹射链击（2 跳 60%→42% 伤害） | Task 11 |
| AC-14 商店买塔 | Task 12 |
| AC-15 金币不足灰化 | Task 12 |
| AC-16 天赋跨局生效 | Task 13 |
| AC-17 lb 提交+查询 | Task 14 |
| AC-18 移动端 | Task 16 |
| AC-19 Spine 降级 | Task 15 |
| AC-20 v3 存档兼容 | Task 3 / 9 / 4 |
| R-1 复玩性 | Task 4/5/6/7/8/12/13 全部上线后人工评审 |
| R-2 新手引导 | 所有任务完成后补 tooltip 子任务（Spec Approve 后添加） |
| R-3 性能 | 压力测试脚本在 Task 15 完成后跑 |
| R-4 移动端体验 | Task 16 后做完整走查 |
| R-5 排行榜正确性 | Task 14 压力测试后评审 |
