# 宝石TD V4 全量功能规范
> 基线版本：V3-6（已交付：账号云档+SSO+乐观锁+Boss波+阶段操作细化+autosave+塔策略切换+塔UI精细化/全局DPS统计+RAF永久断链修复）
> 目标版本：V4.0（十一大模块，V4-1 至 V4-11，增量：能量技能 V4-8 / 伤害三分支+元素配置化 V4-9 / 数值对齐+稀有度成长 V4-10 / 塔 UI 与保留合成流程重构 V4-11 / UI 收纳 / 移动端热修 / Docker 部署热修）
> 生成时间：2026-08-22 （最后同步补丁：2026-08-24 提交 bafe141 + ae67bd8 + V4-10/V4-11 未提交工作区）

---

## Overview

### Summary
V4 在 V3-6 已成熟的单地图塔防核心上，横向扩展 9 大系统：
1. **V4-1 难度分级 + 多地图选择入口**：在现有 MENU 页面新增「难度」（普通/困难/噩梦）+「地图」（后续 V4-2 多图切换）两项入口，为后续模块提供全局难度倍率/地图ID上下文。
2. **V4-2 多地图 + 环境效果**：从单图（mapId=1）升级到 3 张风格不同的地图（经典草原/熔岩洞穴/冰霜高地），每张图配独立路径、地形、波次、以及「环境 Buff」（熔岩减速 10%、冰霜减敌人攻速 15%、草原塔射程 +5%）。
3. **V4-3 塔合成 / 进化系统**：相邻/同稀有度的 3 座真塔可合成 1 座更高稀有度塔（common→rare→epic→legendary），保留 3 座中基础数值最高的 + 1 个 Buff 加成。合成产物立即回到战场。
4. **V4-4 新敌人与 BOSS 技能**：新增 5 种精英敌人（护盾兵 / 治疗师 / 召唤者 / 快速兵 / 分裂者）+ 2 个新 Boss（Boss 2 熔岩暴君「召唤陨石弹幕」、Boss 3 冰霜女王「全屏冰冻 2 秒 + 减速残余 50% 持续 3 秒」）；扩展 enemy 契约（shield / healPerSec / summonEveryN / splitInto / skills 等字段）。
5. **V4-5 多级塔升级 / 分支**：单塔从「0 级」升级到 3 级（费用：等级×40 金），每级 `伤害+30% 攻速+10% 范围+5%`；L2 开始每塔提供**两条分支**（进攻流：伤害再+30% 范围+10% / 控制流：减速+20% AOE 半径+15% / 召唤流：每 5 秒召唤 1 个小炮塔协同射击），选择后不可回退。
6. **V4-6 波次商店 / 抽卡界面**：把 V3 的「WAVEEND → 升运气 + 抽 Buff + 开始下一波」三按钮升级为完整的波次商店：商品包括（1）抽 Buff（40 金 1 次，概率随 Luck 等级上升）、（2）升运气等级（80 金 / 级）、（3）金币购买随机塔放置（120 金，直接扔到空地）、（4）1 次免费拆除墙/塔的重置券、（5）本波开始前预览敌人。
7. **V4-7 综合收尾**：
   - **天赋/技能树系统**：通关第 2 波后解锁 1 天赋点，之后每通 1 波 1 点。三条天赋线（塔强化/生存经济/控制），单点 1 级可叠加，累计最多 15 级。天赋写入账号级存档，跨局生效。
   - **后端全局排行榜**：新增 MySQL `leaderboard_records` 表 + Redis ZSet 热榜，提供 API `/api/config/maps/:id/waves` 扩展外新增 `/api/lb?mapId=&difficulty=&type=highestWave|fastestClear|totalKills&page=`。
   - **Spine 动画接入**：用已有 `assets/spine/` 资源 + `web/vendor/spine-webgl.js`，把 Canvas 2D 绘制升级为 WebGL + Spine（塔受击晃动/击杀特效 / 敌人行走/死亡动画 / BOSS 技能特效），无资源时降级 Canvas 2D。
   - **移动端适配**：canvas 尺寸监听 viewport 并强制 16:9；触屏双指缩放；触屏「长按 = 点塔」「双击 = 放置候选塔」；按钮尺寸 ≥44px。
8. **V4-8 塔能量 + 技能系统（解耦）**：每塔独立 `energyCfgId` 能量配置（能量上限 / 攻击加能 / 秒加能），和 `skillId` 技能配置（伤害倍率 / 穿甲 / 法穿 / 减速）**解耦**，不同塔可以共用相同技能；能量满 → 下一次攻击释放技能（默认：双倍伤害）。
9. **V4-9 伤害类型三分支 + 元素数值全部配置化**：塔新增 `damageType ∈ {physical|magic|true}` 三类型，物理=减甲(减法点数)、魔法=法抗百分比减免、真实=无视双抗；敌人新增 `magicResist(0~100)`；元素减速 / 掉率从 gems.json `elements[].baseBonus` 读取，消灭 4 处前端硬编码。
10. **V4-10 数值对齐 + 塔成长=稀有度成长 + L3 金币解锁**：8 座宝石塔 × 6 档稀有度（common→ultimate）全量对齐《数值.txt》；换算规则（射程 400px=2 格 / 减速 60=5% / 光环 200=20%）；塔成长从「等级×加成」改为「稀有度档位取 levels[i]」；L3 特效解锁改为金币付费（120 金）；战斗特效（减速/毒 DoT/减甲 DEBUFF/多重射击/光环）全部按 towers.json 配置生效。
11. **V4-11 塔 UI 与保留/合成流程重构**：A 类升级整体下线；保留/合成/进化入口从 HUD 三按钮收敛到塔详情弹窗，且**有可用操作才显示按钮**；放满 5 塔后塔详情出现「保留本塔」按钮（保留 → 其余候选变墙直接开战）；放满未保留时允许合成/进化（候选塔可作材料），确认后其余本波候选塔变墙直接开战；开始按钮移至菜单旁缩小为 ▶ 三角图标。

### Purpose
V3 已把「单局核心循环」做稳定。V4 要解决：
- **复玩性差**：只有 1 张地图 1 套难度，几局就乏味。
- **成长路径浅**：塔只能 Roll 不能升级不能合成，中期决策几乎没有。
- **BOSS 无区分度**：V3 Boss 只是大血量大体积，没有独立技能反馈。
- **结算重复**：WAVEEND 三按钮操作已经过拟合游戏节奏，需要更丰富的商店给玩家花钱路径。
- **跨局无成长**：所有进度一局一清零，登录用户除了存档没有永久成长；缺排行榜的社交压力。
- **视觉/设备不足**：Canvas 2D 简单贴图无打击感，手机上玩不了。

### Target Users
- **核心玩家（PC 浏览器 + 已登录）**：至少通 2 波 V3-6，熟悉放置/保留战斗循环 → 是 V4-3~V4-6 的主受众。
- **休闲玩家（移动端）**：首次进入 → 是 V4-7 移动端适配的主受众。
- **硬核玩家（冲榜）**：追求最高波 / 最快通关 → 是 V4-7 排行榜主受众。
- **自动化回归**：Trae 浏览器脚本对每个 AC 做 rule/rubric 断言。

---

## Goals (G1–G12)
- **G1（难度+地图入口）**：MENU 阶段玩家能从 3 种难度 × N 张地图的组合中选开局选项，难度倍率作用到本整局（敌人HP/速度/奖励）。
- **G2（多地图 + 环境）**：3 张新地图提供不同路径、不同出怪顺序、全局环境 Buff；不共用存档（每图独立存档）。
- **G3（塔合成）**：玩家点「合成」按钮选择 3 座相邻同稀有度真塔 → 合成高一级塔，3 座原塔拆除。
- **G4（新精英 + BOSS 技）**：至少 5 种新精英有独立 AI/外观区分，BOSS 2/3 各带 1 个全屏技能 + 明确预警 + 视觉/音效反馈。
- **G5（多级塔升级+分支）**：每塔 L0→L3 升级按钮在塔信息弹框中可点击；L2 后分支选择独立弹框，选中后后续升级走分支加成。
- **G6（波次商店）**：WAVEEND 阶段改为 Tab 式 5 类商品（抽Buff/升级运气/买塔/重置券/预览），所有消费可完整测试。
- **G7（天赋树）**：登录账号跨局累计天赋点，3 条线 × 15 级可配；当前天赋组合对新开局实时生效（塔伤害基础加成等）。
- **G8（排行榜）**：通关结局（WIN / LOSE）自动上报最高波 / 最快通关时间 / 总击杀；登录用户可在排行榜 Tab 查看 top100 + 自己排名。
- **G9（Spine 动画）**：塔/怪/特效至少 6 个 Spine 动画接入（塔 idle/attack；敌人 walk/death；Boss skillCast）；无 Spine 资源时 Canvas 2D 降级模式 100% 可玩。
- **G10（移动端 · 2026-08-24 热修）**：viewport 宽度 ≤ 768px 时，画布自动缩放、stat chip 换行堆叠；触屏手势（点击/长按/双击）全部可操作一局。**触屏滑动判定阈值 ≥ 25px**（电容屏微抖 10~20px 不会把有效 tap 误判为滑动）；**中央"开始本波"大按钮在手机/触屏上强制贴画布底部（bottom 6px，小尺寸）**，桌面中央保持原状，避免挡放塔热区误触提前进 RESERVE。
- **G11（能量 + 技能解耦）**：每塔从配置取独立 energyCfg（上限/攻击加能/秒加能）与 skillCfg（伤害倍率/穿甲/法穿/减速）；能量满 100% 即下一次攻击自动释放技能，UI 塔格底部显示能量条，塔详情显示技能名 + 说明。
- **G12（伤害类型三分支 + 元素配置化）**：物理/魔法/真实三类型伤害公式 100% 路径一致（弹/crit/double/override 都统一过类型公式，再乘元素抗）；gems.json elements[].baseBonus 是减速 / 掉率加成唯一配置源，缺字段按历史硬编码兜底，配置与实现一一对应。
- **G13（V4-10 数值对齐 + 稀有度成长）**：8 塔 × 6 档稀有度数值与《数值.txt》一一对应；塔成长完全由实例稀有度档位驱动（levels[i]）；L3 特效 120 金解锁；战斗特效全配置化。
- **G14（V4-11 操作收敛 + 流程直通）**：塔详情弹窗是保留/合成/进化唯一入口（有可用操作才显示按钮）；放满 5 塔后「保留」或「合成/进化确认」→ 其余候选变墙 → 自动开战，中间无多余弹窗；开始按钮为右上角菜单旁 ▶ 三角小图标。

