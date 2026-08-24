# 宝石TD · 综合玩法设计文档

> 版本: V4.0 综合版 + 2026-08-24 补丁（bafe141 + ae67bd8：移动端热修 / 部署热修 / UI收纳 / 能量技能 / 伤害三分支 & 元素配置化）
> 生成时间: 2026-08-23 （最后同步：2026-08-24 两次提交）
> 基线: 整合 MVP / MVP-v2 / Roadmap-V2Beta / V3-2 Boss / V3-6 UI Stats / V4 全量 共 6 份规格
> 语言: 中文

---

## 目录

1. [项目概述](#1-项目概述)
2. [核心玩法循环](#2-核心玩法循环)
3. [游戏阶段状态机](#3-游戏阶段状态机)
4. [地图与寻路系统](#4-地图与寻路系统)
5. [难度与多地图系统](#5-难度与多地图系统)
6. [塔系统](#6-塔系统)
   - 6.1 塔基础体系
   - 6.2 塔放置与保留机制 (V4-11 保留入口重构)
   - 6.3 塔升级系统 (V4-10：L3 特效金币解锁)
   - 6.4 塔合成/进化系统 (V4-11：B/C 双模式 · 塔详情入口)
   - 6.5 塔攻击策略切换
7. [敌人与战斗系统](#7-敌人与战斗系统)
   - 7.1 敌人种类
   - 7.2 BOSS 系统与技能
   - 7.3 战斗循环与伤害公式
8. [波次系统](#8-波次系统)
9. [经济与运气系统](#9-经济与运气系统)
10. [全局增益 Buff 系统](#10-全局增益-buff-系统)
11. [波次商店系统 (V4-6)](#11-波次商店系统-v4-6)
12. [账号与存档系统](#12-账号与存档系统)
13. [天赋树系统 (V4-7)](#13-天赋树系统-v4-7)
14. [排行榜系统 (V4-7)](#14-排行榜系统-v4-7)
15. [UI/UX 设计规范](#15-uiux-设计规范)
   - 15.1 整体布局 (V4 + 2026-08-24 极简 HUD 收纳版)
   - 15.2 HUD & ☰ 菜单抽屉 (Chip 仅留四角，其余全部入抽屉)
   - 15.3 Canvas 交互
   - 15.4 塔信息弹框 (V3-6 精细化 + 毛玻璃半透明)
   - 15.5 关键弹框
16. [渲染与动画系统](#16-渲染与动画系统)
17. [移动端适配 + 部署可用性 (V4-7 + 2026-08-24 热修)](#17-移动端适配--部署可用性-v4-7--2026-08-24-热修)
18. [配置契约总览](#18-配置契约总览)
   - 18.4 新增：能量配置 energy-cfgs.json、塔技能 tower-skills.json、元素 baseBonus
19. [战斗伤害体系 V4-9（三分支 + 元素配置化）](#19-战斗伤害体系-v4-9三分支--元素配置化)
20. [验收标准摘要](#20-验收标准摘要)

---

## 1. 项目概述

### 1.1 游戏定位
宝石TD 是一款**开放式网格塔防 + 云顶式运气机制**的浏览器单机/云存档游戏。玩家在空地上随机 Roll 塔、保留 1 座、组建防线，通过「升级运气 → 抽全局 Buff → 塔合成进化 → 塔升级分支 → 天赋跨局成长」的多层成长，抵御递增的敌人波次与 BOSS 技能。

### 1.2 设计愿景
- **策略深度**：塔的获取不靠金币购买，而靠「每波 5 次 Roll + 保留 1 座」的云顶式机制，强调「围绕随机结果做最优布局」。
- **多层成长**：单局内有运气等级 / Buff / 塔合成 / 塔升级 4 层成长；跨局有天赋树永久加成；全局有排行榜社交。
- **移动端优先**：Canvas 10×6 横向紧凑网格 + 自适应布局 + 触屏手势，手机可完整玩一局。
- **配置驱动**：所有数值（塔/敌/波/运气/Buff/配方/地图）均来自 JSON 配置，后端改配置即可平衡，前端零改动。

### 1.3 版本演进历史

| 阶段 | 交付内容 | 核心玩法闭环 |
|------|---------|-------------|
| MVP (V1) | 24×16 网格地图、A*寻路、箭塔/炮塔、8波、宝石合成装备 | 能放塔→能出怪→能通关 |
| MVP-v2 | 5次放置/保留1座、运气Lv1~5、取消宝石系统、全局Buff、地形Gate | 云顶式放置循环 + 经济重做 |
| Roadmap-V2Beta | 规划：V3(存档/Boss) / V4(扩内容/Spine) / V5(部署/排行榜) | 后续路线图 |
| V3-2 Boss | wave3/6/8 Boss ×20血 / Roll×2奖励 / [BOSS]角标 / 宽HP bar | 游戏节奏起伏 |
| V3-6 UI Stats | 属性「实际(基础)」格式、Buff范围圈、单塔DPS/伤害/击杀、全局DPS榜、跨波累计击杀云存 | 数值可观测 |
| V4 (当前) | 3难度×3地图×环境、5精英+2BOSS技能、塔合成A/B/C三模式、L0→L3升级+5随机特效、4Tab波末商店、天赋树、排行榜、Spine降级、移动端适配 | 完整可发布版本 |
| V4.1 +2026-08-24 (bafe141) | 移动端误触修复（中央按钮移到底部、滑动阈值25px）+ 部署可用性（TD_PORT 环境变量、GOPROXY 国内镜像）+ UI 收纳极简 HUD + 毛玻璃半透明菜单/弹框 | 手机可玩 + Docker 跑起来 |
| V4.2 +2026-08-24 (ae67bd8) | 能量+技能解耦（每塔 energyCfgId + skillId）、伤害类型三分支(物理/魔法/真实)、法抗 magicResist、armor 从乘区改减法点数、元素减速/掉率 唯一配置 gems.baseBonus | 战斗数值全配置化
| V4.10 +2026-08-24 | 数值对齐《数值.txt》(8塔×6档稀有度)、塔成长=稀有度成长(getTowerLevel 档位取值)、L3特效金币解锁(120金,替代三级升级链)、战斗特效(减速/毒DoT/减甲/多重/光环)配置化 | 数值单一源 |
| V4.11 +2026-08-24 | A类升级下线、保留/合成/进化入口收敛到塔详情弹窗(有操作才显示按钮)、RESERVE弹窗下线(放满5塔详情保留)、合成确认后其余候选变墙直接开战、开始按钮移菜单旁缩为▶三角、合成产物稀有度bug修复(nextRarityUp) | 操作收敛 + 流程直通 |

---

## 2. 核心玩法循环

```
单局循环 (单张地图 × 单个难度)：
┌─────────────────────────────────────────────────────────────────────┐
│  【MENU】难度 + 地图 选择                                                │
│       ↓                                                                 │
│  【PREPARE】每波 5 次放置机会：                                           │
│    空地点击 → 扣机会 → 按 luckLevel 稀有度权重 Roll 1 座塔(候选塔)         │
│    放置 5/5 → 进入「保留/合成窗口」(V4-11，原 RESERVE 弹窗下线)：            │
│      点击任意塔打开塔详情 → ①「保留本塔」：该塔转真塔                       │
│          → 其余 4 座自动变墙(可免费拆) → 直接开战                          │
│        ② 或「合成/进化」(候选塔可作材料)：确认后产物落地                    │
│          → 其余本波候选塔变墙 → 直接开战                                   │
│      (全程 terrainGate 防封死，连通性检查拒绝操作；变墙封路时退化为空地)      │
│       ↓                                                                 │
│  【BATTLE】(保留/合成确认后自动进入)：                                     │
│    • 敌人按 WaveConfig 逐批出生 → A* 最短路径到基地                       │
│    • 真塔锁敌攻击（可选4策略：近/远/血多/血少）                              │
│    • 塔攻击帧动画 + 子弹命中扣血 + 元素效果(减速/多伤/额外金)               │
│    • 可免费拆自己的墙(过Gate)、可看塔属性(L3解锁仅PREPARE/WAVEEND)          │
│    • 禁止：新建塔放置、手动存档、合成/进化(V4-11 收敛到保留/合成窗口)        │
│    • 胜负：基地HP≤0→LOSE / 波清完→进入WAVEEND / 最后一波清完→WIN            │
│       ↓                                                                 │
│  【WAVEEND】波次商店 4 Tab：                                              │
│    ① 抽 Buff（40金/次，每波≤5）                                            │
│    ② 升运气等级（80金×下级等级，Lv.10封顶）                                 │
│    ③ 购买塔（120金/次，每波≤2，直接落地真塔不占放置机会）                    │
│    ④ 下波预览（免费）                                                     │
│    底部【开始下一波】按钮 → 回到 PREPARE(N+1)，放置机会重置为5              │
│    (每波结束自动 autosave；账号+1 天赋点)                                   │
└─────────────────────────────────────────────────────────────────────┘
         ↓ WIN / LOSE 结局
      结算弹框：DPS榜 + 最高波 + 本局统计 + 自动上报排行榜
       → 返回 MENU 或 重新开始
```

**关键设计理念**：
1. **塔资源稀有**：每波只保留 1 座真塔 → 8 波最多 8 座 → 玩家必须用「合成/进化/升级」强化少数几座，而不是堆数量。
2. **双随机层**：放置 Roll 塔（受 luck 控制）+ L3 随机特效（不可控）→ 每局体验差异化。
3. **防作弊**：BATTLE 阶段禁止手动存档（防 rollback 重打）；存档带 `ifMatchUpdatedAt` 乐观锁；账号单点登录（互斥）。

---

## 3. 游戏阶段状态机

```
                        ┌──────── MENU ─────────┐
                        │ 难度·地图·登录·排行榜 │
                        └─────────┬─────────────┘
                                  │ 点【开始游戏】
                                  ↓
          ┌──────────── PREPARE (第 N 波) ────────────┐
          │ 放置机会 X/5 (缺省5)                        │
          │   • 空地/墙 → 放候选塔 Roll                │
          │   • 墙可免费拆                              │
          │   • 手动 save/load 被禁 (placementUsed>0)   │
          │                                            │
          │ 放置 = 5/5 → 「保留/合成窗口」(V4-11)：      │
          │   点击塔 → 塔详情弹窗操作按钮               │
          │   (有可用操作才显示)：                       │
          │   ① 保留本塔(候选塔) ──┐                   │
          │   ② 合成/进化(B/C类,    │                   │
          │     候选塔可作材料) ────┤                   │
          │   ③ 解锁L3特效(真塔,    │                   │
          │     120金)             ↓                   │
          │   terrainGate 通过？← 是─┘                  │
          │     │否：拒绝+提示(变墙封路→退化空地)         │
          │     ↓是(保留/合成确认后)                     │
          │   自动进入 BATTLE                            │
          └──────────┬─────────────────────────────────┘
                     ↓
            ┌──── BATTLE (第 N 波) ──────┐
            │ 敌人按 waves[N].groups 生成   │
            │ RAF 60fps: moveEnemy →        │
            │   lockEnemy → fire → damage   │
            │   → kill → reward →           │
            │   enemy到达扣基地HP            │
            │                                │
            │ 允许：拆墙/看塔属性            │
            │ 禁止：新建塔放置 / 手动存档 /  │
            │      合成/进化(V4-11收敛窗口)  │
            │                                │
            │ 基地HP≤0 ─────→ LOSE ──┐      │
            │ 最后一波 且 敌人清空→ WIN ─┤      │
            │ 非最后一波 敌人清空 ── WAVEEND ─┤      │
            └──────────────────────────────┘
                      │
                      ↓
           ┌────── WAVEEND ───────┐
           │ 波末奖励金发放          │
           │ 自动 autosave           │
           │ 账号+1 天赋点           │
           │                        │
           │ 商店 4 Tab：            │
           │  抽Buff / 升运气 /     │
           │  购买塔 / 下波预览     │
           │                        │
           │ 点【开始下一波】→ PREPARE(N+1)
           └────────────────────────┘
```

### 3.1 阶段约束矩阵 (V4-11 更新：RESERVE 阶段下线，操作收敛到塔详情弹窗)

| 动作 | MENU | PREPARE(放置未满) | PREPARE(放满=保留/合成窗口) | BATTLE | WAVEEND | WIN/LOSE |
|------|------|-------------------|-----------------------------|--------|---------|----------|
| 放置候选塔 | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| 保留本塔(塔详情) | ✗ | ✗ | ✓(候选塔) | ✗ | ✗ | ✗ |
| 拆墙 | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ |
| 合成/进化(塔详情) | ✗ | ✗ | ✓(候选塔可作材料) | ✗ | ✗ | ✗ |
| 解锁L3特效(塔详情) | ✗ | ✗ | ✓(真塔,120金) | ✗ | ✓(真塔,120金) | ✗ |
| 切换难度/地图 | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| 手动save/load | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| autosave触发 | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |
| 商店消费 | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |

---

## 4. 地图与寻路系统

### 4.1 网格规格
- **默认网格**：10 列 × 6 行（横向布局，紧凑适合手机）
- **单元格**：正方形，根据容器自适应：`cellPx = floor(min(containerWidth/cols, containerHeight/rows))`，clamp 在 `[12px, 3×configCellSize(48)]`，即 `[12, 144]px`
- **Canvas 初始尺寸**：480×288（10×48, 6×48），首屏加载体验好
- **DPR 高分辨率**：所有绘制用逻辑像素，`ctx.setTransform(DPR, 0, 0, DPR, 0, 0)` 确保清晰
- **像素渲染**：`image-rendering: pixelated` 保持像素风锐利

### 4.2 Tile 类型

| 值 | 名称 | 可通行 | 可建造(放置) | 可拆除 | 说明 |
|----|------|:------:|:-----------:|:------:|------|
| 0 | T_EMPTY 草地 | ✓ | ✓（放置候选塔/购塔） | - | 基础地形 |
| 1 | T_STONE 石墙 | ✗ | ✗ | ✗ | 地图固定走廊（不可动） |
| 2 | T_START 出生点 S | ✓ | ✗ | ✗ | 敌人路径起点（唯一） |
| 3 | T_END 基地 E | ✓ | ✗ | ✗ | 敌人路径终点（唯一） |
| 4 | T_WALL 玩家墙 | ✗ | ✗(可覆盖) | ✓(免费) | 候选塔未保留时生成 |
| 5 | T_TOWER 真塔 | ✗ | ✗ | 配置开关(默认否) | 玩家保留/合成的有效塔 |
| 6 | T_CP 检查点 | ✓ | ✗ | ✗ | 路径必经锚点(分段) |
| 7 | T_LAVA 熔岩 | ✓(扣血) | ✗ | ✗ | 熔岩地图环境块 |

### 4.3 检查点 (Checkpoint) 机制
- **用途**：强制敌人路径经过指定锚点（S→M1→M2→E），同时分段检测封路。
- **配置**：`mapDetail.checkpoints = [{x:7,y:3}, {x:2,y:5}]`（S型路径示例）。
- **分段寻路**：
  1. 段 1：S → CP[0]
  2. 段 2：CP[0] → CP[1]
  3. 段 3：CP[1] → E
  4. 最终路径 = 三段拼接（去重相邻点）
- **分段封路检测**：任何改地形操作（放置/保留/拆墙/合成落地）都对 3 段各自跑 A*。任意一段无路 → 整体拒绝 + 提示「[拒绝] 第 X 段被封死」。
- **锚点保护**：S / CP / E 三座格子永久禁止建塔/覆盖（放置时先判断是否锚点）。

### 4.4 A* 寻路规则
- **移动方向**：4 向（上/下/左/右），避免斜角穿塔角。
- **触发重算时机**：放置候选塔 / 保留选择 / 拆墙 / 合成落地 / 购塔落地。
- **敌人路径更新**：全局路径重算后，每个敌人从「当前所在格」重新计算到 E 的 A* 路径替换旧路径数组，继续前进。

---

## 5. 难度与多地图系统

### 5.1 难度分级 (V4-1)
MENU / PREPARE 阶段可选（第一波开始后锁定）：

| 难度 | 敌人HP | 敌人速度 | 金币倍率(波末+击杀) | 基地HP上限 |
|------|:------:|:--------:|:------------------:|:----------:|
| 普通 Normal | 1.0× | 1.0× | 1.0× | 20 |
| 困难 Hard | 1.8× | 1.15× | 1.3× | 15 |
| 噩梦 Nightmare | 3.0× | 1.35× | 1.6× | 10 |

**生效点**：
- 敌人HP：`spawnEnemy` 时 `finalHP = cfg.baseHP × difficulty.hpMul`
- 敌人速度：`stepEnemy` 时 `finalSpeed = cfg.speed × difficulty.speedMul`
- 金币：`killEnemy` 和 `wave.rewardGold` 发放时 × difficulty.goldMul
- 基地HP：`prepareNextWave` 第一波时 `state.baseMaxHP = baseHP × difficulty.baseMul`

### 5.2 多地图 + 环境效果 (V4-2)

#### 地图 1：经典草原 (mapId=1)
- **解锁条件**：默认解锁
- **路径布局**：S(0,1) → CP1(7,3) → CP2(2,5) → E(9,5)，S型走廊含 3 石墙 + 2 转弯
- **环境 Buff**：塔攻击范围 +5%
- **波次**：8 波递增；wave3/6/8 Boss

#### 地图 2：熔岩洞穴 (mapId=2)
- **解锁条件**：草原通关 ≥ 4 波（users.unlocked_maps 记录）
- **路径布局**：更绕更长，路径旁随机 20 格熔岩 tile=7
- **环境效果**：
  - 熔岩 Tile：敌人走在上面每 0.5s 扣 5 HP（真实伤害，来源塔=null）
  - 基地伤害系数 0.8×（熔岩也伤害敌人，所以减轻基地压力）
- **波次**：8 波，精英更多，wave3/6 Boss 为熔岩暴君（带技能）

#### 地图 3：冰霜高地 (mapId=3)
- **解锁条件**：熔岩通关 ≥ 4 波
- **路径布局**：分叉再汇合（双通道）
- **环境 Buff**：敌人攻速 -15%；塔攻速 +5%
- **波次**：8 波，wave8 最终 Boss 冰霜女王（带全屏冰冻技能）

### 5.3 地图存档分桶
- **save_records 表主键**：`(uid, map_id, difficulty)` 复合键
- **含义**：草原普通 / 草原困难 / 熔岩困难 等 9 种组合各有独立存档，互不串档。

---

## 6. 塔系统

### 6.1 塔基础体系

#### 稀有度 × 元素 = 24 基础塔（V2 + 扩展）
- **稀有度 (4 档)**：`common / rare / epic / legendary`
  - 数值倍率：common=1.00 / rare=1.50 / epic=2.20 / legendary=3.00
  - 范围格数：2 / 2 / 3 / 3
  - 攻击间隔(秒)：0.9 / 0.8 / 0.7 / 0.6
- **元素 (6 种)**：`fire / ice / thunder / poison / light / dark`
  - fire：damage × 加成
  - ice：减速(30%, 2s)
  - thunder：range × 加成
  - poison：减速(20%, 1.5s)
  - light：额外金币 Roll 概率 +15%
  - dark：额外金币 Roll 概率 +10%
- **AOE 属性**：epic 和 legendary 稀有度的塔带 AOE（aoeRadiusPx）

#### 5 座特殊塔 (V4-3 C类进化产物)
特殊塔带 `special:true` 标识，**只能通过 C 类配方进化产出**。不能通过 A/B 合成、Roll 塔、商店购买获得。

| 配方 ID | 稀有度 | 配方材料 | 特殊塔名 | 被动 / 光环效果 |
|---------|--------|---------|---------|---------------|
| C-FUSION | epic | PYRO + CRYO + ELECTRO (3 common) | 元素融合塔 | 每次攻击火冰雷随机，减速+灼烧+感电同时命中 |
| C-DESTROYER | epic | CANNON + ARCHER + SPLASH (3 rare) | 破坏者 | 每次命中附带 0.3s 眩晕，AOE 半径 ×1.5 |
| C-AURORA | epic | SNIPER + FREEZE + POISON (3 rare) | 极光塔 | 光环：±2 格友塔攻速 +8%（可叠加，上限 +24%） |
| C-GEMLORD | legendary | 任意 3 epic(至少 1 座带元素) | 宝石主宰 | 光环：全图塔伤害 +5%；主动：10s 一次对 20% 最高血敌人 10% 真实伤害 |
| C-RAIGATEKI | legendary | 1 legendary + 2 epic(不同类型) | 雷击帝 | 普攻附带链式闪电，±1 格 60% 伤害，最多链 3 次衰减 70% |

### 6.2 塔放置与保留机制 (MVP-v2 · V4-11 保留入口重构)
- **次数**：每波 `placementPerWave=5`（配置化），从 PREPARE 重置。
- **流程**：
  1. 点击空地/墙 → 扣机会 1 次 → 按当前 luckLevel 的 `towerRarityWeights` 加权随机 Roll 塔（V4-10：Roll 出「宝石类型 + 实例稀有度」）→ 落地为候选塔（T_CAND 显示态，标记高亮）
  2. 5/5 放置完成 → 进入「保留/合成窗口」：点击任意塔打开**塔详情弹窗**，显示「📌 保留本塔」按钮（V4-11：原 RESERVE 弹窗下线）
  3. 点击保留 → terrainGate 逐格验证「1 真塔 + 4 墙」下 S→CP1→CP2→E 全段连通 → 连通则：保留塔变真塔 T_TOWER、其余 4 格变墙 T_WALL、直接进入 BATTLE；不连通则整体回滚并提示。
- **合成/进化替代路径**：窗口内也可不保留而直接合成/进化（见 6.4），确认后其余本波候选塔变墙（封路格退化为空地）→ 直接进入 BATTLE。
- **禁止撤销**：放置即生效，无「撤回放置」按钮。

### 6.3 塔升级系统：L3 特效金币解锁 (V4-10 改造，替代 V4-5 三级升级链)

> **V4-10 破坏性变更**：原 L0→L1→L2→L3 三级金币升级（每级 伤害+30%/攻速+10%/范围+5%）**整体下线**——塔成长 = 稀有度成长（8 塔 × 6 档 levels，见 6.1），等级升级不再提供属性加成。仅保留 **L3 特效解锁**：

#### 解锁费用与规则
- 费用：固定 `120 金`（`L3_UNLOCK_COST`），塔等级上限 `LEVEL_MAX=3`
- 条件：真塔 && PREPARE/WAVEEND 阶段 && 金币足够 && 尚未解锁（有可用操作才显示按钮，V4-11）
- 解锁后属性不变，仅获得随机特效

#### L3 随机特效 (5 选一，等概率 20%)
| ID | 名称 | 效果 | 金标 |
|----|------|------|------|
| effect_offense | 进攻狂潮 | 伤害 +40%，范围 +15% | ⚔ |
| effect_control | 极寒控制 | 减速塔减速幅度 +25%；AOE塔AOE半径 +30%；均不满足则攻速 +20% 兜底 | ❄ |
| effect_double_shot | 双重打击 | 每次攻击时，对攻击范围内**另一个不同敌人**额外攻击一次（伤害 ×0.8，独立元素判定） | ✦ |
| effect_crit | 致命暴击 | 15% 概率打出 2.5× 暴击伤害，命中时Canvas红色破折线飞出 | ★ |
| effect_ricochet | 弹射链击 | 击中主目标后弹射到 ±2 格内最近的其他敌人，60% 伤害，最多弹 2 次（每次衰减 70%） | ⚡ |

#### UI 流程
- 解锁按钮位于塔信息弹框底部，文字「解锁 L3 特效（-120 金）」；不满足条件（非真塔/阶段不符/金币不足/已解锁）时**按钮直接不显示**（V4-11）。
- 确认后播放 **1.2s Roll 动画**（5 图标快速切换 → 定格）→ 结果卡片展示效果。
- L3 塔卡片右上角显示对应金标，塔信息弹框追加「已获得特殊效果」区块。

### 6.4 塔合成/进化系统：B/C 双模式 (V4-3 · V4-11 入口重构)

**共同规则（V4-11 更新）**：
- ~~三种模式 HUD 上各自独立按钮~~ → **入口收敛到塔详情弹窗**：点击塔打开详情，有可用操作才显示「🧪 合成」/「💠 进化」按钮（不能操作不显示）；**A 类升级（2 塔升稀有度保类型）整体下线**
- **操作窗口**：仅 PREPARE 阶段放满 5 塔后的「保留/合成窗口」内可操作（`_mergeWindowOpen`）；本波候选塔（T_CAND）也可作为材料
- 全部取消距离限制（全场任意选塔，含候选塔）
- 产出塔落地位置 = **最后点击选中的素材塔所在格**，其余素材格回变草地
- **窗口内确认合成/进化后**：其余本波候选塔全部变墙（terrainGate 封路则退化为空地）→ 直接进入 BATTLE（V4-11）
- 所有落地操作走 terrainGate 防封死，失败整体回滚
- 从塔详情发起时本塔**预选为第一材料**（`_tiAction`），玩家继续点选其余 2 座

#### B 类：合成 (3 不同类型同稀有度 → 升档 + 随机类型)
- 条件：3 座塔 towerCfgId 互不相同、实例稀有度相同、全非特殊塔（候选塔可作为材料）
- 塔详情「合成」按钮显隐：`_canFusionFrom(idx)`（本塔 + 另 2 座「同稀有度·不同类型」非特殊塔可凑齐才显示）
- 校验通过后弹出「合成确认 modal」：**只显示产物稀有度、不显示类型**（随机悬念）
- 落地：**产物稀有度 = nextRarityUp(材料稀有度)**（如 common×3 → rare；V4-11 修复：不得取塔配置基础稀有度）、类型从普通塔池（!special）Roll、数值按稀有度档位取 levels[i]（V4-10）
- 稀有度链：common→rare→epic→legendary→mythic→ultimate（ultimate 封顶不可再合成）

#### C 类：进化 (固定配方 → 特殊塔)
- **配方检测**：`detectEvolvable()` 自动检测场上是否满足配方（含候选塔）。
- **配方提示条**：画布顶部 sticky，5 Tab 切换配方，每 Tab 显示 3 材料勾选状态 + 可用数量。
- 塔详情「进化」按钮显隐：`_canEvolveFrom(idx)`（存在配方使本塔可作材料且其余材料可凑齐才显示）
- 条件：3 座塔（允许特殊塔作为材料，支持链式进化；候选塔可作材料）满足 5 配方中任一的 towerCfgId 组合
- 命中后弹出「进化预览 modal」：显示配方ID + 产物特殊塔卡片(稀有度固定 + 特殊增益说明)
- 落地：稀有度不按+1规则，直接取配方表指定值（epic 或 legendary），`special:true`

**特殊塔隔离验证**：
- B 类选择时：点击 special 塔 → 拒绝加入 selection
- Roll 塔（placeCandidate + 商店购塔）：候选池过滤 `special:true`
- B 类随机类型池：过滤 `special:true`
- ⇒ 特殊塔只能来自 C 类配方

### 6.5 塔攻击策略切换 (V3-4)
点塔信息弹框内提供 4 选 1 切换：
1. **最近 NEAR**：默认，锁离基地最近（pathIdx 最大）的敌人
2. **最远 FAR**：锁离基地最远（pathIdx 最小）的敌人
3. **血最多 STRONG**：锁范围内 HP 最高
4. **血最少 WEAK**：锁范围内 HP 最低

---

## 7. 敌人与战斗系统

### 7.1 敌人种类

#### 普通/精英敌人

| enemyId | 类型 | 说明 | HP | 速度 | 机制 |
|---------|------|------|----|------|------|
| 1 | normal 小兵 | 基础 | 80 | 1.0 | 无 |
| 2 | runner 疾行者 | 快速 | 60 | 1.5 | 无 |
| 3 | heavy 重甲 | 高血低速 | 160 | 0.6 | armor=0.2 |
| 4 | elite 精英 | 均衡 | 120 | 0.9 | 奖励×2 |
| 5 | split 分裂者 (V4-4) | 死亡分裂 | 180 | 0.9 | 死亡→2 FAST |
| 6 | BOSS·炎狱领主 | wave3/6/8 Boss | 1600 | 0.6 | 血×20，Roll×2 |
| 7 | SHIELD 护盾兵 (V4-4) | 有盾 | 100 | 1.0 | 每次受击先扣 30 护盾值 |
| 8 | HEALER 治疗师 (V4-4) | 辅助 | 80 | 1.0 | 每秒为 ±2 格盟友 +5 HP |
| 9 | SUMMONER 召唤者 (V4-4) | 召唤 | 140 | 0.8 | 每 3s 召唤 2 FAST |
| 10 | FAST 快速兵 (V4-4) | 极速 | 60 | 2.0 | 无 |
| 11 | BOSS·熔岩暴君 (V4-4) | wave6 map2/3 | 2400 | 0.5 | 陨石弹幕技能 |
| 12 | BOSS·冰霜女王 (V4-4) | wave8 map3 最终 | 3200 | 0.55 | 全屏冰冻技能 |

#### 通用敌人属性
- `hpMax / speed(格/秒) / rewardCoin / damageToBase / armor(0~1) / resistance(元素减伤%) / dropBonusRate(0~1) / radiusPx / color`
- 敌人头顶 HP bar（剩余/最大，普通宽 26px、Boss 1.6×，描边加厚）
- slow 标识（HP bar 下方深蓝方点）

### 7.2 BOSS 系统

#### V3-2 BOSS 共性
- wave3 / wave6 / wave8 为 Boss 波（`IsBossWave=true`）
- Boss 血量 ≈ 同波小兵 ×20、基地伤害 ×5、半径 ×2.5
- **视觉识别**：深红体色 + 辉光描边(2.5px) + 1.6× 宽 HP bar（全血深红配色）+ 头顶 [BOSS] 角标
- **Roll×2 奖励**：击杀 Boss 命中奖励概率门后，独立 Roll 两次 bonusRarity（不是概率翻倍），日志 `★击杀 Boss XX Roll1→[稀]+15 Roll2→[史]+100 合计+115 金币`
- Boss 波 RewardGold 加档：wave3≥100 / wave6≥150 / wave8≥300

#### V4-4 BOSS 2 技能：陨石弹幕 meteor_barrage
- **触发**：进入战场 10s 后每 15s 一次
- **预警(3s)**：屏幕上方红色警告条闪烁 + 画布随机 8 格红圈目标预绘
- **执行**：目标格陨石命中，格内所有敌人受 200 真实伤害（敌我通吃）、塔眩晕 1s（无法攻击）
- **视觉**：Canvas 径向黄→红渐变圆扩散

#### V4-4 BOSS 3 技能：全屏冰冻 ice_freezer
- **触发**：进入战场 8s 后每 12s 一次
- **预警(2s)**：全画布蓝闪 + 警告文本「冰霜即将覆盖！」
- **执行**：全屏冰冻 2s：所有塔/敌人 dt=0（静止）；之后 50% 减速残余 3s
- **交互**：冰冻 2s 内 canvas 点击返回「被冰冻中」msg，阻断操作

### 7.3 战斗循环与伤害公式

#### RAF 渲染循环 (硬约束)
```javascript
function renderLoop() {
  state.rafId = requestAnimationFrame(renderLoop); // 顶行：永久保持 RAF 链
  try {
    if (state.running) battleTick(dt);              // 战斗推进 try/catch
  } catch(e) { console.error(e); }
  draw();                                           // 绘制
  if (!state.running) return;                       // running 判断移至底
}
```
- **异常保护**：`battleTick` 抛异常不中断 RAF 循环
- **断链恢复**：进入 `prepareNextWave` 和 `startBattleForWave` 时调用 `ensureRenderLoop()` 重启 RAF
- **保底出怪**：`startBattleForWave` 空波检测到无敌人时 → 日志error + 顶部提示 + 自动填充 5 NORMAL 敌人 0.5s 间隔

#### 伤害公式 (V4-9 三分支 · 2026-08-24 ae67bd8)

```
── 第一阶段：算出基础伤害（所有乘区先合并）
baseDmg 来源分两路（互斥）：
  (a) 常规攻击：
    = towerCfg.baseDamage
    × rarityMul            (common1.0 ~ legendary3.0)
    × elementBonus         (元素伤害/射程/间隔加成，来自 gems.json)
    × towerDamageMulAll    (全局 Buff 叠加·乘法)
    × talentMul.atk        (账号天赋·永久)
    × environment.towerMul.damage
    × levelMul             (每级×1.30)
    × rollEffectMul        (L3 特殊效果:进攻+1.4 / 暴击×2.5)
    × skillCfg.damageMul   (V4-8 技能激活倍率，未激活=1.0)

  (b) 预结伤害（弹射链最后一跳 / DoubleShot / Crit 预设值等）：
    = finalDamageOverride（调用方直接给出，跳过上面所有乘区）

── 第二阶段：伤害类型三选一（towerCfg.damageType ∈ {physical, magic, true}）
  ⚠ armor 语义：从「乘区 (1-armor*0.5)」改为「减法点数」！
    enemies.json 原有小数 armor (如 0.28) 须重新标定为点数制（common 8~15 / BOSS 80~200）。
    enemies 新增 magicResist (0~100，超限自动 clamp)，只对魔法生效。

· physical（物理·默认；damageType 缺/非法 → 一律回退 physical）
    armorActual = enemy.armor
                × environment.enemyMul.armorMul  (地图环境 护甲倍率)
                × (1 - skillCfg.armorIgnorePct01)   (V4-8 技能穿甲 0~1)
    typed = max(1, baseDmg - armorActual)   // 减法；保底1点不0

· magic（魔法·百分比减免）
    mr = clamp(enemy.magicResist, 0, 100)
    mrActual = mr × (1 - skillCfg.magicResistIgnorePct01)
    typed = baseDmg × (1 - mrActual / 100)

· true（真实·无视双抗）
    typed = baseDmg

── 第三阶段：元素抗性（独立维度，三类型都生效）
resistMul = 1 - (enemy.resistances[elementOfTower] ?? 0)
finalDamage = typed × resistMul
            ；clamp 最小值 1（避免 0 伤害吞掉 shield/hp 状态机）

── 抵扣顺序（V4-4 兼容不变）
  1) finalDamage 先扣 enemy.shield（盾破再扣血，盾未破 hp 不变）
  2) 余伤扣 enemy.hp
  3) 累计 grid[sourceGridIdx].damageDealt / kills
```

#### V4-8 塔能量 + 技能（2026-08-24 体系引入，配置解耦）
每塔配置 `energyCfgId` + `skillId`，**能量独立，技能可复用**：
- **能量加能**：`energy += energyCfg.perSecond × dt（battleTick 全局）` + `energyCfg.perAttack 每次命中`；上限 energyCfg.energyMax。
- **技能触发**：energy ≥ max → 下一发子弹携带技能参数（4 类：damageMul / armorIgnore / magicResistIgnore / slowMul+slowTicksSec），命中后 energy 归零。
- **fallback**：缺 energyCfgId → normal（max100 / perAtk1 / perSec1）；缺 skillId → double_strike（默认双倍伤害）。**不配置零影响**。
- **UI**：塔格底部绘制能量条（未满黄 / 已满蓝+金边框）；塔详情显示技能卡片 + 数值 + 当前能量百分比。

#### 伤害累计入口
- `damageEnemy(enemy, dmg, {sourceGridIdx, elem})` → 扣血 + 累加 `grid[X].damageDealt`
- `killEnemy(enemy, {sourceGridIdx})` → 金币 + 累加 `grid[X].kills` + 稀有度奖励 Roll
- 单塔每波 damageDealt/kills 在 `prepareNextWave` 末尾 resetTowerWaveStats 归零；跨波 totalKillsAllWaves 快照幂等累计

---

## 8. 波次系统

### 8.1 波次配置契约
`WaveConfig` 结构（每张地图独立 waves 数组）：
```json
{
  "waveIndex": 1,
  "placementPerWave": 5,
  "rewardGold": 40,
  "isBossWave": false,
  "groups": [
    { "enemyId": 1, "count": 8, "interval": 0.8, "delay": 0 },
    { "enemyId": 2, "count": 3, "interval": 0.5, "delay": 4 }
  ]
}
```

### 8.2 Boss 波节奏 (V3-2)
- wave3（中盘 Boss）：小兵清完 → Boss 1 只 0.5s delay → reward≥100 金
- wave6（后期 Boss）：小兵密度↑ → Boss 1 只 → reward≥150 金
- wave8（最终 Boss）：多精英混编 + Boss + 特殊技能 → reward≥300 金

### 8.3 V4-4 精英扩散
草原 mapId=1 wave2/4/5/7 分别加入 1~2 只新精英（SHIELD/HEALER/SUMMONER/FAST/SPLITTER）；熔岩/冰霜地图精英更多更密集。

---

## 9. 经济与运气系统

### 9.1 金币来源
| 来源 | 规则 | 难度倍率 |
|------|------|:--------:|
| 击杀基础金 | enemy.killBaseGold × killGoldMulAll | × difficulty.goldMul |
| 击杀稀有度奖励 | luckLevel.bonusRarityWeights Roll：common=5/rare=15/epic=40/legendary=100；Boss Roll×2 | × difficulty.goldMul |
| 波末奖励 | waves[N].rewardGold | × difficulty.goldMul |
| 初始金 | 500（与难度无关） | - |

### 9.2 金币消耗
| 消费 | 价格 | 触发时机 |
|------|------|---------|
| 抽 Buff | 40 金/次（每波 ≤5） | WAVEEND 商店 |
| 升运气等级 | (下级等级) × 80 金（Lv10 封顶） | WAVEEND 商店 |
| 购买塔 | 120 金/次（每波 ≤2） | WAVEEND 商店 |
| 塔升级 L0→L1 | 40 金 | PREPARE/BATTLE/WAVEEND |
| 塔升级 L1→L2 | 80 金 | 同上 |
| 塔升级 L2→L3 | 120 金 | 同上 |

### 9.3 运气等级 (Luck Level 1~5 → V4 扩展 Lv10)

| Lv | 升级费 | towerRarityWeights (common/rare/epic/legendary) | bonusRarityWeights |
|----|--------|:--------------------------------------------:|:------------------:|
| 1 | 初始 | 70 / 25 / 4 / 1 | 70 / 25 / 4 / 1 |
| 2 | 60 金 (V2) → 80金×2(V4) | 55 / 35 / 8 / 2 | 60 / 32 / 6 / 2 |
| 3 | 120 → 80×3=240 | 40 / 45 / 12 / 3 | 50 / 38 / 9 / 3 |
| 4 | 240 → 80×4=320 | 25 / 50 / 20 / 5 | 38 / 44 / 14 / 4 |
| 5 | 500 → 80×5=400 | 10 / 50 / 30 / 10 | 25 / 45 / 22 / 8 |
| 6~10 (V4扩展) | 80×N 金/级 | 每级 rare/epic 递增，legendary 微增 | 同左 |

- **只在 WAVEEND 升级**：战斗阶段按钮灰。
- **每级可连续升**：金币充足可一键从 L1 升到 L5。
- **升级后立刻生效**：towerRarityWeights 在下次 Roll 候选塔时用新值；bonusRarityWeights 在下次 killEnemy Roll 时用新值。

---

## 10. 全局增益 Buff 系统

### 10.1 Roll 机制
- 单抽 40 金，按当前 luckLevel 的 `rollRarityWeights` 选稀有度 → 在 buffs[] 中按稀有度均匀抽取一条。
- **叠加规则**：同一 Buff 抽到重复，**乘法叠加**（atk_1 + atk_1 = 1.15×1.15 = 1.3225，收益边际递减避免数值爆炸）。
- 不同 Buff 之间**独立并存**（如 atk_1 + spd_1 互不影响）。

### 10.2 Buff 类型清单

| Buff | 稀有度 | 效果字段 | 数值 |
|------|--------|---------|------|
| 攻击增强 | common | towerDamageMulAll | ×1.15 |
| 射速提升 | common | towerAttackIntervalMulAll | ×0.83 |
| 击杀金币+ | rare | killGoldMulAll | ×1.20 |
| 减速强化 | rare | slowStrengthMulAll | ×1.20 |
| 范围扩大 | epic | towerRangeMulAll | ×1.20 |
| 基地护甲 | epic | baseDamageReduceMul | ×0.85 |
| 暴击光环 | legendary | critChanceAdd01 | +0.08 |
| AOE 半径+ | rare | aoeRadiusMulAdd | +0.20 |
| 击杀保底5金 | common | killBonusMinGold | +5 |
| 波末奖励+ | epic | waveRewardMul | ×1.15 |

### 10.3 Buff 生效点
- `calcTowerEffective(towerCfg, mul)` 在 G1-G5（伤害/间隔/范围/减速/DPS）所有计算尾部把对应的 Mul 乘入。
- Buff 清单 UI：HUD 侧边栏「激活 Buff」列出名称 × 层数（例如 `攻击增强 ×3 = ×1.52`）。

---

## 11. 波次商店系统 (V4-6)

### 11.1 WAVEEND Modal 结构
```
┌──────── waveend-modal ──────────┐
│ 标题：第 N 波结算 · 波末奖励 +X 金 │
│                                  │
│ [Tab1 抽Buff] [Tab2 升运气]      │
│ [Tab3 购买塔] [Tab4 下波预览]    │ ← 4 Tab
│                                  │
│ ── Tab 内容区 ───────────────── │
│                                  │
│                                  │
│ 金币：XXXXX                      │
│ [■ 开始下一波 ■]  ← 底部大按钮    │
└──────────────────────────────────┘
```

### 11.2 四 Tab 详情
| Tab | 内容 | 价格/规则 |
|-----|------|----------|
| 抽 Buff | 大抽奖按钮 + 已有 Buff 清单 + 历史结果 | 40金/次，每波≤5，金币不足灰 |
| 升运气 | 当前 Lv X / 下一 Lv 升级费 / 稀有度权重对比表 / 连升多级按钮 | 下一级 (Lv+1) × 80 金，Lv.10封顶 |
| 购买塔 | 点【购买 120 金】→ 进入 canvas 购买塔模式 → 点空地 Roll 落地真塔 | 120金/次，每波≤2，走 terrainGate |
| 下波预览 | 表格：敌人图标 / 名称 / 数量 / 延迟 / 是否 Boss；总波次进度条 | 免费，永久可查 |

---

## 12. 账号与存档系统 (V3-1 + V4-1 升级)

### 12.1 鉴权 (JWT SSO 单点互斥)
- `POST /api/auth/register` (username + password bcrypt) → `{token, uid}`
- `POST /api/auth/login` → `{token}`；密码错误 401
- JWT 7 天过期，HS256，secret 从 env 读
- **单点登录互斥**：
  - `Redis key = sess:{uid}`，TTL 7 天，value = jti（JWT Token ID）
  - 每次鉴权中间件校验：Redis jti == 请求 JWT.jti？不等 → 401「账号已在别处登录」
  - 新登录时覆盖 Redis jti → 旧 token 立即失效

### 12.2 限流与验证码 (Redis)
- 登录限流：`login:lim:{ip}` Redis key 计数，1h ≤ 10 次
- 短信验证码（预留接口）：`sms:{phone}` TTL 5min

### 12.3 云存档 (V3-1 + V4 复合主键)

#### DB Schema (save_records)
```
PRIMARY KEY (uid, map_id, difficulty)  ← V4 新增，9 组合独立存档
  uid BIGINT         ─ 用户 ID
  map_id INT         ─ 地图 ID (1/2/3)
  difficulty VARCHAR ─ normal/hard/nightmare
  save_json MEDIUMTEXT ─ 存档 JSON payload
  updated_at DATETIME(3) ← 乐观锁 ifMatchUpdatedAt
```

#### users 表 V4 新增列
```
  unlocked_maps JSON        ─ ["map1", "map2"] 已解锁地图
  talent_nodes JSON         ─ ["atk1","surv2",...] 天赋节点
  talent_points_available INT ─ 剩余天赋点
```

#### Save JSON Payload (v2)
```json
{
  "version": 2,
  "mapId": 1,
  "difficulty": "normal",
  "phase": "PREPARE",
  "waveIndex": 3,
  "placementUsed": 2,
  "gold": 820,
  "baseHP": 17,
  "baseMaxHP": 20,
  "luckLevel": 3,
  "tiles": [0,1,0,...],
  "grid": [null, {towerCfgId, level, rollEffect, damageDealt, kills, rarity}, null, ...],
  "activeBuffs": [{id, rarity, effect}, ...],
  "totalKillsAllWaves": 42,
  "selection": { /* 候选塔/保留态快照 */ },
  "ifMatchUpdatedAt": "2026-08-23T01:23:45.123Z"
}
```

#### 存档防作弊
- **阶段锁定**：BATTLE 阶段 `GET/POST /api/save` 返回 403「战斗中不可读/写档」
- **手动 save/load 细化**：PREPARE 且 placementUsed > 0 → 禁止（防无限重 Roll；RESERVE 阶段同样禁止）
- **乐观锁**：写档必须带 `ifMatchUpdatedAt`，服务端比对 `!= updated_at` → 409「进度已被其他标签覆盖，请刷新」
- **doLogout 全清**：登出时 resetLevelState 清空 phase/gold/tiles/grid/enemies/buffs/RAF/弹窗/ifMatchUpdatedAt，再清 JWT

#### 自动保存
- 每进入 WAVEEND 时自动 autosave 写入存档槽
- LOSE 结局弹框显示「从最近 autosave 恢复」按钮
- WIN / LOSE 结局 autosave + 同时上报排行榜

---

## 13. 天赋树系统 (V4-7)

### 13.1 天赋点获取
- 每通 1 波（WAVEEND 发放）账号级 +1 点，累计上限 15 点
- 老账号按「历史已通最高波数」批量补齐
- V4 users 表：`talent_points_available INT` + `talent_nodes JSON`

### 13.2 三条天赋线（每条 5 点，共 15 点）

#### 塔强化线 (Offense · 左)
| 节点 | 消耗 | 效果 |
|------|------|------|
| atk1 | 1 点 | 全塔伤害 +5% |
| atk2 | 1 点 | 全塔伤害再 +5%（累计 +10%） |
| atk3 | 1 点 | 全塔攻速 +5% |
| atk4 | 1 点 | 全塔攻速再 +5%（累计 +10%） |
| atk5 | 1 点 | 全塔范围 +8% |

#### 生存经济线 (Survival · 中)
| 节点 | 消耗 | 效果 |
|------|------|------|
| surv1 | 1 点 | 基地血量上限 +5 |
| surv2 | 1 点 | 初始金币 +30 |
| surv3 | 1 点 | 击杀金币 +10% |
| surv4 | 1 点 | 波末奖励 +15% |
| surv5 | 1 点 | 每波免费拆墙次数 +1 |

#### 控制线 (Control · 右)
| 节点 | 消耗 | 效果 |
|------|------|------|
| ctrl1 | 1 点 | 减速效果 +5% |
| ctrl2 | 1 点 | AOE 半径 +5% |
| ctrl3 | 1 点 | 冰霜地图：敌人 HP 上限 -5% |
| ctrl4 | 1 点 | 熔岩伤害翻倍 |
| ctrl5 | 1 点 | B 类合成 10% 概率稀有度跳两级 |

### 13.3 UI 交互
- HUD 最左：「🎄 天赋」按钮 → 全屏树状图（3 条竖线 × 5 节点）
- 节点未点亮：暗色，点击弹出「点亮该节点？消耗 1 天赋点」确认框
- 节点已点亮：高亮彩色，点击无反应（V4 不提供洗点）
- 天赋配置开局加载，缓存到 `state.talentMul`，作用于 calcTowerEffective / 经济结算

---

## 14. 排行榜系统 (V4-7)

### 14.1 数据结构

#### MySQL 表 leaderboard_records
```
  id BIGINT AUTO_INCREMENT PK
  uid BIGINT FK→users.id
  map_id INT
  difficulty VARCHAR(16)
  record_type ENUM('highestWave', 'fastestClearSec', 'totalKills')
  score BIGINT
  created_at DATETIME(3)
  updated_at DATETIME(3)
  UNIQUE KEY (uid, map_id, difficulty, record_type)
```

#### Redis ZSet 热榜
```
Key:   lb:{mapId}:{difficulty}:{recordType}
Member: uid
Score:  score (最高波/最快秒/总击杀)
TTL:   1 小时（懒加载，DB 回源）
```

### 14.2 上报时机 & API
- **触发**：WIN / LOSE 结局弹框出现前
- **上报内容**：
  - highestWave = state.waveIndex
  - fastestClearSec = WIN 时战斗阶段累计秒数（BATTLE 总耗时，不含 PREPARE/MENU）
  - totalKills = state.totalKillsAllWaves
- **API**：
  - `POST /api/lb/submit` (JWT) → 后端 upsert DB + Redis ZADD（仅新分 > 旧分才更新，幂等）
  - `GET /api/lb?mapId=1&difficulty=normal&type=highestWave&page=0&pageSize=20` → 返回 Top20[] + 当前 uid 排名 + 当前 uid 分数

### 14.3 UI
- HUD「🏆 榜」按钮 → 排行榜弹框
- 顶部 3 下拉：地图 / 难度 / 榜单类型
- 列表：# 排名 · 昵称 · 分数（最高波/秒数/击杀数）+ 自己排名高亮行
- 底部翻页按钮

---

## 15. UI/UX 设计规范

### 15.1 整体布局 (V4 + 2026-08-24 极简 HUD 收纳版)

```
┌─ .app-v2 (单栏·单列·100vh，canvas 占据 90%+) ─────────────────────────── 100vh(dvh) ─┐
│ ┌── overlay HUD：不参与布局流，只盖在 canvas 四角 ───────────────────────────────────┐ │
│ │  [LEFT TOP]   🪙金币胶囊   ❤生命胶囊   🍀运气 Lv.胶囊                              │ │
│ │  [RIGHT TOP]                                              🌊波次胶囊  ☰ MENU 胶囊│ │
│ │  [CENTER]     ▶ 开始第 N 波 · 大按钮（MENU/PREPARE 显示；桌面居中/手机贴底）     │ │
│ │  [CENTER BTM] 放置/BOSS/存活状态 mini bar（仅 PREPARE/BATTLE）                     │ │
│ │  [TOP overlay] 进化配方提示条（仅 evolveMode）                                    │ │
│ └──────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                       │
│ ┌── .game-body / #stage 自适应容器（flex 1×1，画布水平垂直居中）─┐                 │ │
│ │ ┌ canvas(10:6 横屏紧凑网格，DPR高清，ResizeObserver自适应) ┐ │                 │ │
│ │ │ 草原背景 bg1.png(DPR适配平铺) / 10×6 格子 / S CP E 标记  │ │                 │ │
│ │ │ 塔格：真塔/候选/墙 + 稀有度角标 + Lv等级徽章 + 能量条      │ │                 │ │
│ │ │ 敌人/子弹/技能FX(陨石/冰屏/crit折线/ricochet连线)          │ │                 │ │
│ │ └──────────────────────────────────────────────────────────┘ │                 │ │
│ └──────────────────────────────────────────────────────────────┘                 │ │
│                                                                                       │
│ ┌── ☰ MENU DRAWER（点右上 ☰ 打开） 右入 360px ─────────────────────────┐             │
│ │  遮罩 .menu-mask rgba(2~23,0.22) + blur 3px（半透明毛玻璃 战斗可视） │             │
│ │ [头部] 宝石TD · ☰ MENU  ×关闭                                        │             │
│ │ ├─ SECTION 1 对局设置 ───────────────────────────────────────────────┤             │
│ │   难度 Tab 普通(绿)/困难(橙)/噩梦(红)  +  地图 Tab 草原/熔岩/冰霜    │             │
│ │   生效后摘要 chip：当前 草原-困难，敌人 HP×1.8 基地HP=15              │             │
│ │ ├─ SECTION 2 塔合成（三按钮横排）────────────────────────────────────┤             │
│ │   ⬆ 升级 (A类)  🧪 合成 (B类)  💠 进化 (C类)                         │             │
│ │ ├─ SECTION 3 账号/系统（6 按钮 3×2）─────────────────────────────────┤             │
│ │   🎯天赋  🏆排行榜  👤账号  💾保存  📂读档  🔄重开                    │             │
│ │ ├─ SECTION 4 全局 Buffs 列表 ───────────────────────────────────────┤             │
│ │ ├─ SECTION 5 对局读数（真塔/墙/DPS/总击杀）───────────────────────────┤             │
│ │ └─ SECTION 6 操作说明 + 消息日志（滚动区）───────────────────────────┘             │
└──────────────────────────────────────────────────────────────────────────────────────┘
旧 #hud 顶栏 / #left-panel / #right-panel：全部保留 DOM 但加 .h-hidden 隐藏或 display:none，保证后端旧 ID 脚本不报错。
```

- **app-v2**: `height:100vh / 100dvh fallback`（移动端浏览器 URL bar 动态高度适配）
- **#stage**: `min-width:0; min-height:0; display:flex; align-items:center; justify-content:center` → Canvas 水平垂直居中；布局不参与顶栏/侧栏预留
- **Canvas CSS**: `max-width:100%; max-height:100%; touch-action:none; image-rendering:pixelated; contain:layout paint`
- **Canvas HTML attr**: `width="480" height="288"`，`fitCanvasToContainer()` 根据容器 DPR 重新放大

### 15.2 HUD & ☰ 菜单抽屉 (Chip 仅留四角，其余全部入抽屉)

#### 画面四角固定 chip（不进抽屉，持续可见）
| 位置 | Chip | 格式 | 触发行为 |
|------|------|------|---------|
| 左上 · 胶囊1 | 🪙 金币 | `100`（金色大号） | — |
| 左上 · 胶囊2 | ❤ 生命 | `17 / 20` + hp-bar（渐变红→绿） | — |
| 左上 · 胶囊3 | 🍀 运气 | `Lv.3` | — |
| 右上 · 胶囊1 | 🌊 波次 | `3 / 8`（BOSS 波 ★ 后缀 + 橙边） | — |
| 右上 · 胶囊2 | ☰ 菜单 | `☰ MENU`（半透明毛玻璃胶囊） | 点击开右侧抽屉（见上表结构）；遮罩点击 / ESC 关闭 |

#### ☰ 菜单抽屉条目一览
| 分区（自上而下） | 子内容 |
|-----|--------|
| 1. 对局设置 | 难度 3 Tab + 地图 3 Tab（锁定/解锁走 unlocked_maps 规则）+ 当前生效摘要 chip |
| 2. 塔合成 | ⬆ 升级(A) / 🧪 合成(B) / 💠 进化(C)，disabled 条件同 V4-3（塔数量门槛） |
| 3. 账号/系统 | 🎯天赋 / 🏆排行榜 / 👤账号 / 💾保存 / 📂读档 / 🔄重开（3×2 网格按钮） |
| 4. Buffs | 激活全局 Buff chip 列表（类型×层数+累积倍率）+ 新增高亮动画 |
| 5. 对局读数 | 🏗真塔N / 🧱墙M / ⚔总DPS / ☠总击杀 |
| 6. 操作说明 + 消息日志 | 1 段可折叠说明；下方 200 行滚动日志（[放置1/5]、[升级成功] 等） |

#### ▶ 开始按钮 · 生命周期 (V4-11：移至右上角菜单旁)
- **位置与形态**：位于右上角 `#hud-top-right` 内、菜单按钮（☰）左侧；缩小为圆形 **▶ 三角图标、无文字**（`.h-start-btn`，min 40×40px，title 提示完整语义）
- **显示时机**：
  - MENU 阶段：显示（title「开始第 N 波」）
  - PREPARE / BATTLE / WAVEEND：自动隐藏（PREPARE 引导语指向塔详情「保留/合成」操作）
  - WIN/LOSE：显示（title「🏆 通关！点击再来一局 / 💥 失败，点击重开」），点击 fullReset
- **历史**：~~中央大按钮 + 移动端贴底自适应（bafe141）~~ 已被 V4-11 右上角小三角替代；画布中央区域完全让给放塔热区。
- **视觉**：所有遮罩层 + 弹框主体都用**半透明毛玻璃**（`rgba(15~30, 0.62~0.78) + backdrop-filter: blur(12~16px)`），战斗画面不被完全遮挡；塔详情 modal 遮罩更薄（alpha 0.12~0.18），盖在菜单抽屉之上。

### 15.3 Canvas 交互规则
- **悬停**：
  - 草地(可放置)：绿半透明高亮 + 范围圈(若是放置模式)
  - 不可放置(石头/路径封死)：红半透明高亮
  - 真塔：蓝半透明 + Buff 后范围圈
- **点击**（按阶段状态机 §3.1）：
  - 放置模式 → 放候选塔 Roll
  - 购买塔模式 → 落地真塔
  - 合成模式 → 加入 selection + 高亮 ①②③ 角标
  - 普通模式 → 打开塔信息弹框
- **Canvas 坐标归一化**：点击位置 → 减去 canvas bounding rect offset → 缩放到逻辑像素（CSS 缩放比例）→ 除以 cellPx → 得到 (col,row)。确保 DPR 和 CSS 缩放后点击不偏移。
- **移动端触屏合成 click（bafe141 修复）**：
  - touchstart 记录 _tapX/_tapY
  - touchmove 判定：**`|Δx|>25px || |Δy|>25px` 才算滑动**（原 10px 太小，手指微抖 10~20px 就把有效 tap 吞掉）
  - touchend：未标记 _moved → 合成一次 click 到 onCanvasClick
  - 长按（≥500ms）仍为塔详情弹框；双指捏合缩放 canvas 0.5×~1.5×

### 15.4 塔信息弹框 (V3-6 精细化 + V4-9 伤害类型标签 + V4-11 操作按钮重构 + 毛玻璃)

```
┌─ tower-info-modal（毛玻璃半透明 rgba 0.62，blur 16px，蓝色半透明描边） ──┐
│ [稀有度角标] [塔名] Lv.X [特殊效果金标]  [⚡能量: 78/100 满技能名]       │
│ 类型：XX塔 · 元素：XX · 伤害类型：(物理 / 魔法 / 真实) · 策略：[最近▼]  │
│──────────────────────────────────────────────────────────────────────│
│ 伤害       66（40） · 物理 [魔法紫/真实金色]    ← 加类型标签 + 颜色区分│
│ 攻击间隔   1.05（1.20） 秒                                               │
│ 攻击范围   2.42（2.20） 格 ≈ 87 px                                      │
│ 减速效果   31.5%（30%）·2.10（2.00）秒  （实际来自 gems.baseBonus 配置）│
│ ───────────────────────────────────────────────────────────────────── │
│ [技能] 双倍打击（damage×2.00，下一攻击释放）                              │ ← V4-8 新增
│ ───────────────────────────────────────────────────────────────────── │
│ DPS(估算)  63                                                            │ ← 金色大字
│ ───────────────────────────────────────────────────────────────────── │
│ 本波伤害：248   本波击杀：4                                              │
│ 上波伤害#2：310  上波击杀#2：6                                           │ ← WAVEEND/WIN/LOSE 才显示
│ ───────────────────────────────────────────────────────────────────── │
│ 当前总DPS：138  本波总击杀：8          ← 全局合计三行                    │
│ 累计总击杀：42                                                           │
│ ───────────────────────────────────────────────────────────────────── │
│ 已获得特殊效果：⚔进攻狂潮   ← L3 显示                                   │
│   伤害 +40%，范围 +15%                                                   │
│ ───────────────────────────────────────────────────────────────────── │
│ [策略: 最近▼]                                                            │
│ [🧪 合成] [💠 进化] [📌 保留本塔] [解锁L3特效(-120金)]  ← V4-11        │
│   ↑ 四个操作按钮全部「有可用操作才显示，不能操作不显示」：               │
│     合成/进化/保留：仅 PREPARE 放满5塔的保留/合成窗口内且条件满足        │
│     保留：仅本波候选塔；合成/进化：本塔可作材料且其余材料可凑齐          │
│     解锁L3：仅真塔 + PREPARE/WAVEEND + 金币≥120 + 未解锁                │
│ [关闭]                                                                  │
└──────────────────────────────────────────────────────────────────────────┘
  · 位置：根据塔在画布左/右半边自动切换；空间不够就切另一侧（V3-6 已做）
  · 毛玻璃遮罩：alpha < 0.2，塔详情仍能看到下方敌人/子弹移动
  · z-index：60（盖在菜单抽屉 mask 之上，避免被菜单遮罩盖到）
```

### 15.5 关键弹框清单（全部采用半透明毛玻璃背景 + 薄遮罩 blur）

| 弹框 | 触发时机 | 结构要点 |
|------|---------|---------|
| ☰ 菜单抽屉 (DRAWER) | 右上 ☰ MENU / 热键 ESC 关闭 | 6 分区（§15.2 抽屉结构）；遮罩 alpha≈0.22 blur3px；抽屉主体 alpha≈0.72 blur14px |
| 登录/注册 | 未登录点击昵称 | 表单+bcrypt；token 存 localStorage |
| ~~升级预览 (A类)~~ | ~~2 同塔选满~~ | **V4-11 已下线**（A 类升级整体移除） |
| 合成确认 (B类) | 塔详情发起 → 3 异塔选满 | 左：3 源塔卡；右：大字「产物稀有度 ★★ rare」不显示塔类型；取消/确认；确认后其余候选变墙开战 |
| 进化预览 (C类) | 塔详情发起 → 3 塔满+配方命中 | 顶部 C-FUSION 配方标；中间产物特殊塔卡片+效果说明；3 源塔卡；取消/确认；确认后其余候选变墙开战 |
| 进化配方提示条 | 进化模式开启 | sticky 画布顶；5 Tab；每 Tab 三材料✅❌ 可用×2 计数 |
| L3 特殊效果 Roll 动画 | 塔详情点「解锁 L3 特效(-120金)」确认 | Canvas 覆盖层 5 图标 1.2s 快速切换 → 定格 → 结果卡 |
| WAVEEND 商店 | 波末 | §11.1 结构，4 Tab |
| 天赋树 | 点 🎄 | 全屏 3 竖线 × 5 节点；已点亮彩色 |
| 排行榜 | 点 🏆 | 3 下拉 + 列表 + 自己行高亮 |
| DPS 榜 (波末/结局) | WAVEEND 内或结局弹框 | 顶部汇总条 3 栏：当前总DPS/本波击杀/累计击杀；下方5列排行：#/塔名/伤害/占比/击杀 |
| WIN/LOSE 结局 | 基地≤0 或 全波清完 | 覆盖 Canvas，阻断操作；本局统计(DPS榜/最高波/运气等级/总击杀) + 重开/返回菜单/从 autosave 恢复 |
| **塔详情 (半透明超薄)** | 点真塔 | 见 §15.4 ASCII；遮罩 alpha≈0.12（战斗画面几乎可见）；主体 alpha≈0.62 蓝描边 |

> 遮罩层一致性：所有弹框的 mask 统一 `rgba(2,6,23, 0.12 ~ 0.22) + backdrop-filter: blur(1.5~3px) saturate(1.05)`，避免全黑遮挡影响战斗观察。

---

## 16. 渲染与动画系统

### 16.1 Canvas 2D 核心绘制 (主路径)
渲染顺序 (Z 轴从底到顶)：
1. **地图层**：Tile 背景颜色（草地绿 / 石头灰 / 熔岩橙红 / 冰蓝）
2. **路径 & 检查点**：S(绿标)、CP1/CP2(黄标)、E(红标)；路径浅灰底
3. **石墙 / 玩家墙**：石头纹理格；玩家墙 = 棕色方块 + 🧱 emoji 小标
4. **塔**：方块本体 + 元素色边框 + 稀有度角标(绿/蓝/紫/金) + L3 特殊效果金标(⚔❄✦★⚡) + 真塔等级条
5. **塔攻击动画**：塔格底部中心 6 帧 18fps sprite 播放（≈0.33s，自动销毁）
6. **候选塔 / selection 角标**：半透明 + ①②③ 数字
7. **子弹**：小方块/圆 + 元素色
8. **敌人**：圆/方 + 元素色 + HP bar(1.6× Boss) + [BOSS]角标
9. **范围圈 / 冰冻预警 / 陨石预警红圈**
10. **Flash 特效**：合成/进化成功 径向渐变扩散 0.6s

### 16.2 帧动画系统 (塔攻击：替代 Spine 低成本方案)

#### FrameAnimationPlayer (td-animation.js 单例，window.animPlayer)
- 加载模式：`loadTP(jsonURL, pngURL)` → 解析 TexturePacker/FramePacker Hash 格式 JSON
- 播放模式：`none`(一次) / `loop`(循环) / `pingpong`
- 实例管理：`spawn(animId, x, y, scale?)` → 返回 instance；动画结束自动销毁（none 模式）
- DPR 支持：绘制时自动乘以 `state._dpr`

#### 塔攻击动画素材
- 路径：`/assets/png/spritesheet_1.json` + `spritesheet_1.png`
- 规格：6 帧 / 18 fps / FramePacker Hash 格式 / 单帧 720×720 / 图集 4096×2048
- 配置：`defaultScale = 64/720 ≈ 0.0889`（适配 48px 格子）
- 位置锚点：`{x:0.5, y:1.0}` → 对应格子底部中心（`cellTowerAnchorPx` 函数）
- 触发：`fireTowerBullet` 时，若 `animPlayer.hasAnim('towerAttack')` → spawn 一次攻击动画
- 加载降级：加载失败无感降级（无动画，但正常发射子弹）

### 16.3 Spine 动画接入 (V4-7 · Canvas 2D 降级保障)
- **初始化顺序**：`spineManager.init(canvas)` 优先尝试 WebGL 上下文 → 成功则在 canvas 上叠加 z-index 更高的 Spine 画布
- **三类绑定**：
  - 塔：idle 待机 + attack 攻击（0.3s → 回 idle）
  - 敌人：walk 行走 + death 死亡
  - BOSS 技能：meteor 陨石粒子 / ice 冰冻 shader 叠加
- **降级策略**：任何一步失败（spine-webgl.js 没加载 / 资源 404 / WebGL 不支持）→ `state.renderMode = 'canvas2d'`，完全走 §16.1 Canvas 2D 主路径，仅 console.warn 但玩家无感知

### 16.4 ResizeObserver & 自适应 (V4 版)
```
fitCanvasToContainer() {
  containerWidth = stage.clientWidth;   // box-sizing:border-box; padding 不计
  containerHeight = stage.clientHeight;
  cellPx = floor(min(containerWidth / cfg.gridWidth, containerHeight / cfg.gridHeight));
  cellPx = clamp(cellPx, 12, 3 * cfg.cellSize);  // [12, 144]
  canvas.attr.width = gridWidth * cellPx * dpr;   // HTML width*height = 像素尺寸
  canvas.attr.height = gridHeight * cellPx * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);         // 后续绘制用逻辑像素
}
ensureResizeObserver() {
  if ResizeObserver 可用 → new RO(debounce 80ms → fit + redraw)
  else fallback → window resize + orientationchange events
}
```

---

## 17. 移动端适配 + 部署可用性 (V4-7 + 2026-08-24 热修)

### 17.1 Viewport & Canvas
- `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">`
- 约 iPhone 14 (390×844) 下 cellPx ≈ 39px（10 列 × 39 = 390 宽），适合手指点击
- `body { -webkit-user-select:none; user-select:none; touch-action:manipulation }`（禁止长按选中 + 双击缩放）
- `gesturestart / gesturechange / gestureend` → preventDefault；`touchmove` 整页滚动阻止（游戏全屏）

### 17.2 触屏手势 (bafe141 热修：阈值 10px → 25px)
| 手势 | 等价操作 | 判定规则（热修后） |
|------|---------|-----|
| 快速点击 | 鼠标左键点击（onCanvasClick：放塔 / 选塔 / 选合成材料） | touchstart 记录 (x,y)；**touchmove Δx>25 或 Δy>25px 才算滑动**（否则手指微抖 10~20px 仍有效 tap）；touchend 未标记 _moved → 合成 click |
| 长按（touchstart ≥ 500ms 不移动） | 点塔开信息弹框 | 位移阈值同（<25px） |
| 双指捏合 | 缩放 canvas CSS scale 0.5× ~ 1.5× | |

### 17.3 响应式 CSS（2026-08-24 UI收纳后，顶栏/左右栏已移除 → 只保留按钮尺寸与中央按钮）
- `@media (max-width: 600px), (pointer: coarse)`：
  - 所有按钮 `min-height: 44px; touch-action: manipulation`（iOS 可点区推荐）
  - **中央「▶ 开始第 N 波」大按钮 → 贴画布底部（`top:auto; bottom:6px; transform:translateX(-50%)`）+ 小胶囊 `padding:8px 18px; font-size:14px; border-radius:12px`**，避免挡放塔热区误触进入 RESERVE。
  - 四角 chip 字号压缩 1 级（12~13px），胶囊高度 ≤28px，保证不抢画布空间。

### 17.4 部署可用性 (bafe141 修复 TD_PORT + GOPROXY)

| 项 | 规格 |
|---|---|
| **服务端口** | `TD_PORT` 环境变量可覆盖，缺省 `8080`。main.go：`port = ":" + os.Getenv("TD_PORT")`，空串回退 `:8080`。与 Dockerfile / docker-compose.yml 的 `TD_PORT` 变量声明一致。 |
| **Docker build 加速** | Dockerfile builder 阶段：`ENV GOPROXY=https://goproxy.cn,direct`，国内环境 `go mod download` 不会因 proxy.golang.org 不可达而超时。 |
| **日志轮转** | `logs/server-YYYY-MM-DD.log`，main.go 用 `dailyLogWriter` 按自然日切分。容器部署：Dockerfile 提前 `mkdir /app/logs` 并给运行期写入权限。 |
| **静态资源**：`COPY conf/assets /app/conf/assets`、`COPY conf/game /app/conf/game`，Docker 运行期改 JSON 配置不需要重新 build（只要 reload 接口 + 重启）。 |

---


## 18. 配置契约总览

### 18.1 后端配置接口 (12 API，新增 energy-cfgs / tower-skills)
全部为 `GET /api/config/*`，缺字段 V3 fallback 解析合法（空数组 / 0 / null）：

| API | 返回结构 | 关键字段 |
|-----|---------|---------|
| `/maps` | MapSummary[] | id, name, unlockCondition, environmentId |
| `/maps/:id/detail` | MapDetail | gridW=10, gridH=6, cellSize=48, tiles[], spawnPoints, base, checkpoints[], environment |
| `/maps/:id/waves` | WaveConfig[] | placementPerWave, rewardGold, isBossWave, groups[].{enemyId,count,interval,delay,boss?} |
| `/towers` | TowerConfig[] (24普通 + 5特殊) | id, name, rarity, element, isSpecial, code, passiveId, passiveDesc, isAOE, aoeRadiusPx, levels[], **damageType, energyCfgId, skillId** |
| `/enemies` | EnemyConfig[] (12+) | id, name, type, isBoss, isElite, baseHP, speed, **armor(点数制)**, **magicResist(0~100)**, resistances{}, shield, healPerSec, summonEveryN, splitInto, skills[] |
| `/gems` | GemConfig[] (5×4) | elem, level, bonus, dropWeight, **elements[].baseBonus** |
| `/waves/:mapId` | (旧接口等同 maps/:id/waves) | 兼容 |
| `/luck` | LuckConfig | initialLevel, levels[].{level, upgradeCostGold, towerRarityWeights, bonusRarityWeights, rollRarityWeights} |
| `/buffs` | BuffConfig | rollCostGold, buffs[].{id,name,rarity,effect{...}}, rollRarityWeights |
| `/special-towers` | SpecialTower[] (5) | special:true + 被动/光环描述 |
| `/recipes` | SynRecipe[] (5) | id, fixedRarity, inputs[{towerCfgId,rarity}], outputTowerCfgId, label |
| `/energy-cfgs`（V4-8 新增） | `{id: TowerEnergyCfg}` | energyMax, energyPerAttack, energyPerSecond |
| `/tower-skills`（V4-8 新增） | `{id: TowerSkill}` | name, desc, damageMul, armorIgnorePct01, magicResistIgnorePct01, slowMul01, slowTicksSec |

### 18.2 后端功能 API
| Method/Path | 功能 | 鉴权 |
|------------|------|------|
| `POST /api/auth/register` | 注册 | × |
| `POST /api/auth/login` | 登录 | × |
| `GET/POST /api/auth/logout` | 登出(S Redis sess key) | ✓ JWT |
| `GET /api/account/me` | 账号信息 + unlocked_maps + talent | ✓ |
| `GET /api/save?mapId=1&difficulty=normal` | 读存档 (BATTLE 403, PREPARE placementUsed>0 403) | ✓ |
| `POST /api/save` | 写存档 (含 ifMatchUpdatedAt, BATTLE 403) | ✓ |
| `POST /api/lb/submit` | 提交排行榜 | ✓ |
| `GET /api/lb?mapId=1&difficulty=normal&type=highestWave` | 查排行榜 Top | × (但含 uid 排名需 JWT) |
| `GET /api/health` | 健康检查 | × |

### 18.3 配置 JSON 文件 (conf/game/)
```
conf/game/
├── towers.json          (24 普通 + 5 特殊 = 29 条)· damageType/energyCfgId/skillId 三键
├── enemies.json         (12+ 条: armor=点数、新增 magicResist 0~100)
├── gems.json            (5×4) + elements[].baseBonus (V4-9 唯一配置源)
├── maps-list.json       (3 张地图 summary)
├── map-1.json / map-2.json / map-3.json  (detail+tiles+checkpoints)
├── waves-1.json / waves-2.json / waves-3.json  (独立 8 波)
├── luck.json            (Lv1~10)
├── buffs.json           (10+ Buff + rollRarityWeights)
├── special-towers.json  (5 条被动/光环)
├── recipes.json         (5 配方 C-FUSION ~ C-RAIGATEKI)
├── energy-cfgs.json     (V4-8 能量预设 4 条：normal/fast/slow/ultra_fast)
├── tower-skills.json    (V4-8 技能库：double_strike/heavy_strike/armor_pierce/frost_explosion …)
└── td-config-fallback.js  (前端 fallback：和后端返回 100% 字段对齐)
```

### 18.4 V4-8 & V4-9 新增配置详解
#### 18.4.1 energy-cfgs.json（能量预设）
```json
{
  "normal":     { "energyMax":100, "energyPerAttack":1, "energyPerSecond":1 },
  "fast":       { "energyMax": 80, "energyPerAttack":2, "energyPerSecond":1.5 },
  "slow":       { "energyMax":150, "energyPerAttack":1, "energyPerSecond":0.6 },
  "ultra_fast": { "energyMax": 50, "energyPerAttack":3, "energyPerSecond":2.5 }
}
```
- **fallback**：塔未配置 energyCfgId 或 /energy-cfgs 缺字段 → 用 `normal`（100/1/1）保证不配置零影响。

#### 18.4.2 tower-skills.json（技能库）
```json
{
  "double_strike":   { "id":"double_strike",   "name":"双倍打击", "desc":"能量满后下次攻击伤害翻倍",
                       "damageMul":2.0, "armorIgnorePct01":0, "magicResistIgnorePct01":0, "slowMul01":0, "slowTicksSec":0 },
  "heavy_strike":    { "damageMul":2.8, "armorIgnorePct01":0.5, /*...*/ "name":"重击", "desc":"2.8倍伤害 + 无视半甲" },
  "armor_pierce":    { "damageMul":1.2, "armorIgnorePct01":1.0, "magicResistIgnorePct01":1.0, "name":"穿甲" },
  "frost_explosion": { "damageMul":1.3, "slowMul01":0.4, "slowTicksSec":2, "name":"冰爆术", "desc":"伤害 1.3×，并减速 40%×2s" }
}
```
- **fallback**：塔未配置 skillId → 用 `double_strike`（保持旧版"双倍"默认行为）。

#### 18.4.3 gems.json elements[].baseBonus（元素减速/掉率 唯一配置源）
```json
{
  "elements": [
    { "id":"ice",    "baseBonus":{ "slowOnHitPct01":0.30, "slowOnHitSec":2.0, "killGemChanceAdd01":0.0  } },
    { "id":"poison", "baseBonus":{ "slowOnHitPct01":0.20, "slowOnHitSec":1.5, "killGemChanceAdd01":0.0  } },
    { "id":"light",  "baseBonus":{ "killGemChanceAdd01":0.15 } },
    { "id":"dark",   "baseBonus":{ "killGemChanceAdd01":0.10 } }
  ]
}
```
- **兜底**：字段缺省 / 非法 → 仍按上表硬编码默认值兜底（前端不会零减速）。
- **前端用途统一**：`isSlowTower`、塔信息「减速效果」、命中减速效果、`killEnemy` 击杀掉率加成 — **4 处全从 getElementBonus() 拿值**，不再硬编码 `element==='ice'`。

#### 18.4.4 towers.json 三新键（damageType / energyCfgId / skillId）
```json
{
  "id": "ARCHER",
  "damageType":  "physical",          // physical | magic | true（默认 physical）
  "energyCfgId": "fast",              // 引用 energy-cfgs.json
  "skillId":     "heavy_strike",      // 引用 tower-skills.json
  "...基础字段不变..."
}
```
- damageType 空/非法 → 前端 resolveTower() 一律回退 physical，**不会出现未定义行为**。
- energyCfgId / skillId 空 → 用 18.4.1 / 18.4.2 fallback。

#### 18.4.5 enemies.json 字段破坏性变更提醒 ⚠
- **armor 语义变更：从乘区百分比小数 (0~0.99) → 纯点数减法（0~∞）**。
  - 例：enemies.json 原 normal 兵 `armor: 0.28` 在新公式下几乎无护甲（28 点伤害才能扣掉 1 点），请重新整体标定：
    - common 小兵：8~15 点
    - 精英（盾/治疗/召唤）：20~40 点
    - 快速兵（FAST）：4~8 点
    - BOSS 1/2/3：40~80 / 80~120 / 150~200 点
- **新增 magicResist：0~100（超范围自动 clamp）**。常见建议：物理敌人默认 20~30，精英法师型 60，BOSS 按主题（冰霜女王=80）。

---

## 19. 战斗伤害体系 V4-9（三分支 + 元素配置化）

本章节与 V4 spec.md 的 V4-8 / V4-9 FR 保持一致。下面总结为 4 个关键不变量、1 个破坏性变更、2 个配置驱动一致性：

| 编号 | 不变量 / 规则 | 违反判定（应修复） |
|-----|------|------|
| INV-1 | **物理减甲点数减法**：typed_damage = max(1, baseDmg − armor_actual) | 旧公式 (1-armor*0.5) 残留在任何路径 |
| INV-2 | **魔法法抗百分比**：typed_damage = baseDmg × (1 − mrActual/100)，且 mr∈[0,100] clamp | 出现 >100% 减免 或 typed 负数 |
| INV-3 | **真实无视双抗**：typed_damage = baseDmg（不扣 armor 也不扣 magicResist） | 真实塔 typed 不等于 baseDmg |
| INV-4 | **所有攻击路径都走同一套类型公式**：常规 / DoubleShot / ricochet 最后一跳 / crit / finalDamageOverride 预结算 | 任何一条路径直接乘 (1-armor*0.5) 旧公式 |
| INV-5 | **元素抗性作为独立维度**： typed × (1−resistances[elem])，且三类型都应用 | 真实/魔法不乘元素抗、或任何路径漏乘 |
| INV-6 | **伤害类型 / 技能 / 能量三键缺省都有兜底**：缺 damageType→physical；缺 energyCfgId→normal；缺 skillId→double_strike | 开局抛异常或数值 0/NaN |

破坏性变更 1 条（已在 18.4.5 再次强调）：
- armor 从乘区小数改为点数：**必须重标 enemies.json**，否则所有"物理打物理兵"都会接近真实伤害全穿。

配置驱动一致性 2 条：
1. **减速 / 掉率加成**：`getElementBonus(element)` 从 gems.json elements[].baseBonus 读取，且 4 处前端调用点统一（不再出现 `element==='ice'||'poison'` 硬编码）。
2. **技能 4 类参数**（damageMul / armorIgnore / magicResistIgnore / slowMul·slowTicksSec）：技能只配置一次，任何 tower 只要 skillId 相同，行为就一致（技能跨塔复用解耦）。

---


## 20. 验收标准摘要

综合所有版本 AC（MVP ~ V4.2 2026-08-24），核心验收 44 条关键规则：

### 玩法流程 (10)
1. **放置-保留-战斗循环**：PREPARE 5 次放置 → RESERVE 选 1 保留 → terrainGate 封死则拒绝 → BATTLE 敌人出怪 → WAVEEND 商店，状态机阶段条文本正确。
2. **封死拒绝**：在 S→CP1→CP2→E 任一段路径上尝试用 4 座墙堵死 → RESERVE 提交拒绝 + msg 红字，tiles 不变。
3. **胜利/失败遮罩**：基地 HP≤0 → LOSE；wave8 清完 → WIN；遮罩阻断所有操作 + 重开回初始。
4. **难度倍率生效**：困难开局敌人 HP 1.8×(±5%) 普通、速度 1.15×、基地 HP 上限 15。
5. **难度锁定**：第一波 BATTLE 开始后改难度芯片 → 切换不生效（state.difficulty 不变）。
6. **存档分桶**：同账号「草原普通」保存值 X，切「草原困难」读档值 ≠ X（是初始值）。
7. **地图环境 Buff**：冰霜开局塔攻速 +5% / 草原塔范围 +5% / 熔岩 Tile 走 1s 扣 ≥10 HP。
8. **地图解锁**：草原 ≥4 波 WIN 后熔岩 Tab 从 disabled → active；熔岩 ≥4 波冰霜激活。
9. **WAVEEND autosave**：第 3 波结束 500ms 后，`GET /api/save` 返回 `waveIndex=3`。
10. **BATTLE 禁存**：战斗中手动点存 → 403「战斗中不可写档」。

### 塔系统 (10，补能量&技能 2 条)
11. **A 类升级**：2 同 common ARCHER → modal 预览 rare ARCHER(max×1.25) → 落地最后点击素材格，稀有度显示 common→rare（canvas 角标 + 塔弹框标题同显示）。
12. **B 类合成**：3 异 common 塔 → modal 只显示「产物 rare」不显示塔名 → 落地 rarity=rare 且 towerCfgId.special=false。
13. **C 类进化**：PYRO+CRYO+ELECTRO → PREPARE 阶段进化按钮高光 → 配方提示条 C-FUSION 三材料 ✅ → 落地 FUSION_EPIC.special=true。
14. **特殊塔隔离**：100 次 rollTowerByLuckLevel() → 结果集中所有 special 为 false；100 次 B 类随机 → 同样 false。
15. **塔升级数值**：L0 baseDamage=100 → L1≈130 → L2≈169 → L3≈219.7（±2%）。
16. **L3 特殊效果**：双重打击 1 次攻击流程触发 2 次伤害事件（第二次 ×0.8 ±5%）；弹射 3 敌累计 3 条伤害（递减 60%/42%）。
17. **稀有度显示正确**：A 类升级后塔 canvas 角标色 + 塔弹框标题的「[稀有]」与 `gridObj.rarity` 一致（不是 towerCfg.rarity）。
18. **C 进化配方匹配升级塔**：升级后的 actualRarity 用于配方匹配 slot（不用原始 towerCfg.rarity）。
19. **塔能量积累 + 技能触发（V4-8）**：energyCfgId 缺省塔 = normal（100/1/1）；战斗 tick 50s + 命中 50 次 → energy≥100 且 `skillReady=true`；下一次 fireTowerBullet 子弹携带 `energySkillActive=true`；命中瞬间 energy 清零。
20. **技能跨塔复用生效**：T1 配 `skillId=heavy_strike`、T2 配 `skillId=frost_explosion` 同时开火 1 次 → T1 命中伤害倍率=heavy.damageMul、T2 命中 2s 内敌人 slowPct ≥ frost.slowMul01（技能参数完全按 skillId 生效）。

### 敌战斗 & 伤害体系 (10，补 V4-9 三分支 4 条)
21. **BOSS 视觉**：wave3 Boss canvas 有 [BOSS] 文本角标像素 + 宽 HP bar 深红像素。
22. **BOSS Roll×2**：击杀 Boss 日志匹配 `/★击杀 Boss.*Roll1→\[.*\].*Roll2→\[.*\]/`。
23. **护盾兵**：40 点伤害 → shield=0 且 HP=90。
24. **治疗师**：2 秒 → FAST.hp ≥ baseHP×0.7。
25. **BOSS 2 陨石眩晕**：命中格塔 `stunUntil > now - 1s`。
26. **BOSS 3 冰冻**：2s 内 `enemy.pos` 不变；后续 3s 速度 ≤ baseSpeed×0.5。
27. **物理减法护甲 (V4-9)**：damageType=physical，attack=100，enemy.armor=20 → finalDmg=80（±1）。技能穿甲 100% 时 → finalDmg=100。
28. **魔法法抗百分比 (V4-9)**：damageType=magic，attack=100，enemy.magicResist=50 → finalDmg=50。法穿 50% × 抗 80 → finalDmg = 100 × (1 - 40/100) = 60。
29. **真实伤害无视双抗 (V4-9)**：damageType=true，attack=100，enemy armor=100 magicResist=100 → finalDmg=100。
30. **伤害类型缺省/非法回退 physical (V4-9)**：damageType="" 或 "foo" → 最终结果与 physical 分支 100% 相同。
31. **元素抗性三类型都生效**：上述 27/28/29 任一塔元素 fire + enemy.resistances.fire=0.3 → finalDmg 都再 × 0.7。
32. **finalDamageOverride 路径同公式**：调用 damageEnemy(override=200, damageType=magic, enemy magicResist=50) → finalDmg=100（预结值过三分支+元素抗）。

### UI 收纳 & 移动端 & 半透明 (6)
33. **极简 HUD 四角 chip**：applyCfg 后画面 **左上=金币/HP/运气 3 胶囊；右上=波次/☰菜单 2 胶囊**。旧 `#hud` / 左右侧栏 = CSS 隐藏或 DOM 保留不可见。
34. **☰菜单抽屉**：点 ☰ MENU → `.side-menu.open` 显示 + `.menu-mask` 半透明毛玻璃遮罩（alpha 0.22 + blur 3px）。点击遮罩空白 / 按 ESC → 关闭。抽屉 6 分区（对局设置 / 合成三按钮 / 账号6系统 / Buffs / 读数 / 日志）都能交互。
35. **中央 ▶ 开始按钮生命周期**：MENU 立即展示「▶ 开始第 1 波」→ 点按钮 phase 进入 PREPARE → placementUsed=0 按钮藏 → 放置 1 次塔后按钮重显「▶ 开始第 N 波」→ 点按钮隐藏并进入 RESERVE 保留弹框。
36. **移动端阈值 25px**：模拟触屏 start(x=100,y=100) → end(x=115,y=115)（Δ=15px < 25）→ 有效 tap，合成 onCanvasClick；start→end 位移 30px → 判滑动不合成 click。
37. **移动端不挡放塔热区**：`@media (pointer:coarse)` 下 `.center-start` 的 `top=auto bottom=6px`（贴画布底），桌面仍 top=50%（居中大按钮）。
38. **半透明菜单 / 塔详情**：塔详情 `.tower-info-modal` 遮罩 alpha≤0.2，菜单 drawer alpha≤0.78 且带 `backdrop-filter: blur()`，战斗画面仍可见敌人/子弹。

### 元素配置化 & 能量兜底 (2)
39. **元素减速 / 掉率兜底不零（V4-9）**：手动把 gems.json ice/poison/light/dark 的 baseBonus 全删掉 → reload，`getElementBonus('ice').slowPct=0.30 && slowSec=2.0`（硬编码兜底生效）。
40. **能量/技能缺省零影响（V4-8）**：towers.json 空 energyCfgId / skillId 两字段 → 仍能正常开局 5 塔放 + 5 波战斗，无 NaN / undefined（normal / double_strike 兜底）。

### 后端 & 部署 & 兼容 (6)
41. **V3 存档读档兼容**：老 JSON 缺 level/rollEffect/mapId/difficulty/totalKills/energy/skillActive → applySaveRecord 不抛异常，默认值全 0/null。
42. **fallback 与后端对齐**：fallback vs 后端 diff 脚本 20/20 + energy-cfgs / tower-skills 两接口断言 2/2 → 全 PASS。
43. **TD_PORT 环境变量（bafe141）**：进程启动时 `TD_PORT=9090` → `:9090/api/health` 返回 200，`8080` 无监听。
44. **energy-cfgs & tower-skills 两接口可达**：`GET /api/config/energy-cfgs` 和 `GET /api/config/tower-skills` 都 200 JSON，缺字段 V3 客户端不报错。

### Rubric 评分 (≥2 Pass)
- **R-1 复玩性**：3×3×3=27 开局体验差异明显，每局 Roll + 合成路径不同；三伤害类型 + 能量技能进一步提升塔间差异。
- **R-2 新手引导**：新系统首次触达有 tooltip。
- **R-3 性能**：80 敌 + 40 塔 Chrome FPS≥55。
- **R-4 移动端**：414px 宽完整打完 1 波无错位、25px 阈值 + 贴底开始按钮不误触、长按/双指捏合可用。
- **R-5 排行榜正确性**：100 并发 submit Redis ZSet 排序正确无死锁。
- **R-6 配置驱动一致性（新增 · ae67bd8）**：4 处元素减速/掉率代码全走 getElementBonus()，无 `element==='ice'` 硬编码残留；伤害 5 条路径统一三分支公式单测 10/10 通过。

---

> **文档结束**。本综合文档覆盖了从 MVP 到 V4.2 的全部规格，定义了 20 大系统、44 条 AC 和 6 项 Rubric，可作为 V4.0+08-24补丁 最终实现与验收的总依据。**特别提醒：armor 已从乘区改为纯点数减法，enemies.json 必须整体重新标定（见 §18.4.5 / §19 INV-1）**。如需修改功能点，请以最新的单份 spec.md 为准并同步更新本文档。
