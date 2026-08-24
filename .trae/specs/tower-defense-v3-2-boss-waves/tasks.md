# 宝石TD v3-2 Boss 波 - 实现计划

---

## Task 1: 后端 config 生成器 + 模型新增 Boss 敌人（enemy id=6）
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 在 `internal/handler/config.go makeEnemies()` 追加 enemy id=6（BOSS·炎狱领主），严格按 roadmap ×20 HP、×5 基地伤害、×2.5 radius 推导：普通 enemy1（BaseHP/Speed/Armor/KillBaseGold/radiusPx/color）→ Boss：BaseHP ×20、Speed ×0.6、Armor 0.2、Flying=false、IsBoss=true、KillBaseGold ×20、DropBonusRate=1.0、radiusPx ×2.5、color="#991b1b"。
  - 保证 model.EnemyConfig 里已有 `IsBoss bool \`json:"isBoss"\`` 字段（不新增字段，只填充）。
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `rule` TR-1.1: `GET /api/config/enemies` 数组里 id=6 存在，IsBoss=true，type="boss"，BaseHP ≥ id=1.BaseHP × 19.5，radiusPx ≥ id=1.radiusPx × 2.4，KillBaseGold ≥ id=1.KillBaseGold × 19。
    - Evidence: `scripts/td-api-contract-test-v2.ps1` 新断言块 `# --- V3-2 Boss: enemy ---` PASS。
- **Notes**: speed 数值用 `Math.Round(60*0.6)` = 36 像素/秒。

## Task 2: 后端 makeWavesForV2 wave3/6/8 BossWave + boss group + RewardGold 阶梯
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - `internal/handler/config.go makeWavesForV2()`：零基 [2]/[5]/[7]（1-based 3/6/8）设置 `IsBossWave=true`。
  - 在 Boss 波末尾追加 `WaveGroup{EnemyID:6,Count:1,Interval:0,Delay:≈所有普通小兵全部生成完毕后 0.5 秒}`。
  - Boss 波 RewardGold：wave3=100、wave6=150、wave8=300（≥FR-2 要求下限）。普通波保持 rewardGold=50（不变）。
  - 不修改 placementPerWave（统一 = 5）。
- **Acceptance Criteria Addressed**: AC-2, AC-6
- **Test Requirements**:
  - `rule` TR-2.1: `GET /api/config/waves/1` 返回长度 8；waves[2]/[5]/[7].IsBossWave==true；3 波 groups[] 中至少 1 条 group.enemyId==6；waves[2].RewardGold>=100 && waves[5].RewardGold>=150 && waves[7].RewardGold>=300。
    - Evidence: `scripts/td-api-contract-test-v2.ps1` 新断言块 `# --- V3-2 Boss: waves ---` 3×isBossWave + 3×bossGroup + 3×reward 阈值 = 9 子条件全部 true。
  - `rule` TR-2.2: 非 Boss 波 (wave1/2/4/5/7) RewardGold == 50（普通波不回归，保持一致 50）
    - Evidence: 同 ps1 脚本。

## Task 3: 前端 fallback + loader 同步 Boss 配置
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1 & 2
- **Description**:
  - `web/js/td-config-fallback.js` ENEMIES 数组追加 id=6 Boss（字段名与后端返回 JSON 完全一致：`isBoss` 小写 bool、`radiusPx`、`dropBonusRate` 1.0）。
  - `WAVES` 数组修改 index 2/5/7：`isBossWave=true`、追加 `{enemyId:6,count:1,interval:0,delay:X}`、rewardGold 阶梯 100/150/300。
  - `web/js/td-config-loader.js adapt()` 在 enemy 适配段保留并扁平化 `isBoss`、`radiusPx`；对缺失 radiusPx 的旧值 fallback `cfg.radiusPx = cfg.radiusPx || 11`（向后兼容）。
  - `td-config-loader.js adapt()` 对 wave 的 `isBossWave` 原样保留并写入 `cfg.waves[i].isBossWave`，供 HUD banner 显示「★BOSS 波」。
- **Acceptance Criteria Addressed**: AC-1, AC-2, NFR-1
- **Test Requirements**:
  - `rule` TR-3.1: `scripts/td-fallback-vs-backend-v2.ps1` 增加 2 条 Boss 对齐断言：(a) enemyId6 所有字段一一相等；(b) wave3/6/8 三个 Boss 波字段（isBossWave、groups 长度/成员、rewardGold）相等；总体对齐断言计数 ≥ 22（原 20 + 2），PASS=计数、FAIL=0。
    - Evidence: 脚本 stdout 行 `PASS=X / X FAIL=0`。

## Task 4: 前端 drawEnemies Boss 视觉（1.6× HP bar + [BOSS]角标 + 深红 + 2.5px 描边）
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 3
- **Description**:
  - `web/js/td-game.js:819 drawEnemies()`：
    - 提取 `var isBoss = !!(cfg && cfg.isBoss);`
    - 本体描边：`ctx.lineWidth = isBoss ? 2.5 : 1.5; ctx.strokeStyle = isBoss ? 'rgba(248,113,113,0.90)' : 'rgba(0,0,0,.5)';`
    - HP bar：Boss bar `barW = (r*2+4)*1.6`，`barH = isBoss ? 6 : 4`；底色 Boss 使用 `#0f172a`；Boss 的 HP fill 不用绿（即使满血也用深红 `#dc2626`），剩血 ≤0.5 → `#b91c1c`，≤0.25 → `#7f1d1d`。
    - [BOSS] 角标：在 by 上方再画 `bw=38, bh=12` 深色标签框 `fillStyle = '#450a0a'`；`fillStyle='#fee2e2'` + `font='bold 10px sans-serif'`，`textAlign='center'` + `textBaseline='middle'`，写 `BOSS`。
    - slow 标识：Boss 慢标识升级为 4×4px 蓝方点（其余位置不变）。