## Non-Goals (NG)
- NG-1：不做多人协同守塔（V5 再规划）。
- NG-2：不重新做平衡数值（V3 已验证；V4 只在 V3 基础上乘难度系数/环境系数/升级系数，不重设基础塔数值）。
- NG-3：不做 3D / 透视 Camera（Spine 是 2D 骨骼动画，不升级到 3D）。
- NG-4：不做塔交易/市场（玩家之间互换塔）。
- NG-5：不做战斗视频录制（截图+记录即可）。
- NG-6：不支持离线安装包（PWA/桌面端）。

---

## Constraints & Assumptions
- **后端栈不变**：继续使用 Gin + MySQL + Redis，不切换框架/DB。
- **前端栈不变**：Canvas 2D + Spine WebGL（可降级），不引入 React/Vue，保持纯原生 JS + innerHTML。
- **契约向后兼容**：`/api/config/*` 返回必须新增 v4 字段但不破坏 v3 fallback 解析（缺字段用默认值）。
- **老存档可读**：V3-6 的 save_records 必须能在 V4 正常读档（缺字段给默认值），但 V4 存档不保证回退兼容。
- **美术资源复用**：Spine 模型、音效、图片优先复用 `assets/` 已有，不允许新增 >5MB 的外部资源。
- **性能预算**：80 敌人 + 40 塔同屏时，PC Chrome（i5 + 8G）FPS ≥ 55；移动端 660 处理器 ≥ 30 FPS。
- **Spine 降级**：若 Spine 资源加载失败 / WebGL 不支持，必须静默退化为 V3 风格 Canvas 2D，不让玩家察觉错误（仅 log 中 warn）。
- **部署可用性（2026-08-24 新增）**：
  - 服务端口 `TD_PORT` 环境变量可覆盖，缺省 `:8080`，与 `Dockerfile / docker-compose.yml` 变量声明一致。
  - Docker build 阶段显式设置 `GOPROXY=https://goproxy.cn,direct`，确保国内环境 `go mod download` 不超时。
- **UI 收纳 · 极简 HUD（2026-08-24 新增）**：原 HUD 顶栏 + 左右侧栏 **统一收纳到画面右上「☰ 菜单」抽屉**，仅保留 4 个 chip（金币/HP/运气 左上；波次 右上）+ 菜单按钮，把合成/升级/进化/天赋/排行榜/账号/存读档/重开/Buff 列/日志 全部放进抽屉。每波开始期（MENU / PREPARE 放塔后）画面中央显示「▶ 开始第 N 波」按钮，点击后隐藏；手机/触屏改贴底避免挡放塔热区。

---

## Functional Requirements (FRs)

### V4-1 难度分级 + 多地图入口
#### FR-1.1 MENU 新 UI：难度 + 地图选择
- 在 MENU 阶段的「开始下一波」按钮上方，新增两个横向选择器：
  - **难度**：3 个 Tab，「普通」(默认) / 「困难」 / 「噩梦」。
  - **地图**：2 个 Tab，V4-1 时先显示「草原（默认）」一个（熔岩/冰霜 V4-2 再启用，但 UI 位留空显示「未解锁 V4-2」灰字）。
- 选择后，顶部 `#map-info-chip` 和 `#difficulty-chip` 实时显示（放在 account-chip 同一行最左）。

#### FR-1.2 难度倍率契约
- 每局开始（PREPARE wave1 之前）`state.difficulty` = {normal/hard/nightmare}，生效于：
  - 敌人 HP 倍率：普通 1.0x、困难 1.8x、噩梦 3.0x
  - 敌人速度倍率：普通 1.0x、困难 1.15x、噩梦 1.3x
  - 金币奖励（波末+击杀）：普通 1.0x、困难 1.3x、噩梦 1.8x
  - 基地血量上限：普通 20、困难 15、噩梦 10
- 倍率在 `prepareNextWave()` 末尾 `baseMaxHP` 设置时一次性应用，不随战斗中更改难度生效（锁死后不能改）。

#### FR-1.3 存档按 mapId + difficulty 分桶
- `save_records` 表（V4 升级 schema）新增 PK：`(uid, map_id, difficulty)`，不再是 uid 单 PK。
- 每次 start 前读档时按 (uid, mapId, difficulty) 读，避免串档。

---

### V4-2 多地图 + 环境效果
#### FR-2.1 三张地图契约
- mapId=1（草原）：V3 现有地图，环境：塔范围 +5%
- mapId=2（熔岩洞穴）：新增路径更绕、路径 tile 旁随机 20 格「熔岩」（走在上面的敌人每 0.5s 掉 5 HP，基地伤害系数 0.8x）
- mapId=3（冰霜高地）：路径分叉，先分后合；环境：敌人攻击速度 -15%，塔攻速 +5%
- 每张地图独立：
  - `cfg.mapDetail.tiles`
  - `cfg.mapDetail.base.x/y / spawnPoints`
  - 独立 `cfg.waves` 8 波（Boss 在 3/6/8；不同顺序）
  - 独立 `cfg.environment = {id: 'grass'|'lava'|'ice', name: '', towerMul: {...}, enemyMul: {...}, onTick?: 'lava_damage_5hp'}`

#### FR-2.2 环境 Buff 生效点
- 塔：`calcTowerEffective()` 末尾把 `cfg.environment.towerMul{damage,interval,range,...}` 乘入 `eff` 字段（在 activeBuffs 之后，作为全局常数）。
- 敌人：`stepEnemy` 中应用 `environment.enemyMul{speed, attackSpeed}`；熔岩环境下：敌人走到 tile=7（`T_LAVA`）时，每 0.5s `damageEnemy(enemy, 5)`，来源塔 sourceGridIdx=null。

#### FR-2.3 地图选择入口上线
- V4-1 中灰掉的「熔岩 / 冰霜」Tab 在 V4-2 启用。
- 账号首次开局只能选「草原 Lv.1」；草原通关 ≥ 4 波后解锁熔岩；熔岩 ≥ 4 波后解锁冰霜（解锁条件记录在 users 新列 `unlocked_maps JSON`）。

---

### V4-3 塔合成 / 进化系统（三种模式 · 三按钮 · 无距离限制）
合成系统分 **A 升级 / B 合成 / C 进化** 三类，对应 HUD 上三个独立按钮。**全部模式取消距离限制**（可从全场任意位置挑选真塔，不再限制切比雪夫距离）。所有操作都不会消耗 placement 机会；被替换掉的原塔原址回变草地（走 terrainGate 防封死，失败整体回滚）。Legendary 稀有度除配方塔外不可再合成，所有特殊配方塔的稀有度为「固定」，不会参与 A/B 类合成的「再升级」链条。

新塔落地位置约定（三类统一）：**产出塔落在最后一次点击选中的素材塔所在格子**（lastSelected.gridIdx），其余素材格直接回变草地。

#### FR-3.1 A 类：升级按钮 · 2 座同类型 + 同稀有度 → 升一级稀有度 · 类型保持不变
- **按钮入口**：HUD 新增「⬆ 升级」按钮（第一优先位，A 类专属）。
- **操作步骤**：
  1. 点击「⬆ 升级」→ 进入升级模式 `state.upgradeMode = true`；画布顶部 chip 提示：「请选择 2 座同类型同稀有度的塔（已选 0/2）」。
  2. 点击真塔 T_TOWER：依次加入 `state.upgradeSelection = [gridIdx1, gridIdx2?]`，已选塔高亮 + 角标「① / ②」，chip 实时更新「已选 1/2 · 类型=ARCHER」。再次点击已选塔可取消选择。
  3. 选择满 2 座后 → 自动校验：`towerCfgId 相同 && rarity 相同 && rarity ≤ epic && !special`。
     - 校验失败：chip 红字提示「类型不匹配 / 稀有度不一致 / 已是最高级 / 特殊塔不可用」，允许继续点击替换最后一座。
     - 校验通过：自动弹出「升级预览 modal」：
       - 左侧：2 张源塔卡片（带缩略图、稀有度颜色、数值）。
       - 右侧：合成后产物预览（同类型、稀有度 +1 颜色、max(base)×1.25 后数值、等级/策略继承说明）。
       - 底部：取消 / 确认 两个按钮。
  4. **取消**：关闭 modal，清空 state.upgradeSelection，升级模式保持（用户可重新选）。
  5. **确认**：
     - 记录 undo 快照 → 删除 2 座源塔 → 在 **最后选中的素材格（②所在格）** 落地同类型稀有度+1 新塔 → terrainGate 校验。
     - 失败 → 回滚 + msg「升级失败：路径封死」。
     - 成功 → 金色闪光特效（Canvas 径向渐变扩散）+ HUD 顶绿色 chip「升级成功：ARCHER common → rare」+ 清空 selection 自动退出模式。
