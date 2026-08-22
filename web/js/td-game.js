// ============================================================
// td-game.js  MVP v2 + V3-1(账号/保存)
// 功能：
//  - A* 4 方向寻路 + hasPath(S→E) 连通性检查
//  - 封死 Gate：place/reserve/demolishWall 三类修改地形操作唯一入口，
//    修改前临时改 tiles 跑 hasPath，失败拒绝、回滚
//  - 阶段状态机：MENU → PREPARE(Nx放置) → RESERVE(选1) → BATTLE → WAVEEND
//     → (下一波 PREPARE / WIN / LOSE)
//  - 放置：点空地 (T_GRASS or T_WALL) → rollTowerByLuck → 建候选塔 T_CAND
//    不提供撤销。放满 N/N → 开 RESERVE 模态
//  - 保留：选 1 座留真塔 (T_TOWER)，其余 4 座变墙 (T_WALL)，都过连通 Gate
//  - 免费拆墙：点击 T_WALL → gate 通过 → 改回 T_GRASS
//  - 战斗循环：敌人 A* 移动，塔锁定攻击，伤害/减速/金币结算（Buff 乘数生效）
//  - 波末：运气升级（upgradeCostGold × 连续可升）+ Buff 抽取（叠加）
//  - V3-1 账号：JWT 登录/注册，localStorage 持久化
//  - V3-1 存档：手动保存 + 波末/失败 autosave；BATTLE 阶段禁止写入（防作弊门）
//  - V3-1 读档：GET /api/save 恢复 tiles/grid/phase/金币/运气/Buff
// ============================================================
(function () {
  'use strict';

  // ---------- Tile types ----------
  var T_GRASS = 0;   // 可走 可建
  var T_STONE = 1;   // 不可走 不可建（地图初始障碍）
  var T_START = 2;   // 起点 可走
  var T_END   = 3;   // 基地 可走
  var T_WALL  = 4;   // 墙 玩家放的 可拆 不可走
  var T_TOWER = 5;   // 真塔 不可走 不可拆
  var T_CAND  = 6;   // 候选塔 不可走 未保留阶段显示

  function tileIsWalkable(v) {
    return v === T_GRASS || v === T_START || v === T_END;
  }
  function tileIsPlaceable(v) {
    return v === T_GRASS || v === T_WALL; // 空地或已有墙可再放（用户需求："5次机会也可放在墙上"）
  }
  function tileIsTowerLike(v) {
    return v === T_TOWER || v === T_CAND;
  }

  // ---------- log ----------
  var LOG_MAX = 80;
  function log(type, text) {
    var host = document.getElementById('log-list');
    if (!host) return;
    var d = document.createElement('div');
    d.className = 'lg ' + (type || 'i');
    d.textContent = text;
    host.insertBefore(d, host.firstChild);
    while (host.childNodes.length > LOG_MAX) host.removeChild(host.lastChild);
  }

  function setMsg(text, isErr) {
    var m = document.getElementById('msg');
    if (!m) return;
    if (!text) { m.textContent = ''; m.classList.remove('err'); return; }
    m.textContent = text;
    m.classList.toggle('err', !!isErr);
  }

  // ---------- Toast (V3-1) ----------
  var _toastTimer = 0;
  function toast(msg, type) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.className = 'toast ' + (type || 'info');
    el.textContent = String(msg || '');
    el.classList.remove('hidden');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2400);
  }

  // ---------- HTTP / API (V3-1) ----------
  // 统一解包后端 {code,status,data,message} 结构
  var API_BASE = '';  // 同源即可
  function api(path, opt) {
    opt = opt || {};
    var headers = opt.headers ? JSON.parse(JSON.stringify(opt.headers)) : {};
    if (!headers['Content-Type'] && opt.body) headers['Content-Type'] = 'application/json';
    var token = accountToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(API_BASE + path, {
      method: opt.method || 'GET',
      headers: headers,
      body: opt.body || undefined,
      credentials: 'omit'
    }).then(function (res) {
      return res.text().then(function (t) {
        var body = null;
        try { body = t ? JSON.parse(t) : null; } catch (_) { body = null; }
        return { status: res.status, ok: res.ok, bodyRaw: t, body: body };
      });
    }).then(function (r) {
      // 正常/错误统一解包
      var code = r.body && typeof r.body.code === 'number' ? r.body.code : r.status;
      var msg  = r.body && typeof r.body.message === 'string' ? r.body.message : '';
      var data = r.body && 'data' in r.body ? r.body.data : r.body;
      // ===== 单点登录 (SSO) 互斥自动处理 =====
      // 后端返回 401 + code===40101 / status==='kicked' 明确表示该账号已在别处登录 → 本地立即登出 + toast
      if (r.status === 401 && (code === 40101 || (r.body && r.body.status === 'kicked'))) {
        log('w', 'SSO: 检测到别处登录互斥，自动登出本地账号。message=' + msg);
        try { accountLogout(); } catch (_) { /* ignore */ }
        toast('账号在其他地方登录，已自动下线（单点登录）', 'er');
        setMsg(msg || '您的账号在别处登录，当前会话已结束。', true);
        refreshHUD();
        // 仍然把失败结果返回给调用者
      }
      if (r.ok && (code === 0 || code >= 200 && code < 300)) {
        return { ok: true, status: r.status, data: data, code: code, message: msg };
      }
      // 存档乐观锁冲突 409 code=40901：给用户明确提示，不要吞错误
      if (code === 40901 || (r.body && r.body.status === 'conflict_save')) {
        toast('存档已在其他页面更新：' + (msg || '请先读档再保存'), 'er');
        setMsg(msg || '双开冲突：另一页面/浏览器已修改存档，当前保存已拦截。请点「读档」同步后再操作。', true);
        log('w', 'SAVE_CONFLICT(40901): ' + msg);
        // 清空本地已知版本戳（防止下次循环使用）
        _knownSaveUpdatedAt = '';
      }
      // 错误
      var err = new Error(msg || ('HTTP ' + r.status));
      err.status = r.status; err.code = code; err.data = data;
      return { ok: false, status: r.status, data: data, code: code, message: msg, error: err };
    });
  }

  // ---------- Account (V3-1) ----------
  var ACC_STORE = 'td.account.v1';  // localStorage key: {uid, username, token}
  function accountFromStore() {
    try { return JSON.parse(localStorage.getItem(ACC_STORE) || 'null') || null; }
    catch (_) { return null; }
  }
  function accountSaveToStore(info) {
    try {
      if (!info) localStorage.removeItem(ACC_STORE);
      else localStorage.setItem(ACC_STORE, JSON.stringify(info));
    } catch (_) {}
  }
  var _acc = accountFromStore();  // {uid, username, token} or null
  function accountToken()  { return _acc ? _acc.token : ''; }
  function accountInfo()   { return _acc; }
  function accountLoggedIn() { return !!_acc; }

  // ===== 存档乐观锁 (SSO 双开防覆盖) =====
  // 每次 GET /api/save 读档成功 或 POST /api/save 保存成功时，刷新成服务器返回的 updatedAt (ISO字符串)
  // 初始值 '' = 从未同步过服务器存档版本（意味着本地第一次保存时应该带 ifNoneExist / ifMatchUpdatedAt=ZERO）
  var _knownSaveUpdatedAt = '';
  // 登出/换号时必须清空，避免串号
  function _resetSaveVersion() { _knownSaveUpdatedAt = ''; }

  function accountSetLoggedIn(info) {
    _acc = info ? { uid: Number(info.uid) || 0, username: String(info.username || ''), token: String(info.token || '') } : null;
    accountSaveToStore(_acc);
    _resetSaveVersion(); // 登录状态变化（登出/换号/新登录）都必须重置乐观锁版本戳，避免串号 / 用旧版本戳去匹配当前账号
    refreshAccountChip();
  }

  function refreshAccountChip() {
    var el = document.getElementById('account-chip');
    if (!el) return;
    if (_acc && _acc.username) {
      el.textContent = '👤 ' + _acc.username;
      el.classList.add('on');
    } else {
      el.textContent = '👤 未登录';
      el.classList.remove('on');
    }
  }

  function openAccountModal() {
    var m = document.getElementById('account-modal');
    if (!m) return;
    var title = document.getElementById('account-title');
    var sub   = document.getElementById('account-sub');
    var btnLogin = document.getElementById('btn-acc-login');
    var btnReg   = document.getElementById('btn-acc-register');
    var btnLogout= document.getElementById('btn-acc-logout');
    var formErr  = document.getElementById('account-err');
    formErr.classList.add('hidden'); formErr.textContent = '';
    if (_acc) {
      title.textContent = '账号信息';
      sub.textContent = '当前已登录为 ' + _acc.username + '（uid=' + _acc.uid + '）。可退出后切换账号。';
      btnLogin.classList.add('hidden');
      btnReg.classList.add('hidden');
      btnLogout.classList.remove('hidden');
      document.getElementById('acc-username').value = '';
      document.getElementById('acc-password').value = '';
    } else {
      title.textContent = '登录 / 注册';
      sub.textContent = '登录后可云端保存进度（BATTLE 阶段禁止写入，防作弊）。';
      btnLogin.classList.remove('hidden');
      btnReg.classList.remove('hidden');
      btnLogout.classList.add('hidden');
    }
    m.classList.remove('hidden');
  }
  function closeAccountModal() {
    var m = document.getElementById('account-modal');
    if (m) m.classList.add('hidden');
  }
  function accountFormValues() {
    var u = document.getElementById('acc-username');
    var p = document.getElementById('acc-password');
    return { username: (u && u.value || '').trim(), password: (p && p.value || '') };
  }
  function accountSetFormErr(msg) {
    var e = document.getElementById('account-err');
    if (!e) return;
    if (msg) { e.textContent = msg; e.classList.remove('hidden'); }
    else     { e.textContent = '';  e.classList.add('hidden'); }
  }
  function doLogin(isRegister) {
    var v = accountFormValues();
    if (v.username.length < 2) { accountSetFormErr('用户名至少 2 个字符'); return; }
    if (v.password.length < 6) { accountSetFormErr('密码至少 6 个字符'); return; }
    accountSetFormErr('');
    var body = JSON.stringify({ username: v.username, password: v.password });
    var path = isRegister ? '/api/auth/register' : '/api/auth/login';
    api(path, { method: 'POST', body: body }).then(function (r) {
      if (r.ok && r.data && r.data.token) {
        accountSetLoggedIn({ uid: r.data.uid, username: r.data.username, token: r.data.token });
        toast((isRegister ? '注册并登录成功：' : '登录成功：') + (r.data.username || ''), 'ok');
        log('s', (isRegister ? '已注册并登录：' : '已登录：') + (r.data.username || '') + ' (uid=' + r.data.uid + ')');
        closeAccountModal();
      } else {
        accountSetFormErr((r && r.message) ? r.message : ((isRegister ? '注册' : '登录') + '失败（HTTP ' + (r && r.status) + '）'));
      }
    });
  }
  function doLogout() {
    accountSetLoggedIn(null);
    toast('已退出登录', 'info');
    log('i', '已退出登录。');
    closeAccountModal();
  }
  // 别名：SSO 自动被踢下线时 api() 内部直接调用
  var accountLogout = doLogout;

  // ---------- Save / Load (V3-1) ----------
  // 构造存档 payload：保存游戏中所有跨波持久字段
  function buildSavePayload(isAutoFlag) {
    // tiles: 只存玩家改动过的 tile 太复杂，MVP 存整份 []uint8 作为数组
    var tilesArr = [];
    for (var i = 0; i < state.tiles.length; i++) tilesArr.push(state.tiles[i] | 0);
    // grid: 只导出非空 cell（塔/墙元数据；候选塔不跨波）
    var N = state.cols * state.rows;
    var gridOut = [];
    for (var k = 0; k < N; k++) {
      var g = state.grid[k];
      if (!g) continue;
      var t = state.tiles[k];
      // 候选塔跳过（不存档）
      if (t === T_CAND) continue;
      var item = { i: k };
      if (t === T_WALL) { item.type = 'wall'; gridOut.push(item); continue; }
      if (t === T_TOWER && g.towerCfgId != null) {
        item.type = 'tower';
        item.towerCfgId = g.towerCfgId;
        item.rarity = g.rarity || null;
        gridOut.push(item);
      }
    }
    return {
      version: 1,
      phase:   state.phase,
      luckLevel: state.luckLevel,
      gold:    state.gold,
      baseHP:  state.baseHP,
      baseMaxHP: state.baseMaxHP,
      waveIndex: state.waveIndex,
      tiles:   tilesArr,
      grid:    gridOut,
      activeBuffs: state.activeBuffs.map(function (b) {
        return { id: b.id, name: b.name, rarity: b.rarity, count: b.count || 1 };
      }),
      placementUsed:  state.placementUsed,
      placementTotal: state.placementTotal,
      isAuto:  !!isAutoFlag
    };
  }

  // ---------- 防作弊：阶段级保存 / 读档门禁 ----------
  // 手动保存 / 手动读档都可能被玩家用于「Roll 不满意就读档回滚 → 无限刷稀有塔」
  // 因此任何处于「已 Roll 了塔但尚未完成 RESERVE」的阶段都禁止手动读写存档
  function canManualSaveOrLoad(s) {
    var ph = s.phase;
    // 明确白名单：MENU（对局没开始）、波末结算 / WIN / LOSE（已结束/暂停的稳定点）
    if (ph === PHASE.MENU || ph === PHASE.WAVEEND || ph === PHASE.WIN || ph === PHASE.LOSE) return { ok: true };
    // PREPARE：只有放置机会完全没开始用（一次 Roll 都没做）才允许
    // 一旦 placementUsed > 0，说明至少 Roll 过一次塔了，此时存/读档等于刷塔入口
    if (ph === PHASE.PREPARE) {
      if ((s.placementUsed || 0) === 0) return { ok: true };
      return { ok: false, reason: 'PREP_PLACING', msg: '已经开始 Roll 塔（已放置 ' + s.placementUsed + '/' + s.placementTotal + '），禁止存/读档防刷塔。如需放弃本局进度请点「重开」。' };
    }
    // RESERVE：已经完整看完 5 个 Roll 结果，看完了再读档回滚是纯作弊
    if (ph === PHASE.RESERVE) return { ok: false, reason: 'RESERVE_PEEKED', msg: '已查看保留弹窗（5 个 Roll 结果都展示了），禁止存/读档防刷塔。如需放弃本局进度请点「重开」。' };
    // BATTLE：战斗中当然不允许
    if (ph === PHASE.BATTLE) return { ok: false, reason: 'BATTLE', msg: '战斗阶段禁止存/读档（防作弊）。' };
    return { ok: false, reason: 'UNKNOWN', msg: '当前阶段 (' + ph + ') 禁止存/读档。' };
  }

  function saveNow(isAuto) {
    if (!_acc) { toast('请先登录再保存', 'er'); setMsg('未登录无法云端保存', true); return Promise.resolve({ ok: false }); }
    // autosave（波末/失败触发）是代码内部安全调用点，直接放行
    // 手动点按钮必须过防刷门禁
    if (!isAuto) {
      var g1 = canManualSaveOrLoad(state);
      if (!g1.ok) {
        toast('禁止保存：' + g1.msg, 'er');
        setMsg(g1.msg, true);
        log('w', '手动保存被拒绝: ' + g1.reason + ' ' + g1.msg);
        return Promise.resolve({ ok: false });
      }
    }
    if (state.phase === PHASE.BATTLE) {
      toast('战斗阶段禁止保存（防作弊）', 'er');
      setMsg('战斗中禁止写入存档，请等待波末或结束', true);
      return Promise.resolve({ ok: false });
    }
    // ===== 构造存档请求体 + 乐观锁版本戳 =====
    // - _knownSaveUpdatedAt === '' : 本地从未读档过，期望服务器没有该账号的存档（ifMatchUpdatedAt='ZERO' / ifNoneExist=true）
    // - _knownSaveUpdatedAt 非空   : 把上次服务器返回的 updatedAt 带回去，毫秒级比对（防止双开覆盖）
    var payload = buildSavePayload(!!isAuto);
    if (!_knownSaveUpdatedAt) {
      payload.ifNoneExist = false;          // 兼容字段（后端 IfMatchUpdatedAt=ZERO 优先）
      payload.ifMatchUpdatedAt = 'ZERO';
    } else {
      payload.ifMatchUpdatedAt = _knownSaveUpdatedAt;
    }
    var body = JSON.stringify(payload);
    return api('/api/save', { method: 'POST', body: body }).then(function (r) {
      if (r.ok && r.data && r.data.saved) {
        // 保存成功：刷新成服务器最新的 updatedAt（后端保证返回的是真实写入时的时间戳，ms 级一致）
        if (r.data.updatedAt) {
          _knownSaveUpdatedAt = (typeof r.data.updatedAt === 'string') ? r.data.updatedAt : new Date(r.data.updatedAt).toISOString();
        }
        var label = isAuto ? '自动保存成功' : '保存成功';
        toast(label + '（波 ' + state.waveIndex + '）', 'ok');
        log('s', label + '：' + (r.data.updatedAt ? new Date(r.data.updatedAt).toLocaleString() : '') + '  version=' + _knownSaveUpdatedAt);
        return { ok: true };
      } else {
        // 409 冲突已经在 api() 统一处理并清空 _knownSaveUpdatedAt，这里无需重复
        toast((isAuto ? '自动保存失败：' : '保存失败：') + (r.message || ('HTTP ' + r.status)), 'er');
        return { ok: false };
      }
    });
  }

  function applySaveRecord(rec) {
    // 先重置 canvas 尺寸，再逐个字段覆盖
    if (!rec) return { ok: false, msg: '无存档数据' };
    // 关键修复：若尚未初始化地图（MENU 直接读档），先跑 applyCfg 分配 cols/rows/grid/canvas 尺寸
    // 否则 state.grid 是空数组，塔对象会因 idx_k >= grid.length 被跳过，导致 tiles 有值但 draw 时 g=null 不渲染
    if ((!state.cols || !state.rows || !state.grid.length) && state.cfg) {
      applyCfg(state.cfg);
      log('i', '读档时自动调用 applyCfg 初始化地图尺寸 cols=' + state.cols + ' rows=' + state.rows + ' gridLen=' + state.grid.length);
    }
    // 尺寸
    if (Array.isArray(rec.tiles) && rec.tiles.length > 0 && state.cfg) {
      var md = state.cfg.mapDetail;
      var expectedLen = (md && md.gridWidth && md.gridHeight) ? (md.gridWidth * md.gridHeight) : 0;
      if (expectedLen && expectedLen !== rec.tiles.length) {
        log('w', '存档 tiles 长度与当前地图不一致：' + rec.tiles.length + ' ≠ ' + expectedLen + '，可能无法复原。');
      }
      state.tiles = rec.tiles.slice();
      // 清零 grid 并回填
      for (var k = 0; k < state.grid.length; k++) state.grid[k] = null;
      state.towersByInst = {};
      state.nextInstId = 1;
      if (Array.isArray(rec.grid)) {
        for (var j = 0; j < rec.grid.length; j++) {
          var it = rec.grid[j];
          var idx_k = Number(it.i);
          if (idx_k < 0 || idx_k >= state.grid.length) continue;
          if (it.type === 'wall') {
            state.grid[idx_k] = { type: T_WALL };
          } else if (it.type === 'tower' && it.towerCfgId != null) {
            var cfg = (state.cfg && state.cfg.towersById) ? state.cfg.towersById[Number(it.towerCfgId)] : null;
            if (!cfg) continue;
            var inst = {
              type: T_TOWER,
              towerCfgId: cfg.id,
              rarity: it.rarity || cfg.rarity,
              towerCfg: cfg,
              cooldown: 0
            };
            state.grid[idx_k] = inst;
            state.towersByInst[state.nextInstId] = inst;
            inst.towerInstanceId = state.nextInstId;
            state.nextInstId++;
          }
        }
      }
    }
    // 玩家字段
    if (typeof rec.gold === 'number') state.gold = rec.gold;
    if (typeof rec.baseHP === 'number') state.baseHP = rec.baseHP;
    if (typeof rec.baseMaxHP === 'number') state.baseMaxHP = rec.baseMaxHP;
    if (typeof rec.luckLevel === 'number') state.luckLevel = rec.luckLevel;
    if (typeof rec.waveIndex === 'number') state.waveIndex = rec.waveIndex;
    if (typeof rec.placementTotal === 'number') state.placementTotal = rec.placementTotal;
    if (typeof rec.placementUsed === 'number') state.placementUsed = rec.placementUsed;
    if (Array.isArray(rec.activeBuffs)) state.activeBuffs = rec.activeBuffs.slice();
    // phase：若存档 phase === BATTLE 则回退为 PREPARE（不允许恢复到战斗中）
    var ph = String(rec.phase || 'MENU');
    if (ph === PHASE.BATTLE) {
      state.phase = PHASE.PREPARE;
      log('w', '存档为 BATTLE 阶段，回退至 PREPARE（防作弊）。');
    } else if (PHASE[ph]) {
      state.phase = PHASE[ph];
    } else {
      state.phase = PHASE.MENU;
    }
    // 清理战斗临时数据
    state.enemies = []; state.projectiles = []; state.spawnQueue = [];
    state.candidates = []; state.waveElapsed = 0;
    state.waveKillGold = 0; state.waveBonusGold = 0;
    state.lastFrame = 0; state.running = true;
    // 关闭残留模态
    ['reserve-modal','waveend-modal','end-modal'].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.classList.add('hidden');
    });
    // 若为 WAVEEND，重开波末模态
    if (state.phase === PHASE.WAVEEND) {
      // 仅显示，不重复发金币
      state.phase = PHASE.WAVEEND;
      document.getElementById('waveend-summary').innerHTML =
        '从存档恢复：波 ' + state.waveIndex + ' 结算。';
      renderLuckPanel();
      document.getElementById('buff-roll-cost').textContent = String(state.cfg && state.cfg.buffRollCostGold || 40);
      document.getElementById('waveend-modal').classList.remove('hidden');
    }
    if (state.phase === PHASE.LOSE || state.phase === PHASE.WIN) {
      var title = state.phase === PHASE.WIN ? '通关！' : '防线崩溃！';
      document.getElementById('end-title').textContent = title;
      document.getElementById('end-summary').innerHTML =
        '从存档恢复至结局：波 <b>' + state.waveIndex + '</b>；金币 <b>' + state.gold + '</b>。';
      document.getElementById('end-modal').classList.remove('hidden');
    }
    refreshHUD();
    draw();
    return { ok: true };
  }

  function loadSave() {
    if (!_acc) { toast('请先登录再读档', 'er'); setMsg('未登录无法云端读档', true); return Promise.resolve({ ok: false }); }
    // 手动读档必须过防刷门禁（防止：Roll 不满意 → 读档 → Roll 次数清零 → 无限刷塔）
    var g2 = canManualSaveOrLoad(state);
    if (!g2.ok) {
      toast('禁止读档：' + g2.msg, 'er');
      setMsg(g2.msg, true);
      log('w', '手动读档被拒绝: ' + g2.reason + ' ' + g2.msg);
      return Promise.resolve({ ok: false });
    }
    return api('/api/save', { method: 'GET' }).then(function (r) {
      if (!r.ok) {
        toast('读档失败：' + (r.message || ('HTTP ' + r.status)), 'er');
        return { ok: false };
      }
      if (!r.data) {
        // 账号下没有存档：本地也记成"空" → 接下来 save 会走 ifMatchUpdatedAt=ZERO 首次保存
        _knownSaveUpdatedAt = '';
        toast('当前账号没有存档', 'info');
        return { ok: false };
      }
      var result = applySaveRecord(r.data);
      if (result.ok) {
        // 读档成功：把服务器存档的 updatedAt 记录下来，下次保存就带着它乐观锁
        if (r.data.updatedAt) {
          _knownSaveUpdatedAt = (typeof r.data.updatedAt === 'string') ? r.data.updatedAt : new Date(r.data.updatedAt).toISOString();
        }
        toast('读档成功（波 ' + state.waveIndex + ' ' + state.phase + '）', 'ok');
        log('s', '已载入存档：' + (r.data.updatedAt ? new Date(r.data.updatedAt).toLocaleString() : '') +
          '  phase=' + state.phase + '  波=' + state.waveIndex + '  version=' + _knownSaveUpdatedAt);
      } else {
        toast('读档失败：' + (result.msg || '数据异常'), 'er');
      }
      return result;
    });
  }

  // ---------- autosave hook (V3-1) ----------
  // 在 WAVEEND 打开后 + LOSE 触发后调用：saveNow(true)，失败静默警告不阻断 UI
  function autoSaveIfLoggedIn(reason) {
    if (!_acc) return;
    saveNow(true).then(function (r) {
      if (!r.ok) log('w', '自动保存失败(' + reason + ')：未保存。');
    });
  }

  // ---------- game state ----------
  var PHASE = {
    MENU: 'MENU', PREPARE: 'PREPARE', RESERVE: 'RESERVE',
    BATTLE: 'BATTLE', WAVEEND: 'WAVEEND', WIN: 'WIN', LOSE: 'LOSE'
  };
  var state = {
    cfg: null,
    canvas: null, ctx: null,
    cell: 0, cols: 0, rows: 0,
    tiles: [],
    // grid 元数据：每格的对象（塔/墙/候选）
    grid: [],  // length = cols*rows；对象形如 {type:T_WALL, towerId?, towerInstanceId?, hp?}
    towersByInst: {}, // instId -> runtime tower
    nextInstId: 1,
    // 阶段
    phase: PHASE.MENU,
    waveIndex: 0, maxWaves: 0,      // waveIndex 0 表示未开始，第 1 波=1
    placementTotal: 5, placementUsed: 0,
    candidates: [],   // 当前 wave 候选塔 [{gx,gy,instId,towerCfg}]
    // 玩家属性
    luckLevel: 1,
    gold: 0,
    baseHP: 0, baseMaxHP: 0,
    activeBuffs: [],   // [{id,name,rarity,effect}]  同 id 可多条，applyBuffs 处理叠加
    // 战斗
    enemies: [],
    projectiles: [],
    spawnQueue: [],    // 待生成的敌人: [{enemyId,timeLeft}]
    waveElapsed: 0,
    lastFrame: 0,
    running: false,
    waveKillGold: 0,
    waveBonusGold: 0,
    rafId: 0
  };

  function idx(x, y) { return y * state.cols + x; }
  function inBounds(x, y) { return x >= 0 && y >= 0 && x < state.cols && y < state.rows; }
  function tileAt(x, y) {
    if (!inBounds(x, y)) return -1;
    return state.tiles[idx(x, y)];
  }
  function setTile(x, y, v) {
    state.tiles[idx(x, y)] = v;
  }
  function cellCenterPx(x, y) {
    var cs = state.cell;
    return { cx: x * cs + cs / 2, cy: y * cs + cs / 2 };
  }

  // ---------- A* pathfinding ----------
  function aStar(sx, sy, ex, ey) {
    if (!inBounds(sx, sy) || !inBounds(ex, ey)) return null;
    var cols = state.cols, rows = state.rows;
    var N = cols * rows;
    var open = [];
    // simple flat arrays
    var gScore = new Array(N); for (var i = 0; i < N; i++) gScore[i] = Infinity;
    var cameFrom = new Array(N); for (var i = 0; i < N; i++) cameFrom[i] = -1;
    var closed = new Uint8Array(N);
    var start = idx(sx, sy);
    gScore[start] = 0;
    open.push({ i: start, f: Math.abs(ex - sx) + Math.abs(ey - sy) });
    var dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    while (open.length) {
      // pick lowest f
      var bi = 0;
      for (var k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
      var cur = open.splice(bi, 1)[0];
      var ci = cur.i;
      if (ci === idx(ex, ey)) {
        var path = [];
        var cc = ci;
        while (cc !== -1) {
          path.unshift({ x: cc % cols, y: Math.floor(cc / cols) });
          cc = cameFrom[cc];
        }
        return path;
      }
      if (closed[ci]) continue;
      closed[ci] = 1;
      var cx = ci % cols, cy = Math.floor(ci / cols);
      for (var d = 0; d < 4; d++) {
        var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
        if (!inBounds(nx, ny)) continue;
        var nv = tileAt(nx, ny);
        if (!tileIsWalkable(nv) && !(nx === ex && ny === ey)) continue;
        var ni = idx(nx, ny);
        if (closed[ni]) continue;
        var tent = gScore[ci] + 1;
        if (tent < gScore[ni]) {
          cameFrom[ni] = ci;
          gScore[ni] = tent;
          var hh = Math.abs(ex - nx) + Math.abs(ey - ny);
          open.push({ i: ni, f: tent + hh });
        }
      }
    }
    return null;
  }

  function hasPathFromStartToEnd() {
    var md = state.cfg.mapDetail;
    var sp = md.spawnPoints && md.spawnPoints[0] ? md.spawnPoints[0] : { x: 0, y: 0 };
    var ep = md.base || { x: state.cols - 1, y: 0 };
    var sx = sp.x, sy = sp.y, ex = ep.x, ey = ep.y;
    // 起点/终点 tile 的可走性
    var save = [tileAt(sx, sy), tileAt(ex, ey)];
    if (!tileIsWalkable(save[0])) setTile(sx, sy, T_START);
    if (!tileIsWalkable(save[1])) setTile(ex, ey, T_END);
    var p = aStar(sx, sy, ex, ey);
    // restore
    if (tileAt(sx, sy) !== save[0]) setTile(sx, sy, save[0]);
    if (tileAt(ex, ey) !== save[1]) setTile(ex, ey, save[1]);
    return !!p;
  }

  // ---------- Gate: single source of truth for terrain-modifying ops ----------
  // op = {kind:'place'|'reserve_tower'|'to_wall'|'demolish_wall', gx,gy, newTile}
  // 返回 { ok:boolean, msg?:string }
  function terrainGate(op) {
    if (!op || !inBounds(op.gx, op.gy)) return { ok: false, msg: '越界' };
    var prev = tileAt(op.gx, op.gy);
    var prevGridObj = state.grid[idx(op.gx, op.gy)] || null;
    setTile(op.gx, op.gy, op.newTile);
    if (op.gridObj !== undefined) state.grid[idx(op.gx, op.gy)] = op.gridObj;
    var pathOk = hasPathFromStartToEnd();
    if (!pathOk) {
      // 回滚
      setTile(op.gx, op.gy, prev);
      state.grid[idx(op.gx, op.gy)] = prevGridObj;
      return { ok: false, msg: '操作会封死路径（起点→基地无通路），已拒绝' };
    }
    return { ok: true };
  }

  // ---------- rendering ----------
  function drawTile(x, y) {
    var ctx = state.ctx, cs = state.cell;
    var px = x * cs, py = y * cs;
    var t = tileAt(x, y);
    switch (t) {
      case T_GRASS:
        ctx.fillStyle = '#14532d';
        ctx.fillRect(px, py, cs, cs);
        ctx.fillStyle = 'rgba(34, 197, 94, 0.10)';
        ctx.fillRect(px + 2, py + 2, cs - 4, cs - 4);
        break;
      case T_STONE:
        ctx.fillStyle = '#475569'; ctx.fillRect(px, py, cs, cs);
        ctx.fillStyle = '#334155'; ctx.fillRect(px + 3, py + 3, cs - 6, cs - 6);
        break;
      case T_START:
        ctx.fillStyle = '#065f46'; ctx.fillRect(px, py, cs, cs);
        ctx.fillStyle = '#10b981';
        ctx.font = 'bold ' + Math.round(cs * 0.5) + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('S', px + cs / 2, py + cs / 2 + 1);
        break;
      case T_END:
        ctx.fillStyle = '#7f1d1d'; ctx.fillRect(px, py, cs, cs);
        ctx.fillStyle = '#f87171';
        ctx.font = 'bold ' + Math.round(cs * 0.5) + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('E', px + cs / 2, py + cs / 2 + 1);
        break;
      case T_WALL:
        ctx.fillStyle = '#78350f'; ctx.fillRect(px, py, cs, cs);
        ctx.fillStyle = '#92400e'; ctx.fillRect(px + 3, py + 3, cs - 6, cs - 6);
        ctx.fillStyle = '#451a03'; ctx.fillRect(px + 7, py + 7, cs - 14, cs - 14);
        break;
      case T_TOWER:
      case T_CAND:
        ctx.fillStyle = '#14532d'; ctx.fillRect(px, py, cs, cs);
        break;
      default:
        ctx.fillStyle = '#111827'; ctx.fillRect(px, py, cs, cs);
    }
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, cs - 1, cs - 1);
  }

  function drawGridTowersAndWalls() {
    var ctx = state.ctx, cs = state.cell;
    for (var y = 0; y < state.rows; y++) {
      for (var x = 0; x < state.cols; x++) drawTile(x, y);
    }
    // grid 上的塔/候选塔
    for (var y2 = 0; y2 < state.rows; y2++) {
      for (var x2 = 0; x2 < state.cols; x2++) {
        var g = state.grid[idx(x2, y2)];
        if (!g) continue;
        var t = tileAt(x2, y2);
        var cc = cellCenterPx(x2, y2);
        if (t === T_CAND || t === T_TOWER) {
          var cfg = g.towerCfg;
          var color = (cfg && cfg.color) ? cfg.color : '#fff';
          var dash = (t === T_CAND);
          // 外圈
          ctx.save();
          ctx.beginPath();
          ctx.arc(cc.cx, cc.cy, cs * 0.40, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = dash ? '#fde047' : 'rgba(0,0,0,.45)';
          if (dash) ctx.setLineDash([5, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
          // 顶部方块（塔炮）
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(cc.cx - cs * 0.12, cc.cy - cs * 0.12, cs * 0.24, cs * 0.24);
          // 稀有度角标
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(cc.cx + cs * 0.10, cc.cy - cs * 0.42, cs * 0.28, 14);
          ctx.fillStyle = rarityCssColor(cfg && cfg.rarity);
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          ctx.fillText(rarityShort(cfg && cfg.rarity), cc.cx + cs * 0.12, cc.cy - cs * 0.40);
          ctx.restore();
          // 攻击范围（仅候选塔显示 + 半透明，战斗中影响性能先关，为 AC 观测可开）
          if (t === T_CAND && cfg && cfg.rangeInCells) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(cc.cx, cc.cy, cfg.rangeInCells * cs, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.5)';
            ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
            ctx.stroke(); ctx.setLineDash([]);
            ctx.restore();
          }
        }
      }
    }
  }

  function rarityCssColor(r) {
    return ({common:'#e2e8f0',rare:'#60a5fa',epic:'#a78bfa',legendary:'#fbbf24'})[r] || '#e2e8f0';
  }
  function rarityShort(r) {
    return ({common:'普',rare:'稀',epic:'史',legendary:'传'})[r] || '?';
  }

  function drawEnemies() {
    var ctx = state.ctx, cs = state.cell;
    for (var i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      if (!e.alive) continue;
      var px = e.px, py = e.py;
      var cfg = e.cfg;
      var r = (cfg && cfg.radiusPx) ? cfg.radiusPx : 11;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = (cfg && cfg.color) ? cfg.color : '#68d391';
      ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.stroke();
      // HP bar
      var barW = r * 2 + 4, barH = 4;
      var bx = px - barW / 2, by = py - r - 8;
      ctx.fillStyle = '#334155'; ctx.fillRect(bx, by, barW, barH);
      var ratio = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = ratio > 0.5 ? '#22c55e' : (ratio > 0.25 ? '#eab308' : '#ef4444');
      ctx.fillRect(bx, by, barW * ratio, barH);
      // slow 标识
      if (e.slowSec > 0) {
        ctx.fillStyle = '#60a5fa';
        ctx.fillRect(bx, by + barH + 1, 3, 3);
      }
    }
  }

  function drawProjectiles() {
    var ctx = state.ctx;
    for (var i = 0; i < state.projectiles.length; i++) {
      var p = state.projectiles[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = p.color || '#fde047';
      ctx.fill();
    }
  }

  function drawMouseHint() {
    if (!state.mouseCell) return;
    var ctx = state.ctx, cs = state.cell;
    var x = state.mouseCell.x, y = state.mouseCell.y;
    if (!inBounds(x, y)) return;
    var t = tileAt(x, y);
    var canPlace = state.phase === PHASE.PREPARE && tileIsPlaceable(t);
    var canDemol = state.phase !== PHASE.MENU && t === T_WALL;
    var canInfo  = (t === T_TOWER || t === T_CAND);
    var ok = canPlace || canDemol || canInfo;
    ctx.fillStyle = ok ? 'rgba(96,165,250,0.22)' : 'rgba(248,113,113,0.22)';
    ctx.fillRect(x * cs, y * cs, cs, cs);
    ctx.strokeStyle = ok ? 'rgba(96,165,250,0.85)' : 'rgba(248,113,113,0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x * cs + 1, y * cs + 1, cs - 2, cs - 2);
  }

  function draw() {
    var ctx = state.ctx;
    if (!ctx || !state.cfg) return;
    ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
    drawGridTowersAndWalls();
    drawProjectiles();
    drawEnemies();
    drawMouseHint();
  }

  // ---------- HUD ----------
  function rarityLabel(r) {
    return ({common:'普通',rare:'稀有',epic:'史诗',legendary:'传说'})[r] || r;
  }

  function refreshHUD() {
    var $ = function (id) { return document.getElementById(id); };
    $('stat-gold').textContent   = String(state.gold);
    $('stat-hp').textContent     = String(state.baseHP) + ' / ' + String(state.baseMaxHP);
    $('stat-wave').textContent   = String(state.waveIndex) + ' / ' + String(state.maxWaves);
    $('stat-luck').textContent   = String(state.luckLevel);
    var tcnt = 0, wcnt = 0;
    for (var i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i] === T_TOWER) tcnt++;
      else if (state.tiles[i] === T_WALL) wcnt++;
    }
    $('stat-towers').textContent = String(tcnt);
    $('stat-walls').textContent  = String(wcnt);
    $('stat-source').textContent = (state.cfg && state.cfg.source) ? state.cfg.source : '-';
    // phase bar
    var phaseT = $('phase-name'), extra = $('phase-extra');
    phaseT.textContent = state.phase;
    var extras = [];
    if (state.phase === PHASE.PREPARE) {
      var left = state.placementTotal - state.placementUsed;
      extras.push('<span class="chip hot">放置剩余 ' + left + ' / ' + state.placementTotal + '</span>');
      extras.push('<span class="chip ok">运气 ' + state.luckLevel + '</span>');
    } else if (state.phase === PHASE.BATTLE) {
      var alive = 0;
      for (var i = 0; i < state.enemies.length; i++) if (state.enemies[i].alive) alive++;
      extras.push('<span class="chip hot">战斗中 存活 ' + alive + '</span>');
      extras.push('<span class="chip">待生成 ' + state.spawnQueue.length + '</span>');
    } else if (state.phase === PHASE.RESERVE) {
      extras.push('<span class="chip hot">请选择 1 座保留</span>');
    } else if (state.phase === PHASE.WAVEEND) {
      extras.push('<span class="chip ok">波次结算</span>');
    } else if (state.phase === PHASE.WIN || state.phase === PHASE.LOSE) {
      extras.push('<span class="chip hot">对局结束</span>');
    } else {
      extras.push('<span class="chip">点击"开始下一波"进入游戏</span>');
    }
    extra.innerHTML = extras.join(' ');
    renderBuffsPanel();
  }

  function renderBuffsPanel() {
    var host = document.getElementById('buffs-list');
    if (!host) return;
    if (!state.activeBuffs.length) {
      host.innerHTML = '<div class="empty">（暂无。波末可用金币抽取）</div>';
      return;
    }
    // 按 id 聚合显示 × 数量
    var agg = {};
    state.activeBuffs.forEach(function (b) {
      if (!agg[b.id]) agg[b.id] = { id: b.id, name: b.name, rarity: b.rarity, count: 0 };
      agg[b.id].count++;
    });
    host.innerHTML = '';
    Object.keys(agg).forEach(function (id) {
      var b = agg[id];
      var d = document.createElement('div');
      d.className = 'buff-chip r-' + b.rarity;
      d.innerHTML = '<span class="name">' + b.name + '</span><span class="cnt">x' + b.count + '</span>';
      host.appendChild(d);
    });
  }

  // ---------- terrain ops (gate-wrapped) ----------
  function placeCandidate(gx, gy) {
    if (state.phase !== PHASE.PREPARE) return { ok: false, msg: '当前阶段不可放置' };
    if (state.placementUsed >= state.placementTotal) return { ok: false, msg: '本波放置机会已用完，请选择保留塔' };
    var t = tileAt(gx, gy);
    if (!tileIsPlaceable(t)) return { ok: false, msg: '该位置不可放置（只能放在空地或墙上）' };
    var towerCfg = state.cfg.rollTowerByLuck(state.luckLevel);
    if (!towerCfg) return { ok: false, msg: '配置错误：无法 Roll 塔' };
    var prevTile = t;
    var prevGrid = state.grid[idx(gx, gy)] || null;
    var instId = state.nextInstId++;
    var gridObj = { type: T_CAND, instId: instId, towerCfgId: towerCfg.id, rarity: towerCfg.rarity, towerCfg: towerCfg, cooldown: 0 };
    var res = terrainGate({ kind: 'place', gx: gx, gy: gy, newTile: T_CAND, gridObj: gridObj });
    if (!res.ok) return res;
    state.towersByInst[instId] = gridObj;
    state.candidates.push({ gx: gx, gy: gy, instId: instId, towerCfg: towerCfg });
    state.placementUsed++;
    log('s', '放置#' + state.placementUsed + ' Roll出 ' + rarityLabel(towerCfg.rarity) + ' ' + towerCfg.name + ' 于 (' + gx + ',' + gy + ')');
    setMsg('已 Roll 出 [' + rarityLabel(towerCfg.rarity) + '] ' + towerCfg.name + '。不能撤销。');
    return { ok: true };
  }

  function demolishWall(gx, gy) {
    if (tileAt(gx, gy) !== T_WALL) return { ok: false, msg: '不是墙' };
    if (state.phase === PHASE.MENU || state.phase === PHASE.WIN || state.phase === PHASE.LOSE)
      return { ok: false, msg: '当前阶段不可操作' };
    var res = terrainGate({ kind: 'demolish_wall', gx: gx, gy: gy, newTile: T_GRASS, gridObj: null });
    if (!res.ok) return res;
    log('i', '免费拆除了 (' + gx + ',' + gy + ') 的墙');
    return { ok: true };
  }

  function reserveOne(instId) {
    if (state.phase !== PHASE.RESERVE) return { ok: false, msg: '当前阶段不需要保留' };
    var found = null;
    for (var i = 0; i < state.candidates.length; i++) if (state.candidates[i].instId === instId) { found = state.candidates[i]; break; }
    if (!found) return { ok: false, msg: '候选塔不存在' };

    // 先把所有候选 tile 暂变回草地以便走 gate 逐个改造，保留 T_CAND 记录
    // 方案：逐个处理。先 to_wall 4 个（改 T_WALL），再把保留的变 T_TOWER。
    // 每一步都 gate，失败回滚前一步的改动。
    var applied = []; // list of undo ops
    function undoAll() {
      for (var k = applied.length - 1; k >= 0; k--) {
        var u = applied[k];
        setTile(u.gx, u.gy, u.oldTile);
        state.grid[idx(u.gx, u.gy)] = u.oldGrid;
        if (u.oldInstId) state.towersByInst[u.oldInstId] = state.grid[idx(u.gx, u.gy)];
      }
    }
    var kept = null;
    for (var j = 0; j < state.candidates.length; j++) {
      var c = state.candidates[j];
      var oldTile = tileAt(c.gx, c.gy);
      var oldGrid = state.grid[idx(c.gx, c.gy)];
      if (c.instId === instId) {
        // 保留 → T_TOWER
        var newGridObj = { type: T_TOWER, instId: c.instId, towerCfgId: c.towerCfg.id, rarity: c.towerCfg.rarity, towerCfg: c.towerCfg, cooldown: 0 };
        var r1 = terrainGate({ kind: 'reserve_tower', gx: c.gx, gy: c.gy, newTile: T_TOWER, gridObj: newGridObj });
        if (!r1.ok) { undoAll(); return r1; }
        state.towersByInst[c.instId] = newGridObj;
        kept = c;
        applied.push({ gx: c.gx, gy: c.gy, oldTile: oldTile, oldGrid: oldGrid, oldInstId: c.instId });
      } else {
        // 变墙 → T_WALL
        var wallGridObj = { type: T_WALL };
        var r2 = terrainGate({ kind: 'to_wall', gx: c.gx, gy: c.gy, newTile: T_WALL, gridObj: wallGridObj });
        if (!r2.ok) { undoAll(); return r2; }
        delete state.towersByInst[c.instId];
        applied.push({ gx: c.gx, gy: c.gy, oldTile: oldTile, oldGrid: oldGrid, oldInstId: null });
      }
    }
    if (!kept) { undoAll(); return { ok: false, msg: '内部错误：未找到保留塔' }; }
    log('s', '保留 [' + rarityLabel(kept.towerCfg.rarity) + '] ' + kept.towerCfg.name + ' (' + kept.gx + ',' + kept.gy + ')；其余 ' + (state.candidates.length - 1) + ' 座变墙（可免费拆）');
    state.candidates = [];
    // 进入战斗
    state.phase = PHASE.BATTLE;
    startBattleForWave(state.waveIndex);
    hideReserveModal();
    setMsg('战斗开始！');
    refreshHUD();
    draw();
    return { ok: true };
  }

  // ---------- Reserve modal ----------
  function showReserveModal() {
    state.phase = PHASE.RESERVE;
    refreshHUD();
    var host = document.getElementById('reserve-choices');
    host.innerHTML = '';
    state.candidates.forEach(function (c, i) {
      var cfg = c.towerCfg;
      var card = document.createElement('div');
      card.className = 'reserve-card';
      card.innerHTML =
        '<div class="rc-head"><span class="rc-sw" style="background:' + cfg.color + '"></span>' +
        '<span class="rar-' + cfg.rarity + '">' + cfg.name + '</span></div>' +
        '<div class="rc-meta">' +
        '伤害 ' + Math.round(cfg.baseDamage) + ' · 范围 ' + (Math.round(cfg.rangeInCells * 100) / 100) + '格 · AOE ' + (cfg.isAOE ? ('是(' + cfg.aoeRadiusPx + ')') : '否') + '<br>' +
        '射速 ' + (Math.round((1 / cfg.attackInterval) * 100) / 100) + '/秒 · 元素 ' + cfg.element +
        '</div>' +
        '<div class="rc-pos">位置 #' + (i + 1) + ' (' + c.gx + ',' + c.gy + ')</div>';
      card.addEventListener('click', function () { reserveOne(c.instId); });
      host.appendChild(card);
    });
    document.getElementById('reserve-modal').classList.remove('hidden');
    log('w', '请在弹窗中选择 1 座保留为真塔（其余变为墙）。');
  }
  function hideReserveModal() {
    document.getElementById('reserve-modal').classList.add('hidden');
  }

  // ---------- Waveend modal ----------
  function showWaveendModal() {
    state.phase = PHASE.WAVEEND;
    // summary
    var md = state.cfg.mapDetail;
    var summary = '' +
      '第 <b>' + state.waveIndex + '</b> / ' + state.maxWaves + ' 波完成。<br>' +
      '击杀金币 <b>' + state.waveKillGold + '</b>；奖励稀有度 Roll <b>' + state.waveBonusGold + '</b>；波次奖励 <b>' + (currentWaveCfg() ? currentWaveCfg().rewardGold : 0) + '</b>。<br>' +
      '当前金币：<b>' + state.gold + '</b>；生命：<b>' + state.baseHP + '/' + state.baseMaxHP + '</b>；运气等级：<b>' + state.luckLevel + '</b>；已激活 Buff <b>' + state.activeBuffs.length + '</b> 条。';
    document.getElementById('waveend-summary').innerHTML = summary;
    // luck panel
    renderLuckPanel();
    // buff roll cost
    document.getElementById('buff-roll-cost').textContent = String(state.cfg.buffRollCostGold);
    document.getElementById('buff-roll-result').textContent = '';
    var btnNext = document.getElementById('btn-next-wave');
    if (state.waveIndex >= state.maxWaves) {
      btnNext.textContent = '进入结算（通关）';
    } else {
      btnNext.textContent = '进入下一波（波 ' + (state.waveIndex + 1) + '）';
    }
    state.phase = PHASE.WAVEEND;
    refreshHUD();
    draw();
    document.getElementById('waveend-modal').classList.remove('hidden');
    // V3-1 autosave（已登录时）
    autoSaveIfLoggedIn('waveend');
  }
  function hideWaveendModal() {
    document.getElementById('waveend-modal').classList.add('hidden');
  }

  function renderLuckPanel() {
    var host = document.getElementById('luck-panel');
    host.innerHTML = '';
    var levels = state.cfg.luckLevels || [];
    levels.forEach(function (l) {
      var row = document.createElement('div');
      row.className = 'luck-row' + (l.level === state.luckLevel ? ' cur' : '');
      var costStr = l.upgradeCostGold == null ? '初始' : (l.upgradeCostGold + ' 金');
      var w = l.towerRarityWeights || {};
      var wStr = '普:' + (w.common || 0) + ' 稀:' + (w.rare || 0) + ' 史:' + (w.epic || 0) + ' 传:' + (w.legendary || 0);
      row.innerHTML =
        '<span class="lv">Lv.' + l.level + '</span>' +
        '<span class="weights">' + wStr + '</span>' +
        '<span class="cost">' + costStr + '</span>';
      if (l.level === state.luckLevel + 1 && l.upgradeCostGold != null) {
        var btn = document.createElement('button');
        btn.className = 'btn primary';
        btn.style.marginLeft = '6px';
        btn.style.padding = '4px 8px';
        btn.style.fontSize = '12px';
        btn.textContent = '升级';
        if (state.gold < l.upgradeCostGold) btn.disabled = true;
        btn.addEventListener('click', function () { upgradeLuck(l.level); });
        row.appendChild(btn);
      }
      host.appendChild(row);
    });
  }

  function upgradeLuck(targetLv) {
    var cur = state.luckLevel;
    if (targetLv !== cur + 1) return;
    var lvCfg = state.cfg.luckByLevel && state.cfg.luckByLevel[targetLv];
    if (!lvCfg || lvCfg.upgradeCostGold == null) return;
    var cost = lvCfg.upgradeCostGold;
    if (state.gold < cost) { setMsg('金币不足', true); return; }
    state.gold -= cost;
    state.luckLevel = targetLv;
    log('s', '运气升级至 Lv.' + targetLv + '，花费 ' + cost + ' 金币');
    refreshHUD();
    renderLuckPanel();
    document.getElementById('waveend-summary').innerHTML =
      '第 <b>' + state.waveIndex + '</b> / ' + state.maxWaves + ' 波完成。<br>' +
      '击杀金币 <b>' + state.waveKillGold + '</b>；奖励稀有度 Roll <b>' + state.waveBonusGold + '</b>；波次奖励 <b>' + (currentWaveCfg() ? currentWaveCfg().rewardGold : 0) + '</b>。<br>' +
      '当前金币：<b>' + state.gold + '</b>；生命：<b>' + state.baseHP + '/' + state.baseMaxHP + '</b>；运气等级：<b>' + state.luckLevel + '</b>；已激活 Buff <b>' + state.activeBuffs.length + '</b> 条。';
  }

  function rollOneBuff() {
    var cost = state.cfg.buffRollCostGold;
    if (state.gold < cost) { setMsg('金币不足抽 Buff', true); return; }
    var b = state.cfg.rollBuffByLuck(state.luckLevel);
    if (!b) { setMsg('Buff 配置为空', true); return; }
    state.gold -= cost;
    state.activeBuffs.push({ id: b.id, name: b.name, rarity: b.rarity, effect: b.effect });
    log('s', '抽 Buff：[' + rarityLabel(b.rarity) + '] ' + b.name + '（花 ' + cost + ' 金币）');
    document.getElementById('buff-roll-result').innerHTML =
      '获得 <span class="hit">[' + rarityLabel(b.rarity) + '] ' + b.name + '</span>';
    refreshHUD();
    renderLuckPanel();
    document.getElementById('waveend-summary').innerHTML =
      '第 <b>' + state.waveIndex + '</b> / ' + state.maxWaves + ' 波完成。<br>' +
      '击杀金币 <b>' + state.waveKillGold + '</b>；奖励稀有度 Roll <b>' + state.waveBonusGold + '</b>；波次奖励 <b>' + (currentWaveCfg() ? currentWaveCfg().rewardGold : 0) + '</b>。<br>' +
      '当前金币：<b>' + state.gold + '</b>；生命：<b>' + state.baseHP + '/' + state.baseMaxHP + '</b>；运气等级：<b>' + state.luckLevel + '</b>；已激活 Buff <b>' + state.activeBuffs.length + '</b> 条。';
  }

  function closeWaveendGoNextOrWin() {
    hideWaveendModal();
    if (state.waveIndex >= state.maxWaves) {
      // WIN
      state.phase = PHASE.WIN;
      document.getElementById('end-title').textContent = '通关胜利！';
      document.getElementById('end-summary').innerHTML =
        '击败 <b>' + state.maxWaves + '</b> 波全部敌人。<br>' +
        '剩余金币 <b>' + state.gold + '</b>；剩余生命 <b>' + state.baseHP + '</b>；运气 <b>Lv.' + state.luckLevel + '</b>；Buff <b>' + state.activeBuffs.length + '</b> 条。';
      document.getElementById('end-modal').classList.remove('hidden');
      state.running = false;
      log('s', '★ 通关胜利！');
      refreshHUD(); draw();
      return;
    }
    // 进入下一波 PREPARE
    prepareNextWave();
  }

  // ---------- battle: wave setup ----------
  function currentWaveCfg() {
    var waves = state.cfg.waves || [];
    if (state.waveIndex < 1 || state.waveIndex > waves.length) return null;
    return waves[state.waveIndex - 1];
  }

  function prepareNextWave() {
    state.waveIndex++;
    var w = currentWaveCfg();
    state.placementTotal = (w && typeof w.placementPerWave === 'number') ? w.placementPerWave : 5;
    state.placementUsed = 0;
    state.phase = PHASE.PREPARE;
    setMsg('第 ' + state.waveIndex + ' 波 准备阶段：剩余 ' + state.placementTotal + ' 次放置机会。点击空地 Roll 塔。');
    log('i', '进入第 ' + state.waveIndex + ' 波（放置 ' + state.placementTotal + ' 次）');
    refreshHUD(); draw();
  }

  function startBattleForWave(waveNum) {
    var w = currentWaveCfg();
    if (!w) return;
    state.enemies = [];
    state.projectiles = [];
    state.spawnQueue = [];
    state.waveElapsed = 0;
    state.waveKillGold = 0;
    state.waveBonusGold = 0;
    (w.groups || []).forEach(function (g) {
      var delay = g.delay || 0;
      for (var i = 0; i < (g.count || 0); i++) {
        state.spawnQueue.push({ enemyId: g.enemyId, spawnAt: delay + i * (g.interval || 1) });
      }
    });
    state.spawnQueue.sort(function (a, b) { return a.spawnAt - b.spawnAt; });
  }

  // ---------- combat tick ----------
  function spawnEnemy(enemyId) {
    var cfg = state.cfg.enemiesById[enemyId];
    if (!cfg) return;
    var md = state.cfg.mapDetail;
    var sp = (md.spawnPoints && md.spawnPoints[0]) ? md.spawnPoints[0] : { x: 0, y: 0 };
    var path = aStar(sp.x, sp.y, md.base.x, md.base.y);
    // 起点 tile 本身可能被改为 START 时仍不可走：再强制一次 walkable 计算
    if (!path) {
      setTile(sp.x, sp.y, T_START); setTile(md.base.x, md.base.y, T_END);
      path = aStar(sp.x, sp.y, md.base.x, md.base.y);
    }
    if (!path) { log('e', '无法为敌人找到路径（封死了？但 gate 理应阻止）'); return; }
    var startPx = cellCenterPx(sp.x, sp.y);
    var e = {
      cfg: cfg,
      hp: cfg.baseHP, maxHp: cfg.baseHP,
      speed: cfg.speed, // px per second
      px: startPx.cx, py: startPx.cy,
      pathIdx: 1, // next target cell
      path: path,
      slowPct: 0, slowSec: 0,
      alive: true,
      instId: state.nextInstId++
    };
    state.enemies.push(e);
  }

  function stepEnemy(e, dt) {
    if (!e.alive) return;
    // 减速过期
    if (e.slowSec > 0) {
      e.slowSec -= dt;
      if (e.slowSec <= 0) { e.slowSec = 0; e.slowPct = 0; }
    }
    var effSpeed = e.speed * (1 - (e.slowPct || 0));
    var targetCell = e.path[e.pathIdx];
    if (!targetCell) {
      // reached end
      reachBase(e);
      return;
    }
    var tp = cellCenterPx(targetCell.x, targetCell.y);
    var dx = tp.cx - e.px, dy = tp.cy - e.py;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var stepLen = effSpeed * dt;
    if (stepLen >= dist) {
      e.px = tp.cx; e.py = tp.cy; e.pathIdx++;
      // 到达 base
      var md = state.cfg.mapDetail;
      if (targetCell.x === md.base.x && targetCell.y === md.base.y) { reachBase(e); return; }
    } else {
      e.px += dx / dist * stepLen;
      e.py += dy / dist * stepLen;
    }
  }

  function reachBase(e) {
    if (!e.alive) return;
    e.alive = false;
    var dmg = (e.cfg && e.cfg.damageToBase) ? e.cfg.damageToBase : 1;
    state.baseHP = Math.max(0, state.baseHP - dmg);
    log('e', (e.cfg && e.cfg.name ? e.cfg.name : '敌人') + '冲入基地，造成 ' + dmg + ' 点伤害');
    if (state.baseHP <= 0 && state.phase === PHASE.BATTLE) {
      triggerLose();
    }
  }

  function triggerLose() {
    state.phase = PHASE.LOSE;
    state.running = false;
    document.getElementById('end-title').textContent = '防线崩溃！';
    document.getElementById('end-summary').innerHTML =
      '坚持至第 <b>' + state.waveIndex + '</b> 波。<br>' +
      '剩余金币 <b>' + state.gold + '</b>；运气 <b>Lv.' + state.luckLevel + '</b>；Buff <b>' + state.activeBuffs.length + '</b> 条。';
    document.getElementById('end-modal').classList.remove('hidden');
    log('e', '★ 防线崩溃，对局失败。');
    refreshHUD(); draw();
    // V3-1 autosave（已登录时，结局也可记录）
    autoSaveIfLoggedIn('lose');
  }

  // 伤害公式：dmg = towerCfg.baseDamage * buffMul.towerDamageMulAll * (1 - armor * 0.5) * elemRes
  //   简化：armor 0~0.4，抵扣 0.5 armor 比例伤害；抗性表 resistances[element] = 减伤比例
  function damageEnemy(e, towerCfg, hitsLow, buffMul) {
    if (!e.alive) return 0;
    var armor = e.cfg.armor || 0;
    var res = (e.cfg.resistances && e.cfg.resistances[towerCfg.element]) ? Number(e.cfg.resistances[towerCfg.element]) : 0;
    var dmg = towerCfg.baseDamage * (buffMul ? buffMul.towerDamageMulAll : 1);
    dmg *= Math.max(0, 1 - armor * 0.5);
    dmg *= Math.max(0, 1 - res);
    dmg = Math.max(1, Math.floor(dmg));
    e.hp -= dmg;
    // 减速：来自 towerCfg.elemBonus? 其实 adapt 没塞到 towerCfg 本身；重新用 element 查表
    // fallback 中定义常量即可
    var slowPct = 0, slowSec = 0;
    if (towerCfg.element === 'ice')    { slowPct = 0.30; slowSec = 2.0; }
    if (towerCfg.element === 'poison') { slowPct = 0.20; slowSec = 1.5; }
    if (slowPct > 0 && buffMul) slowPct = Math.min(0.95, slowPct * (buffMul.slowStrengthMulAll || 1));
    if (slowPct > 0 && slowSec > 0) {
      if (slowPct > (e.slowPct || 0)) e.slowPct = slowPct;
      e.slowSec = Math.max(e.slowSec || 0, slowSec);
    }
    if (e.hp <= 0) killEnemy(e, towerCfg, buffMul);
    return dmg;
  }

  function killEnemy(e, towerCfg, buffMul) {
    if (!e.alive) return;
    e.alive = false;
    // 击杀基础金币
    var baseGold = (e.cfg && e.cfg.killBaseGold) ? e.cfg.killBaseGold : 0;
    var gold = Math.floor(baseGold * (buffMul ? buffMul.killGoldMulAll : 1));
    state.gold += gold;
    state.waveKillGold += gold;
    // 稀有度奖励 Roll（按 dropBonusRate + Buff add）
    var rollChance = ((e.cfg && e.cfg.dropBonusRate) ? Number(e.cfg.dropBonusRate) : 0)
                   + ((towerCfg && towerCfg.element === 'light') ? 0.15 : 0)
                   + ((towerCfg && towerCfg.element === 'dark')  ? 0.10 : 0);
    if (buffMul && typeof buffMul.killBonusGoldChanceAddAll === 'number') rollChance += buffMul.killBonusGoldChanceAddAll;
    if (Math.random() < rollChance) {
      var rar = state.cfg.rollBonusRarityByLuck(state.luckLevel);
      var bonusMap = state.cfg.bonusGoldMap || { common:5, rare:15, epic:50, legendary:200 };
      var bGold = bonusMap[rar] || 5;
      state.gold += bGold;
      state.waveBonusGold += bGold;
      log('s', '击杀奖励 Roll→[' + rarityLabel(rar) + '] +' + bGold + ' 金币');
    }
    log('i', '击杀 ' + (e.cfg && e.cfg.name ? e.cfg.name : '敌人') + '，+' + gold + ' 金');
  }

  function stepTowers(dt, buffMul) {
    var cs = state.cell;
    for (var i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i] !== T_TOWER) continue;
      var g = state.grid[i];
      if (!g || !g.towerCfg) continue;
      var tcfg = g.towerCfg;
      g.cooldown = Math.max(0, (g.cooldown || 0) - dt);
      if (g.cooldown > 0) continue;
      var gx = i % state.cols, gy = Math.floor(i / state.cols);
      var center = cellCenterPx(gx, gy);
      // 找范围内最近敌人
      var effRange = tcfg.rangeInCells * cs * (buffMul ? (buffMul.towerRangeMulAll || 1) : 1);
      var best = null, bestDist = Infinity;
      for (var j = 0; j < state.enemies.length; j++) {
        var e = state.enemies[j];
        if (!e.alive) continue;
        var dx = e.px - center.cx, dy = e.py - center.cy;
        var d2 = dx * dx + dy * dy;
        if (d2 <= effRange * effRange && d2 < bestDist) { best = e; bestDist = d2; }
      }
      if (!best) continue;
      // 攻击：生成 1 个子弹（立即命中也可以，但为了视觉可观测给子弹）
      state.projectiles.push({
        x: center.cx, y: center.cy,
        targetId: best.instId,
        speed: 520,
        color: tcfg.color || '#fde047',
        towerCfg: tcfg
      });
      var attackIntv = tcfg.attackInterval * (buffMul ? (buffMul.towerAttackIntervalMulAll || 1) : 1);
      g.cooldown = attackIntv;
    }
  }

  function stepProjectiles(dt, buffMul) {
    var keep = [];
    for (var i = 0; i < state.projectiles.length; i++) {
      var p = state.projectiles[i];
      // 找目标
      var target = null;
      for (var j = 0; j < state.enemies.length; j++) {
        if (state.enemies[j].instId === p.targetId && state.enemies[j].alive) { target = state.enemies[j]; break; }
      }
      if (!target) continue; // 丢弃
      var dx = target.px - p.x, dy = target.py - p.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var step = p.speed * dt;
      if (step >= d) {
        // hit
        damageEnemy(target, p.towerCfg, false, buffMul);
        // AOE
        if (p.towerCfg.isAOE && p.towerCfg.aoeRadiusPx > 0) {
          var r2 = p.towerCfg.aoeRadiusPx * p.towerCfg.aoeRadiusPx;
          for (var k = 0; k < state.enemies.length; k++) {
            var e2 = state.enemies[k];
            if (!e2.alive || e2.instId === target.instId) continue;
            var ddx = e2.px - target.px, ddy = e2.py - target.py;
            if (ddx * ddx + ddy * ddy <= r2) damageEnemy(e2, p.towerCfg, false, buffMul);
          }
        }
      } else {
        p.x += dx / d * step;
        p.y += dy / d * step;
        keep.push(p);
      }
    }
    state.projectiles = keep;
  }

  function battleTick(nowMs) {
    if (state.phase !== PHASE.BATTLE) return;
    if (!state.lastFrame) state.lastFrame = nowMs;
    var dt = (nowMs - state.lastFrame) / 1000;
    state.lastFrame = nowMs;
    if (dt > 0.1) dt = 0.1; // cap
    state.waveElapsed += dt;
    var effBuffs = state.cfg.applyBuffs(state.activeBuffs);
    var buffMul = effBuffs.mul;
    var buffAdd = effBuffs.add; // 已在 killEnemy 里通过 applyBuffs 暴露
    // spawn
    while (state.spawnQueue.length && state.spawnQueue[0].spawnAt <= state.waveElapsed) {
      var s = state.spawnQueue.shift();
      spawnEnemy(s.enemyId);
    }
    // 敌人移动
    for (var i = 0; i < state.enemies.length; i++) stepEnemy(state.enemies[i], dt);
    // 塔攻击
    stepTowers(dt, buffMul);
    // 子弹
    stepProjectiles(dt, buffMul);
    // 检查战斗是否结束
    var anyAlive = false;
    for (var j = 0; j < state.enemies.length; j++) if (state.enemies[j].alive) { anyAlive = true; break; }
    if (state.phase === PHASE.BATTLE && !anyAlive && state.spawnQueue.length === 0) {
      // 波末：奖励金币
      var w = currentWaveCfg();
      var reward = w ? (w.rewardGold || 0) : 0;
      if (reward > 0) { state.gold += reward; log('s', '波次奖励 +' + reward + ' 金币'); }
      log('s', '第 ' + state.waveIndex + ' 波战斗结束');
      showWaveendModal();
    }
    refreshHUD();
    draw();
  }

  function renderLoop(now) {
    if (!state.running) return;
    battleTick(now);
    state.rafId = requestAnimationFrame(renderLoop);
  }

  // ---------- mouse ----------
  function cellFromEvt(ev) {
    var rect = state.canvas.getBoundingClientRect();
    var x = (ev.clientX - rect.left) / rect.width  * state.canvas.width;
    var y = (ev.clientY - rect.top)  / rect.height * state.canvas.height;
    return { x: Math.floor(x / state.cell), y: Math.floor(y / state.cell) };
  }

  function onCanvasMove(ev) {
    state.mouseCell = cellFromEvt(ev);
    draw();
  }

  function onCanvasLeave() {
    state.mouseCell = null; draw();
  }

  function onCanvasClick(ev) {
    var c = cellFromEvt(ev);
    state.mouseCell = c;
    var x = c.x, y = c.y;
    if (!inBounds(x, y)) return;
    var t = tileAt(x, y);
    // 优先点击墙 → 拆
    if (t === T_WALL) {
      var d = demolishWall(x, y);
      if (!d.ok) { setMsg(d.msg || '无法拆除', true); if (d.msg && d.msg.indexOf('封死') >= 0) log('e', d.msg); }
      refreshHUD(); draw();
      return;
    }
    // 塔信息
    if (t === T_TOWER || t === T_CAND) {
      var g = state.grid[idx(x, y)];
      if (g && g.towerCfg) {
        var c2 = g.towerCfg;
        log('i', '[' + rarityLabel(c2.rarity) + '] ' + c2.name + ' 伤害' + Math.round(c2.baseDamage) + ' 范围' + c2.rangeInCells + '格');
        setMsg('[' + rarityLabel(c2.rarity) + '] ' + c2.name + ' 伤害' + Math.round(c2.baseDamage) + ' 范围' + c2.rangeInCells + '格');
      }
      draw();
      return;
    }
    // 放置阶段：空地 Roll 塔
    if (state.phase === PHASE.PREPARE) {
      var p = placeCandidate(x, y);
      if (!p.ok) { setMsg(p.msg || '无法放置', true); if (p.msg && p.msg.indexOf('封死') >= 0) log('e', p.msg); }
      refreshHUD(); draw();
      // 放置满 N/N 直接开 RESERVE
      if (p.ok && state.placementUsed >= state.placementTotal) {
        showReserveModal();
      }
      return;
    }
    draw();
  }

  // ---------- init / reset ----------
  function applyCfg(cfg) {
    state.cfg = cfg;
    var md = cfg.mapDetail;
    state.cols = md.gridWidth;
    state.rows = md.gridHeight;
    state.cell = md.cellSize;
    state.tiles = (md.tiles || []).slice();
    // tiles 里可能全是 0/1/2/3，没有墙/塔/候选
    state.grid = new Array(state.cols * state.rows);
    for (var i = 0; i < state.grid.length; i++) state.grid[i] = null;
    state.towersByInst = {};
    state.nextInstId = 1;
    state.canvas.width  = state.cols * state.cell;
    state.canvas.height = state.rows * state.cell;
    // 初始状态
    state.gold          = 50;   // 起步少量金币（抽 1 次 Buff 40 金以内给玩家体验）
    state.baseMaxHP     = md.base.hp;
    state.baseHP        = md.base.hp;
    state.maxWaves      = (cfg.waves || []).length;
    state.waveIndex     = 0;
    state.placementTotal = 5;
    state.placementUsed = 0;
    state.candidates    = [];
    state.activeBuffs   = [];
    state.enemies       = [];
    state.projectiles   = [];
    state.spawnQueue    = [];
    state.waveElapsed   = 0;
    state.waveKillGold  = 0;
    state.waveBonusGold = 0;
    state.luckLevel     = cfg.luckInitialLevel || 1;
    state.phase         = PHASE.MENU;
    state.running       = true;
    state.lastFrame     = 0;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = requestAnimationFrame(renderLoop);
    setMsg('配置已加载（source: ' + (cfg.source || '?') + '）。点击"开始下一波"进入游戏。');
    log('i', '对局初始化完成。source=' + (cfg.source || '?') + ' 地图=' + md.name);
    refreshHUD();
    draw();
  }

  function fullReset() {
    // hide any open modal
    ['reserve-modal','waveend-modal','end-modal'].forEach(function (m) {
      var el = document.getElementById(m);
      if (el) el.classList.add('hidden');
    });
    var logEl = document.getElementById('log-list');
    if (logEl) logEl.innerHTML = '';
    return window.TDConfig.loadAllAdapted().then(function (cfg) {
      applyCfg(cfg);
      return cfg;
    });
  }

  function btnStartClick() {
    if (state.phase === PHASE.MENU) {
      prepareNextWave();
      return;
    }
    if (state.phase === PHASE.PREPARE) {
      // 如果玩家没放满也允许战斗（剩余保留 1 塔 + 其余变墙）：按"放置次数最少保留1个"逻辑处理
      if (state.placementUsed === 0) { setMsg('至少放置 1 次再开始', true); return; }
      // 如果还没放满，进入 RESERVE modal 让玩家从已放置者里选 1 个；不满的其余变成墙（不存在的不动）
      showReserveModal();
      return;
    }
    if (state.phase === PHASE.BATTLE) {
      setMsg('战斗中…等待本波结束即可');
      return;
    }
    if (state.phase === PHASE.WIN || state.phase === PHASE.LOSE) {
      fullReset();
      return;
    }
  }

  // ---------- wire up ----------
  function init(opt) {
    state.canvas = opt.stage;
    state.ctx    = state.canvas.getContext('2d');
    state.canvas.addEventListener('mousemove', onCanvasMove);
    state.canvas.addEventListener('mouseleave', onCanvasLeave);
    state.canvas.addEventListener('click', onCanvasClick);

    document.getElementById('btn-start').addEventListener('click', btnStartClick);
    document.getElementById('btn-restart').addEventListener('click', function () { fullReset(); });
    document.getElementById('btn-next-wave').addEventListener('click', closeWaveendGoNextOrWin);
    document.getElementById('btn-roll-buff').addEventListener('click', rollOneBuff);
    document.getElementById('btn-reserve-cancel').addEventListener('click', function () {
      setMsg('规则：必须选择 1 座保留，无法取消。', true);
    });
    document.getElementById('btn-end-restart').addEventListener('click', function () {
      document.getElementById('end-modal').classList.add('hidden');
      fullReset();
    });

    // ---- V3-1 账号/保存/读档 按钮绑定 ----
    refreshAccountChip();
    document.getElementById('btn-account').addEventListener('click', openAccountModal);
    document.getElementById('btn-acc-cancel').addEventListener('click', closeAccountModal);
    document.getElementById('btn-acc-login').addEventListener('click', function () { doLogin(false); });
    document.getElementById('btn-acc-register').addEventListener('click', function () { doLogin(true); });
    document.getElementById('btn-acc-logout').addEventListener('click', doLogout);
    document.getElementById('account-modal').addEventListener('click', function (e) {
      // 点击遮罩关闭（点击 modal-body 内部不关闭）
      if (e.target && e.target.id === 'account-modal') closeAccountModal();
    });

    document.getElementById('btn-save').addEventListener('click', function () { saveNow(false); });
    document.getElementById('btn-load').addEventListener('click', function () { loadSave(); });

    // 账号回车快捷
    var accForm = document.getElementById('account-form');
    if (accForm) {
      var inputs = accForm.querySelectorAll('input.input');
      for (var hi = 0; hi < inputs.length; hi++) {
        inputs[hi].addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); doLogin(false); }
        });
      }
    }

    return window.TDConfig.loadAllAdapted().then(function (cfg) {
      applyCfg(cfg);
      return cfg;
    });
  }

  window.TDGame = {
    init: init,
    getState: function () { return state; },
    // V3-1 账号/保存/读档（给调试和 UI 自动化调用）
    account: {
      info: accountInfo,
      login: function (u, p) {
        var body = JSON.stringify({ username: (u || '').trim(), password: (p || '') });
        return api('/api/auth/login', { method: 'POST', body: body }).then(function (r) {
          if (r.ok && r.data && r.data.token) accountSetLoggedIn(r.data);
          return r;
        });
      },
      register: function (u, p) {
        var body = JSON.stringify({ username: (u || '').trim(), password: (p || '') });
        return api('/api/auth/register', { method: 'POST', body: body }).then(function (r) {
          if (r.ok && r.data && r.data.token) accountSetLoggedIn(r.data);
          return r;
        });
      },
      logout: doLogout
    },
    saveNow: saveNow,
    loadSave: loadSave,
    _buildSavePayload: buildSavePayload,
    _applySaveRecord:  applySaveRecord,
    // 调试 / AC 辅助接口
    _hasPath: hasPathFromStartToEnd,
    _aStar:   aStar,
    _gate:    terrainGate,
    _PHASE:   PHASE,
    _tiles: function () { return state.tiles; },
    _grid:  function () { return state.grid; },
    _forceReserveOne: reserveOne,
    _forceDemolish: demolishWall,
    _forcePlace: placeCandidate,
    _dbgKnownVersion: function () { return _knownSaveUpdatedAt; }, // SSO + 乐观锁测试：获取当前 JS 内存里存档 known updatedAt
    _dbgSetKnownVersion: function (v) { _knownSaveUpdatedAt = v || ''; } // SSO 冲突测试：强制设置 known version 模拟"拿着旧版本戳写"
  };
})();
