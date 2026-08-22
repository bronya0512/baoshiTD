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
      rewardCoin: 300, damageToBase: 10, color: '#9b2c2c', radiusPx: 22 }
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
  var MAPS_LIST = [
    { id: 1, name: '\u8349\u539f\u5e73\u539f', theme: 'grassland', difficulty: 1, maxWaves: 8, thumbnailUrl: '' }
  ];

  function buildDefaultTiles(cols, rows) {
    var n = cols * rows;
    var t = new Array(n);
    for (var i = 0; i < n; i++) t[i] = 0;
    var idx = function (x, y) { return y * cols + x; };
    var set = function (x, y, v) { if (x >= 0 && x < cols && y >= 0 && y < rows) t[idx(x, y)] = v; };
    for (var x = 4; x <= 20; x++) { set(x, 5, 1); set(x, 11, 1); }
    // 两个缺口：和后端 config.go buildDefaultMapTiles 严格一致
    //   col 4 : y=5..11 open (0)
    //   col 20: y=5..10 open (0), y=11 stays stone (1)
    for (var y = 5; y <= 11; y++) set(4, y, 0);
    for (var y = 5; y <= 10; y++) set(20, y, 0);
    set(1, 8, 2); set(22, 8, 3);
    var out = new Array(n);
    for (var j = 0; j < n; j++) out[j] = t[j];
    return out;
  }

  var COLS = 24, ROWS = 16, CELL = 36;
  var MAPS_DETAIL = {
    1: {
      id: 1, name: '\u8349\u539f\u5e73\u539f', theme: 'grassland', difficulty: 1, maxWaves: 8, thumbnailUrl: '',
      gridWidth: COLS, gridHeight: ROWS, cellSize: CELL,
      spawnPoints: [{ x: 1, y: 8 }],
      base: { x: 22, y: 8, hp: 20 },
      buildableCells: null,
      tiles: buildDefaultTiles(COLS, ROWS)
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
      wave(2, 60,  false, [{ enemyId: 1, count: 10, interval: 0.8, delay: 0 }, { enemyId: 2, count: 4,  interval: 1.2, delay: 4.0 }]),
      wave(3, 80,  false, [{ enemyId: 2, count: 10, interval: 0.6, delay: 0 }, { enemyId: 1, count: 12, interval: 0.7, delay: 3.0 }]),
      wave(4, 100, false, [{ enemyId: 3, count: 4,  interval: 2.0, delay: 0 }, { enemyId: 1, count: 16, interval: 0.6, delay: 2.0 }]),
      wave(5, 120, false, [{ enemyId: 2, count: 16, interval: 0.45, delay: 0 }, { enemyId: 3, count: 6,  interval: 1.6, delay: 3.0 }]),
      wave(6, 150, false, [{ enemyId: 4, count: 2,  interval: 3.0, delay: 0 }, { enemyId: 1, count: 20, interval: 0.5, delay: 1.0 }, { enemyId: 2, count: 10, interval: 0.6, delay: 6.0 }]),
      wave(7, 200, false, [{ enemyId: 3, count: 10, interval: 1.2, delay: 0 }, { enemyId: 4, count: 3,  interval: 4.0, delay: 4.0 }]),
      wave(8, 500, true,  [{ enemyId: 1, count: 20, interval: 0.3, delay: 0 }, { enemyId: 3, count: 8, interval: 1.0, delay: 2.0 }, { enemyId: 4, count: 4, interval: 2.5, delay: 6.0 }, { enemyId: 5, count: 1, interval: 0, delay: 15.0 }])
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