- **数值规则**：
  - 基础数值 = max(2 座 base) × 1.25（A 类加成为三类最高）。
  - 等级：继承 2 座中最高 level。
  - 策略：若策略相同保留，否则回默认 NEAR。
  - 稀有度：common→rare、rare→epic、epic→legendary（legendary 不参与）。

#### FR-3.2 B 类：合成按钮 · 3 座不同类型 + 同稀有度 → 升一级稀有度 · 随机类型（特殊塔类型除外）
- **按钮入口**：HUD 新增「🧪 合成」按钮（B 类专属，位于升级按钮右侧）。
- **操作步骤**：
  1. 点击「🧪 合成」→ 进入合成模式 `state.mergeMode = true`；画布顶部 chip 提示：「请选择 3 座不同类型同稀有度的塔（已选 0/3）」。
  2. 点击真塔 T_TOWER：依次加入 `state.mergeSelection = [idx1, idx2, idx3?]`，已选塔高亮 + 角标「①②③」。再次点击可取消。
  3. 选择满 3 座后 → 自动校验：`3 座 towerCfgId 互不相同 && rarity 相同 && rarity ≤ epic && 都不是 special 塔`。
     - 校验失败：chip 红字「类型有重复 / 稀有度不一致 / 已是最高级 / 含特殊塔」。
     - 校验通过：弹出「合成确认 modal」：
       - **不显示合成后具体塔类型与数值**（随机悬念）。
       - 左侧：3 张源塔卡片。
       - 右侧：大字显示「产物稀有度：★★ rare（升一级）」+ 说明「类型随机，来自普通塔池，不含特殊塔」。
       - 底部：取消 / 确认。
  4. **取消**：清空 selection，合成模式保持。
  5. **确认**：
     - 删除 3 座源塔 → 在 **最后选中的素材格（③所在格）** 落地稀有度+1 的**随机普通塔**（`!special`）。
     - terrainGate 失败→回滚；成功→金色闪光 + chip「合成成功：★ common → ★★ rare · 随机获得 XXX 塔」+ 清空 selection。
- **数值规则**：
  - 新塔稀有度 +1（common→rare→epic→legendary，legendary 封顶）。
  - towerCfgId = 从普通塔池（升一档后稀有度）随机 Roll，**过滤掉所有 `special: true` 塔**。
  - 基础数值 = max(3 座 base) × 1.15。
  - 等级：继承 3 座最高 level；策略默认 NEAR。
  - 天赋控制线 V 点 5：B 类合成有 10% 概率稀有度再跳一级（如 epic→legendary 直接 legendary+1→ 视作 legendary+20% 数值加成）。

#### FR-3.3 C 类：进化按钮 · 固定配方 → 产出特殊塔（稀有度固定；Roll 与 B 类随机池均无法出）
- **按钮入口**：HUD 新增「💠 进化」按钮（C 类专属，位于合成按钮右侧）。

特殊塔属于独立塔池 `cfg.towersById` 中带 `special: true` 标识的条目。它们**无法通过升级（A）、合成（B）、也无法通过 Roll 塔机会（placeCandidate / 商店购买塔）出现**，只能通过下表的固定配方触发。进化成功时在 HUD 顶部显示金色 chip「★ 解锁特殊塔：XXX」。

配方表（共 5 个，可后续扩）：
| 配方 ID | 稀有度（固定） | 配方：3 座塔的 towerCfgId 组合（类型无序，需同稀有度） | 产出塔（名称 · special） | 特殊增益（被动 / 光环） |
|---|---|---|---|---|
| C-FUSION | epic | PYRO + CRYO + ELECTRO（3 座 common 稀有度） | `FUSION_EPIC` 元素融合塔 | 每次攻击从 {火/冰/雷} 随机选元素，减速 + 灼烧 + 感电同时命中 |
| C-DESTROYER | epic | CANNON + ARCHER + SPLASH（3 座 rare 稀有度） | `DESTROYER_EPIC` 破坏者 | 每次命中附带 0.3s 眩晕 + AOE 半径 ×1.5 |
| C-AURORA | epic | SNIPER + FREEZE + POISON（3 座 rare 稀有度） | `AURORA_EPIC` 极光塔 | 攻击使 ±2 格内所有友塔攻速 +8%（光环，可叠加但上限 +24%） |
| C-GEMLORD | legendary | 任意 3 座 epic（塔类型任意但 **至少 1 座带元素属性**） | `GEMLORD_LEG` 宝石主宰 | 光环：全图塔伤害 +5%；主动：每隔 10s 对 20% 血量最高敌人造成 10% 真实伤害 |
| C-RAIGATEKI | legendary | 任意 1 座 legendary（任意类型） + 2 座 epic（任意不同类型） | `RAIGATEKI_LEG` 雷击帝 | 每次普通攻击附带一道雷击：对该敌人 ±1 格造成 60% 伤害的链式闪电（最多链 3 次，衰减 70%） |

- **操作步骤（与升级类似，但有配方高亮 + 提示）**：
  1. **PREPARE 阶段自动检测可进化配方**：每次进入 PREPARE 时调用 `detectEvolvable()` 遍历 5 条配方，若场上真塔能凑齐某配方的所有材料（不限位置），则将「💠 进化」按钮置为**高光脉冲**（CSS box-shadow + animation），tooltip：「检测到可进化配方！点击查看」。
  2. 点击「💠 进化」→ 进入进化模式 `state.evolveMode = true`；**画布顶部固定一条「配方提示条」**（sticky top）：
     - 左侧 Tab 切换 5 条配方；Tab 名用 emoji + 名字：「🔥⚡❄ 融合塔」「💥🧱⚙ 破坏者」等。
     - 当前激活配方显示 3 格材料需求：`PYRO ✅ / CRYO ✅ / ELECTRO ❌`（已有塔显示打勾，未满足显示灰叉；若场上有多座候选，在对应格子显示「可用：×2」count）。
  3. 点击真塔 T_TOWER：加入 `state.evolveSelection = [idx1, idx2, idx3?]`；塔必须 `!special`。
  4. 选择满 3 座后 → 自动匹配配方：遍历 MERGE_RECIPES，找到命中的那条（可能多条命中则选材料稀有度条件更高的优先）。
     - 未命中：chip 红字「不满足任何进化配方，请点击顶部配方提示查看需求」。
     - 命中：弹出「进化预览 modal」，顶部显示配方 ID（如 C-FUSION）、产物特殊塔卡片（稀有度固定 + special 标识 + 特殊增益说明）、3 张源塔卡片、取消/确认按钮。
  5. **取消**：清空 selection，进化模式保持，配方提示条继续显示。
  6. **确认**：
     - 删除 3 座源塔 → 在 **最后选中的素材格（③所在格）** 落地配方表指定的 `special:true` 塔（稀有度固定，不遵循 +1 规则）。
     - terrainGate 失败→回滚；成功→金色闪光 + 金色 chip「★ 进化成功：解锁特殊塔【宝石主宰】」+ 清空 selection + 重新检测高光脉冲。
- **特殊塔作为源的规则**：
  - A 类（升级）与 B 类（合成）：点击 special 真塔 → msg「特殊塔不可用于升级/合成，请另选普通塔或选择进化模式」并**拒绝**加入 selection。
  - C 类（进化）：special 真塔**允许**作为配方材料加入 evolveSelection。意味着已进化出的 FUSION_EPIC / DESTROYER_EPIC 等特殊塔，可以继续作为 C-GEMLORD（需 3 epic 其中 1 元素）或 C-RAIGATEKI（需 1 legendary + 2 epic）配方的组成部分，链式进化出更高级的 legendary 特殊塔。
  - 产出限制仍成立：**只有 C 类能产出 special 塔**。A 类/B 类/Roll/购塔的结果池永远过滤 `special:true`。

#### FR-3.4 三模式通用规则与特效
- **selection 互斥**：升级/合成/进化三种模式互斥；进入新模式会清空另两类 selection。点击 HUD 之外的空白（非塔区域）**不**清空选择（避免误触）；点击模式按钮本身（同按钮）切换「模式开 → 关」时才清空。
- **三类按钮的 disabled 条件**：
  - 场上真塔数量 < 2 时：升级 disabled。
  - 场上真塔数量 < 3 时：合成与进化 disabled。
