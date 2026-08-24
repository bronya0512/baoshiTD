// ============================================================
// td-config-fallback.js (MVP v2 — 4r×6e=24 塔 + luck + buffs + enemies 新字段 + waves 新字段)
// 规则：和 Go 后端 24 塔静态生成器一一对应（rarityTpl × elemBonus），waves 每波 placementPerWave=5。
// ============================================================
(function () {
  'use strict';

  var rarityCN = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };
  var elemColor = {
    fire: '#fc8181', ice: '#63b3ed', thunder: '#f6e05e',
    poison: '#68d391', light: '#faf089', dark: '#9f7aea'
  };
  var rarityTpl = {
    common:    { dmgMul: 1.00, rangeInCells: 2, attackIntv: 0.9, isAOE: false, aoeRadiusPx: 0 },
    rare:      { dmgMul: 1.50, rangeInCells: 2, attackIntv: 0.8, isAOE: false, aoeRadiusPx: 0 },
    epic:      { dmgMul: 2.20, rangeInCells: 3, attackIntv: 0.7, isAOE: true,  aoeRadiusPx: 40 },
    legendary: { dmgMul: 3.00, rangeInCells: 3, attackIntv: 0.6, isAOE: true,  aoeRadiusPx: 56 }
  };
  // 默认 multiplier 全部 1.0，避免 0 除数（保持与后端 handler/config.go 对齐）
  var elemBonus = {
    fire:    { damageMul: 1.20, attackIntvMul: 1.0, rangeMul: 1.0, slowOnHitPct: 0,    slowOnHitSec: 0,   killBonusAdd: 0    },
    ice:     { damageMul: 1.00, attackIntvMul: 0.83, rangeMul: 1.0, slowOnHitPct: 0.30, slowOnHitSec: 2.0, killBonusAdd: 0    },
    thunder: { damageMul: 1.00, attackIntvMul: 1.0, rangeMul: 1.15, slowOnHitPct: 0,    slowOnHitSec: 0,   killBonusAdd: 0    },
    poison:  { damageMul: 1.10, attackIntvMul: 1.0, rangeMul: 1.0, slowOnHitPct: 0.20, slowOnHitSec: 1.5, killBonusAdd: 0    },
    light:   { damageMul: 1.00, attackIntvMul: 0.91, rangeMul: 1.0, slowOnHitPct: 0,    slowOnHitSec: 0,   killBonusAdd: 0.15 },
    dark:    { damageMul: 1.10, attackIntvMul: 1.0, rangeMul: 1.10, slowOnHitPct: 0,    slowOnHitSec: 0,   killBonusAdd: 0.10 }
  };
  var RARITIES = ['common', 'rare', 'epic', 'legendary'];
  var ELEMENTS = ['fire', 'ice', 'thunder', 'poison', 'light', 'dark'];
  var COMMON_BASE_DMG = 40;

  function makeTowers24() {
    var arr = [];
    var id = 1;
    for (var ri = 0; ri < RARITIES.length; ri++) {
      var r = RARITIES[ri];
      var tpl = rarityTpl[r];
      for (var ei = 0; ei < ELEMENTS.length; ei++) {
        var e = ELEMENTS[ei];
        var eb = elemBonus[e];
        var baseDamage = COMMON_BASE_DMG * tpl.dmgMul * eb.damageMul;
        var attackIntv = tpl.attackIntv * eb.attackIntvMul;
        var attackSpeed = 1 / attackIntv;
        var attRange = tpl.rangeInCells * eb.rangeMul;
        var name = rarityCN[r] + '\u00b7' + e + '\u5854'; // "·塔"
        arr.push({
          id: id++, name: name, element: e, rarity: r,
          description: name,
          levels: [{ level: 1, baseDamage: baseDamage, attackRange: attRange, attackSpeed: attackSpeed, cost: 0, upgradeCost: 0 }],
          canTargetFly: (r !== 'epic'),
          isAOE: tpl.isAOE, aoeRadiusPx: tpl.aoeRadiusPx,
          color: elemColor[e]
        });
      }
    }
    return arr;
  }

  var TOWERS = makeTowers24();

  var ENEMIES = [
    { id: 1, name: '\u5c0f\u5175', type: 'normal',
      baseHP: 60, speed: 54, armor: 0, resistances: {},
      flying: false, isBoss: false, isElite: false, dropGemRate: 0.25,
      killBaseGold: 10, dropBonusRate: 0.30,
      rewardCoin: 12, damageToBase: 1, color: '#68d391', radiusPx: 11 },
    { id: 2, name: '\u75be\u884c\u8005', type: 'swift',
      baseHP: 40, speed: 90, armor: 0, resistances: { light: 0.2 },
      flying: false, isBoss: false, isElite: false, dropGemRate: 0.20,
      killBaseGold: 8, dropBonusRate: 0.25,
      rewardCoin: 10, damageToBase: 1, color: '#63b3ed', radiusPx: 10 },
    { id: 3, name: '\u91cd\u7532\u5175', type: 'heavy',
      baseHP: 220, speed: 36, armor: 0.30, resistances: { fire: 0.20 },
      flying: false, isBoss: false, isElite: true, dropGemRate: 0.40,
      killBaseGold: 22, dropBonusRate: 0.45,
      rewardCoin: 28, damageToBase: 2, color: '#a0aec0', radiusPx: 14 },
    { id: 4, name: '\u5143\u7d20\u7cbe\u82f1', type: 'elite',
      baseHP: 360, speed: 45, armor: 0.15, resistances: { ice: 0.40, thunder: 0.40 },
      flying: false, isBoss: false, isElite: true, dropGemRate: 0.55,
      killBaseGold: 35, dropBonusRate: 0.55,
      rewardCoin: 45, damageToBase: 3, color: '#d53f8c', radiusPx: 15 },
    { id: 5, name: 'BOSS', type: 'boss',
      baseHP: 2400, speed: 30, armor: 0.35, resistances: {},
      flying: false, isBoss: true, isElite: true, dropGemRate: 1.0,
      killBaseGold: 200, dropBonusRate: 1.0,
      rewardCoin: 300, damageToBase: 10, color: '#9b2c2c', radiusPx: 22 },
    // V3-2 id=6 规范 Boss（roadmap: ×20 HP / ×0.6 Speed / ×2.5 半径 / ×5 基地伤害）
    { id: 6, name: 'BOSS\u00b7\u708e\u72f1\u9886\u4e3b', type: 'boss',
      baseHP: 1200, speed: 32, armor: 0.20, resistances: { fire: 0.30 },
      flying: false, isBoss: true, isElite: false, dropGemRate: 1.0,
      killBaseGold: 200, dropBonusRate: 1.0,
      rewardCoin: 300, damageToBase: 5, color: '#991b1b', radiusPx: 28 },
    // ===== V4 Task 7：5 种新精英（id=7~11） =====
    // 7: SHIELD 盾兵（自带护盾值 30）
    { id: 7, name: '\u76fe\u76d2\u5175', type: 'shield',
      baseHP: 180, speed: 40, armor: 0.10, resistances: {},
      flying: false, isBoss: false, isElite: true, dropGemRate: 0.45,
      killBaseGold: 20, dropBonusRate: 0.40,
      rewardCoin: 25, damageToBase: 2, color: '#718096', radiusPx: 13,
      shield: 30 },
    // 8: HEALER 治疗师（每 1s 对 2 格内友军治疗 12 HP）
    { id: 8, name: '\u6cbb\u7597\u5e08', type: 'healer',
      baseHP: 140, speed: 42, armor: 0.05, resistances: { poison: 0.30 },
      flying: false, isBoss: false, isElite: true, dropGemRate: 0.45,
      killBaseGold: 22, dropBonusRate: 0.40,
      rewardCoin: 28, damageToBase: 2, color: '#48bb78', radiusPx: 12,
      healPerSec: 12, healRadiusCells: 2 },
    // 9: SUMMONER 召唤师（每 6s 召唤 2 只速行者 FAST）
    { id: 9, name: '\u53ec\u5524\u5e08', type: 'summoner',
      baseHP: 200, speed: 38, armor: 0.10, resistances: { dark: 0.30 },
      flying: false, isBoss: false, isElite: true, dropGemRate: 0.50,
      killBaseGold: 28, dropBonusRate: 0.50,
      rewardCoin: 35, damageToBase: 3, color: '#805ad5', radiusPx: 13,
      summonEveryNSec: 6, summonSpawnId: 10, summonCountPer: 2 },
    // 10: FAST 极速者（超高速度，比 id=2 疾行者更快）
    { id: 10, name: '\u6781\u901f\u8005', type: 'fast',
      baseHP: 30, speed: 130, armor: 0, resistances: {},
      flying: false, isBoss: false, isElite: false, dropGemRate: 0.20,
      killBaseGold: 6, dropBonusRate: 0.25,
      rewardCoin: 8, damageToBase: 1, color: '#4fd1c5', radiusPx: 9 },
    // 11: SPLITTER 分裂者 / 熔岩暴君（死亡 → 分裂 2 只 FAST id=10；同时带 meteor 技能）
    { id: 11, name: 'BOSS\u00b7\u7194\u5ca9\u66b4\u541b', type: 'boss',
      baseHP: 3200, speed: 28, armor: 0.25, resistances: { fire: 0.40 },
      flying: false, isBoss: true, isElite: true, dropGemRate: 1.0,
      killBaseGold: 260, dropBonusRate: 1.0,
      rewardCoin: 380, damageToBase: 8, color: '#c05621', radiusPx: 30,
      splitInto: { enemyId: 10, count: 2 },
      skills: [
        { id: 'meteor', firstAtSec: 10, everySec: 15, warningSec: 1.5, warningColor: '#ef4444',
          extra: { radiusCells: 1.5, trueDamage: 200, towerStunSec: 1 } }
      ] },
    // 12: ICE QUEEN 冰霜女王（带 ice freezer 冰冻技能）
    { id: 12, name: 'BOSS\u00b7\u51b0\u971c\u5973\u738b', type: 'boss',
      baseHP: 4200, speed: 26, armor: 0.28, resistances: { ice: 0.60 },
      flying: false, isBoss: true, isElite: true, dropGemRate: 1.0,
      killBaseGold: 320, dropBonusRate: 1.0,
      rewardCoin: 460, damageToBase: 10, color: '#2b6cb0', radiusPx: 32,
      skills: [
        { id: 'ice', firstAtSec: 8, everySec: 18, warningSec: 1.0, warningColor: '#4299e1', durationSec: 2.5,
          extra: { freezeSec: 2.0, slowMul: 0.5, slowRemnantSec: 4.0 } }
      ] }
  ];

  // --- LUCK（v2 新增）：5 档，bonusRarityWeights 代替 gemRarityWeights ---
  var LUCK = {
    initialLevel: 1,
    levels: [
      { level: 1, upgradeCostGold: null,
        towerRarityWeights: { common: 70, rare: 25, epic:  4, legendary: 1 },
        bonusRarityWeights: { common: 70, rare: 25, epic:  4, legendary: 1 } },
      { level: 2, upgradeCostGold: 60,
        towerRarityWeights: { common: 55, rare: 35, epic:  8, legendary: 2 },
        bonusRarityWeights: { common: 60, rare: 32, epic:  6, legendary: 2 } },
      { level: 3, upgradeCostGold: 120,
        towerRarityWeights: { common: 40, rare: 40, epic: 15, legendary: 5 },
        bonusRarityWeights: { common: 50, rare: 38, epic: 10, legendary: 2 } },
      { level: 4, upgradeCostGold: 240,
        towerRarityWeights: { common: 25, rare: 40, epic: 28, legendary: 7 },
        bonusRarityWeights: { common: 40, rare: 40, epic: 16, legendary: 4 } },
      { level: 5, upgradeCostGold: 500,
        towerRarityWeights: { common: 15, rare: 35, epic: 38, legendary: 12 },
        bonusRarityWeights: { common: 30, rare: 40, epic: 22, legendary: 8 } }
    ]
  };

  // --- BUFFS（v2 新增）：RollCostGold=40，10 条 Buff ---
  var BUFFS = {
    rollCostGold: 40,
    buffs: [
      { id: 'atk_1',   name: '\u653b\u51fb+15%', rarity: 'common', effect: { towerDamageMulAll: 1.15 } },
      { id: 'atk_2',   name: '\u653b\u51fb+25%', rarity: 'rare',   effect: { towerDamageMulAll: 1.25 } },
      { id: 'atk_3',   name: '\u653b\u51fb+40%', rarity: 'epic',   effect: { towerDamageMulAll: 1.40 } },
      { id: 'spd_1',   name: '\u5c04\u901f+20%', rarity: 'common', effect: { towerAttackIntervalMulAll: 0.83 } },
      { id: 'spd_2',   name: '\u5c04\u901f+35%', rarity: 'rare',   effect: { towerAttackIntervalMulAll: 0.74 } },
      { id: 'rng_1',   name: '\u5c04\u7a0b+15%', rarity: 'common', effect: { towerRangeMulAll: 1.15 } },
      { id: 'gold_1',  name: '\u51fb\u6740\u91d1\u5e01+20%', rarity: 'rare', effect: { killGoldMulAll: 1.20 } },
      { id: 'gold_2',  name: '\u51fb\u6740\u91d1\u5e01+40%', rarity: 'epic', effect: { killGoldMulAll: 1.40 } },
      { id: 'slow_1',  name: '\u51cf\u901f\u6548\u679c+20%', rarity: 'rare', effect: { slowStrengthMulAll: 1.20 } },
      { id: 'lucky_1', name: '\u5956\u52b1\u547d\u4e2d+10%', rarity: 'epic', effect: { killBonusGoldChanceAddAll: 0.10 } }
    ],
    rollRarityWeights: {
      '1': { common: 70, rare: 25, epic:  4, legendary: 1 },
      '2': { common: 60, rare: 32, epic:  7, legendary: 1 },
      '3': { common: 50, rare: 35, epic: 13, legendary: 2 },
      '4': { common: 40, rare: 35, epic: 20, legendary: 5 },
      '5': { common: 30, rare: 35, epic: 28, legendary: 7 }
    }
  };

  // --- GEMS（v1 兼容保留，v2 前端不再使用） ---
  var GEMS = {
    elements: [
      { key: 'fire',    name: '\u706b', color: '#e53e3e', baseBonus: { attrMulDamage: 1.20 } },
      { key: 'ice',     name: '\u6c34', color: '#3182ce', baseBonus: { attrMulAttackInterval: 0.83 } },
      { key: 'thunder', name: '\u98ce', color: '#ecc94b', baseBonus: { attrMulRange: 1.15 } },
      { key: 'poison',  name: '\u571f', color: '#38a169', baseBonus: { slowOnHitPct01: 0.20, slowOnHitSec: 1.5 } },
      { key: 'light',   name: '\u5149', color: '#faf089', baseBonus: { killGemChanceAdd01: 0.15 } },
      { key: 'dark',    name: '\u6697', color: '#805ad5', baseBonus: { attrMulDamage: 1.10, killGemChanceAdd01: 0.10 } }
    ],
    rarities: [
      { key: 'common',    name: '1\u9636', multiplier: 1.00, dropRate: 0.60 },
      { key: 'rare',      name: '2\u9636', multiplier: 1.50, dropRate: 0.28 },
      { key: 'epic',      name: '3\u9636', multiplier: 2.20, dropRate: 0.10 },
      { key: 'legendary', name: '4\u9636', multiplier: 3.00, dropRate: 0.02 }
    ]
  };

  // --- MAPS ---
  // V4-2 地图环境 Buff：grass 塔射程+5% / lava 基地伤害×0.8 + 熔岩Tile每0.5s扣5HP真实伤害 / ice 塔攻速+5.3%≈interval×0.95 & 敌攻速-15.3%≈interval×1.18
  var ENV_GRASS = { id: 'grass', name: '\u8349\u539f\u5e73\u539f', towerMul: { rangeMul: 1.05 }, enemyMul: {} };
  var ENV_LAVA  = { id: 'lava',  name: '\u7194\u5ca9\u6d1e\u7a74', towerMul: {}, enemyMul: { damageMul: 0.8 }, onTick: 'lava_damage_5hp', lavaDmg: 5, lavaEverySec: 0.5 };
  var ENV_ICE   = { id: 'ice',   name: '\u51b0\u971c\u9ad8\u5730', towerMul: { attackIntervalMul: 0.95 }, enemyMul: { attackIntervalMul: 1.18 } };
  var MAPS_LIST = [
    { id: 1, name: '\u8349\u539f\u5e73\u539f', theme: 'grassland', difficulty: 1, maxWaves: 8, thumbnailUrl: '', environment: ENV_GRASS },
    { id: 2, name: '\u7194\u5ca9\u6d1e\u7a74', theme: 'lava',      difficulty: 2, maxWaves: 8, thumbnailUrl: '', environment: ENV_LAVA  },
    { id: 3, name: '\u51b0\u971c\u9ad8\u5730', theme: 'ice',       difficulty: 3, maxWaves: 8, thumbnailUrl: '', environment: ENV_ICE   }
  ];

  function buildDefaultTiles(cols, rows) {
    var n = cols * rows;
    var t = new Array(n);
    for (var i = 0; i < n; i++) t[i] = 0;
    var idx = function (x, y) { return y * cols + x; };
    var set = function (x, y, v) { if (x >= 0 && x < cols && y >= 0 && y < rows) t[idx(x, y)] = v; };
    // 10×6 S 形蛇形路径（与后端 conf/game/map-1.json 完全一致）：
    //   y=0 全石头 → 顶部硬边界
    //   y=2 全部石头，仅 (7,2)=草地（上段↔中段唯一上下通道：(7,1)↓(7,2)↓M1(7,3)）
    //   y=4 全部石头，仅 (2,4)=草地（中段↔下段唯一上下通道：(2,3)↓(2,4)↓M2(2,5)）
    //   中段 y=3：x=0 石 / x∈[1..8] 草地 / x=9 石 → 左右硬边界，中段只有水平走廊
    if (cols === 10 && rows === 6) {
      for (var x = 0; x < 10; x++) set(x, 0, 1);
      for (var x2 = 0; x2 < 10; x2++) set(x2, 2, 1);
      set(7, 2, 0);
      set(0, 3, 1); set(9, 3, 1);
      for (var x4 = 0; x4 < 10; x4++) set(x4, 4, 1);
      set(2, 4, 0);
    } else {
      // 其他尺寸回退：全草地（只放 T_START/T_END 默认点不影响，因为 fallback 一般就是 10×6 走到上面分支）
    }
    var out = new Array(n);
    for (var j = 0; j < n; j++) out[j] = t[j];
    return out;
  }

  var COLS = 10, ROWS = 6, CELL = 48;
  // Map-2 熔岩洞穴：路径更长，路径周围散布 20 块 T_LAVA(7)，lavaCells 单独给出坐标列表
  function buildLavaTiles() {
    // 与 conf/game/map-2.json 完全一致
    return [
      1,7,7,7,7,0,0,1,1,1,
      1,0,0,0,7,7,7,0,1,1,
      1,1,0,7,7,0,7,7,0,1,
      1,1,0,1,1,7,7,7,0,1,
      1,1,0,1,1,1,7,7,7,0,
      1,1,0,1,1,7,1,7,7,0
    ];
  }
  function buildIceTiles() {
    // 与 conf/game/map-3.json 完全一致：分叉路径双通道
    return [
      1,1,1,1,1,1,1,1,1,1,
      1,0,0,0,1,0,0,0,0,1,
      0,0,1,0,1,0,1,1,0,0,
      1,0,1,0,1,0,0,1,0,1,
      1,0,0,0,0,0,0,1,0,1,
      1,1,1,1,1,1,1,1,1,1
    ];
  }
  var LAVA_CELLS = [
    [1,0],[2,0],[3,0],[4,0],
    [4,1],[5,1],[6,1],
    [3,2],[4,2],[6,2],[7,2],
    [5,3],[6,3],[7,3],
    [6,4],[7,4],[8,4],
    [7,5],[8,5],[5,5]
  ];
  var MAPS_DETAIL = {
    1: {
      id: 1, name: '\u8349\u539f\u5e73\u539f', theme: 'grassland', difficulty: 1, maxWaves: 8, thumbnailUrl: '',
      environment: ENV_GRASS,
      gridWidth: COLS, gridHeight: ROWS, cellSize: CELL,
      spawnPoints: [{ x: 0, y: 1 }],
      checkpoints: [{ x: 7, y: 3 }, { x: 2, y: 5 }],
      base: { x: 9, y: 5, hp: 20 },
      buildableCells: null,
      lavaCells: null,
      tiles: buildDefaultTiles(COLS, ROWS)
    },
    2: {
      id: 2, name: '\u7194\u5ca9\u6d1e\u7a74', theme: 'lava', difficulty: 2, maxWaves: 8, thumbnailUrl: '',
      environment: ENV_LAVA,
      gridWidth: COLS, gridHeight: ROWS, cellSize: CELL,
      spawnPoints: [{ x: 0, y: 0 }],
      checkpoints: [{ x: 5, y: 2 }, { x: 8, y: 4 }],
      base: { x: 9, y: 5, hp: 20 },
      buildableCells: null,
      lavaCells: LAVA_CELLS,
      tiles: buildLavaTiles()
    },
    3: {
      id: 3, name: '\u51b0\u971c\u9ad8\u5730', theme: 'ice', difficulty: 3, maxWaves: 8, thumbnailUrl: '',
      environment: ENV_ICE,
      gridWidth: COLS, gridHeight: ROWS, cellSize: CELL,
      spawnPoints: [{ x: 0, y: 2 }],
      checkpoints: [{ x: 3, y: 4 }],
      base: { x: 9, y: 2, hp: 20 },
      buildableCells: null,
      lavaCells: null,
      tiles: buildIceTiles()
    }
  };

  function wave(idx, rewardGold, isBoss, groups) {
    return {
      wave: idx,
      reward: { gold: rewardGold, gemRolls: 0 },
      isBossWave: !!isBoss,
      placementPerWave: 5,
      rewardGold: rewardGold,
      groups: groups
    };
  }
  var WAVES = {
    1: [
      wave(1, 50,  false, [{ enemyId: 1, count: 8,  interval: 1.0, delay: 0 }]),
      wave(2, 50,  false, [{ enemyId: 1, count: 10, interval: 0.8, delay: 0 }, { enemyId: 2, count: 4,  interval: 1.2, delay: 4.0 }]),
      wave(3, 100, true,  [{ enemyId: 2, count: 10, interval: 0.6, delay: 0 }, { enemyId: 1, count: 12, interval: 0.7, delay: 3.0 }, { enemyId: 6, count: 1, interval: 0, delay: 12.0 }]),
      wave(4, 50,  false, [{ enemyId: 3, count: 4,  interval: 2.0, delay: 0 }, { enemyId: 1, count: 16, interval: 0.6, delay: 2.0 }]),
      wave(5, 50,  false, [{ enemyId: 2, count: 16, interval: 0.45, delay: 0 }, { enemyId: 3, count: 6,  interval: 1.6, delay: 3.0 }]),
      wave(6, 150, true,  [{ enemyId: 4, count: 2,  interval: 3.0, delay: 0 }, { enemyId: 1, count: 20, interval: 0.5, delay: 1.0 }, { enemyId: 2, count: 10, interval: 0.6, delay: 6.0 }, { enemyId: 6, count: 1, interval: 0, delay: 12.0 }]),
      wave(7, 50,  false, [{ enemyId: 3, count: 10, interval: 1.2, delay: 0 }, { enemyId: 4, count: 3,  interval: 4.0, delay: 4.0 }]),
      wave(8, 300, true,  [{ enemyId: 1, count: 20, interval: 0.3, delay: 0 }, { enemyId: 3, count: 8,  interval: 1.0, delay: 2.0 }, { enemyId: 4, count: 4, interval: 2.5, delay: 6.0 }, { enemyId: 6, count: 1, interval: 0, delay: 16.0 }, { enemyId: 5, count: 1, interval: 0, delay: 22.0 }])
    ],
    // Map-2 熔岩洞穴：更密集精英，wave3 Boss=炎狱领主(id6) / wave6 Boss=熔岩暴君(id11·meteor弹幕) / wave8 双Boss(id11+分裂id5)
    2: [
      wave(1, 60,  false, [{ enemyId: 1, count: 10, interval: 0.9, delay: 0 }]),
      wave(2, 60,  false, [{ enemyId: 1, count: 12, interval: 0.7, delay: 0 }, { enemyId: 2, count: 6, interval: 1.0, delay: 3 }, { enemyId: 7, count: 2, interval: 2.0, delay: 7 }]),
      wave(3, 120, true,  [{ enemyId: 2, count: 12, interval: 0.5, delay: 0 }, { enemyId: 1, count: 16, interval: 0.6, delay: 2 }, { enemyId: 7, count: 2, interval: 3.0, delay: 8 }, { enemyId: 6,  count: 1, interval: 0, delay: 14 }]),
      wave(4, 60,  false, [{ enemyId: 3, count: 6,  interval: 1.8, delay: 0 }, { enemyId: 1, count: 20, interval: 0.5, delay: 2 }, { enemyId: 8, count: 1, interval: 0, delay: 9 }, { enemyId: 9, count: 1, interval: 0, delay: 12 }]),
      wave(5, 60,  false, [{ enemyId: 2, count: 20, interval: 0.4, delay: 0 }, { enemyId: 3, count: 8, interval: 1.4, delay: 3 }, { enemyId: 10, count: 8, interval: 0.5, delay: 8 }]),
      wave(6, 180, true,  [{ enemyId: 4, count: 3,  interval: 2.5, delay: 0 }, { enemyId: 1, count: 24, interval: 0.45, delay: 1 }, { enemyId: 2, count: 14, interval: 0.5, delay: 6 }, { enemyId: 7, count: 3, interval: 2.0, delay: 9 }, { enemyId: 11, count: 1, interval: 0, delay: 14 }]),
      wave(7, 70,  false, [{ enemyId: 3, count: 14, interval: 1.0, delay: 0 }, { enemyId: 4, count: 4, interval: 3.5, delay: 3 }, { enemyId: 8, count: 2, interval: 4.0, delay: 7 }, { enemyId: 9, count: 2, interval: 5.0, delay: 11 }, { enemyId: 5, count: 2, interval: 3.0, delay: 15 }]),
      wave(8, 360, true,  [{ enemyId: 1, count: 24, interval: 0.25, delay: 0 }, { enemyId: 3, count: 10, interval: 0.9, delay: 2 }, { enemyId: 4, count: 5, interval: 2.2, delay: 5 }, { enemyId: 10, count: 10, interval: 0.4, delay: 8 }, { enemyId: 7, count: 4, interval: 1.8, delay: 10 }, { enemyId: 11, count: 1, interval: 0, delay: 18 }, { enemyId: 5, count: 2, interval: 3.0, delay: 24 }])
    ],
    // Map-3 冰霜高地：节奏最快+精英最多，wave6 Boss=熔岩暴君(id11) / wave8 最终Boss=冰霜女王(id12·ice_freezer)
    3: [
      wave(1, 70,  false, [{ enemyId: 1, count: 12, interval: 0.85, delay: 0 }]),
      wave(2, 70,  false, [{ enemyId: 1, count: 14, interval: 0.6, delay: 0 }, { enemyId: 2, count: 8, interval: 0.9, delay: 3 }, { enemyId: 7, count: 3, interval: 2.0, delay: 8 }]),
      wave(3, 140, true,  [{ enemyId: 2, count: 14, interval: 0.45, delay: 0 }, { enemyId: 1, count: 18, interval: 0.55, delay: 2 }, { enemyId: 7, count: 3, interval: 2.5, delay: 8 }, { enemyId: 6,  count: 1, interval: 0, delay: 14 }]),
      wave(4, 70,  false, [{ enemyId: 3, count: 8,  interval: 1.6, delay: 0 }, { enemyId: 1, count: 24, interval: 0.45, delay: 2 }, { enemyId: 8, count: 2, interval: 0, delay: 8 }, { enemyId: 9, count: 2, interval: 0, delay: 12 }, { enemyId: 10, count: 6, interval: 0.5, delay: 14 }]),
      wave(5, 70,  false, [{ enemyId: 2, count: 24, interval: 0.35, delay: 0 }, { enemyId: 3, count: 10, interval: 1.2, delay: 3 }, { enemyId: 5, count: 2, interval: 3.0, delay: 9 }, { enemyId: 10, count: 10, interval: 0.4, delay: 11 }]),
      wave(6, 200, true,  [{ enemyId: 4, count: 4,  interval: 2.2, delay: 0 }, { enemyId: 1, count: 28, interval: 0.4, delay: 1 }, { enemyId: 2, count: 16, interval: 0.45, delay: 6 }, { enemyId: 7, count: 4, interval: 1.8, delay: 8 }, { enemyId: 11, count: 1, interval: 0, delay: 15 }]),
      wave(7, 80,  false, [{ enemyId: 3, count: 16, interval: 0.9, delay: 0 }, { enemyId: 4, count: 5, interval: 3.2, delay: 3 }, { enemyId: 8, count: 2, interval: 4.0, delay: 7 }, { enemyId: 9, count: 2, interval: 5.0, delay: 11 }, { enemyId: 5, count: 3, interval: 2.8, delay: 14 }]),
      wave(8, 400, true,  [{ enemyId: 1, count: 28, interval: 0.22, delay: 0 }, { enemyId: 3, count: 12, interval: 0.85, delay: 2 }, { enemyId: 4, count: 6, interval: 2.0, delay: 5 }, { enemyId: 10, count: 14, interval: 0.35, delay: 8 }, { enemyId: 7, count: 5, interval: 1.6, delay: 10 }, { enemyId: 12, count: 1, interval: 0, delay: 18 }, { enemyId: 5, count: 3, interval: 2.5, delay: 25 }])
    ]
  };

  window.TD_FALLBACK_CONFIG = {
    towers: TOWERS,
    enemies: ENEMIES,
    luck: LUCK,
    buffs: BUFFS,
    gems: GEMS,
    mapsList: MAPS_LIST,
    mapsDetail: MAPS_DETAIL,
    waves: WAVES,
    getMapsDetail: function (mapId) { return MAPS_DETAIL[String(mapId)] || null; },
    getWaves:     function (mapId) { return WAVES[String(mapId)] || null; }
  };
})();