- **Acceptance Criteria Addressed**: AC-3, AC-6
- **Test Requirements**:
  - `rule` TR-4.1: Evaluate 脚本插入 isBoss 敌人，取 drawEnemies 执行后 canvas 像素：取 [BOSS] 标签 BBox 内采样 10 点存在 `0xfee2e2`（rgba 对应）；HP bar BBox 内采样 20 点存在 `0xdc2626`（满血 Boss）。
    - Evidence: `browser_evaluate` 返回 `{bossTagPixel:true, hpBarRedPixel:true}`。

## Task 5: 前端 killEnemy Boss 奖励 Roll×2 + ★击杀日志
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 3
- **Description**:
  - `td-game.js:1325 killEnemy(e, towerCfg, buffMul)` 新增：
    - 判定 `var isBoss = !!(e.cfg && e.cfg.isBoss);`
    - 原本 roll 逻辑保持不变：当 `Math.random() < rollChance` 为 true，设置 `rolls = isBoss ? 2 : 1`。
    - 对 1 或 2 次 rolls 分别独立 `rar = rollBonusRarityByLuck(luckLevel)`、`bG = bonusMap[rar] || 5`；累计 `bGoldTotal`。
    - 最后 1 条日志：
      - 普通（rolls=1）保持原日志 `击杀奖励 Roll→[稀有]+15 金币`
      - Boss（rolls=2）替换为：`log('s', '★击杀 Boss ' + enemyName + '  Roll1→[' + label(rar1) + ']+' + b1 + '  Roll2→[' + label(rar2) + ']+' + b2 + ' 合计+' + (b1+b2) + ' 金币')`；若未命中 rollChance 门则日志写 `Roll[1/2] 未命中 +0`。
- **Acceptance Criteria Addressed**: AC-4, AC-6
- **Test Requirements**:
  - `rule` TR-5.1: Evaluate 脚本生成 isBoss enemy、dropBonusRate=1.0、luckLevel=1，走 killEnemy 后读 state.logTail（或直接找 msgLog 末尾 2 条）：含 `'★击杀 Boss '` 与正则 `'Roll1→\[[^\]]+\][+]\d+  Roll2→\[[^\]]+\][+]\d+ 合计[+]\d+'` 匹配成功；state.waveBonusGold 增量 == b1 + b2。
    - Evidence: `browser_evaluate` 返回 `{logMatched: true, bonusDeltaEq: true}`。

## Task 6: Banner phase 文本 Boss 波提示（AC-6 rubric 分数保障）
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 3
- **Description**:
  - 在 Banner phase 文本生成处（PREPARE/WAVEEND/BATTLE 开头）加：若 `cfg.waves[state.waveIndex-1].isBossWave === true`，拼接 `【★BOSS 波】`。
  - WAVEEND 当 `cfg.waves[state.waveIndex-1].isBossWave === true` 时加文案：`第 X 波 BOSS 已击败结算。`
- **Acceptance Criteria Addressed**: AC-6
- **Test Requirements**:
  - `rule` TR-6.1: 浏览器 evaluate 将 waveIndex 设为 3（W3）、phase=PREPARE，refreshHUD() 后 Banner phase 文本 `indexOf('【★BOSS 波】') >= 0`。
    - Evidence: evaluate 返回 `bannerHasBossHint = true`。
  - `rubric` TR-6.2: Dimension "Boss 波节奏辨识度综合" Scale 1-5。Anchors: 1=0 提示；3=phase 文本提示；5=PREPARE/BATTLE/WAVEEND 三处均【★BOSS 波】高亮 + 入场 log `i: 进入第 3 波 (★BOSS 波) - 剩余 5 次放置` 写消息日志。Pass Threshold ≥ 4。
    - Evidence: snapshot 中 Banner phase 文本块 + snapshot 日志首行 `进入第 3 波 (★BOSS 波) ...`。

## Task 7: 契约测试 + fallback-vs-backend + auth/save 套件不回归（FAIL=0）
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1-6（按序）
- **Description**:
  - `scripts/td-api-contract-test-v2.ps1` 追加 2 断言块：Boss 敌人(enemy6)、Boss 波(wave3/6/8)。
  - `scripts/td-fallback-vs-backend-v2.ps1` 追加 2 Boss 对齐：enemy6 字段逐一 ===、wave3/6/8 字段/组 对齐。
  - `scripts/td-auth-save-contract-test.ps1` 不变（FAIL=0）。
  - 浏览器 E2E：打到 wave3 → 出现 Boss → 击杀 → 日志含 ★击杀 Boss 双 Roll。
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-3, AC-4, AC-5
- **Test Requirements**:
  - `rule` TR-7.1: 3 个 PowerShell 契约脚本 exit code 全部为 0 且 stdout FAIL=0。
    - Evidence: Shell 捕获结果截图。
  - `rule` TR-7.2: E2E（wave 1→2→3 PREPARE 手动跳过或放塔保留，打 wave3 击杀 Boss 后）：Banner phase=BATTLE 为 BOSS 波提示；消息日志包含 `★击杀 Boss BOSS·炎狱领主 Roll1→[普]+X  Roll2→[普]+Y 合计+Z 金币`。
    - Evidence: browser snapshot（日志块 e28 含该字符串）。
  - `rule` TR-7.3: 浏览器 evaluate 取 30 次 draw() loop `performance.now` 平均 ≤ 1.0ms（NFR-2）。
    - Evidence: `{avgDrawMs: 0.xxx}` 输出。