- **闪光成功特效**：Canvas 2D 径向渐变扩散，从 lastSelected.gridIdx 中心格扩展 8 格；持续 0.6s。
- **log 标签**：`[MERGE-A]` / `[MERGE-B]` / `[MERGE-C]` 各自独立，便于调试。

### FR-3.5 Roll 塔 / B 类随机池排除特殊塔
- `rollTowerByLuckLevel()`（placeCandidate / 商店购买塔都走这个）的候选池只包含 `!towerCfg.special` 的普通塔（永远不会直接 Roll 出特殊塔）。
- B 类合成的随机类型池同样过滤 `special`。
- 只有 C 类配方能产出 `special:true` 塔。

---

### V4-4 新精英敌人 + BOSS 技能
#### FR-4.1 5 种精英契约（enemy 契约扩展）
在 `cfg.enemies` 中新增 5 条：
| enemyId | 名 | 护盾/技能 | 基础 HP | 速度 | 掉落金 |
|---|---|---|---|---|---|
| SHIELD | 护盾兵 | `shield: 30`（每次受击先扣护盾，破盾前不扣血） | 100 | 1.0 | 12 |
| HEALER | 治疗师 | `healPerSec: 5`（每 1 秒为 ±2 格内所有盟友 +5 HP，不治疗自己） | 80 | 1.0 | 15 |
| SUMMONER | 召唤者 | `summonEveryN: 3`（每 3s 召唤 2 只 FAST 小喽啰） | 140 | 0.8 | 20 |
| FAST | 快速兵 | `speed: 2.0` | 60 | 2.0 | 8 |
| SPLITTER | 分裂者 | `splitInto: {enemyId:'FAST', count:2}`（死亡时当场爆 2 FAST） | 180 | 0.9 | 18 |

#### FR-4.2 BOSS 2/3 新技能
- **BOSS 2 熔岩暴君（Lv.6 Boss）技能 `meteor_barrage`**：
  - 触发：进入战场 10s 后、每 15s 一次。
  - 预警：屏幕上方红色警告条「陨石即将坠落，注意躲避（3s）」闪烁 + 画布上随机 8 格目标红圈预绘。
  - 执行：3s 后，目标格被陨石命中，所有在该格的敌人受到 200 真实伤害（敌我通吃），塔被眩晕 1s（无法攻击）。
  - 视觉：陨石掉落 Spine 粒子动画（或 Canvas 2D 径向黄→红渐变圆）。
- **BOSS 3 冰霜女王（Lv.8 最终 Boss）技能 `ice_freezer`**：
  - 触发：进入战场 8s 后、每 12s 一次。
  - 预警：全画布蓝闪 + 「冰霜即将覆盖！（2s）」。
  - 执行：2s 后全屏冰冻 2 秒：所有敌人/塔静止（dt=0）；之后 50% 减速残余持续 3 秒。
  - 伤害：基地不受影响；玩家可在 2s 冰冻期间移动鼠标规划，但不接受点击操作（canvas 点击返回被冻 msg）。

#### FR-4.3 波次表升级
- 草原 mapId=1：V3 原有 8 波在 2/4/5/7 波分别加入 1-2 只新精英。
- 熔岩/冰霜 mapId=2/3：每张独立 8 波，精英更多、密度更高。

---

### V4-5 多级塔升级 / 随机特殊效果
#### FR-5.1 塔等级定义
- 每塔新增字段 `level: 0|1|2|3`（默认 0）与 `rollEffect: string|null`（L3 随机特殊效果 id，默认 null）。
- 升级费用：`(level+1) * 40 金`（L0→L1:40，L1→L2:80，L2→L3:120），金币不足按钮灰并红字提示。
- 升级基础加成（线性累计，每级 × 上一级结果）：
  - L0→L1：伤害 +30%，攻速 +10%，范围 +5%
  - L1→L2：伤害 +30%，攻速 +10%，范围 +5%
  - L2→L3：伤害 +30%，攻速 +10%，范围 +5%，**额外随机 Roll 一个「特殊效果」**（见 FR-5.2）

#### FR-5.2 L3 随机特殊效果（Roll 机制 · 5 选一）
- **触发时机**：L2→L3 升级确认时立即 Roll，结果写入 `tower.rollEffect = effectId`。
- **池**：5 个效果，等概率均匀 Roll（各 20%）。
- **效果清单（互斥，每塔只能有一个）**：
  1. **`effect_offense` 进攻狂潮**：伤害 +40%，范围 +15%；塔卡片右上角「⚔」金标。
  2. **`effect_control` 极寒控制**：带减速元素的塔减速幅度额外 +25%；AOE 塔 AoE 半径 +30%；既不减速也不 AOE 则攻速 +20% 兜底。
  3. **`effect_double_shot` 双重打击**：每次对主目标攻击时，**在当前塔的范围内自动选取「另一个不同的敌人」再额外攻击一次**（伤害 = 本次攻击伤害的 80%，独立判定命中/暴击/元素，冷却=同一次攻击间隔，不能选同一个主目标）。
  4. **`effect_crit` 致命暴击**：所有攻击 15% 概率打出 2.5× 伤害；命中时 Canvas 画红色破折线飞出。
  5. **`effect_ricochet` 弹射链击**：击中主目标后，弹射到相邻 ±2 格内最近的另一个敌人，造成 60% 伤害，最多弹 2 次（衰减 70%/次）。
- **生效点**：`calcTowerEffective()` 末尾基于 `tower.rollEffect` 合并到 eff；双重打击与弹射在 `fireTowerBullet` / `stepTowers` 的攻击结算阶段新增分支。

#### FR-5.3 UI：塔信息弹框扩展 + Roll 动画
- 升级按钮：位于塔信息弹框底部，与「策略」并列；文字「升至 Lx (xx 金)」，金币不足灰 + 红字。
- **L2→L3 的升级流程**：点「升至 L3 (120 金)」→ 金币扣 → **随机特殊效果 Roll 动画播放 1.2s**（Canvas 弹框中心 5 个图标快速切换 → 定格在结果）→ 最终结果卡片展示效果名/图标/说明 → 点「确定」后 L3 等级 + rollEffect 字段生效、刷新塔卡金标角标。
- L3 塔信息弹框新增「已获得特殊效果」区块：显示图标 + 效果名 + 具体数值说明；L0/L2 此处空。
- 存档兼容：level 与 rollEffect 写入 grid 项，缺省 0/null；v3 存档读档后 level=0 rollEffect=null。
- **拆塔提醒**：拆塔时若 L3 带 rollEffect，在拆确认 modal 增加黄色 chip「含特殊效果：XXX」提醒用户。

---

### V4-6 波次商店 / 抽卡界面
#### FR-6.1 原 WAVEEND 改造
- 原 WAVEEND 三按钮（升级运气 / 抽 Buff / 开始下一波）升级为 Tab 式 `waveend-modal` 内 4 个 Tab：
  - 「抽 Buff」「升运气」「购买塔」「下波预览」。
  - 底部统一「开始下一波」大按钮。

#### FR-6.2 4 类商品契约
| Tab 名称 | 动作 | 价格 | 上限/规则 |
|---|---|---|---|
| 抽 Buff | 从 buffs 池中按 luck 级别概率 Roll 一条，若与现有相同类型则替换（不叠加同名） | 40 金 / 次 | 每波最多 5 次；Roll 出的 buff 立即加入 activeBuffs |
| 升运气 | luckLevel += 1 | 80 金 × 等级（下一级 = (curr_level+1)*80） | 最高 Lv.10 |
| 购买塔 | 按当前 luckLevel 随机 Roll 一座塔（不消耗 placement 机会），扔到选中空地 | 120 金 / 次 | 每波最多 2 次；必须选空地放置才能成功，地形 gate 不封死 |
| 下波预览 | 显示下一波敌人清单（表格：enemyId 图标/数量/出场时间） | 免费，一直可点 | 纯信息 |

#### FR-6.3 视觉一致性
- 商店 Tab 视觉风格与 reserve modal 对齐（白底卡片式）。
- 价格金币不足时统一：按钮灰，文字「金币不足」红字提示。
- 购买塔需要与 placeCandidate 类似的 canvas 选择流程：点按钮 → 光标变为「购买塔」模式 → 点空地 Roll → 成功后立即作为真塔（T_TOWER）落地，不进候选，不进保留阶段（战斗阶段直接进入）。

---

### V4-7 综合收尾：天赋树 / 排行榜 / Spine / 移动端
#### FR-7.1 天赋树系统
- **天赋点获取**：每通关一波（WIN / WAVEEND 结束前）账号级 +1 点，上限 15 点。老存档按「已通波数」批量补齐。
- **三条天赋线，每条 5 点**：
  - **塔强化线（5 点）**：点 1 → 全塔伤害 +5%；点 2 → +10%；点 3 → 攻速 +5%；点 4 → +10%；点 5 → 范围 +8%。
  - **生存经济线（5 点）**：点 1 → 基地血量上限 +5；点 2 → 初始金币 +30；点 3 → 击杀金币奖励 +10%；点 4 → 波末奖励 +15%；点 5 → 免费拆墙次数每波 +1。
  - **控制线（5 点）**：点 1 → 减速效果 +5%；点 2 → AOE 半径 +5%；点 3 → 冰环境强叠加（-5% 敌人 HP 上限）；点 4 → 熔岩伤害翻倍；点 5 → 合成时稀有度升两级概率 10%（否则正常 +1）。
