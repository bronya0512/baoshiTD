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
      fetchJson(base + '/maps/1').then(unpackData),
      fetchJson(base + '/waves/1').then(unpackData),
      fetchJson(base + '/luck').then(unpackData),
      fetchJson(base + '/buffs').then(unpackData)
    ]).then(function (parts) {
      return {
        source: 'backend',
        towers: parts[0],
        enemies: parts[1],
        gems: parts[2],
        mapsList: parts[3],
        mapDetail: parts[4],
        waves: parts[5],
        luck: parts[6],
        buffs: parts[7]
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
      luck: fb.luck,
      buffs: fb.buffs
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
    function buildTower(t) {
      var lv = (t.levels && t.levels[0]) || {};
      var attackSpeed = (typeof lv.attackSpeed === 'number' && lv.attackSpeed > 0) ? lv.attackSpeed : 1;
      return Object.assign({}, t, {
        cost: lv.cost,
        rangeInCells: lv.attackRange,
        baseDamage: lv.baseDamage,
        attackInterval: 1 / attackSpeed,
        upgradeCost: lv.upgradeCost,
        level: lv.level || 1
      });
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
      (towersArr || []).forEach(function (t) { if (t.rarity === rarity) pool.push(t); });
      if (!pool.length) pool = towersArr || [];
      return pool[Math.floor(Math.random() * pool.length)];
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
    var towersArr = (cfg.towers || []).map(buildTower);
    var towersById = {};
    towersArr.forEach(function (t) { towersById[t.id] = t; });
    var enemiesById = {};
    (cfg.enemies || []).forEach(function (e) { enemiesById[e.id] = e; });

    return Object.assign({}, cfg, {
      towers: towersArr,
      towersById: towersById,
      towersByRarity: (function () {
        var m = {};
        towersArr.forEach(function (t) { if (!m[t.rarity]) m[t.rarity] = []; m[t.rarity].push(t); });
        return m;
      })(),
      enemiesById: enemiesById,
      gemsIndex: gemIdx,
      // luck
      luckInitialLevel: luckInitialLevel,
      luckLevels: luckLevels,
      luckByLevel: luckByLevel,
      rollTowerByLuck: function (level) { return rollTowerByLuck(level, towersArr, towersById); },
      rollBonusRarityByLuck: rollBonusRarityByLuck,
      // buffs
      buffsList: buffsList,
      buffsById: buffsById,
      buffRollCostGold: buffRollCostGold,
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
