// ============================================================
// td-config-loader.js
// 统一从后端取配置，失败时走 FALLBACK，向上暴露 { towers/enemies/gems/maps/mapDetail/waves }。
// 用法：
//   TDConfig.loadAll().then(cfg => { /* cfg.towers / cfg.enemies ... */ })
// 依赖：td-config-fallback.js（window.TD_FALLBACK_CONFIG），仅在后端失败时启用。
// ============================================================
(function () {
  'use strict';

  // 后端包装体：{ code, status, data }，成功就返回 data。其他情况抛错。
  function unpackData(respJson) {
    if (respJson && typeof respJson === 'object' &&
        ('code' in respJson) && ('data' in respJson) &&
        respJson.code >= 200 && respJson.code < 300) {
      return respJson.data;
    }
    return respJson; // 裸数据兼容
  }

  function fetchJson(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = timeoutMs || 3000;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText || '{}')); }
          catch (e) { reject(e); }
        } else {
          reject(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function () { reject(new Error('network')); };
      xhr.ontimeout = function () { reject(new Error('timeout')); };
      xhr.send(null);
    });
  }

  function tryBackend() {
    var base = '/api/config';
    return Promise.all([
      fetchJson(base + '/towers').then(unpackData),
      fetchJson(base + '/enemies').then(unpackData),
      fetchJson(base + '/gems').then(unpackData),
      fetchJson(base + '/maps').then(unpackData),
      // V4-2 Task 5：并行加载 3 张地图 detail + 3 份 waves；任何一张失败自动退化返回 null（adapt 里用 1 兜底）
      Promise.allSettled ? Promise.allSettled([1,2,3].map(function(id){ return fetchJson(base + '/maps/' + id).then(unpackData); }))
        .then(function(results){ return results.map(function(r){ return r.status === 'fulfilled' ? r.value : null; }); })
        : Promise.all([1,2,3].map(function(id){ return fetchJson(base + '/maps/' + id).then(unpackData).catch(function(){ return null; }); })),
      Promise.allSettled ? Promise.allSettled([1,2,3].map(function(id){ return fetchJson(base + '/waves/' + id).then(unpackData); }))
        .then(function(results){ return results.map(function(r){ return r.status === 'fulfilled' ? r.value : null; }); })
        : Promise.all([1,2,3].map(function(id){ return fetchJson(base + '/waves/' + id).then(unpackData).catch(function(){ return null; }); })),
      fetchJson(base + '/luck').then(unpackData),
      fetchJson(base + '/buffs').then(unpackData),
      // v4: 特殊塔 + 进化配方（C 类合成）
      fetchJson(base + '/special-towers').then(unpackData).catch(function () { return []; }),
      fetchJson(base + '/recipes').then(unpackData).catch(function () { return []; }),
      // ===== V4-7 能量 / 技能 解耦 =====
      fetchJson(base + '/energy-cfgs').then(unpackData).catch(function () { return []; }),
      fetchJson(base + '/tower-skills').then(unpackData).catch(function () { return []; })
    ]).then(function (parts) {
      var mapDetails = parts[4] || [null, null, null]; // [map1Detail, map2Detail, map3Detail]
      var wavesArr   = parts[5] || [null, null, null]; // [waves1, waves2, waves3]
      // 若 map 1 失败，游戏彻底无法开始就抛错；否则用 map1 作为默认
      if (!mapDetails[0] || !wavesArr[0]) throw new Error('core config (map1/waves1) unavailable');
      return {
        source: 'backend',
        towers: parts[0],
        enemies: parts[1],
        gems: parts[2],
        mapsList: parts[3],
        mapDetail: mapDetails[0],
        waves: wavesArr[0],
        // V4-2 Task 5：所有地图详情 & waves 表（setMapId 时就地切换）
        _mapDetailsById: { 1: mapDetails[0], 2: mapDetails[1], 3: mapDetails[2] },
        _wavesById:       { 1: wavesArr[0],   2: wavesArr[1],   3: wavesArr[2] },
        luck: parts[6],
        buffs: parts[7],
        specialTowers: parts[8] || [],
        recipes: parts[9] || [],
        // ===== V4-7 能量 / 技能 解耦 =====
        energyCfgs: parts[10] || [],
        skills: parts[11] || []
      };
    });
  }

  function useFallback(reason) {
    var fb = (typeof window !== 'undefined' && window.TD_FALLBACK_CONFIG);
    if (!fb) throw new Error('fallback unavailable: ' + (reason && reason.message || reason));
    return Promise.resolve({
      source: 'fallback (' + (reason && reason.message || 'no-backend') + ')',
      towers: fb.towers,
      enemies: fb.enemies,
      gems: fb.gems,
      mapsList: fb.mapsList,
      mapDetail: fb.getMapsDetail(1),
      waves: fb.getWaves(1),
      _mapDetailsById: { 1: fb.getMapsDetail(1), 2: fb.getMapsDetail(2), 3: fb.getMapsDetail(3) },
      _wavesById:       { 1: fb.getWaves(1),     2: fb.getWaves(2),     3: fb.getWaves(3) },
      luck: fb.luck,
      buffs: fb.buffs,
      // v4: 退化：fallback 无特殊塔 / 配方，AB 合成依然可用，C 进化被 detectEvolvable 自动禁用
      specialTowers: [],
      recipes: [],
      // ===== V4-7 能量/技能 解耦 fallback 默认值 =====
      energyCfgs: [
        { id: 'normal',     max: 100, perAttack: 1,   perSecond: 1,   desc: '默认能量配置' },
        { id: 'fast',       max: 60,  perAttack: 1.2, perSecond: 1.5, desc: '快速充能' },
        { id: 'slow',       max: 150, perAttack: 0.6, perSecond: 0.7, desc: '慢速爆发' },
        { id: 'ultra_fast', max: 40,  perAttack: 1.6, perSecond: 2,   desc: '超高频技能' }
      ],
      skills: [
        { id: 'double_strike',   name: '蓄势一击', icon: '💥', desc: '满能下一击×2伤害',             skillType: 'damage_mult',  damageMul: 2.0, armorIgnorePct: 0,   slowMul: 1,   slowTicksSec: 0   },
        { id: 'heavy_strike',    name: '重击',     icon: '🔨', desc: '满能下一击×1.5伤害',           skillType: 'damage_mult',  damageMul: 1.5, armorIgnorePct: 0,   slowMul: 1,   slowTicksSec: 0   },
        { id: 'armor_pierce',    name: '穿甲爆破', icon: '🛡️', desc: '满能下一击：穿甲+×1.3',          skillType: 'armor_pierce', damageMul: 1.3, armorIgnorePct: 1.0, slowMul: 1,   slowTicksSec: 0   },
        { id: 'frost_explosion', name: '冰爆术',   icon: '❄️', desc: '满能×1.3+减速50% 2秒',          skillType: 'damage_mult',  damageMul: 1.3, armorIgnorePct: 0,   slowMul: 0.5, slowTicksSec: 2.0 }
      ]
    });
  }

  function loadAll() {
    // 先请求后端（只要有一个失败，整体就使用 fallback，保证单机 file:// 也能直接跑）
    return tryBackend().catch(useFallback);
  }

  // ============================================================
  // Adapter：把契约里的结构拍平成游戏循环直接用的字段。
  //  - Towers：用 levels[0] 作为基础等级；补上 attackInterval（=1/attackSpeed）
  //  - Luck：拆成 byLevel 索引 + rollTowerByLuck() / rollBonusRarityByLuck() helper
  //  - Buffs：byId 索引 + rollRarityWeightsByLuckLevel + rollBuffByLuck() + applyBuffs()
  //  - bonusGoldMap：按稀有度映射 bonusRarity→奖励金币（common=5/rare=15/epic=50/legendary=200）
  // ============================================================
  function adapt(cfg) {
    if (!cfg) return cfg;
    // ---- Task 7 兼容：后端 JSON 配置可能尚未收录新精英/BOSS（id7~12）。
    // 从 fallback 配置按 id 补全缺失的条目，绝不覆盖已存在的 id，绝不触碰磁盘 JSON 配置。
    try {
      var fb = (typeof window !== 'undefined' && window.TD_FALLBACK_CONFIG);
      if (fb && Array.isArray(fb.enemies) && Array.isArray(cfg.enemies)) {
        var haveIds = {};
        cfg.enemies.forEach(function (e) { haveIds[e.id] = true; });
        fb.enemies.forEach(function (fe) {
          if (!haveIds[fe.id]) {
            cfg.enemies.push(Object.assign({}, fe));
          }
        });
      }
    } catch (e) { /* 合并失败不致命，直接用后端返回的 enemies */ }
    // ===== V4-7 能量 / 技能 解耦：独立池建立 byId + 默认值 =====
    var DEFAULT_ENERGY_CFG = { id: 'normal', max: 100, perAttack: 1, perSecond: 1, desc: '默认兜底（normal）' };
    var DEFAULT_SKILL     = { id: 'double_strike', name: '蓄势一击', icon: '💥', desc: '满能下一击×2伤害（兜底默认）', skillType: 'damage_mult', damageMul: 2.0, armorIgnorePct: 0, slowMul: 1, slowTicksSec: 0 };
    var energyCfgsById = {};
    (cfg.energyCfgs || []).forEach(function (eC) { if (eC && eC.id) energyCfgsById[eC.id] = eC; });
    if (!energyCfgsById['normal']) energyCfgsById['normal'] = DEFAULT_ENERGY_CFG;
    var skillsById = {};
    (cfg.skills || []).forEach(function (sC) { if (sC && sC.id) skillsById[sC.id] = sC; });
    if (!skillsById['double_strike']) skillsById['double_strike'] = DEFAULT_SKILL;
    function resolveEnergyCfg(id) {
      var c = (id && energyCfgsById[id]) ? energyCfgsById[id] : DEFAULT_ENERGY_CFG;
      // 数值防御：不允许负数/非数字
      var max       = Number(c.max);
      var perAttack = Number(c.perAttack);
      var perSecond = Number(c.perSecond);
      if (!(max > 0))              max       = DEFAULT_ENERGY_CFG.max;
      if (!(perAttack >= 0))       perAttack = DEFAULT_ENERGY_CFG.perAttack;
      if (!(perSecond >= 0))       perSecond = DEFAULT_ENERGY_CFG.perSecond;
      return {
        id:        c.id || 'normal',
        max:       max,
        perAttack: perAttack,
        perSecond: perSecond,
        desc:      (typeof c.desc === 'string') ? c.desc : ''
      };
    }
    function resolveSkillCfg(id) {
      var c = (id && skillsById[id]) ? skillsById[id] : DEFAULT_SKILL;
      var dmgMul        = Number(c.damageMul);
      var armorIgnore   = Number(c.armorIgnorePct);
      var slowMul       = Number(c.slowMul);
      var slowTicksSec  = Number(c.slowTicksSec);
      if (!(dmgMul >= 1))            dmgMul       = DEFAULT_SKILL.damageMul;
      if (!(armorIgnore >= 0))       armorIgnore  = 0;   // NaN / 缺字段兜底：0 穿甲（后端 omitempty 常见于 0 值）
      if (!(armorIgnore <= 1))       armorIgnore  = 1;
      if (!(slowMul > 0))            slowMul      = 1;
      if (!(slowTicksSec >= 0))      slowTicksSec = 0;
      return {
        id:             c.id || 'double_strike',
        name:           (typeof c.name === 'string' && c.name) ? c.name : DEFAULT_SKILL.name,
        icon:           (typeof c.icon === 'string' && c.icon) ? c.icon : DEFAULT_SKILL.icon,
        desc:           (typeof c.desc === 'string') ? c.desc : '',
        skillType:      (typeof c.skillType === 'string' && c.skillType) ? c.skillType : DEFAULT_SKILL.skillType,
        damageMul:      dmgMul,
        armorIgnorePct: armorIgnore,
        slowMul:        slowMul,
        slowTicksSec:   slowTicksSec
      };
    }
    function buildTower(t) {
      var lv = (t.levels && t.levels[0]) || {};
      var attackSpeed = (typeof lv.attackSpeed === 'number' && lv.attackSpeed > 0) ? lv.attackSpeed : 1;
      var eCfg = resolveEnergyCfg(t.energyCfgId);
      var sCfg = resolveSkillCfg(t.skillId);
      // ===== V4-10：塔成长 = 稀有度成长。levels[0..5] 归一化为 6 档稀有度数值 =====
      // levelsResolved[i] = 第 i 档稀有度（common/rare/epic/legendary/mythic/ultimate）的最终数值
      var levelsResolved = [];
      if (t.levels && t.levels.length) {
        t.levels.forEach(function (l0) {
          var sp = (typeof l0.attackSpeed === 'number' && l0.attackSpeed > 0) ? l0.attackSpeed : 1;
          levelsResolved.push({
            level:               l0.level || 1,
            baseDamage:          Number(l0.baseDamage) || 0,
            rangeCells:          Number(l0.attackRange) || 0,
            attackInterval:      1 / sp,
            slowPct01:           (typeof l0.slowPct01 === 'number') ? Math.max(0, Math.min(0.95, l0.slowPct01)) : null,
            slowSec:             Number(l0.slowSec) || 0,
            killGemAdd01:        (typeof l0.killGemAdd01 === 'number') ? Math.max(0, Math.min(1, l0.killGemAdd01)) : null,
            poisonDoTDps:        Number(l0.poisonDoTDps) || 0,
            poisonDoTSec:        Number(l0.poisonDoTSec) || 0,
            armorShredPoints:    Number(l0.armorShredPoints) || 0,
            armorShredSec:       Number(l0.armorShredSec) || 0,
            auraRadiusCells:     Number(l0.auraRadiusCells) || 0,
            auraAttackFlat:      Number(l0.auraAttackFlat) || 0,
            auraAttackSpeedPct01: Number(l0.auraAttackSpeedPct01) || 0,
            multiShotCount:      Math.max(1, parseInt(l0.multiShotCount || 1, 10) || 1),
            aoeRadiusCells:      Number(l0.aoeRadiusCells) || 0,
            aoeDamagePct01:      (typeof l0.aoeDamagePct01 === 'number') ? Math.max(0, Math.min(1, l0.aoeDamagePct01)) : 1
          });
        });
      }
      return Object.assign({}, t, {
        // V4-9 伤害类型规范化：physical（缺省）/ magic / true；非法/缺失值回退 physical
        damageType: (t.damageType === 'magic' || t.damageType === 'true') ? t.damageType : 'physical',
        cost: lv.cost,
        rangeInCells: lv.attackRange,
        baseDamage: lv.baseDamage,
        attackInterval: 1 / attackSpeed,
        upgradeCost: lv.upgradeCost,
        level: lv.level || 1,
        levels: (t.levels || []).slice(),
        levelsResolved: levelsResolved,
        // ===== V4-7 能量 / 技能 解耦：每塔独立挂完整对象（game.js 直接读），同时保留 energyCfgId/skillId 供调试/存档
        energyCfgId: eCfg.id,
        skillId:     sCfg.id,
        energyCfg:   eCfg,
        skillCfg:    sCfg
      });
    }
    // ===== V4-10：6 档稀有度链（塔成长 = 稀有度成长）=====
    var RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic', 'ultimate'];
    function rarityIndex(r) { return RARITY_ORDER.indexOf(r); }
    // 按稀有度取塔数值：levelsResolved[i] = 第 i 档稀有度的最终数值；未知/缺档回退第 0 档（common）
    function getTowerLevel(cfg, rarity) {
      if (!cfg || !cfg.levelsResolved || !cfg.levelsResolved.length) return null;
      var i = RARITY_ORDER.indexOf(rarity);
      if (i < 0 || i >= cfg.levelsResolved.length) i = 0;
      return cfg.levelsResolved[i];
    }
    var gemIdx = {};
    if (cfg.gems && cfg.gems.elements) {
      gemIdx.byElement = {};
      cfg.gems.elements.forEach(function (e) { gemIdx.byElement[e.key] = e; });
    }
    if (cfg.gems && cfg.gems.rarities) {
      gemIdx.byRarity = {};
      cfg.gems.rarities.forEach(function (r) { gemIdx.byRarity[r.key] = r; });
    }

    // ===== 元素数值配置化：gems.json elements[].baseBonus 是唯一配置源 =====
    // 主链路（td-game.js 减速/击杀掉率）不再硬编码元素数值；
    // 缺字段/非法值 → 默认表（= 原硬编码值），保证不配置时行为零变化。
    //   可配字段：slowOnHitPct01（0~0.95 减速比例）、slowOnHitSec（持续秒）、killGemChanceAdd01（0~1 击杀额外掉率）
    var ELEM_BONUS_DEFAULTS = {
      fire:    { slowPct: 0,    slowSec: 0,   killGemAdd: 0    },
      ice:     { slowPct: 0.30, slowSec: 2.0, killGemAdd: 0    },
      thunder: { slowPct: 0,    slowSec: 0,   killGemAdd: 0    },
      poison:  { slowPct: 0.20, slowSec: 1.5, killGemAdd: 0    },
      light:   { slowPct: 0,    slowSec: 0,   killGemAdd: 0.15 },
      dark:    { slowPct: 0,    slowSec: 0,   killGemAdd: 0.10 }
    };
    var _elemBonusCache = {};
    function getElementBonus(element) {
      if (Object.prototype.hasOwnProperty.call(_elemBonusCache, element)) return _elemBonusCache[element];
      var d = ELEM_BONUS_DEFAULTS[element] || { slowPct: 0, slowSec: 0, killGemAdd: 0 };
      var b = (gemIdx.byElement && gemIdx.byElement[element] && gemIdx.byElement[element].baseBonus) || {};
      var sp = Number(b.slowOnHitPct01), ss = Number(b.slowOnHitSec), kg = Number(b.killGemChanceAdd01);
      var res = {
        slowPct:    (sp > 0 && sp <= 0.95) ? sp : d.slowPct,
        slowSec:    (ss > 0) ? ss : d.slowSec,
        killGemAdd: (kg > 0 && kg <= 1) ? kg : d.killGemAdd
      };
      _elemBonusCache[element] = res;
      return res;
    }

    // ---- luck ----
    var luckByLevel = {};
    var luckLevels = (cfg.luck && cfg.luck.levels) ? cfg.luck.levels.slice() : [];
    luckLevels.forEach(function (l) { luckByLevel[l.level] = l; });
    var luckInitialLevel = (cfg.luck && typeof cfg.luck.initialLevel === 'number') ? cfg.luck.initialLevel : 1;

    function weightedPickKey(weights) {
      var keys = Object.keys(weights);
      var total = 0;
      for (var i = 0; i < keys.length; i++) total += Number(weights[keys[i]]) || 0;
      if (total <= 0) return keys[0];
      var r = Math.random() * total;
      for (var j = 0; j < keys.length; j++) {
        r -= Number(weights[keys[j]]) || 0;
        if (r <= 0) return keys[j];
      }
      return keys[keys.length - 1];
    }

    function rollTowerByLuck(level, towersArr, towersById) {
      var lv = luckByLevel[level] || luckByLevel[luckInitialLevel];
      if (!lv) return null;
      var rarity = weightedPickKey(lv.towerRarityWeights || {});
      var pool = [];
      // v4: 特殊塔（special:true）只能通过 C 类配方产出，Roll 池（放置机会）与 B 类合成 永不产出特殊塔
      (towersArr || []).forEach(function (t) { if (t.rarity === rarity && !t.special) pool.push(t); });
      if (!pool.length) {
        (towersArr || []).forEach(function (t) { if (!t.special) pool.push(t); });
      }
      if (!pool.length) pool = towersArr || [];
      var picked = pool[Math.floor(Math.random() * pool.length)];
      // ===== V4-10：塔成长 = 稀有度成长。Roll 出的是"宝石类型 + 实例稀有度" =====
      // _rollRarity = 本次 Roll 决定的实例稀有度（放置时写入 gridObj.rarity，数值取 levels[rarityIdx]）
      if (picked) picked._rollRarity = rarity;
      return picked;
    }

    function rollBonusRarityByLuck(level) {
      var lv = luckByLevel[level] || luckByLevel[luckInitialLevel];
      if (!lv) return 'common';
      return weightedPickKey(lv.bonusRarityWeights || {});
    }

    // ---- buffs ----
    var buffsById = {};
    var buffsList = (cfg.buffs && cfg.buffs.buffs) ? cfg.buffs.buffs.slice() : [];
    buffsList.forEach(function (b) { buffsById[b.id] = b; });
    var buffRollCostGold = (cfg.buffs && typeof cfg.buffs.rollCostGold === 'number') ? cfg.buffs.rollCostGold : 40;
    var buffRollsPerWave = (cfg.buffs && Number(cfg.buffs.rollsPerWave)) || 5;
    var shopTowerCostGold = (cfg.buffs && Number(cfg.buffs.shopTowerCostGold)) || 120;
    var buffRollRarityWeights = (cfg.buffs && cfg.buffs.rollRarityWeights) ? cfg.buffs.rollRarityWeights : {};

    function rollBuffByLuck(luckLevel) {
      var key = String(luckLevel);
      var weights = buffRollRarityWeights[key] || buffRollRarityWeights['1'] || {};
      var rarity = weightedPickKey(weights);
      var pool = [];
      buffsList.forEach(function (b) { if (b.rarity === rarity) pool.push(b); });
      if (!pool.length) pool = buffsList;
      return pool[Math.floor(Math.random() * pool.length)];
    }

    // 叠加 Buffs：把多条 buff.effect 的 mul 字段相乘、add 字段相加
    function applyBuffs(activeBuffs) {
      var mul = {
        towerDamageMulAll: 1, towerAttackIntervalMulAll: 1, towerRangeMulAll: 1,
        killGoldMulAll: 1, slowStrengthMulAll: 1
      };
      var add = { killBonusGoldChanceAddAll: 0 };
      (activeBuffs || []).forEach(function (b) {
        var eff = (typeof b === 'object' && b.effect) ? b.effect : (buffsById[b && b.id] ? buffsById[b.id].effect : null);
        if (!eff) return;
        Object.keys(mul).forEach(function (k) { if (typeof eff[k] === 'number') mul[k] *= eff[k]; });
        Object.keys(add).forEach(function (k) { if (typeof eff[k] === 'number') add[k] += eff[k]; });
      });
      return { mul: mul, add: add };
    }

    // 稀有度 → 奖励金币（替代 v1 宝石掉落）
    var bonusGoldMap = { common: 5, rare: 15, epic: 50, legendary: 200 };

    // towers / enemies index
    // v4: 常规塔（towers）+ 特殊塔（specialTowers）统一 buildTower → towersArr/towersById
    //   特殊塔保留 special/code/passiveId/passiveDesc 字段，buildTower 只增字段不覆盖
    var rawRegular = (cfg.towers || []).map(function (t) { return Object.assign({}, t); });
    var rawSpecial = (cfg.specialTowers || []).map(function (t) {
      // 确保 special 标记不丢（后端 JSON 已有 special:true）
      return Object.assign({}, t, { special: true });
    });
    var allRawTowers = rawRegular.concat(rawSpecial);

    var towersArr = allRawTowers.map(buildTower);
    // buildTower 默认不会保留 special/code/passiveId/passiveDesc；再手动回写一次确保存在
    allRawTowers.forEach(function (raw, i) {
      var built = towersArr[i];
      if (raw.special) built.special = true;
      if (typeof raw.code === 'string') built.code = raw.code;
      if (typeof raw.passiveId === 'string') built.passiveId = raw.passiveId;
      if (typeof raw.passiveDesc === 'string') built.passiveDesc = raw.passiveDesc;
    });
    var towersById = {};
    towersArr.forEach(function (t) { towersById[t.id] = t; });
    var specialTowersList = towersArr.filter(function (t) { return t.special; });
    var specialTowersById = {};
    specialTowersList.forEach(function (t) { specialTowersById[t.id] = t; });

    // 非特殊塔按稀有度分组（B 类合成随机结果 & Roll 池复用）
    var nonSpecialByRarity = {};
    towersArr.forEach(function (t) {
      if (t.special) return;
      if (!nonSpecialByRarity[t.rarity]) nonSpecialByRarity[t.rarity] = [];
      nonSpecialByRarity[t.rarity].push(t);
    });
    // 下一稀有度映射（用于 A 升级 / B 合成）
    // V4-10：扩展到 6 档（塔成长 = 稀有度成长：common→…→mythic→ultimate）
    var RARITY_UP = { common: 'rare', rare: 'epic', epic: 'legendary', legendary: 'mythic', mythic: 'ultimate' };
    function nextRarityUp(r) { return RARITY_UP[r] || null; }
    function pickRandomNonSpecialByRarity(rarity) {
      // V4-10：塔池不再按 cfg.rarity 分池（同一宝石塔配置只有一份，稀有度是实例属性）；
      // 返回随机非特殊塔 cfg，产物稀有度由调用方（B 合成 outputRarity）决定。
      var pool = [];
      towersArr.forEach(function (t) { if (!t.special) pool.push(t); });
      if (!pool.length) return null;
      return pool[Math.floor(Math.random() * pool.length)];
    }

    var enemiesById = {};
    (cfg.enemies || []).forEach(function (e) {
      // V3-2 兼容：radiusPx 缺失时回退到 11（保持 v1 老数据正常绘制）
      if (!e.radiusPx) e.radiusPx = 11;
      // isBoss / isElite 强制 bool（防止 JSON 解析后端返回 0/1）
      e.isBoss = !!e.isBoss;
      e.isElite = !!e.isElite;
      enemiesById[e.id] = e;
    });

    // v4 recipes: byId 索引
    var recipesList = (cfg.recipes || []).slice();
    var recipesById = {};
    recipesList.forEach(function (r) { recipesById[r.id] = r; });

    // V4-2 Task 5：mapsList by id 索引 + 3 地图/waves 表（直接传递供 setMapId 切换）
    var mapsListById = {};
    (cfg.mapsList || []).forEach(function (m) { mapsListById[Number(m.id) | 0] = m; });
    var mapDetailsById = cfg._mapDetailsById || { 1: cfg.mapDetail };
    var wavesById       = cfg._wavesById       || { 1: cfg.waves };

    return Object.assign({}, cfg, {
      towers: towersArr,
      towersById: towersById,
      towersByRarity: (function () {
        var m = {};
        towersArr.forEach(function (t) { if (!m[t.rarity]) m[t.rarity] = []; m[t.rarity].push(t); });
        return m;
      })(),
      towersNonSpecialByRarity: nonSpecialByRarity,
      specialTowers: specialTowersList,
      specialTowersById: specialTowersById,
      recipes: recipesList,
      recipesById: recipesById,
      // ===== V4-7 能量 / 技能 解耦：独立池 byId 缓存 =====
      energyCfgs: (cfg.energyCfgs || []).slice(),
      energyCfgsById: energyCfgsById,
      skills: (cfg.skills || []).slice(),
      skillsById: skillsById,
      nextRarityUp: nextRarityUp,
      pickRandomNonSpecialByRarity: pickRandomNonSpecialByRarity,
      // ===== V4-10：6 档稀有度链 + 按稀有度取塔数值 =====
      rarityOrder: RARITY_ORDER.slice(),
      rarityIndex: rarityIndex,
      getTowerLevel: getTowerLevel,
      enemiesById: enemiesById,
      gemsIndex: gemIdx,
      mapsListById: mapsListById,       // V4-2: 供 currentEnvironment fallback / MENU Tab 读环境
      mapDetailsById: mapDetailsById,   // V4-2: setMapId 切换 mapDetail
      wavesById: wavesById,             // V4-2: setMapId 切换 waves
      // luck
      luckInitialLevel: luckInitialLevel,
      luckLevels: luckLevels,
      luckByLevel: luckByLevel,
      rollTowerByLuck: function (level) { return rollTowerByLuck(level, towersArr, towersById); },
      rollBonusRarityByLuck: rollBonusRarityByLuck,
      // 元素数值查表（gems.json baseBonus 驱动；td-game.js 减速/掉率统一走这里）
      getElementBonus: getElementBonus,
      // buffs
      buffsList: buffsList,
      buffsById: buffsById,
      buffRollCostGold: buffRollCostGold,
      buffRollsPerWave: buffRollsPerWave,
      shopTowerCostGold: shopTowerCostGold,
      rollBuffByLuck: rollBuffByLuck,
      applyBuffs: applyBuffs,
      bonusGoldMap: bonusGoldMap
    });
  }

  function loadAllAdapted() { return loadAll().then(adapt); }

  window.TDConfig = {
    loadAll: loadAll,
    loadAllAdapted: loadAllAdapted,
    adapt: adapt
  };
})();