- **天赋选择 UI**：HUD 最左侧新增「🎄 天赋」按钮，点它打开全屏树状图：3 条竖线 × 5 节点。点击未点亮节点 → 消耗 1 点点亮；点击已点亮节点 → 无动作（不洗点，V4.1 版本锁定，不加入后悔药）。
- **账号级存档**：天赋写入 users 表新列 `talent_nodes JSON`（数组 `['atk1','atk2','surv1',...]`）与 `talent_points_available INT`；每次开局时从账号 API 加载天赋配置并缓存到 `state.talentMul = {...}` 中，作用于所有塔的基础系数。

#### FR-7.2 后端全局排行榜
- **新增 MySQL 表** `leaderboard_records`（PK：`id` 自增；组合 UK：`uid, map_id, difficulty, record_type`）：
  - uid BIGINT, map_id INT, difficulty VARCHAR(16), record_type VARCHAR(32) ENUM('highestWave','fastestClearSec','totalKills')
  - score BIGINT, created_at DATETIME(3), updated_at DATETIME(3)
  - 外键 uid → users
- **Redis ZSet 热榜**：键 `lb:{mapId}:{difficulty}:{recordType}`，member=uid，score=score。
- **上报时机**：每次触发 WIN / LOSE（结局）时，前端从 state 计算：
  - highestWave：waveIndex
  - fastestClearSec：仅 WIN 时（战斗 phase 累计耗时，不含准备/菜单）
  - totalKills：totalKillsAllWaves
  - POST `/api/lb/submit`（JWT 鉴权）→ 后端 upsert DB + ZADD Redis（幂等：仅当新分数 > 旧分时才更新）。
- **查询 API**：`GET /api/lb?mapId=1&difficulty=normal&type=highestWave&page=0&pageSize=20` → 返回 top20 + 当前 uid 排名（若登录）+ 当前 uid 分数。
- **UI**：HUD 新增「🏆 榜」按钮，点击弹排行榜弹框（地图/难度/类别三个下拉 + 分页）。

#### FR-7.3 Spine 动画接入
- **初始化**：`draw()` 入口之前，新增 `spineManager.init(canvas)`——优先尝试 WebGL 上下文创建 Spine canvas（覆盖在原 canvas 上方 z-index 更高），失败则返回 `{ok:false}`。
- **三类动画绑定**：
  - 塔：`towers[instId].spine.setAnimation('idle')` / 攻击时切换到 `attack` 0.3s → 回 idle。
  - 敌人：每次 `spawnEnemy` 时初始化 walk 动画；`alive=false` 时切 death。
  - 技能：BOSS meteor_barrage 用独立粒子；ice_freezer 用全屏 shader（Canvas 2D 降级：画布 globalAlpha × 0.5 blue 叠加 2 秒，之后逐帧淡去）。
- **降级**：任一环节失败（spine-webgl.js 没加载、资源没下载、WebGL 失败）统一 `state.renderMode = 'canvas2d'`，完全走 V3 draw() 函数，log warn 但不阻断。

#### FR-7.4 移动端适配
- **Viewport Meta**：`td.html` 补 `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">`。
- **Canvas 自适应**：每次 onResize（新增）根据 viewportWidth 计算 `cellPx = floor(min(viewportWidth/cols, viewportHeight*0.9/rows))`，调用 `applyCfg(state.cfg)` 重新渲染。
- **手势识别**：
  - 触屏点击（touchend 60ms 内）→ 视为鼠标 click（同 onCanvasClick）。
  - 长按（touchstart 持续 500ms 不移动）→ 视为「点塔开信息弹框」。
  - 双指缩放（pinch）：缩放 canvas CSS 比例，范围 0.5× ~ 1.5×。
- **按钮 / chip 大小**：所有按钮 CSS 高度 `min-height:44px`，移动端 viewport 下 `@media (max-width: 768px) { #hud .stat { flex-basis:33%; } }` 统计 chip 33% 换行。
- **移动端热修（bafe141）**：
  - `touchmove` 滑动 vs tap 判定阈值：`25px`（旧 10px 因手指微抖吞有效 tap）。
  - 中央「▶ 开始本波」大按钮：`@media (max-width: 600px), (pointer: coarse)` 下强制 `top:auto; bottom:6px; transform: translateX(-50%)`，并缩小为 14px 小胶囊；桌面仍保持居中大按钮。
- **部署热修（bafe141）**：
  - Go 后端启动 `port = ":" + os.Getenv("TD_PORT")`，空回退 `:8080`；与 Dockerfile / compose `TD_PORT` 一致。
  - Dockerfile builder 阶段：`ENV GOPROXY=https://goproxy.cn,direct`，国内网络 go mod 不超时。
- **UI 收纳热修（2026-08-24 UI 极简）**：
  - 画面四角 chip：**左上** (金币/HP/运气)、**右上** (波次 + ☰菜单胶囊按钮)，其余 **HUD 顶栏/左右侧栏全部隐藏**。
  - ☰菜单抽屉：放置 难度+地图 Tab 选择器、合成三按钮（升级/合成/进化）、天赋/排行榜/账号/存读档/重开 6 个系统按钮、全局 Buffs 列表、DPS/塔/墙/击杀读数、操作日志滚动区。遮罩点击 / ESC 均可关闭；菜单与塔详情遮罩都采用半透明毛玻璃背景。
  - 中央开始按钮：MENU 期「▶ 开始第 1 波」；PREPARE 放塔前不显示（先放塔），放置 ≥1 次后自动出现「▶ 开始第 N 波」，点击隐藏并进入 RESERVE 保留流程。BATTLE/WAVEEND 自动隐藏。

---

### V4-8 塔能量 + 技能系统（独立配置 · 解耦）
> 前置配置 JSON：`conf/game/energy-cfgs.json`、`conf/game/tower-skills.json`；每塔 `towers.json` 携带 `energyCfgId` 与 `skillId`。

#### FR-8.1 能量配置（每塔独立）
- `TowerEnergyCfg`：
  - `id: string`：配置引用键
  - `energyMax: number`：能量上限（默认 100）
  - `energyPerAttack: number`：每次射击命中 +N 能量
  - `energyPerSecond: number`：每秒战斗 tick 全图每塔累加 +N 能量
- 后端接口：`GET /api/config/energy-cfgs` 返回 `{[id]: TowerEnergyCfg}`
- **缺省兜底**：塔没填 `energyCfgId` / 配置缺失 → 套用 `normal = {max:100, perAttack:1, perSec:1}`

#### FR-8.2 技能配置（解耦 · 多塔复用）
- `TowerSkill`：
  - `id: string`：技能引用键
  - `name / desc`：中文名 + 一句说明（用于塔详情卡片）
  - `damageMul: number`：技能激活本次攻击伤害倍率（例 `2.0` = 双倍）
  - `armorIgnorePct01: number`：物理伤害穿甲比例（0~1；1=完全无视护甲）
  - `magicResistIgnorePct01: number`：魔法伤害法穿比例（0~1）
  - `slowMul01: number`：技能命中附加减速百分比（0~1，0=不减速）
  - `slowTicksSec: number`：减速持续秒
- 后端接口：`GET /api/config/tower-skills` 返回 `{[id]: TowerSkill}`
- **缺省兜底**：塔没填 `skillId` → 套 `double_strike = {damageMul:2.0, 其他0}`（保持旧版"双倍"预期）

#### FR-8.3 能量生命周期（per-tower 状态字段）
- grid 真塔对象新增：
  - `energy: number` 当前能量（0~energyMax），存档读/写
  - `skillReady: boolean` 能量是否达到释放阈值（≥ energyMax）
  - `skillActive: boolean` 技能是否"正等待下一次攻击"释放（为 true 时，下一发子弹携带技能参数，命中后消耗 energy）
- 能量累计点：
  1. `battleTick` 每 dt：所有真塔 `energy += energyPerSecond × dt`
  2. `stepTowers` 每次攻击完成：目标塔 `energy += energyPerAttack`
  3. `energy >= energyMax` 时：`energy = energyMax`，`skillReady = true`，触发下一次攻击自动消费
- 技能消费：`fireTowerBullet` 时若 `skillReady && !skillActive` → 设置 `skillActive=true`、子弹携带 `energySkillActive + 4 个技能参数`；命中结算时扣 `energy=0`、`skillActive=false`
- UI：
  - 塔格底部画能量条（黄色 0→满 → 蓝色满格 + 金边框）
  - 塔详情弹框：技能名卡片 + 4 个参数数值 + 当前能量 / 满值百分比
- **存档**：能量字段写进 save_records.grid；读档缺省按 0 初始化

---

### V4-9 伤害类型三分支 + 元素数值配置化（ae67bd8）

#### FR-9.1 伤害类型契约（每塔三选一）
- 塔新增 `damageType ∈ {"physical"|"magic"|"true"}`（towers.json damageType 字段）
- **规范化 & 回退**：前端 `resolveTower()` 与后端都把缺字段 / 非法值 → 统一 `physical`，禁止出现 undefined 行为

#### FR-9.2 敌人新增法抗
- `EnemyConfig` 新增 `magicResist: float64`（数值 0~100，超限 clamp 到 [0,100]）
- 旧 armor 语义 **从乘区 x*(1-armor*0.5) 改为减法点数**：**此为破坏性变更，enemies.json 现有小数 armor（如 0.28）需整体重新标定为合理点数（例 common=8~15，BOSS=80~200）**

#### FR-9.3 统一伤害公式（所有路径一致）
所有攻击路径（普通 / 弹射链最后一跳 / DoubleShot / Crit / finalDamageOverride 预设伤害）**统一过同一套类型公式**：

```
step1 基础伤害 baseDmg
  = attack (来自 calcTowerEffective) × buffDamageMul × skillCfg.damageMul
    或 finalDamageOverride（若有：弹/crit 预设值直接用）

step2 伤害类型公式（三者互斥）
  - physical: typed = max(1, baseDmg - armorActual)
      其中 armorActual = enemy.armor × envArmorMul × (1 - skillCfg.armorIgnorePct01)
      // 含地图环境护甲系数 + 技能穿甲
      // ⚠ armor = 纯点数减法；保底 1 点伤害避免 0
  - magic:    typed = baseDmg × (1 - magicResistActual / 100)
      其中 magicResistActual = clamp(enemy.magicResist, 0, 100)
                                   × (1 - skillCfg.magicResistIgnorePct01)
      // 法抗百分比减免；法穿按对方有效抗比例扣
  - true:     typed = baseDmg  // 无视双抗，跳过 step2 修正

step3 元素抗性（独立维度、三类型都生效）
  resistMul = 1 - (enemy.resistances[element] ?? 0)
  finalDamage = clamp(typed × resistMul, 1, Infinity)
```

**盾抵扣顺序不变**：先 finalDamage → 扣 shield → 扣 hp（与 V4-4 shield 契约兼容）。

#### FR-9.4 元素数值配置化（唯一源：gems.json elements[].baseBonus）
消灭前端 `td-game.js` 4 处硬编码（ice/poison 减速 / light/dark 掉率加成），统一由：
```json
// gems.json -> elements[] 每元素新增 baseBonus 对象
"elements": [
  { "id": "ice", "baseBonus": {
      "slowOnHitPct01": 0.30,
      "slowOnHitSec":  2.0,
      "killGemChanceAdd01": 0.0 } },
  { "id": "light","baseBonus": {
      "killGemChanceAdd01": 0.15 } }
  // 其他元素同理
]
```
- loader 新增 `getElementBonus(element)`：**缺字段 / 非法值 → 兜底历史硬编码**（ice 30% 2s / poison 20% 1.5s / light+0.15 / dark+0.10），保证不配置零影响。
- `isSlowTower` 判定：从 `getElementBonus(element).slowPct > 0` 推导，不再硬编码 `element==='ice'||'poison'`
- 生效点统一替换：`calcTowerEffective 减速 base` / `damageEnemy 命中减速` / `killEnemy 击杀掉率加成`

#### FR-9.5 UI 反馈
- 塔详情弹框「伤害」行文字改为：**伤害 130（80）· 物理 / 魔法 / 真实**，带对应类型标签
- 画布命中数字：三类型颜色区分（物理白、魔法紫、真实金色）

---

### V4-10 数值对齐 + 塔成长=稀有度成长 + L3 金币解锁

#### FR-10.1 数值换算规则（《数值.txt》→ towers.json）
统一换算契约（唯一源：`conf/game/core/数值.txt`）：
- **射程**：400px = 2 格 → `attackRange` 单位为格（如 2.5 / 3.0）
- **减速**：60 = 5% → `slowPct01 = 60/1200`（slow 60 → 0.05，随档位成长 5%→40%）
- **光环**：200 = 20% → `auraAttackFlat` 固定点数（20~70 随档位成长）
- 8 座宝石塔 × 6 档稀有度共 48 组数值全部由 towers.json `levels[0..5]` 承载

#### FR-10.2 塔成长 = 稀有度成长（破坏性变更）
- 塔配置不再按 `cfg.rarity` 分池：**同一宝石塔只有一份配置，稀有度是实例属性**
- `getTowerLevel(cfg, rarity)`：按 `RARITY_ORDER = [common, rare, epic, legendary, mythic, ultimate]` 索引取 `levelsResolved[i]`；未知/缺档回退第 0 档
- Roll 塔产出「宝石类型 + 实例稀有度」，数值即时取对应档位（`placeCandidate` 的 `_rollRarity`）

#### FR-10.3 L3 特效解锁 = 金币升级（替代 V4-5 等级升级链）
- 老的三级升级（等级×40 金、每级 +30%/+10%/+5%）下线；塔等级上限 `LEVEL_MAX = 3`
- L3 特效解锁按钮在塔详情弹窗，费用固定 `L3_UNLOCK_COST = 120` 金；仅 PREPARE / WAVEEND 阶段、真塔、金币足够时可操作

#### FR-10.4 战斗特效配置化生效点
按 towers.json 字段在 `td-game.js` 战斗层实现（全部档位成长）：
- **减速**（蓝宝石）：`slowPct01 + slowSec` 命中减速
- **毒 DoT**（翡翠）：`poisonDoTDps + poisonDoTSec` 持续魔法伤害、可刷新
- **减甲 DEBUFF**（紫水晶）：`armorShredPoints + armorShredSec` 削甲全队受益
- **多重射击**：`multiShotCount` 一次攻击多目标
- **光环**（蛋白石）：`auraRadiusCells + auraAttackFlat` 周友塔攻击加成

---

### V4-11 塔 UI 与保留/合成流程重构

#### FR-11.1 塔详情弹窗操作收敛（A 类升级下线）
- **A 类升级（2 塔升稀有度保持类型）整体下线**：HUD 升级按钮移除，mergeTest 调试入口同步移除
- 保留 / 合成 / 进化入口从 HUD 三按钮收敛到**塔详情弹窗**（点击塔打开）
- **按钮显隐规则 = 有可用操作才显示**（不能操作不显示）：
  - `ti-fusion`：合成窗口开启 && `_canFusionFrom(idx)`（本塔 + 另 2 座「同稀有度·不同类型」非特殊塔可凑齐）
  - `ti-evolve`：合成窗口开启 && `_canEvolveFrom(idx)`（存在配方使本塔可作材料且其余材料可凑齐）
  - `ti-reserve`：合成窗口开启 && 该格是本波候选塔（T_CAND）
  - `ti-upgrade`（L3 特效解锁）：真塔 && PREPARE/WAVEEND && 金币 ≥ 120

#### FR-11.2 保留流程（原 RESERVE 弹窗下线）
- **合成窗口**定义：`PREPARE 阶段 && placementUsed >= placementTotal(5)`（放满 5 塔、尚未保留）
- 放满 5 塔后点击任意候选塔 → 塔详情显示「📌 保留本塔」；点击后：
  1. 保留塔 T_CAND → T_TOWER；其余候选逐个 `to_wall`（terrainGate，失败整体回滚）
  2. `candidates` 清空 → 直接 `phase = BATTLE` 开战（不再经过 RESERVE 弹窗）
- 未放满 5 塔时塔详情四个操作按钮全部隐藏

#### FR-11.3 合成/进化流程（放满未保留窗口内可操作）
- 窗口内本波候选塔（T_CAND）**可作为合成/进化材料**（`_mergeSelectablePool` 含 T_CAND）
- 从塔详情点「合成/进化」→ 进入对应模式且**本塔预选为第一材料**（`_tiAction`）
- 选满 3 座 → 校验 → 确认弹窗 → 确认后（`onMergeModalConfirm`）：
  1. 产物落在最后素材格（既有规则）；素材塔移除
  2. **其余本波候选塔全部变墙**（`_resolveRemainingCandidatesToWalls`：逐个 `to_wall`，封路则退化为草地保证路径可走）
  3. 直接 `phase = BATTLE` 开战，msg「合成进化完成，其余本波塔已变墙，战斗开始！」

#### FR-11.4 开始按钮改造
- 从画布中央大按钮移至**右上角菜单按钮旁**（`#hud-top-right` 内，`#btn-menu` 左侧）
- 缩小为圆形 **▶ 三角图标、无文字**（`.h-start-btn`，min 40×40px）
- 显隐：MENU / WIN / LOSE 显示；PREPARE / BATTLE / WAVEEND 隐藏（PREPARE 引导语指向塔详情操作）

#### FR-11.5 合成产物稀有度修复（bug fix）
- B 类合成产物稀有度必须 = `outputRarity`（`nextRarityUp` 结果，如 common×3 → rare），**不得取 `cfg.rarity`（配置基础稀有度恒为 common）**——V4-10 稀有度是实例属性后的连带修正

#### FR-11.6 工程配套
- 静态资源引用统一带 `?v=` 版本参数（td.css / 4 个 JS），杜绝浏览器旧缓存导致的"页面旧代码"问题
- mergeTest 调试接口新增：`placeCandidates(n)`（走 placeCandidate 真实放置）、`clickCell(idx)`（模拟 canvas 点击走 onCanvasClick）、`towerModalState()`（弹窗 + 四按钮可见性快照）

---

## Non-Functional Requirements (NFRs)
- **NFR-1 性能**：PC（i5+8G+Chrome）80 敌人 / 40 塔同屏 FPS ≥ 55；移动端骁龙 660 同款压力下 FPS ≥ 30（不强制，Spine 模式下允许低 5 帧）。
- **NFR-2 存档兼容**：V3-6 存档在 V4 启动后点「读档」必须 100% 恢复（缺字段用默认值）。
- **NFR-3 后端兼容性**：`/api/config/*` 接口新增字段必须给 v3 客户端传缺省字段（空数组 / 0 / null 合法），禁止 v3 客户端 parse 报错。
- **NFR-4 日志可追溯**：V4 每个新系统加独立 log tag：[DIFFICULTY]/[MAPx]/[MERGE]/[BOSS-SKILL]/[LEVEL-BRANCH]/[SHOP]/[TALENT]/[LB]/[SPINE]/[MOBILE]；错误等级 e/w/i 按 V3 惯例。
- **NFR-5 Spine 降级**：无论 Spine 失败什么原因，Canvas 2D 必须能继续玩，FPS 不低于 NFR-1。
- **NFR-6 首屏加载**：`/td` 首屏 DOMContentLoaded → applyCfg resolve ≤ 3.5s（含后端 config 8 个请求 + fallback 兜底失败时间）。
- **NFR-7 能量/技能配置兼容性**：`/api/config/energy-cfgs` 与 `/api/config/tower-skills` 缺失单字段时，前端 fallback 不报错；towers.json 缺 energyCfgId/skillId/ damageType 三字段 → 仍能开局，默认 normal/double_strike/physical。
- **NFR-8 伤害类型路径一致性**：普通攻击 / 弹射链 / double_shot / crit / finalDamageOverride 五条路径的最终伤害，必须有同一套类型公式结果（单测 10 条 10/10 用例通过，见 ae67bd8 提交验证）。

---

## Acceptance Criteria (ACs)

### Rule 型（客观可断言）
- **AC-1（难度选择可持久）**：evaluate 点困难 → 开局 10s step 后读 `state.enemies[0].cfg.hp`：困难 = 普通对应敌人 HP × 1.8（±5%）。
- **AC-2（存档按桶分）**：同一账号，先以「草原/普通」开一局保存；再开「草原/困难」开局存档 → `state.gold` 必须是困难开局的 50（不是之前保存的值），确认互不干扰。
- **AC-3（多地图环境生效）**：冰霜地图开局 → 随便 Roll 一座非冰元素塔 → `calcTowerEffective().eff.interval` vs. 草原地图同塔：冰霜 eff.interval ≤ 草原 × 0.952（攻速 +5%）。
- **AC-4（熔岩伤害）**：熔岩地图 wave1 开始，生成 1 只 enemy 走在 lava tile 上 1s 后 `enemy.hp ≤ baseHP - 10`（2 次 lava_damage_5hp）。
- **AC-5（地图解锁）**：草原 wave ≥ 4 通关后，新 difficulty select 上「熔岩」不再 disabled。
- **AC-6A（A 类合成：2 同塔升稀有度+保持类型）**：放 2 座同类型 ARCHER、同 common 真塔 → 点升级 → 点取消 → selection 清空、源塔不变；再点确认合成 → 新塔落地在最后点击的素材格（② gridIdx）且是 rare ARCHER（类型不变）；其 damage ≈ max(2 座 base) × 1.25；源 2 格中除落地格外其余 1 格变草地；a* 验证 start→base 仍有路径。
- **AC-6B（B 类合成：3 不同类型同稀有度→随机类型升档）**：放 3 座 CANNON/ARCHER/SPLASH（3 不同类型）common 真塔（任意位置）→ 点合成 → modal 仅显示产物稀有度（不显示具体塔名）→ 点确认 → 新塔落地在最后点击素材格（③ gridIdx）且 rarity=rare、towerCfgId ∈ 普通塔池（`!towerCfg.special`）；其余 2 座源塔格变草地；a* 路径仍通。
- **AC-6C（C 类合成：配方产出特殊塔）**：放 PYRO+CRYO+ELECTRO（3 座 common，任意位置）→ PREPARE 阶段 `#btn-evolve` 高光；点进化 → 顶部配方提示条显示 C-FUSION Tab + 三材料勾选 → 选满 3 座 → 预览显示「C-FUSION · 元素融合塔 · epic 固定」+ 特殊增益说明 → 确认后落地在最后素材格（③ gridIdx）产出 `FUSION_EPIC` 且 `towerCfgById[towerCfgId].special == true`；同时验证 rollTowerByLuckLevel() 的输出池里从未出现 `FUSION_EPIC` / `DESTROYER_EPIC` / `GEMLORD_LEG` 等特殊 towerCfgId。
- **AC-6D（特殊塔只来自配方：隔离校验）**：连续 100 次调用 rollTowerByLuckLevel()（含 placeCandidate + 商店购买塔两种入口，mock luckLevel=高）→ 结果集中所有 towerCfgId 的 `towerCfgById[id].special` 全为 `false`；同样 B 类合成随机结果池 100 次中所有 towerCfgId 也全为 `false`。
- **AC-7（三模式交互：取消重置 / 落点正确 / 高光 + 配方提示）**：
  - A 类：点升级 → 选 2 座符合条件的塔 → modal 出现「取消」按钮 → 点取消 → `state.upgradeSelection.length === 0` 且源塔仍在原位；重新选 2 座 → 点确认 → 新塔落地 = 最后点击素材格（②的 gridIdx）。
  - B 类：点合成 → 选 3 座符合条件的异塔 → modal 仅显示「产物稀有度」不显示产物 towerCfgId → 点确认 → 新塔落地 = 最后点击素材格（③的 gridIdx）。
  - C 类：准备阶段 `detectEvolvable()` 命中 C-FUSION 配方 → `#btn-evolve` 有 `high-glow` 类；点进化 → 画布顶部「配方提示条」可见且显示 C-FUSION tab + PYRO/CRYO/ELECTRO 三材料勾选状态。
- **AC-8（护盾兵伤害）**：生成 1 只 SHIELD enemy（shield=30, HP=100），承受 40 点伤害 1 次 → `enemy.shield=0 && enemy.hp=90`（先扣盾 30 再扣血 10）。
- **AC-9（治疗师治疗）**：把 HEALER 与 1 只 50% HP FAST 放在同路径 2 格内，stepBattle 2s 后 FAST.hp ≥ FAST.baseHP*0.7。
- **AC-10（BOSS 2 meteor 眩晕）**：触发 BOSS 2 meteor skill 后，选 1 座随机命中范围内塔 → `tower.stunUntil > state.waveElapsed - 1s` 成立（眩晕 1s）。
- **AC-11（BOSS 3 ice 冰冻）**：触发 BOSS 3 ice_freezer 后 2s 内，`state.enemies[0].pos` 不变（dt=0 生效），之后 3 秒 `enemy.effectiveSpeed ≤ baseSpeed * 0.5`。
- **AC-12（塔升级数值 + L3 随机效果）**：L0 塔 damage=100 → 升到 L1 damage≈130（±2%）；→ 升到 L2 ≈169（±2%）；→ 升到 L3（基础 +30% 后 ≈ 219.7）后叠加 L3 rollEffect：
  - 若 `rollEffect==='effect_offense'` → damage ≥ 219.7×1.4 = 307.6（±2%）；
  - 若 `rollEffect==='effect_crit'` → 20 次攻击中至少 1 次打出 2.5× 暴击。
  - 存档兼容：v3 存档塔 level=0、`rollEffect===null`。
- **AC-13（双重打击：另选敌人额外攻击一次）**：把一座 `rollEffect==='effect_double_shot'` 的 L3 塔放在场上，喂 2 只以上不同敌人进入塔范围 → stepBattle 触发塔一次完整攻击流程 → 统计到「对主目标一次 + 对非主目标另一个敌人额外一次」两条伤害事件（共 2 次），且额外攻击的伤害 = 主攻击 damage × 0.8（±5%）。
- **AC-13B（弹射链击验证 · 新增）**：把一座 `rollEffect==='effect_ricochet'` 的 L3 塔放在场上，喂 3 只不同敌人连成 2 格内相邻 → 一次主攻击后统计 3 条伤害（主目标 + 第 2 敌人 60% + 第 3 敌人 42%），最后一跳伤害相对主攻击 ≥ 主攻击 × 0.6 × 0.7（=0.42）容差 ±5%。
- **AC-14（商店买塔落地）**：WAVEEND，金币≥120 → 购买塔 → 点空地 → 该格 tile = T_TOWER，state.gold = 原 gold - 120。
- **AC-15（商店金币不足）**：WAVEEND，金币=30 → 抽 Buff 按钮 disabled 且文字灰色。
- **AC-16（天赋跨局生效）**：账号天赋 atk1 已点亮 → 新开局任意塔 calcTowerEffective().eff.damage / 未点亮账号同塔 damage ≥ 1.05（±0.01）。
- **AC-17（排行榜提交+查询）**：通关 WIN 结局后 1s 查 /api/lb?mapId=1&difficulty=normal → top1 含 uid 且 score_highestWave==waveIndex。
- **AC-18（移动端点击 · 2026-08-24 热修）**：
  - (a) 移动端 viewport 模拟宽度 414px（iPhone XR）→ canvas 渲染高度 ≤ window.innerHeight*0.9；触屏 1 次「点击」同 canvas click 逻辑（能放塔）。
  - (b) **滑动阈值 25px**：touchstart→touchend 在 X/Y 位移 15px（>旧10，<新25）之间 → 仍被识别为有效 tap（合成 onCanvasClick 触发）；位移 30px+ 才判为滑动不触发。
  - (c) **中央开始按钮不挡放塔**：`@media (pointer: coarse)` 下 `.center-start` 的 `getBoundingClientRect().top` 必须 >= canvas 底-32px（贴画布底部），且桌面浏览器（pointer: fine）下仍 `top=50%` 居中。
- **AC-19（Spine 降级 Canvas 2D）**：手动把 spine-webgl.js 暂时重命名 → 页面刷新不报错；仍能正常 5 塔放 + 保留 + 战斗。
- **AC-20（v3 存档读档兼容）**：加载一份 v3-6 没有 `level/rollEffect/difficulty/mapId` 字段的 save.json → readArchive 不抛异常；开局所有塔 level=0 rollEffect=null，difficulty=normal mapId=1。
- **AC-21（能量系统 · 加能 & 触发）**：构造 emptyCfgId 塔（fallback normal：max 100 / perAtk 1 / perSec 1），在 state.running 下 stepBattle 50 秒 + 攻击 50 次 = energy≥100 → `skillReady===true`；下一次 fireTowerBullet 产生的子弹必带 `energySkillActive=true` 且命中瞬间 energy 清零。
- **AC-22（技能解耦 · per-tower 配置生效）**：取两座不同塔 T1(energyCfgId=fast, skillId=heavy_strike), T2(energyCfgId=slow, skillId=frost_explosion)
  - T1.energyMax == fastCfg.max，T2.fireTowerBullet 携带技能参数 frost（slowMul / slowTicksSec 与配置一致 → 命中 2 秒内 enemy.slowPct≥ frost.slowMul-0.02）
- **AC-23（部署端口 · TD_PORT 生效）**：启动进程时 env TD_PORT=9090 → `netstat` / HTTP GET `:9090/api/health` 200，同时 `:8080` 无监听。
- **AC-24（伤害类型三分支公式 · ae67bd8 单测 10/10 等价）**：
  - 物理塔 (armorIgnore=0) attack=100 打 armor=20 抗 0 → finalDmg≈80
  - 物理塔 + armorIgnorePct01=1.0 打 armor=20 → finalDmg≈100（穿甲）
  - 魔法塔 attack=100 打 magicResist=50 → 50
  - 魔法塔 magicResistIgnore=0.5 打 magicResist=80 → 100 × (1 - 40/100) = 60
  - 真实塔 attack=100 打 armor=100/magicResist=100 → 100（无视双抗）
  - 元素抗性叠加：物理 100 × resistances.fire=0.3 → final=70
  - 非法 damageType / 缺字段 → 全部按 physical 计算（与 attack×1-armor 公式一致）
  - finalDamageOverride=200 路径：三种类型结果同样按类型公式修正，且仍乘元素抗。
- **AC-25（UI 收纳 · 极简 HUD）**：页面 applyCfg 完成后：
  - (a) 画面左上区域 chip：`.hud-top.left` 含金币 / 生命 / 运气 3 项，`.hud-top.right` 含波次 + ▶开始按钮 + ☰菜单按钮（V4-11）。
  - (b) 原 `#hud / #left-panel / #right-panel` 要么 DOM 不存在，要么 CSS 视觉隐藏（`.h-hidden` 或 `display:none`）。
  - (c) 点 ☰菜单 → `.side-menu.open === true` 且有 `.menu-mask` 半透明遮罩（mask 点击或 ESC 均可关闭）。
  - (d) MENU phase 立即展示开始按钮（V4-11 起：`#hud-top-right` 内 `.h-start-btn` ▶ 三角图标无文字，替代旧 `.center-start` 中央大按钮）；点击后进入 PREPARE，按钮隐藏；放塔期间不再出现（保留/合成入口收敛到塔详情弹窗，见 AC-28）。
  - (e) 塔详情 modal + 菜单 modal 的遮罩背景均 rgba alpha<0.3 且带 blur（毛玻璃半透明而非完全遮挡）。
- **AC-26（元素数值配置化 · 兜底不零）**：手动把 gems.json 里 ice/poison/light/dark 4 个 baseBonus 字段全部删除后 reload → applyCfg 不抛异常，`getElementBonus('ice').slowPct`=0.30 且 `slowSec`=2.0（硬编码兜底生效）。
- **AC-27（V4-10 稀有度成长 + L3 金币解锁 + 战斗特效）**：
  - (a) `getTowerLevel(蓝宝石cfg, 'rare')` 返回 levels[1]（baseDamage=4, slowPct01=0.075）；`getTowerLevel(cfg, 'ultimate')` 返回 levels[5]（slowPct01=0.40）。
  - (b) PREPARE 放 1 座真塔金币=200 → 塔详情「解锁 L3 特效」按钮可见且文案含「-120 金」；金币=50 时按钮不显示。
  - (c) 战斗特效：蓝宝石命中后 2 秒内 enemy 减速生效；翡翠命中后出现 poison DoT tick；紫水晶命中后 enemy armorActual 下降；蛋白石周围 2 格友塔 attack 提升 auraAttackFlat。
- **AC-28（V4-11 塔详情操作收敛 + 保留/合成变墙开战 · 2026-08-24 浏览器验证通过）**：
  - (a) **未放满隐藏**：PREPARE 只放 1 座候选塔 → 点击它打开塔详情，`ti-fusion/ti-evolve/ti-reserve/ti-upgrade` 四按钮全部 `display:none`。
  - (b) **保留流程**：放满 5 塔后点击候选塔 → 详情显示「保留本塔」（其余按钮按可用性）→ 点击后：弹窗关闭、`phase=BATTLE`、`candidates.length=0`、其余 4 座候选塔格变墙。
  - (c) **合成变墙开战**：放满 5 塔 + 场上 3 座同稀有度不同类型真塔 → 点击第一座真塔详情显示「合成」→ 点击进入合成模式（本塔预选①）→ 点满 3 座 → 确认后：产物落在第 3 素材格且 **rarity=rare**（FR-11.5 修复验证）、素材塔清空、其余候选塔变墙、`phase=BATTLE` 直接开战。
  - (d) **开始按钮**：MENU 阶段 `#btn-start-wave` 可见、textContent='▶'（无文字）、位于 `#hud-top-right` 内 `#btn-menu` 左侧；PREPARE/BATTLE 阶段隐藏。

### Rubric 型（评分维度，0-2）
- **R-1 复玩性（0-2）**：
  - 2：3 地图 × 3 难度 × 3 天赋线组合 ≥ 27 种开局体验，且每局节奏/敌人分布差异明显。
  - 1：有多种组合选择，但开局体验差异一般（Boss 技能与环境明显可感知，但普通波差异不明显）。
  - 0：选择项多但体验差异不感知或明显不平衡。
- **R-2 新手友好度（0-2）**：
  - 2：每个 V4 新系统首次出现时都有 1 次新手引导 tooltip（至少 1 句 + 下一步按钮）；合成/分支/商店失败时均有可操作的错误提示（不是「失败」2 字）。
  - 1：有部分引导或提示，但 1-2 处系统无引导（用户靠猜上手）。
  - 0：多个 V4 新系统无引导，玩家操作 5 次以上才会用。
- **R-3 性能/流畅度（0-2）**：
  - 2：80 敌 + 40 塔压力测试（Canvas 2D / Spine 两种模式）FPS ≥ NFR-1 目标，无明显卡顿抖动。
  - 1：偶尔 0.2-0.5s 级卡顿，但不影响操作。
  - 0：平均 FPS 低于阈值 ≥ 3 次/ 30s。
- **R-4 移动端体验（0-2）**：
  - 2：414px 宽度下完整打完一波（放置+保留+战斗）无障碍，触屏手势（点击/长按/缩放）全部可用，按钮不会误触。
  - 1：核心流程可用，但 1-2 处需滚动或缩放后才能点到，或 1 处手势易混淆。
  - 0：明显布局错位、无法完成基本操作。
- **R-5 后端 & 排行榜正确性（0-2）**：
  - 2：排行榜高并发（100 uid 同时 submit）下 Redis ZSet 正确排序，DB upsert 无死锁/丢分；查询接口 50th 分位 ≤ 80ms。
  - 1：排行榜总体正确但 1-2 条边界 case 分数异常；DB 查询 ≤ 200ms。
  - 0：出现 2 条以上分数串号或 DB 查询超时 2s+。

---

## Open Questions (OQ)
- OQ-1：Spine 资源是否已有现成 6 个动画？如果缺失，MVP 阶段先允许 Canvas 2D 升级，Spine 延后到 v4.1 补丁。
- OQ-2：C 类配方塔的「特殊增益」实际数值（光环幅度、雷击链次数）是否需要调整？V4 默认按 spec.md 当前表实现；若实测过强/过弱再数值微调。
- OQ-3：排行榜需不需要「每周重置赛季」？V4 默认不做（只做永久榜）。若需要可在 V4-7 实现中以 `{YYYY}-{WW}` 前缀分桶 Redis key，不扩表。
- OQ-4：天赋树可洗点功能默认不做（NG）。如果用户明确要，可加 100 金重置功能（不锁定不回退）。
