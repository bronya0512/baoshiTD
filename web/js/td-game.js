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
    // 小模式：没有 #msg 节点（精简 HUD）就丢到 toast；不影响任何调用方
    if (!m) {
      if (text) toast(text, isErr ? 'er' : 'info');
      return;
    }
    if (!text) { m.textContent = ''; m.classList.remove('err'); return; }
    m.textContent = text;
    m.classList.toggle('err', !!isErr);
  }

  // ---------- V4-7 精简布局：右侧菜单抽屉 open/close + ESC 关闭 ----------
  function openMenuDrawer() {
    var d = document.getElementById('side-menu');
    var k = document.getElementById('menu-mask');
    var b = document.getElementById('btn-menu');
    if (d) { d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); }
    if (k) k.classList.remove('hidden');
    if (b) b.setAttribute('aria-expanded', 'true');
  }
  function closeMenuDrawer() {
    var d = document.getElementById('side-menu');
    var k = document.getElementById('menu-mask');
    var b = document.getElementById('btn-menu');
    if (d) { d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); }
    if (k) k.classList.add('hidden');
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  function toggleMenuDrawer() {
    var d = document.getElementById('side-menu');
    var isOpen = d && d.classList.contains('open');
    if (isOpen) closeMenuDrawer(); else openMenuDrawer();
  }
  // V4-7：按当前 PHASE 刷新"画面中央开始本波"按钮 + mini phase bar 显隐
  function refreshCenterStartAndMiniBar() {
    var startBtn = document.getElementById('btn-start-wave');
    var waveNum  = document.getElementById('center-wave-num');
    var miniBar  = document.getElementById('mini-bar');
    var ph = state.phase;
    var show = false;
    if (startBtn && waveNum) {
      if (ph === PHASE.MENU) {
        startBtn.innerHTML = '▶ 开始第 <span id="center-wave-num">1</span> 波';
        // innerHTML 重写后 waveNum 引用失效，重新 grab
        waveNum = document.getElementById('center-wave-num');
        if (waveNum) waveNum.textContent = String((Number(state.waveIndex) || 0) + 1);
        show = true;
      } else if (ph === PHASE.PREPARE) {
        startBtn.innerHTML = '▶ 开始第 <span id="center-wave-num">' + String(state.waveIndex) + '</span> 波';
        waveNum = document.getElementById('center-wave-num');
        // 放置过至少 1 次才显示开始按钮（对应 btnStartClick 里 placementUsed===0 的门槛），否则先引导放置
        if ((Number(state.placementUsed) || 0) > 0) show = true;
        else show = false;
      } else if (ph === PHASE.WIN || ph === PHASE.LOSE) {
        // 结局：中央开始按钮变成"再玩一次"
        var txt = (ph === PHASE.WIN) ? '🏆 通关！再来一局' : '💥 失败，再玩一次';
        startBtn.innerHTML = '<span id="center-wave-num" style="display:none">1</span>' + txt;
        waveNum = document.getElementById('center-wave-num');
        if (waveNum) waveNum.textContent = '1';
        show = true;
      } else {
        show = false;
      }
      if (show) startBtn.classList.remove('hidden');
      else startBtn.classList.add('hidden');
    }
    // mini-bar: 非 MENU 阶段显示短状态；MENU 阶段给玩家一眼知道当前在菜单
    if (miniBar) {
      if (ph === PHASE.MENU && (!startBtn || startBtn.classList.contains('hidden'))) {
        miniBar.classList.remove('hidden');
      } else if (ph !== PHASE.MENU) {
        miniBar.classList.remove('hidden');
      } else {
        miniBar.classList.add('hidden');
      }
    }
  }

  // ---------- Toast (V3-1) ----------
  var _toastTimer = 0;
  var _lastToastMsg = '', _lastToastType = '';
  function toast(msg, type) {
    _lastToastMsg = String(msg || '');
    _lastToastType = type || 'info';
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
    if (info) {
      _acc = {
        uid: Number(info.uid) || 0,
        username: String(info.username || ''),
        token: String(info.token || '')
      };
      // V4-2 Task 5：后端 users 表新字段 → 持久化在 _acc 中，mergeUnlockedMaps / buildSavePayload 会读到
      if (typeof info.unlockedMaps !== 'undefined') _acc.unlockedMaps = info.unlockedMaps;
      if (typeof info.talentNodes !== 'undefined') _acc.talentNodes = info.talentNodes;
      if (typeof info.talentPointsAvailable !== 'undefined') _acc.talentPointsAvailable = Number(info.talentPointsAvailable) || 0;
    } else {
      _acc = null;
    }
    accountSaveToStore(_acc);
    _resetSaveVersion(); // 登录状态变化（登出/换号/新登录）都必须重置乐观锁版本戳，避免串号 / 用旧版本戳去匹配当前账号
    // V4-2：状态变更后立即合并解锁（登录后可能获得更多地图），并重绘 MENU Tab disabled
    mergeUnlockedMaps();
    try { renderMenuChooser(); } catch (_) {}
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
    // 必须先清关卡状态（再清账号），否则登出画面残留上一局塔/金币/buff/波次信息
    resetLevelState();
    accountSetLoggedIn(null);
    toast('已退出登录', 'info');
    log('i', '已退出登录，关卡状态已重置。');
    closeAccountModal();
  }
  // 别名：SSO 自动被踢下线时 api() 内部直接调用
  var accountLogout = doLogout;

  // ============================================================
  // resetLevelState()：同步、无依赖、幂等 —— 把「游戏关卡状态」归零
  // 触发场景：
  //   1) 用户主动点退出登录 (doLogout)
  //   2) SSO 被踢下线自动登出
  //   3) 以后"回到主菜单 / 重新开局"可直接复用
  // 说明：
  //   - state.cfg / canvas / cell / cols / rows / tiles / grid 保留（画面尺寸和地图基础不变，
  //     只把玩家放置的塔/墙、战斗、金币、阶段、候选塔清空）。
  //     如果还没加载过地图（state.cfg==null），则跳过相关重置。
  // ============================================================
  function resetLevelState() {
    // A) 停 RAF 战斗循环，避免登出时战斗还在跑不断扣血
    if (state.rafId) {
      try { cancelAnimationFrame(state.rafId); } catch (_) {}
      state.rafId = 0;
    }
    state.running = false;
    state.lastFrame = 0;

    // B) 若地图已加载：清空玩家放置物、战斗数据
    if (state.cfg) {
      var md = state.cfg.mapDetail;
      // tiles：还原成地图原始 tiles（不保留玩家放的塔/墙）
      if (md && Array.isArray(md.tiles)) {
        state.tiles = md.tiles.slice();
      } else {
        for (var k = 0; k < state.tiles.length; k++) {
          // 只保留地形类（保留 T_PATH/T_NOPATH/T_SPAWN/T_BASE/T_EDGE）：其他置 T_NOPATH=0
          var t = state.tiles[k] | 0;
          if (t !== 0 && t !== 1 && t !== 2 && t !== 3 && t !== 4) state.tiles[k] = 0;
        }
      }
      // ===== 同 applyCfg：确保起点/基地画 S/E；检测点若被写成石头 → 改回草地
      if (md) {
        if (md.spawnPoints && md.spawnPoints.length) {
          var sp = md.spawnPoints[0];
          if (sp && inBounds(sp.x, sp.y)) state.tiles[idx(sp.x, sp.y)] = T_START;
        }
        if (md.base && inBounds(md.base.x, md.base.y)) {
          state.tiles[idx(md.base.x, md.base.y)] = T_END;
        }
        if (md.checkpoints && md.checkpoints.length) {
          for (var cci2 = 0; cci2 < md.checkpoints.length; cci2++) {
            var cp2 = md.checkpoints[cci2];
            if (!cp2 || !inBounds(cp2.x, cp2.y)) continue;
            var ci2 = idx(cp2.x, cp2.y);
            var cv2 = state.tiles[ci2] | 0;
            if (cv2 === T_STONE) state.tiles[ci2] = T_GRASS;
          }
        }
      }
      // grid：全部清空（塔/墙/候选）
      for (var i = 0; i < state.grid.length; i++) state.grid[i] = null;
      state.towersByInst = {};
      state.nextInstId = 1;
      state.enemies = [];
      state.projectiles = [];
      state.spawnQueue = [];
      state.waveElapsed = 0;
      state.waveKillGold = 0;
      state.waveBonusGold = 0;
      state.placementUsed = 0;
      state.placementTotal = state.cfg.placementPerWave ? Number(state.cfg.placementPerWave) || 5 : 5;
      state.candidates = [];
      state.activeBuffs = [];
      // 玩家数值：归零到配置起始值
      state.gold = 50;
      state.baseMaxHP = (md && md.base && md.base.hp) ? Number(md.base.hp) : 20;
      state.baseHP = state.baseMaxHP;
      state.maxWaves = (state.cfg.waves || []).length | 0;
      state.waveIndex = 0;
      state.luckLevel = Number(state.cfg.luckInitialLevel) || 1;
      state.waveDamageStats = null;
      state.totalKillsAllWaves = 0;
    } else {
      // 地图都没加载过：至少把玩家/战斗数组清空
      state.tiles = [];
      state.grid = [];
      state.towersByInst = {};
      state.enemies = [];
      state.projectiles = [];
      state.spawnQueue = [];
      state.activeBuffs = [];
      state.candidates = [];
      state.gold = 0; state.baseHP = 0; state.baseMaxHP = 0;
      state.waveIndex = 0; state.maxWaves = 0; state.luckLevel = 1;
      state.placementUsed = 0; state.placementTotal = 5;
      state.waveDamageStats = null;
      state.totalKillsAllWaves = 0;
    }
    state.phase = PHASE.MENU;

    // C) 关闭所有可能打开的关卡模态（选塔/波末/胜负/塔信息），否则登出后还能看到上一局的结算
    ['reserve-modal','waveend-modal','end-modal','tower-info-modal'].forEach(function (m) {
      var el = document.getElementById(m);
      if (el) el.classList.add('hidden');
    });
    _towerInfoIdx = null;

    // D) 乐观锁版本戳：与换号/登出强绑定，确保下次登录不会串用上一个账号的存档版本
    _resetSaveVersion();

    // E) HUD + 画面刷新（HUD 会显示 MENU / gold=50 / hp=满血 / wave=0/MAX 等初始状态）
    try { refreshHUD(); } catch (_) {}
    try { draw(); } catch (_) {}
  }

  // ---------- Save / Load (V3-1) ----------
  // V3-5 本地波末 Autosave（和账号无关，失败后一键"恢复到最近波末"继续玩）
  var LOCAL_WAVEEND_KEY = 'td_waveend_autosave_v1'; // 单槽：始终覆盖最新 WAVEEND
  var LOCAL_UNLOCKED_KEY = 'td_unlocked_maps_v1'; // V4-2 Task 5：游客/本地地图解锁，格式 { 1:true, 2:false, 3:false }
  var LOCAL_TALENT_KEY = 'td_talents_v1';          // V4-6 T13：游客/本地天赋持久化，格式 {nodes:['dmg1',...], points: N, highestWaveRewardGiven: {mapId: {difficulty: maxWave}}}
  // ---- 天赋定义（12 节点，成本 1-2，含前置依赖；后续可扩展到 20）----
  var TALENT_DEFS = [
    { id:'dmg1',  name:'攻击强化 I',   cost:1, requires:[],     icon:'⚔', row:0, col:0, desc:'所有塔伤害 +6%',
      stats:{ towerDamageMulAll:1.06 } },
    { id:'dmg2',  name:'攻击强化 II',  cost:1, requires:['dmg1'],icon:'⚔', row:1, col:0, desc:'所有塔伤害 +6%',
      stats:{ towerDamageMulAll:1.06 } },
    { id:'dmg3',  name:'攻击强化 III', cost:2, requires:['dmg2'],icon:'🔥',row:2, col:0, desc:'所有塔伤害 +8%',
      stats:{ towerDamageMulAll:1.08 } },
    { id:'spd1',  name:'攻速强化 I',   cost:1, requires:['dmg1'],icon:'⏱', row:1, col:1, desc:'所有塔攻击间隔 -6%',
      stats:{ towerAttackIntervalMulAll:0.94 } },
    { id:'spd2',  name:'攻速强化 II',  cost:2, requires:['spd1'],icon:'⏱', row:2, col:1, desc:'所有塔攻击间隔 -8%',
      stats:{ towerAttackIntervalMulAll:0.92 } },
    { id:'rng1',  name:'射程增幅 I',   cost:1, requires:[],     icon:'🎯',row:0, col:2, desc:'所有塔射程 +6%',
      stats:{ towerRangeMulAll:1.06 } },
    { id:'rng2',  name:'射程增幅 II',  cost:2, requires:['rng1'],icon:'🎯',row:1, col:2, desc:'所有塔射程 +8%',
      stats:{ towerRangeMulAll:1.08 } },
    { id:'eco1',  name:'富裕开端',     cost:1, requires:[],     icon:'💰',row:0, col:3, desc:'每局开局金币 +50',
      stats:{ startGoldBonus:50 } },
    { id:'eco2',  name:'收益加成',     cost:1, requires:['eco1'],icon:'💰',row:1, col:3, desc:'击杀金币 +8%',
      stats:{ killGoldMulAll:1.08 } },
    { id:'hp1',   name:'铁壁防线',     cost:1, requires:[],     icon:'🛡', row:0, col:4, desc:'基地最大 HP +5',
      stats:{ baseMaxHPBonus:5 } },
    { id:'luc1',  name:'幸运之源',     cost:2, requires:[],     icon:'🍀',row:2, col:4, desc:'初始运气 Lv +1',
      stats:{ startLuckLevelBonus:1 } },
    { id:'crt1',  name:'暴击本能',     cost:2, requires:['spd1'],icon:'💥',row:2, col:3, desc:'所有塔暴击率 +8%（L3 crit 基础上加成）',
      stats:{ critRateBonus:0.08 } }
  ];
  function talentDefById(id) {
    for (var i = 0; i < TALENT_DEFS.length; i++) { if (TALENT_DEFS[i].id === id) return TALENT_DEFS[i]; }
    return null;
  }
  function readTalentsLocal() {
    try {
      var raw = localStorage.getItem(LOCAL_TALENT_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') return obj;
    } catch (_) {}
    return null;
  }
  function writeTalentsLocal(obj) {
    try { localStorage.setItem(LOCAL_TALENT_KEY, JSON.stringify(obj || { nodes: [], points: 0 })); } catch (_) {}
  }
  function mergeTalents() {
    // 优先级：登录账号 AccountInfo talentNodes/talentPointsAvailable > localStorage > 默认 {nodes:[], points:5}
    var defNodes = [];
    var defPoints = 5;
    var local = readTalentsLocal() || { nodes: [], points: defPoints };
    var nodes = (local && Array.isArray(local.nodes)) ? local.nodes.slice() : defNodes.slice();
    var points = Number(local.points) || 0;
    // 登录账号
    var acc = (window.TDGame && TDGame._account) ? TDGame._account() : null;
    if (!acc) {
      try { acc = _account; } catch (e) { acc = null; }
    }
    if (acc && typeof acc === 'object') {
      if (Array.isArray(acc.talentNodes) && acc.talentNodes.length > 0) nodes = acc.talentNodes.slice();
      if (typeof acc.talentPointsAvailable === 'number') points = acc.talentPointsAvailable;
    } else if (!local || !readTalentsLocal()) {
      points = defPoints; // 游客初始
    }
    // 去重、过滤无效 id
    var seen = {};
    var valid = [];
    for (var j = 0; j < nodes.length; j++) {
      var id = String(nodes[j]);
      if (seen[id]) continue;
      if (!talentDefById(id)) continue;
      seen[id] = true; valid.push(id);
    }
    state.talentNodesList = valid;
    state.talentNodesActive = seen;
    state.talentPointsAvailable = Math.max(0, points);
  }
  function persistTalentsBackend() {
    if (!(state.talentNodesList && Array.isArray(state.talentNodesList))) return;
    writeTalentsLocal({ nodes: state.talentNodesList.slice(), points: state.talentPointsAvailable });
    // 登录：发送 PATCH /api/td/account/talents（若接口存在）
    var acc = null;
    try { acc = _account; } catch (e) {}
    if (!(acc && acc.uid)) return;
    try {
      var idsArr = state.talentNodesList.slice();
      fetch('/api/td/account/talents', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
        body: JSON.stringify({ talentNodes: idsArr, talentPointsAvailable: state.talentPointsAvailable })
      }).then(function (r) {
        if (!r.ok) log('w', '同步 talents 到后端失败：status=' + r.status);
      }).catch(function (e) { log('w', '同步 talents 异常：' + String(e && e.message || e)); });
    } catch (e) { log('w', '同步 talents 异常：' + String(e && e.message || e)); }
  }
  // 聚合所有已激活天赋的 stats，返回叠加后的 Mul 结构（可与 applyBuffs/mul 合并）
  function calcTalentMul() {
    var set = state.talentNodesActive || {};
    var mul = {
      towerDamageMulAll: 1, towerAttackIntervalMulAll: 1, towerRangeMulAll: 1,
      killGoldMulAll: 1, slowStrengthMulAll: 1, baseMaxHPBonus: 0,
      startGoldBonus: 0, startLuckLevelBonus: 0, critRateBonus: 0
    };
    for (var k in set) {
      if (!set.hasOwnProperty(k) || !set[k]) continue;
      var d = talentDefById(k);
      if (!d || !d.stats) continue;
      var s = d.stats;
      if (typeof s.towerDamageMulAll === 'number')          mul.towerDamageMulAll *= s.towerDamageMulAll;
      if (typeof s.towerAttackIntervalMulAll === 'number')  mul.towerAttackIntervalMulAll *= s.towerAttackIntervalMulAll;
      if (typeof s.towerRangeMulAll === 'number')           mul.towerRangeMulAll *= s.towerRangeMulAll;
      if (typeof s.killGoldMulAll === 'number')             mul.killGoldMulAll *= s.killGoldMulAll;
      if (typeof s.slowStrengthMulAll === 'number')         mul.slowStrengthMulAll *= s.slowStrengthMulAll;
      if (typeof s.baseMaxHPBonus === 'number')             mul.baseMaxHPBonus += s.baseMaxHPBonus;
      if (typeof s.startGoldBonus === 'number')             mul.startGoldBonus += s.startGoldBonus;
      if (typeof s.startLuckLevelBonus === 'number')        mul.startLuckLevelBonus += s.startLuckLevelBonus;
      if (typeof s.critRateBonus === 'number')              mul.critRateBonus += s.critRateBonus;
    }
    return mul;
  }
  function talentCanUnlock(def) {
    if (!def) return { ok: false, reason: '未知天赋' };
    var set = state.talentNodesActive || {};
    if (set[def.id]) return { ok: false, reason: '已激活' };
    // 前置依赖：都激活
    var req = def.requires || [];
    for (var i = 0; i < req.length; i++) { if (!set[req[i]]) return { ok: false, reason: '需要先激活：' + req[i] }; }
    var cost = Number(def.cost) || 0;
    if ((Number(state.talentPointsAvailable) || 0) < cost) return { ok: false, reason: '天赋点不足（需 ' + cost + '，剩余 ' + state.talentPointsAvailable + '）' };
    return { ok: true };
  }
  function talentUnlock(defId) {
    var def = talentDefById(defId);
    var r = talentCanUnlock(def);
    if (!r.ok) return r;
    state.talentPointsAvailable = Math.max(0, (Number(state.talentPointsAvailable) || 0) - (Number(def.cost) || 0));
    state.talentNodesActive[def.id] = true;
    if (Array.isArray(state.talentNodesList)) state.talentNodesList.push(def.id);
    persistTalentsBackend();
    // 立即生效：刷新 HUD / 塔面板数值（塔弹窗不显示加成但战斗中会应用；canvas 重绘不影响）
    refreshHUD();
    return { ok: true };
  }
  function talentResetAll(refundPoints) {
    state.talentNodesActive = {};
    state.talentNodesList = [];
    if (refundPoints) {
      // 不退款（避免 bug 刷点）；除非调用方显式说退款
    }
    persistTalentsBackend();
    refreshHUD();
  }
  function readUnlockedMapsLocal() {
    try {
      var raw = localStorage.getItem(LOCAL_UNLOCKED_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') return obj;
    } catch (_) {}
    return null;
  }
  function writeUnlockedMapsLocal(obj) {
    try { localStorage.setItem(LOCAL_UNLOCKED_KEY, JSON.stringify(obj || {})); } catch (_) {}
  }
  function mergeUnlockedMaps() {
    // 优先级：登录账号返回 unlocked_maps（AccountInfo 字段） > localStorage > 默认 {1:true}
    var def = { 1: true, 2: false, 3: false };
    var local = readUnlockedMapsLocal() || {};
    var merged = {};
    for (var k in def) if (def.hasOwnProperty(k)) merged[k] = !!def[k];
    for (var k1 in local) if (local.hasOwnProperty(k1)) merged[k1] = !!local[k1];
    var acc = accountInfo();
    if (acc && acc.unlockedMaps && typeof acc.unlockedMaps === 'object') {
      // 登录：unlockedMaps 字段以数组形式 [1,2] 或 map {1:true} 两种兼容（后端 users.unlocked_maps=JSON）
      if (Array.isArray(acc.unlockedMaps)) {
        for (var ai = 0; ai < acc.unlockedMaps.length; ai++) merged[Number(acc.unlockedMaps[ai]) | 0] = true;
      } else {
        for (var k2 in acc.unlockedMaps) if (acc.unlockedMaps.hasOwnProperty(k2)) merged[Number(k2) | 0] = !!acc.unlockedMaps[k2];
      }
    }
    state.unlockedMaps = merged;
    return merged;
  }
  function tryUnlockNextMap(currMapId, reason) {
    // currMapId=1 WIN → 解锁 2；currMapId=2 WIN → 解锁 3；currMapId=3 WIN → 终局
    var nextId = Number(currMapId) + 1;
    if (nextId > 3) return null;
    mergeUnlockedMaps();
    if (state.unlockedMaps[nextId]) return { ok: true, already: true, nextId: nextId };
    state.unlockedMaps[nextId] = true;
    writeUnlockedMapsLocal(state.unlockedMaps);
    // 已登录：后端 PATCH users.unlocked_maps（若有接口；否则静默，下一次请求/读档会继续由本地兜底）
    var acc = accountInfo();
    if (acc && acc.token) {
      try {
        var idsArr = [];
        for (var k3 in state.unlockedMaps) if (state.unlockedMaps.hasOwnProperty(k3) && state.unlockedMaps[k3]) idsArr.push(Number(k3) | 0);
        api('/api/account/patch', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + acc.token },
          body: JSON.stringify({ unlockedMaps: idsArr })
        }).then(function (r) { if (!r.ok) log('w', '同步 unlocked_maps 到后端失败：' + (r.msg || 'unknown')); });
      } catch (e) { log('w', '同步 unlocked_maps 异常：' + String(e && e.message || e)); }
    }
    toast('🔓 新地图解锁：Map ' + nextId, 's');
    log('s', '地图 ' + nextId + ' 已解锁（' + (reason || 'WIN') + ' mapId=' + currMapId + '）');
    return { ok: true, nextId: nextId };
  }
  function _writeLocalWaveendAutosave() {
    try {
      var snap = buildSavePayload(true);
      snap.savedAt = (new Date()).toISOString();
      snap.fromWaveIndex = state.waveIndex;
      localStorage.setItem(LOCAL_WAVEEND_KEY, JSON.stringify(snap));
      return true;
    } catch (_) {
      return false;
    }
  }
  function _readLocalWaveendAutosave() {
    try {
      var raw = localStorage.getItem(LOCAL_WAVEEND_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }
  function _clearLocalWaveendAutosave() {
    try { localStorage.removeItem(LOCAL_WAVEEND_KEY); } catch (_) {}
  }
  // 构造存档 payload：保存游戏中跨波持久字段
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
        if (g.targetStrategy) item.targetStrategy = _normStrategy(g.targetStrategy);
        // V4 Task9：level + rollEffect（rollEffect 仅 L3 有值，否则不传 / null → 读档时 fallback）
        if (typeof g.level === 'number' && g.level > 0) item.level = g.level | 0;
        if (typeof g.rollEffect === 'string' && g.rollEffect) item.rollEffect = g.rollEffect;
        // ===== V4-7 塔能量系统：保存 energy/skillReady（旧存档无=0）—— skillActive 一律归零（读档无进行中子弹）
        var _en = (typeof g.energy === 'number') ? g.energy : 0;
        _en = Math.max(0, Math.min(TOWER_ENERGY_MAX, _en));
        item.energy = _en;
        item.skillReady = !!g.skillReady || (_en >= TOWER_ENERGY_MAX);
        gridOut.push(item);
      }
    }
    return {
      version: 2, // V4-1: 存档版本号（V3=1）
      mapId:   Number(state.mapId) || 1,
      difficulty: state.difficulty || 'normal',
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
      totalKillsAllWaves: Number(state.totalKillsAllWaves) || 0,
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
              cooldown: 0,
              level: Math.max(0, Math.min(LEVEL_MAX, parseInt(it.level || 0, 10))),
              rollEffect: (typeof it.rollEffect === 'string' && it.rollEffect && getL3Effect(it.rollEffect)) ? it.rollEffect : null,
              targetStrategy: _normStrategy(it.targetStrategy),
              damageDealt: 0,
              kills: 0,
              // V4-7：兼容旧存档（无 energy=0；无 skillReady 看 energy）—— skillActive 一律 false
              energy: 0,
              skillReady: false,
              skillActive: false
            };
            var _en = Number(it.energy);
            if (!isFinite(_en)) _en = (it.skillReady === true) ? TOWER_ENERGY_MAX : 0;
            _en = Math.max(0, Math.min(TOWER_ENERGY_MAX, _en));
            inst.energy = _en;
            inst.skillReady = (it.skillReady === true) || (_en >= TOWER_ENERGY_MAX);
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
    if (typeof rec.totalKillsAllWaves === 'number') state.totalKillsAllWaves = rec.totalKillsAllWaves;
    else state.totalKillsAllWaves = 0;
    if (Array.isArray(rec.activeBuffs)) state.activeBuffs = rec.activeBuffs.slice();
    // V4-1: 存档的 mapId/difficulty → 恢复 state + 刷新 Tab 选中 + 重建难度倍率；并锁定 Tab（因为已是已开局状态）
    var newMapId = Number(rec.mapId) || 1;
    var newDiff = String(rec.difficulty || 'normal');
    if (newMapId !== (Number(state.mapId) || 1)) {
      setMapId(newMapId, { force: true, silent: true });
    }
    // 恢复难度：先解锁再 setDifficulty，保证 baseMaxHP/multiplier 按存档值一致
    var savedLocked = state.difficultyLocked;
    state.difficultyLocked = false;
    setDifficulty(newDiff, { silent: true });
    // 若存档已经 baseMaxHP 指定过（通常与 difficultyMul 一致），以存档为准
    if (typeof rec.baseMaxHP === 'number') state.baseMaxHP = rec.baseMaxHP;
    // 已开局 ≥ 1 波的存档，Tab 保持锁定（防玩家读档后改难度作弊）
    state.difficultyLocked = (savedLocked) || (Number(state.waveIndex) >= 1);
    renderMenuChooser();
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
      refreshEndAutosaveUI(state.phase === PHASE.WIN ? 'win' : 'lose');
      document.getElementById('end-modal').classList.remove('hidden');
    }
    refreshHUD();
    draw();
    return { ok: true };
  }

  function loadSave() {
    if (!_acc) { toast('请先登录再读档', 'er'); setMsg('未登录无法云端读档', true); return Promise.resolve({ ok: false }); }
    // 手动读档必须过防刷门禁
    var g2 = canManualSaveOrLoad(state);
    if (!g2.ok) {
      toast('禁止读档：' + g2.msg, 'er');
      setMsg(g2.msg, true);
      log('w', '手动读档被拒绝: ' + g2.reason + ' ' + g2.msg);
      return Promise.resolve({ ok: false });
    }
    // V4-1: 按当前 state.(mapId, difficulty) 取对应桶；无 state 值走默认 1/normal
    var mId = Number(state.mapId) || 1;
    var diff = state.difficulty || 'normal';
    var qs = '?mapId=' + encodeURIComponent(mId) + '&difficulty=' + encodeURIComponent(diff);
    return api('/api/save' + qs, { method: 'GET' }).then(function (r) {
      if (!r.ok) {
        toast('读档失败：' + (r.message || ('HTTP ' + r.status)), 'er');
        return { ok: false };
      }
      if (!r.data) {
        _knownSaveUpdatedAt = '';
        toast('当前账号没有存档（地图=' + mId + ' 难度=' + diff + '）', 'info');
        return { ok: false };
      }
      var result = applySaveRecord(r.data);
      if (result.ok) {
        if (r.data.updatedAt) {
          _knownSaveUpdatedAt = (typeof r.data.updatedAt === 'string') ? r.data.updatedAt : new Date(r.data.updatedAt).toISOString();
        }
        toast('读档成功（波 ' + state.waveIndex + ' ' + state.phase + '）', 'ok');
        log('s', '已载入存档：' + (r.data.updatedAt ? new Date(r.data.updatedAt).toLocaleString() : '') +
          '  phase=' + state.phase + '  波=' + state.waveIndex + '  mapId=' + state.mapId + '  diff=' + state.difficulty + '  version=' + _knownSaveUpdatedAt);
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
  // V4-Anim: 序列帧播放器全局单例（由 /web/js/td-animation.js 挂载 window.animPlayer）
  //          回退：若 td-animation.js 未加载也不影响其他战斗逻辑，globalAnimPlayer 为 null
  var globalAnimPlayer = (typeof window !== 'undefined' && window.animPlayer) ? window.animPlayer : null;
  var _towerAttackLoading = false;   // 去重：loadTP 只触发一次（JSON/PNG 均有浏览器缓存）

  // ===== V4 地图背景图：按 map.backgroundImage 预加载，失败自动降级为原纯色格 =====
  var _mapBgCache = {};        // url -> { loaded: bool, img: HTMLImageElement|null }
  var _currentMapBgImg = null; // 当前 MapDetail 对应 Image (loaded=true 才画)
  function ensureMapBgLoaded(mapDetail) {
    var url = (mapDetail && typeof mapDetail.backgroundImage === 'string') ? mapDetail.backgroundImage : '';
    if (!url) { _currentMapBgImg = null; return; }
    if (!_mapBgCache[url]) {
      var rec = { loaded: false, img: null };
      try {
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () { rec.loaded = true; draw(); }; // 加载完触发一次重绘
        img.onerror = function () {
          rec.loaded = false;
          log('w', '[背景] 地图背景图加载失败，回退为纯色格渲染：' + url);
        };
        img.src = url;
        rec.img = img;
      } catch (e) {
        rec.img = null; rec.loaded = false;
        log('w', '[背景] 创建背景图失败：' + (e && e.message ? e.message : String(e)));
      }
      _mapBgCache[url] = rec;
    }
    _currentMapBgImg = _mapBgCache[url] ? _mapBgCache[url].img : null;
  }
  function _drawMapBgIfReady() {
    if (!_currentMapBgImg || !_currentMapBgImg.complete || !_currentMapBgImg.naturalWidth) return false;
    var ctx = state.ctx;
    if (!ctx) return false;
    var dpr = state._dpr || 1;
    var logicW = state.canvas.width  / dpr;
    var logicH = state.canvas.height / dpr;
    if (!(logicW > 0) || !(logicH > 0)) return false;
    // cover: 撑满整个 canvas 逻辑区域（S/E/Tower 层之上画，背景不影响逻辑像素）
    try {
      ctx.drawImage(_currentMapBgImg, 0, 0, logicW, logicH);
      return true;
    } catch (e) {
      return false;
    }
  }
  /** 通用：从"散图帧目录"加载一套动画；
   *  - 用法1：baseDir+'/'+prefix+pad(i,padLen)+suffix   （Spine 导出的默认命名）
   *  - 用法2：直接传入 frameUrls 数组
   *  加载完毕后自动根据"逻辑画布大小"计算 defaultScale = cell×1.2÷max(w, h)，保证塔散图和角色散图都自动铺满格子 1.2 倍
   */
  function ensureFrameAnimByName(name, opts) {
    if (!globalAnimPlayer) return Promise.reject(new Error('animPlayer not loaded'));
    opts = opts || {};
    if (globalAnimPlayer.hasAnim(name)) {
      if (typeof opts.adaptiveCell === 'undefined' || opts.adaptiveCell) {
        var a0 = globalAnimPlayer.anims[name];
        if (a0 && a0.frames && a0.frames.length) {
          var f0 = a0.frames[0];
          var longest = Math.max(f0.w || 0, f0.h || 0) || 720;
          var s = _currentTowerAttackTargetPx() / longest;
          if (typeof globalAnimPlayer.setAnimDefaultScale === 'function') globalAnimPlayer.setAnimDefaultScale(name, s > 0 ? s : 1);
          else if (a0) a0.defaultScale = s > 0 ? s : 1;
        }
      }
      return Promise.resolve(globalAnimPlayer.anims[name]);
    }
    var def = { name: name, fps: opts.fps || 18, loop: opts.loop || 'none', anchor: opts.anchor || { x: 0.5, y: 1.0 } };
    if (Array.isArray(opts.frameUrls)) {
      def.frames = opts.frameUrls.slice();
    } else {
      if (!opts.baseDir) return Promise.reject(new Error('ensureFrameAnimByName 需要 baseDir 或 frameUrls'));
      def.baseDir    = opts.baseDir;
      def.prefix     = opts.prefix || '';
      def.suffix     = opts.suffix || '.png';
      def.count      = Number(opts.count)     || 0;
      def.padLen     = Number(opts.padLen)    || 2;
      def.startIndex = Number(opts.startIndex)|| 0;
    }
    if (opts.frameSize && opts.frameSize.w && opts.frameSize.h) def.frameSize = { w: opts.frameSize.w, h: opts.frameSize.h };
    return globalAnimPlayer.loadFrames(def).then(function (anim) {
      if (typeof opts.adaptiveCell === 'undefined' || opts.adaptiveCell) {
        var f1 = anim.frames && anim.frames[0];
        if (f1) {
          var longest = Math.max(f1.w || 0, f1.h || 0) || 720;
          var s1 = _currentTowerAttackTargetPx() / longest;
          if (typeof globalAnimPlayer.setAnimDefaultScale === 'function') globalAnimPlayer.setAnimDefaultScale(name, s1 > 0 ? s1 : 1);
          else anim.defaultScale = s1 > 0 ? s1 : 1;
        }
      } else if (typeof opts.defaultScale === 'number') {
        if (typeof globalAnimPlayer.setAnimDefaultScale === 'function') globalAnimPlayer.setAnimDefaultScale(name, opts.defaultScale);
        else anim.defaultScale = opts.defaultScale;
      }
      log('i', '[动画] loadFrames 完成 ' + name + ' frames=' + anim.frames.length + ' scale=' + (anim.defaultScale || 1).toFixed(3));
      return anim;
    });
  }

  /** 测试入口：把 chuxue 目录这 6 张 spritesheet 直接加载为名为 towerAttack_chuxue 的动画，播放前先 cell 自适应 */
  function _demoLoadChuxue() {
    return ensureFrameAnimByName('towerAttack_chuxue', {
      baseDir: '/assets/png/chuxue',
      prefix:  'char_174_slbell-Attack_',
      suffix:  '.png',
      count:   6,
      padLen:  2,
      startIndex: 0,
      fps: 18,
      loop: 'none',
      anchor: { x: 0.5, y: 1.0 }
    });
  }

  function ensureTowerAttackAnimLoaded() {
    if (!globalAnimPlayer || _towerAttackLoading) return;
    if (globalAnimPlayer.hasAnim('towerAttack')) {
      // 已加载过：根据当前 cell 重新同步自适应 defaultScale（= 1.2 格 ÷ 帧原始尺寸 720）
      _syncTowerAttackScale();
      return;
    }
    _towerAttackLoading = true;
    // V4 自适应：塔攻击序列帧 defaultScale 按"地图格大小的 1.2 倍"换算（帧原始尺寸 720×720）
    //   先写 cell ×1.2÷720 的当前值；如果动画尚未加载完 cell 还会在 _syncTowerAttackScale 里再次覆盖。
    var baseScale = _currentTowerAttackTargetPx() / 720;
    globalAnimPlayer.loadTP({
      name: 'towerAttack',
      jsonUrl:  '/assets/png/spritesheet_1.json',
      imageUrl: '/assets/png/spritesheet_1.png',
      order: ['001','002','003','004','005','006'],
      fps: 18,
      loop: 'none',
      defaultScale: baseScale > 0 ? baseScale : (64 / 720),
      anchor: { x: 0.5, y: 1.0 }
    }).then(function () {
      // 动画就绪后立即再用最新 cell 校准一次（applyCfg / fitCanvasToContainer 后 cell 一般已固定）
      _syncTowerAttackScale();
      log('i', '[动画] towerAttack 加载完毕（塔攻击 6 帧/18fps，自适应尺寸 = ' + (100 * baseScale).toFixed(2) + '% × 720px 原图）');
    }).then(null, function (e) {
      var msg = (e && e.message) ? e.message : String(e || '');
      log('e', '[动画] towerAttack 加载失败: ' + msg + ' —— 将回退到纯方块子弹/塔显示，不影响战斗进行');
      _towerAttackLoading = false; // 允许下次 applyCfg/重开 再次尝试
    });
  }

  /** 序列帧目标边长：用户要求 = 地图每格大小(cell) 的 1.2 倍 */
  function _currentTowerAttackTargetPx() {
    var cs = Number(state && state.cell) || 0;
    if (cs > 0) return cs * 1.2;
    // cell 尚未就绪（applyCfg 前）时，用 configCellSize 兜底
    var cfg = Number(state && state.configCellSize) || 48;
    return cfg * 1.2;
  }
  /** 动画已加载后：按最新 cell 同步 anim.defaultScale；未加载则作为 pending 会在 loadTP.then 里再次执行 */
  function _syncTowerAttackScale() {
    if (!globalAnimPlayer) return;
    var target = _currentTowerAttackTargetPx();
    var newScale = target > 0 ? (target / 720) : 0;
    if (newScale <= 0) return;
    if (typeof globalAnimPlayer.setAnimDefaultScale === 'function') {
      globalAnimPlayer.setAnimDefaultScale('towerAttack', newScale);
    } else {
      // td-animation.js 未升级 setAnimDefaultScale：直接访问 anims 兜底（老版本兼容）
      var anim = globalAnimPlayer.anims && globalAnimPlayer.anims['towerAttack'];
      if (anim) anim.defaultScale = newScale;
    }
  }

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
    // V4-6 T12 WAVEEND 4 Tab 商店
    buffRollsLeft: 0,            // 本波剩余可抽 Buff 次数（每波 showWaveendModal 时重置）
    shopTowerMode: false,        // 是否处于「商店塔」放置模式（WAVEEND 阶段）
    shopTowerPending: null,      // 已扣金币但未落地的商店塔 cfg；取消时退金
    shopTowerPaidGold: 0,        // 商店塔扣的金（取消时退）
    // 战斗
    enemies: [],
    projectiles: [],
    spawnQueue: [],    // 待生成的敌人: [{enemyId,timeLeft}]
    waveElapsed: 0,
    lastFrame: 0,
    running: false,
    waveKillGold: 0,
    waveBonusGold: 0,
    // DPS 统计：
    //  - waveDamageStats: { waveIndex: N, towers: [{gridIdx,name,rarity,damageDealt,kills}] }
    //    在战斗结束（WAVEEND/WIN/LOSE）时由当前 grid 快照生成，不会在波间被覆盖
    waveDamageStats: null,
    // 累计跨波击杀（本波结束 snapshot 时才把本波 kills 总合累加到这里，用于 HUD / 模态展示 / 存档持久）
    totalKillsAllWaves: 0,
    rafId: 0,
    // ===== V4-自适应地图尺寸 =====
    _dpr: 1,               // 高清屏 devicePixelRatio（由 fitCanvasToContainer 自动刷新）
    _resizeT: null,        // resizeObserver debounce timer
    _resizeOb: null,       // ResizeObserver 实例（监听 .game-main 尺寸变化）
    configCellSize: 0,     // 配置原始 cellSize（当前作为 "不要过度放大" 的参考上限 3x 内）
    // ===== v4: 塔合成系统 =====
    merge: {
      mode: null,             // null | 'upgrade' (A) | 'fusion' (B) | 'evolve' (C)
      selected: [],           // gridIdx[]，按点击顺序；最后一个 = 合成后产物落点
      activeRecipeId: null,   // evolve 模式下当前激活配方（若被用户在 ribbon 点选，则锁定）
      lastPreview: null       // 最近一次成功的校验缓存（打开 modal 时复用）
    },
    // v4: 进化可达成检测结果（prepare 阶段展示高光 + ribbon 配方可实现列表）
    evolvable: {
      any: false,             // true = 有任意一个配方可达成
      recipeIds: []           // 满足材料需求的配方 id 列表
    },
    // 当前地图 id（默认 1）
    mapId: 1,
    // ===== V4-1: 难度 / 地图 Tab 状态 =====
    difficulty: 'normal',     // 'normal' | 'hard' | 'nightmare'
    // 难度锁定：true = 已开始对局，之后 Tab 点击只切 UI 不再改变倍率（防作弊/跳数值）
    difficultyLocked: false,
    // 不同难度的基础值契约（FR-1.2 说明：HP/SPD/金/基地HP）
    difficultyMul: {
      hp: 1.0, speed: 1.0, gold: 1.0, baseMaxHP: 20
    },
    // 已解锁的地图 id 集合（默认 mapId=1 草原开启；lava/ice 通关前一图解锁）
    unlockedMaps: { 1: true, 2: false, 3: false },
    // ===== V4-6 T13 天赋树 =====
    talentNodesActive: {},          // 已激活节点集合 {id:true}，直接 in 查找
    talentNodesList: [],            // 数组版本（持久化写入后端顺序与激活顺序一致）
    talentPointsAvailable: 5        // 初始可用天赋点数
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
  /** 像素反推格子：px/cs 向下取整即格子 x,y；越界返回 null */
  function pxToCell(px, py) {
    var cs = state.cell || 1;
    var x = Math.floor(px / cs);
    var y = Math.floor(py / cs);
    if (!inBounds(x, y)) return null;
    return { x: x, y: y };
  }
  /** 塔攻击动作锚点（与 spritesheet_1 anchor:{x:0.5, y:1.0} 对齐）= 格子底边中央 */
  function cellTowerAnchorPx(x, y) {
    var cs = state.cell;
    return { x: x * cs + cs / 2, y: y * cs + cs };
  }

  /**
   * V4-自适应：根据 canvas 父容器（.game-main）的实际可用像素，等比重新计算 cellSize。
   * - 高清屏（DPR>1）：canvas internal 宽高 × DPR，并在 ctx 上 setTransform(DPR)，所有绘制逻辑不改；
   * - CSS box 仍由 #stage 的 max-width/max-height 负责等比缩放到容器内；
   * - 结果：PC 最大化 / 手机横竖屏 / 侧边栏折叠时，地图 cell 始终是"容器内最大可行整数像素"。
   */
  function fitCanvasToContainer() {
    if (!state.canvas || !state.ctx || !state.cols || !state.rows) return false;
    var host = state.canvas.parentElement;
    if (!host) return false;
    var W = Math.max(0, Math.floor(host.clientWidth)), H = Math.max(0, Math.floor(host.clientHeight));
    if (!W || !H) return false;
    // 逻辑 cellSize（=DPR=1 时的每个格子像素数）
    var maxFromConfig = state.configCellSize > 0 ? state.configCellSize * 3 : 128;
    var cell = Math.floor(Math.min(W / state.cols, H / state.rows));
    if (cell < 12) cell = 12;
    if (cell > maxFromConfig) cell = maxFromConfig;
    if (cell > 128) cell = 128; // 硬上限（避免超大屏内存爆炸）
    // DPR 高清：把 canvas 内部像素 * DPR（每个逻辑像素被 DPR×DPR 真实物理像素渲染，Retina/高分屏不糊）
    // 不设置 canvas 的 style.width/style.height：
    //   让 CSS 的 max-width:100%; max-height:100%; width:auto; height:auto 自动把 canvas intrinsic 尺寸等比缩放到父容器，
    //   保证盒子宽高比永远是 cols:rows，每个网格 cell 都是正方形（不会因为横向略溢出被 max-width 夹扁）。
    var dpr = Math.max(1, Math.min(3, Math.round(window.devicePixelRatio || 1)));
    var logicW = state.cols * cell;
    var logicH = state.rows * cell;
    state.canvas.width  = logicW * dpr;
    state.canvas.height = logicH * dpr;
    // 清掉可能残留的 inline style（防止旧值影响新的 intrinsic ratio 判定）
    state.canvas.style.width  = '';
    state.canvas.style.height = '';
    state.cell = cell;
    state._dpr = dpr;
    var ctx = state.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 图像平滑：DPR>=2 时关闭抗锯齿能让像素图（塔攻击序列帧 / sprite）更锐利
    try { ctx.imageSmoothingEnabled = (dpr === 1); } catch (e) {}
    // V4：地图尺寸已变化 → 塔攻击序列帧 defaultScale 同步为 1.2×cell
    _syncTowerAttackScale();
    // V4：塔信息弹窗若已打开，重新按新 canvas 位置对齐（避免 resize 后弹窗错位）
    if (typeof _towerInfoIdx !== 'undefined' && _towerInfoIdx != null) {
      try { _positionTowerInfoModal(_towerInfoIdx); } catch(e) {}
    }
    return { cell: cell, dpr: dpr, logicW: logicW, logicH: logicH };
  }

  /** 注册/销毁 ResizeObserver + debounce 调用 fitCanvasToContainer；只在 init 时调一次 */
  function ensureResizeObserver() {
    if (!state.canvas || !state.canvas.parentElement) return;
    if (state._resizeOb) return;   // 已注册
    try {
      var host = state.canvas.parentElement;
      var Ob = window.ResizeObserver;
      if (!Ob) {
        // 旧浏览器回退：window resize debounce
        var onWin = function () {
          if (state._resizeT) clearTimeout(state._resizeT);
          state._resizeT = setTimeout(function () { state._resizeT = null; if (fitCanvasToContainer()) draw(); }, 100);
        };
        window.addEventListener('resize', onWin, { passive: true });
        window.addEventListener('orientationchange', onWin, { passive: true });
        state._resizeOb = { disconnect: function () {
          window.removeEventListener('resize', onWin);
          window.removeEventListener('orientationchange', onWin);
        } };
      } else {
        state._resizeOb = new Ob(function () {
          if (state._resizeT) clearTimeout(state._resizeT);
          state._resizeT = setTimeout(function () { state._resizeT = null; if (fitCanvasToContainer()) draw(); }, 80);
        });
        state._resizeOb.observe(host);
      }
    } catch (e) {
      log('e', '[自适应] ResizeObserver 失败: ' + (e && e.message ? e.message : String(e || '')));
    }
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

  /**
   * V4 检测点：构建"起点 → 中间检测点数组 → 基地"的完整 waypoint 列表（每个点 {x,y}）
   *   - 地图未定义 checkpoints 时，退化成老逻辑的 [S, E] 两节点
   *   - 用在：hasPathAcrossCheckpoints（每段连通性判断）和 buildFullPathWithCheckpoints（敌人路径拼接）
   */
  function collectWaypoints() {
    var md = state.cfg.mapDetail;
    var sp = (md.spawnPoints && md.spawnPoints[0]) ? md.spawnPoints[0] : { x: 0, y: 0 };
    var ep = md.base || { x: state.cols - 1, y: 0 };
    var cps = (md.checkpoints && Array.isArray(md.checkpoints)) ? md.checkpoints.slice() : [];
    // 过滤无效检测点（越界/和起点终点重合）
    cps = cps.filter(function (c) {
      if (!c || !inBounds(c.x, c.y)) return false;
      if (c.x === sp.x && c.y === sp.y) return false;
      if (c.x === ep.x && c.y === ep.y) return false;
      return true;
    });
    var arr = [sp];
    for (var i = 0; i < cps.length; i++) arr.push(cps[i]);
    arr.push(ep);
    return arr;
  }

  function hasPathFromStartToEnd() {
    // 无 checkpoints：保持老行为（整段 S→E A*）
    if (!(state.cfg.mapDetail.checkpoints && state.cfg.mapDetail.checkpoints.length)) {
      var md = state.cfg.mapDetail;
      var sp = (md.spawnPoints && md.spawnPoints[0]) ? md.spawnPoints[0] : { x: 0, y: 0 };
      var ep = md.base || { x: state.cols - 1, y: 0 };
      return _aStarSegmentExist(sp.x, sp.y, ep.x, ep.y);
    }
    // 有 checkpoints：走分段 A*（保证任何一段都不被封死）
    return !!hasPathAcrossCheckpoints();
  }

  /**
   * 顺序检查每一段 waypoints[i] → waypoints[i+1] 的连通性
   *   - 全部成功 → 返回 { ok:true, segments: N }
   *   - 某段失败 → 返回 { ok:false, segIndex:i, from:{x,y}, to:{x,y} }
   */
  function hasPathAcrossCheckpoints() {
    var wps = collectWaypoints();
    for (var i = 0; i < wps.length - 1; i++) {
      var a = wps[i], b = wps[i + 1];
      var ok = _aStarSegmentExist(a.x, a.y, b.x, b.y);
      if (!ok) return { ok: false, segIndex: i, from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y } };
    }
    return { ok: true, segments: wps.length - 1 };
  }

  /**
   * 单个 A* 分段的连通性判断：
   *   - 起点/终点 tile 本身可能不是 walkable（比如 S/E），临时设为 START/END；
   *   - 跑完再原样回滚；
   *   - 任何情况下只要 A* 有路径即返回 true。
   */
  function _aStarSegmentExist(sx, sy, ex, ey) {
    var ta = tileAt(sx, sy), tb = tileAt(ex, ey);
    if (!tileIsWalkable(ta)) setTile(sx, sy, T_START);
    if (!tileIsWalkable(tb)) setTile(ex, ey, T_END);
    var p = aStar(sx, sy, ex, ey);
    if (tileAt(sx, sy) !== ta) setTile(sx, sy, ta);
    if (tileAt(ex, ey) !== tb) setTile(ex, ey, tb);
    return !!p;
  }

  /**
   * V4：为敌人生成一整条长路径（按顺序过每一个检测点）
   *   - 任何一段 A* 失败 → 返回 null（异常路径，敌人放弃出生，记日志）
   *   - 每段拼接时去掉后一段首格（和前一段末端重合），保证 pathIdx 单调前进不重复停在同一格
   */
  function buildFullPathWithCheckpoints() {
    var wps = collectWaypoints();
    var full = null;
    for (var i = 0; i < wps.length - 1; i++) {
      var a = wps[i], b = wps[i + 1];
      var seg = aStar(a.x, a.y, b.x, b.y);
      if (!seg) return null;
      if (!full) full = seg;
      else {
        // seg[0] 和 full[full.length-1] 都是 waypoints[i]（同一格重合），跳过第一个
        for (var j = 1; j < seg.length; j++) full.push(seg[j]);
      }
    }
    return full;
  }

  // ---------- Gate: single source of truth for terrain-modifying ops ----------
  // op = {kind:'place'|'reserve_tower'|'to_wall'|'demolish_wall', gx,gy, newTile}
  // 返回 { ok:boolean, msg?:string }
  function terrainGate(op) {
    if (!op || !inBounds(op.gx, op.gy)) return { ok: false, msg: '越界' };
    // V4：起点 / 基地 / 任意检测点 是关卡关键锚点 —— 不能被覆盖为塔/墙（否则 A* 会临时"当作可走"，实际通过不了）
    var kx = op.gx, ky = op.gy;
    var md = state.cfg.mapDetail;
    var sp = (md.spawnPoints && md.spawnPoints[0]) ? md.spawnPoints[0] : null;
    var isFixedAnchor = false;
    var anchorLabel = '';
    if (sp && sp.x === kx && sp.y === ky) { isFixedAnchor = true; anchorLabel = '起点'; }
    else if (md.base && md.base.x === kx && md.base.y === ky) { isFixedAnchor = true; anchorLabel = '基地'; }
    else if (md.checkpoints && md.checkpoints.length) {
      for (var ci = 0; ci < md.checkpoints.length; ci++) {
        var c = md.checkpoints[ci];
        if (c && c.x === kx && c.y === ky) { isFixedAnchor = true; anchorLabel = '检测点 M' + (ci + 1); break; }
      }
    }
    if (isFixedAnchor) {
      // demolish_wall：不允许拆锚点上的"任何东西"（真的能放吗？下面 place/reserve 已经拒绝，但保险：拆锚点也拒绝）
      if (op.kind === 'demolish_wall') {
        return { ok: false, msg: anchorLabel + '(' + kx + ',' + ky + ') 不允许拆除（关卡关键锚点）' };
      }
      return { ok: false, msg: anchorLabel + '(' + kx + ',' + ky + ') 是必经检测点/起点/基地，不允许在此建造塔或墙' };
    }
    var prev = tileAt(op.gx, op.gy);
    var prevGridObj = state.grid[idx(op.gx, op.gy)] || null;
    setTile(op.gx, op.gy, op.newTile);
    if (op.gridObj !== undefined) state.grid[idx(op.gx, op.gy)] = op.gridObj;
    var pathOk;
    // V4：若有检测点（checkpoints），按分段检查；否则按旧的 S→E 直通
    if (md.checkpoints && md.checkpoints.length) {
      pathOk = hasPathAcrossCheckpoints();
      if (!pathOk.ok) {
        setTile(op.gx, op.gy, prev);
        state.grid[idx(op.gx, op.gy)] = prevGridObj;
        var segLabel = '段 ' + (pathOk.segIndex + 1);
        var fromName = pathOk.segIndex === 0 ? '起点(' + pathOk.from.x + ',' + pathOk.from.y + ')' : '检测点(' + pathOk.from.x + ',' + pathOk.from.y + ')';
        var toIsBase = (pathOk.to.x === md.base.x && pathOk.to.y === md.base.y);
        var toName = toIsBase ? '基地(' + pathOk.to.x + ',' + pathOk.to.y + ')' : '检测点(' + pathOk.to.x + ',' + pathOk.to.y + ')';
        return { ok: false, msg: '操作会封死必经之路【' + segLabel + '：' + fromName + ' → ' + toName + '】，已拒绝' };
      }
    } else {
      pathOk = hasPathFromStartToEnd();
      if (!pathOk) {
        setTile(op.gx, op.gy, prev);
        state.grid[idx(op.gx, op.gy)] = prevGridObj;
        return { ok: false, msg: '操作会封死路径（起点→基地无通路），已拒绝' };
      }
    }
    return { ok: true };
  }

  // ---------- rendering ----------
  function drawTile(x, y) {
    var ctx = state.ctx, cs = state.cell;
    var px = x * cs, py = y * cs;
    var t = tileAt(x, y);
    // V4-背景图：若已显示地图背景图，草/塔格使用低透明度填色（保留 S/E/Wall/Stone 更粗对比视觉）
    var hasBg = !!(_currentMapBgImg && _currentMapBgImg.complete && _currentMapBgImg.naturalWidth);
    var grassAlpha = hasBg ? 0.12 : 1.00;
    var stoneAlpha = hasBg ? 0.70 : 1.00;
    var wallAlpha  = hasBg ? 0.88 : 1.00;
    switch (t) {
      case T_GRASS:
        if (grassAlpha >= 1) {
          ctx.fillStyle = '#14532d';
          ctx.fillRect(px, py, cs, cs);
          ctx.fillStyle = 'rgba(34, 197, 94, 0.10)';
          ctx.fillRect(px + 2, py + 2, cs - 4, cs - 4);
        } else {
          ctx.fillStyle = 'rgba(20, 83, 45, ' + grassAlpha + ')';
          ctx.fillRect(px, py, cs, cs);
        }
        break;
      case T_STONE:
        ctx.globalAlpha = stoneAlpha;
        ctx.fillStyle = '#475569'; ctx.fillRect(px, py, cs, cs);
        ctx.fillStyle = '#334155'; ctx.fillRect(px + 3, py + 3, cs - 6, cs - 6);
        ctx.globalAlpha = 1;
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
        ctx.globalAlpha = wallAlpha;
        ctx.fillStyle = '#78350f'; ctx.fillRect(px, py, cs, cs);
        ctx.fillStyle = '#92400e'; ctx.fillRect(px + 3, py + 3, cs - 6, cs - 6);
        ctx.fillStyle = '#451a03'; ctx.fillRect(px + 7, py + 7, cs - 14, cs - 14);
        ctx.globalAlpha = 1;
        break;
      case T_TOWER:
      case T_CAND:
        if (grassAlpha >= 1) {
          ctx.fillStyle = '#14532d'; ctx.fillRect(px, py, cs, cs);
        } else {
          ctx.fillStyle = 'rgba(20, 83, 45, ' + grassAlpha + ')';
          ctx.fillRect(px, py, cs, cs);
        }
        break;
      default:
        ctx.fillStyle = '#111827'; ctx.fillRect(px, py, cs, cs);
    }
    ctx.globalAlpha = hasBg ? 0.35 : 0.4;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, cs - 1, cs - 1);
    ctx.globalAlpha = 1;
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
          // 稀有度角标（注意：A 升级会把 gridObj.rarity 升到下一级；因此优先读 g.rarity，回退 cfg.rarity）
          var displayRarity = g.rarity || (cfg && cfg.rarity);
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(cc.cx + cs * 0.10, cc.cy - cs * 0.42, cs * 0.28, 14);
          ctx.fillStyle = rarityCssColor(displayRarity);
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          ctx.fillText(rarityShort(displayRarity), cc.cx + cs * 0.12, cc.cy - cs * 0.40);
          // V4 Task9：等级 Ln 角标（右上角左侧对称位置）；L0 不显示
          var ln = Number(g.level) || 0;
          if (ln > 0) {
            ctx.fillStyle = '#0ea5e9';
            ctx.fillRect(cc.cx - cs * 0.38, cc.cy - cs * 0.42, cs * 0.26, 14);
            ctx.fillStyle = '#f0f9ff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            ctx.fillText('L' + ln, cc.cx - cs * 0.35, cc.cy - cs * 0.40);
          }
          // V4 Task9：L3 effect 图标徽章（右下角小彩标；L3 才有）
          var l3fx = getL3Effect(g.rollEffect);
          if (l3fx) {
            var bxi = cc.cx + cs * 0.22, byi = cc.cy + cs * 0.24;
            var rad = Math.max(7, cs * 0.14);
            ctx.save();
            ctx.beginPath();
            ctx.arc(bxi, byi, rad, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(15,23,42,0.85)';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#fbbf24';
            ctx.stroke();
            ctx.fillStyle = '#fff7ed';
            ctx.font = Math.round(Math.max(10, cs * 0.22)) + 'px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(l3fx.icon || '?', bxi, byi + 1);
            ctx.restore();
          }
          // v4: 特殊塔左下角宝石标识（💠 圆徽）
          if (cfg && cfg.special) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(cc.cx - cs * 0.28, cc.cy + cs * 0.28, 8, 0, Math.PI * 2);
            ctx.fillStyle = '#fbbf24';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#78350f';
            ctx.stroke();
            ctx.fillStyle = '#78350f';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('★', cc.cx - cs * 0.28, cc.cy + cs * 0.29);
            ctx.restore();
          }
          // ====== V4-7 塔能量条：格子底部画细长条；满能金色+脉动光晕；激活中(skillActive)橙色 ⚡ ======
          if (t === T_TOWER) {
            _towerEnsureEnergyFields(g, 0);
            var enPct = Math.max(0, Math.min(1, (Number(g.energy) || 0) / TOWER_ENERGY_MAX));
            var barW = cs * 0.70, barH = Math.max(3, Math.floor(cs * 0.08));
            var bx = Math.round(cc.cx - barW / 2);
            var by = Math.round(cc.cy + cs * 0.40 - barH - 2);
            // 底座背景（暗色）
            ctx.save();
            ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
            ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
            // 前景填充色
            var barColor = '#22c55e';  // 普通：绿
            if (g.skillActive) barColor = '#f97316';  // 已激活等待命中：橙
            else if (g.skillReady || enPct >= 1) barColor = '#facc15';  // 满能：金
            ctx.fillStyle = barColor;
            if (enPct >= 1) {
              // 满能光晕脉动（用 waveElapsed 的 sin 闪烁）
              var pulse = 0.5 + 0.5 * Math.sin((state.waveElapsed || 0) * 6);
              ctx.globalAlpha = 0.25 + 0.45 * pulse;
              ctx.shadowColor = barColor;
              ctx.shadowBlur = Math.round(4 + 6 * pulse);
              ctx.fillRect(bx, by, Math.round(barW), barH);
              ctx.shadowBlur = 0;
              ctx.globalAlpha = 1;
            } else {
              ctx.fillRect(bx, by, Math.round(barW * enPct), barH);
            }
            // 边框
            ctx.strokeStyle = (enPct >= 1) ? '#a16207' : 'rgba(148,163,184,0.6)';
            ctx.lineWidth = 1;
            ctx.strokeRect(bx + 0.5, by + 0.5, barW - 1, barH - 1);
            // skillActive 闪⚡图标：右上角
            if (g.skillActive) {
              ctx.fillStyle = '#f97316';
              ctx.font = 'bold ' + Math.max(10, Math.floor(cs * 0.22)) + 'px sans-serif';
              ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              ctx.fillText('⚡', cc.cx + cs * 0.38, cc.cy - cs * 0.02);
            }
            ctx.restore();
          }
          ctx.restore();
          // 攻击范围（候选塔：黄虚线圈；真塔：白细线；都按 buff 叠加后的实际范围画）
          if (cfg && cfg.rangeInCells) {
            var rMul = (state.cfg && typeof state.cfg.applyBuffs === 'function')
              ? (state.cfg.applyBuffs(state.activeBuffs || []).mul.towerRangeMulAll || 1)
              : 1;
            var effR = cfg.rangeInCells * cs * rMul;
            ctx.save();
            ctx.beginPath();
            ctx.arc(cc.cx, cc.cy, effR, 0, Math.PI * 2);
            if (t === T_CAND) {
              ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
              ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
            } else {
              ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
              ctx.lineWidth = 1;
            }
            ctx.stroke(); ctx.setLineDash([]);
            ctx.restore();
          }
        }
      }
    }
    // ===== V4：绘制"检测点"小徽章（M1/M2/…）—— 玩家能看见必经拐弯点，知道在哪里守塔最关键
    var cps = state.cfg.mapDetail.checkpoints;
    if (cps && cps.length) {
      for (var ci = 0; ci < cps.length; ci++) {
        var cp = cps[ci];
        if (!cp || !inBounds(cp.x, cp.y)) continue;
        var ccc = cellCenterPx(cp.x, cp.y);
        var rad = cs * 0.36;
        ctx.save();
        // 外圈呼吸光晕（金色=必守）
        ctx.shadowColor = 'rgba(251,191,36,0.55)';
        ctx.shadowBlur = Math.max(6, cs * 0.15);
        ctx.beginPath();
        ctx.arc(ccc.cx, ccc.cy, rad, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251,191,36,0.18)';
        ctx.fill();
        ctx.shadowBlur = 0;
        // 内圈描边 + 序号
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
        ctx.stroke();
        ctx.fillStyle = '#fef3c7';
        ctx.font = '700 ' + Math.round(cs * 0.42) + 'px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('M' + (ci + 1), ccc.cx, ccc.cy + 1);
        ctx.restore();
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
      var isBoss = !!(cfg && cfg.isBoss);
      // 本体圆
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = (cfg && cfg.color) ? cfg.color : '#68d391';
      ctx.fill();
      // 描边：Boss 加粗 + 辉红；普通：细 + 黑半透
      if (isBoss) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(248,113,113,0.90)';
      } else {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(0,0,0,.5)';
      }
      ctx.stroke();
      // HP bar：Boss 1.6× 宽 + 加深 + 加厚；Boss 满血也红（不绿不黄）
      var baseBarW = r * 2 + 4;
      var barW = isBoss ? baseBarW * 1.6 : baseBarW;
      var barH = isBoss ? 6 : 4;
      var bx = px - barW / 2, by = py - r - (isBoss ? 12 : 8);
      ctx.fillStyle = isBoss ? '#0f172a' : '#334155';
      ctx.fillRect(bx, by, barW, barH);
      var ratio = Math.max(0, e.hp / e.maxHp);
      var hpColor;
      if (isBoss) {
        hpColor = ratio > 0.5 ? '#dc2626' : (ratio > 0.25 ? '#b91c1c' : '#7f1d1d');
      } else {
        hpColor = ratio > 0.5 ? '#22c55e' : (ratio > 0.25 ? '#eab308' : '#ef4444');
      }
      ctx.fillStyle = hpColor;
      ctx.fillRect(bx, by, barW * ratio, barH);
      if (isBoss) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#450a0a';
        ctx.strokeRect(bx, by, barW, barH);
      }
      // [BOSS] 角标：HP bar 上方 38×12 深红底 + fee2e2 文字
      if (isBoss) {
        var tagW = 38, tagH = 12;
        var tx = px - tagW / 2, ty = by - tagH - 3;
        ctx.fillStyle = '#450a0a';
        ctx.fillRect(tx, ty, tagW, tagH);
        ctx.fillStyle = '#fee2e2';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('BOSS', px, ty + tagH / 2);
      }
      // slow 标识：Boss 升级为 4×4 深蓝方点
      if (e.slowSec > 0) {
        ctx.fillStyle = '#60a5fa';
        var sw = isBoss ? 4 : 3;
        ctx.fillRect(bx, by + barH + 1, sw, sw);
      }
    }
  }

  function drawProjectiles() {
    var ctx = state.ctx;
    for (var i = 0; i < state.projectiles.length; i++) {
      var p = state.projectiles[i];
      // V4 Task9：double / ricochet 子弹视觉：子弹颜色 + 外环 glow 区分
      var isDouble = (p.tag === 'double');
      var isRico = !!p.ricochetCfg;
      var baseR = 3;
      if (isDouble) baseR = 3.6;
      if (isRico)   baseR = 3.4;
      if (isDouble || isRico) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, baseR + 4, 0, Math.PI * 2);
        ctx.fillStyle = isDouble ? 'rgba(249,115,22,0.22)' : 'rgba(250,204,21,0.20)';
        ctx.fill();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, baseR, 0, Math.PI * 2);
      ctx.fillStyle = isDouble ? '#fb923c' : (isRico ? '#fde047' : (p.color || '#fde047'));
      ctx.fill();
      if (p.isCrit) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, baseR + 1.6, 0, Math.PI * 2);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }
  }

  function drawMouseHint() {
    if (!state.mouseCell) return;
    var ctx = state.ctx, cs = state.cell;
    var x = state.mouseCell.x, y = state.mouseCell.y;
    if (!inBounds(x, y)) return;
    var t = tileAt(x, y);
    // v4: 合成模式下，鼠标悬停逻辑
    if (state.merge && state.merge.mode) {
      var isTower = (t === T_TOWER);
      var i = idx(x, y);
      var alreadySel = isTower && state.merge.selected.indexOf(i) >= 0;
      // 合成模式：只有 T_TOWER 可点（C 模式下接受配方中允许的 special 塔）
      var ok = isTower;
      ctx.fillStyle = alreadySel ? 'rgba(250,204,21,0.30)' : (ok ? 'rgba(96,165,250,0.22)' : 'rgba(248,113,113,0.22)');
      ctx.fillRect(x * cs, y * cs, cs, cs);
      ctx.strokeStyle = alreadySel ? '#facc15' : (ok ? 'rgba(96,165,250,0.85)' : 'rgba(248,113,113,0.85)');
      ctx.lineWidth = alreadySel ? 3 : 2;
      ctx.strokeRect(x * cs + 1, y * cs + 1, cs - 2, cs - 2);
      return;
    }
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

  // v4: 合成模式选中塔高亮（粗绿外框 + 序号小圆）、进化配方匹配塔角标
  function drawMergeAndEvolveMarkers() {
    var ctx = state.ctx, cs = state.cell;
    if (!state.cfg) return;
    // 1) 选中塔：依次画 绿色边框 + 选择序号（1/2/3）
    var sel = (state.merge && state.merge.selected) ? state.merge.selected : [];
    for (var s = 0; s < sel.length; s++) {
      var gi = sel[s];
      var gx = gi % state.cols, gy = Math.floor(gi / state.cols);
      var px = gx * cs, py = gy * cs;
      ctx.save();
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 3;
      ctx.strokeRect(px + 2, py + 2, cs - 4, cs - 4);
      // 左上角序号圆
      ctx.beginPath();
      ctx.arc(px + 9, py + 9, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#16a34a';
      ctx.fill();
      ctx.strokeStyle = '#052e16';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(s + 1), px + 9, py + 10);
      ctx.restore();
    }
    // 2) 进化 ribbon 激活或 evolve 按钮已"有可合成"时：在匹配塔右上角显示对应配方小圆色标（仅 PREPARE 阶段，提升体验）
    if (state.phase === PHASE.PREPARE && state.evolvable && state.evolvable.any && state.cfg.recipesById) {
      // 只给激活的配方画角标
      var rid = state.merge.activeRecipeId || (state.evolvable.recipeIds[0]);
      if (!rid) return;
      var recipe = state.cfg.recipesById[rid];
      if (!recipe || !recipe.inputs) return;
      // 构造候选池：所有真塔（T_TOWER）未被选中的，扫描每个 input 匹配
      var trueTowers = [];
      for (var k = 0; k < state.tiles.length; k++) {
        if (state.tiles[k] !== T_TOWER) continue;
        var gg = state.grid[k]; if (!gg || !gg.towerCfg) continue;
        trueTowers.push({ i: k, cfg: gg.towerCfg });
      }
      if (!trueTowers.length) return;
      // 贪心匹配：对每个 slot 按顺序匹配真塔（使用过的跳过）
      var usedIdx = {};
      var markedIdx = [];
      for (var slot = 0; slot < recipe.inputs.length; slot++) {
        var inp = recipe.inputs[slot];
        for (var tt = 0; tt < trueTowers.length; tt++) {
          var tc = trueTowers[tt];
          if (usedIdx[tc.i]) continue;
          if (!_towerMatchesRecipeSlot(tc.cfg, inp, recipe, tc.gridObj && tc.gridObj.rarity)) continue;
          usedIdx[tc.i] = true;
          markedIdx.push(tc.i);
          break;
        }
      }
      for (var m = 0; m < markedIdx.length; m++) {
        var mi = markedIdx[m];
        if (sel.indexOf(mi) >= 0) continue; // 选中的已有更醒目的标
        var mx2 = mi % state.cols, my2 = Math.floor(mi / state.cols);
        var mpx = mx2 * cs, mpy = my2 * cs;
        ctx.save();
        ctx.strokeStyle = 'rgba(251,191,36,0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(mpx + 3, mpy + 3, cs - 6, cs - 6);
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }

  function draw() {
    var ctx = state.ctx;
    if (!ctx || !state.cfg) return;
    // V4-自适应：DPR>1 时 ctx 上有 setTransform(dpr,...)，逻辑坐标单位是 1 像素 cell 系；
    //   clearRect 直接用逻辑尺寸清全画布即可，不要用 canvas.width/height（后者是 DPR 放大过的，会导致 clear 越界）。
    var dpr = state._dpr || 1;
    var logicW = state.canvas.width  / dpr;
    var logicH = state.canvas.height / dpr;
    ctx.clearRect(0, 0, logicW, logicH);
    // ===== V4 地图背景图：backgroundImage 加载完成时先平铺画布，再画格子层（草格透明+S/E 叠加） =====
    _drawMapBgIfReady();
    drawGridTowersAndWalls();
    // V4-Anim: 塔攻击序列帧（在塔层之上、子弹/敌人之下 — 视觉：塔刀光覆盖塔体，但不遮子弹/敌人）
    if (globalAnimPlayer) globalAnimPlayer.drawAll(ctx);
    drawProjectiles();
    drawEnemies();
    // ===== V4 Task8：技能视觉（meteor 预警圈 / 撞击闪光 / ice 预警蓝层 / 冻结全屏蓝蒙层）=====
    drawSkillFx();
    // ===== V4 Task9：命中特效 overlay —— 弹射连线 & 暴击折线 & 数字飘字 =====
    drawHitFxOverlay();
    drawMergeAndEvolveMarkers();
    drawMouseHint();
  }

  // 弹射子弹（标签 tag=double 的子弹）画橙黄色尾迹线区分
  //   drawProjectiles 里调用：在 bullet circle 外额外画一条 trail
  // ----- 先把原 drawProjectiles 扩展：找并插入
  // ----- V4 Task9：命中特效 overlay —— crit 红色折线 / ricochet 蓝黄折线（伤害飘字）
  function drawHitFxOverlay() {
    var ctx = state.ctx;
    for (var i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      if (!e._hitFx || !e._hitFx.length) continue;
      for (var k = 0; k < e._hitFx.length; k++) {
        var f = e._hitFx[k];
        var prog = f.life > 0 ? (f.t / f.life) : 1;
        prog = Math.max(0, Math.min(1, prog));
        if (f.type === 'crit') {
          // 折线：从敌人左上↗右下↖ 再回到起点？→ 简化：三段"闪电"折线红色，终点在敌人 center
          var sx = e.px - 14, sy = e.py - 16;
          var p1 = { x: e.px + 6,  y: e.py - 8 };
          var p2 = { x: e.px - 4,  y: e.py + 2 };
          var ex = e.px + 10, ey = e.py + 14;
          ctx.save();
          ctx.globalAlpha = 1 - prog * 0.8;
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = Math.max(1.5, 3 - 2 * prog);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.fillStyle = '#fee2e2';
          ctx.strokeStyle = '#991b1b';
          ctx.lineWidth = 2;
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          var upY = e.py - 22 - prog * 18;
          ctx.strokeText('CRIT -' + (f.amount|0), e.px, upY);
          ctx.fillText('CRIT -' + (f.amount|0), e.px, upY);
          ctx.restore();
        } else if (f.type === 'ricochet' && f.from) {
          // 从弹射起点（上一只敌人 or 塔 or 子弹命中点）到当前敌人，画一条渐隐黄/蓝折线
          ctx.save();
          ctx.globalAlpha = 1 - prog * 0.8;
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = Math.max(1, 2.2 - 1.5 * prog);
          ctx.setLineDash([3, 2]);
          ctx.beginPath();
          ctx.moveTo(f.from.px, f.from.py);
          // 中间弯一点视觉更"电"
          var mx = (f.from.px + e.px) / 2, my = (f.from.py + e.py) / 2 - 6;
          ctx.quadraticCurveTo(mx, my, e.px, e.py);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }
    }
  }

  // ----- V4 Task8 技能 FX 绘制辅助 -----
  function drawSkillFx() {
    if (!state.skillFx || !state.skillFx.length) {
      // 即使空 fx 也要画 freeze / ice overlay（冻结阶段可能只剩 state.iceUntil）
    }
    var ctx = state.ctx;
    var cs = state.cellSize || 48;
    var dpr = state._dpr || 1;
    var logicW = state.canvas.width / dpr;
    var logicH = state.canvas.height / dpr;
    var nowW = state.waveElapsed;
    // --- (1) iceWarning：全屏闪烁蓝色（警告阶段）---
    // --- (2) freeze overlay：冻结阶段（waveElapsed < iceUntil）→ 蓝色蒙层 35% ---
    var freeze = state.iceUntil && nowW < state.iceUntil;
    var slowR = state.slowRemnantUntil && nowW < state.slowRemnantUntil;
    var warnIce = null;
    if (state.skillFx && state.skillFx.length) {
      for (var wfxi = 0; wfxi < state.skillFx.length; wfxi++) {
        var wfx = state.skillFx[wfxi];
        if (wfx.type === 'iceWarning') { warnIce = wfx; break; }
      }
    }
    if (warnIce || freeze || slowR) {
      ctx.save();
      var alpha = 0;
      if (warnIce) {
        var prog = 1 - (warnIce.tLeft / (warnIce.warnTotal || warnIce.tLeft || 1));
        alpha = 0.12 + 0.15 * Math.abs(Math.sin(prog * Math.PI * 4)); // 闪烁 0.12~0.27
      } else if (freeze) {
        alpha = 0.38;
      } else if (slowR) {
        alpha = 0.12;
      }
      ctx.fillStyle = (warnIce && warnIce.color) ? warnIce.color : '#4299e1';
      ctx.globalAlpha = alpha;
      ctx.fillRect(0, 0, logicW, logicH);
      // 冻结中文大字
      if (freeze) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold ' + Math.max(18, Math.floor(cs * 0.55)) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('❄ 已冰冻', logicW / 2, logicH / 2);
      }
      ctx.restore();
    }
    // --- (3) meteor warning / impact 圆圈 ---
    if (!state.skillFx || !state.skillFx.length) return;
    for (var fi = 0; fi < state.skillFx.length; fi++) {
      var fx = state.skillFx[fi];
      if (fx.type === 'meteorWarning') {
        var wProg = 1 - (fx.tLeft / (fx.warnTotal || fx.tLeft || 1));
        ctx.save();
        // 外环：细
        ctx.strokeStyle = fx.color || '#ef4444';
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.arc(fx.cx, fx.cy, fx.rPx, 0, Math.PI * 2); ctx.stroke();
        // 内部填充：0.18 + pulse 到 0.35
        ctx.fillStyle = fx.color || '#ef4444';
        ctx.globalAlpha = 0.18 + 0.17 * (0.5 + 0.5 * Math.sin(wProg * Math.PI * 6));
        ctx.beginPath(); ctx.arc(fx.cx, fx.cy, fx.rPx, 0, Math.PI * 2); ctx.fill();
        // 中心小 X / 叹号
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold ' + Math.max(14, Math.floor(fx.rPx * 0.75)) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('!', fx.cx, fx.cy);
        ctx.restore();
      } else if (fx.type === 'meteorImpact') {
        var iProg = 1 - (fx.tLeft / (fx.total || fx.tLeft || 1));
        ctx.save();
        // impact 瞬间：从 rPx × 0.3 → rPx × 1.18（快速向外扩）
        var rNow = fx.rPx * (0.3 + 0.88 * iProg);
        ctx.strokeStyle = fx.color || '#ef4444';
        ctx.lineWidth = Math.max(2, 8 * (1 - iProg));
        ctx.globalAlpha = 1 - iProg;
        ctx.beginPath(); ctx.arc(fx.cx, fx.cy, rNow, 0, Math.PI * 2); ctx.stroke();
        // 内层橙黄色
        ctx.fillStyle = '#fde68a';
        ctx.globalAlpha = (1 - iProg) * 0.5;
        ctx.beginPath(); ctx.arc(fx.cx, fx.cy, fx.rPx * 0.6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
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
    // V4-1：难度 / 地图 stat chip 文本（含具体倍率，玩家一眼能确认生效）
    var dEl = $('stat-difficulty');
    if (dEl) {
      var dm = state.difficultyMul || {};
      var dName = ({normal:'普通', hard:'困难', nightmare:'噩梦'})[state.difficulty] || state.difficulty;
      var lockTag = state.difficultyLocked ? '（已锁定）' : '';
      dEl.textContent = dName + lockTag + ' ' + dm.hp + '×HP ' + dm.speed + '×速 ' + dm.gold + '×金 ' + dm.baseMaxHP + 'HP';
      // 颜色区分难度
      dEl.classList.remove('normal','hard','nightmare');
      dEl.classList.add(state.difficulty);
    }
    var mEl = $('stat-map');
    if (mEl) {
      var mid = Number(state.mapId) || 1;
      var mName = ({1:'🌿 草原', 2:'🌋 熔岩', 3:'❄ 冰霜'})[mid] || ('Map#' + mid);
      mEl.textContent = mName + ' (#' + mid + ')';
      mEl.classList.remove('grass','lava','ice');
      mEl.classList.add(({1:'grass',2:'lava',3:'ice'})[mid] || 'grass');
    }
    // V4-1：MENU→显示 Tab 选择器；进入 PREPARE/战斗→隐藏（同时也会锁定难度后点无效）
    var mc = $('menu-chooser');
    if (mc) {
      if (state.phase === PHASE.MENU) mc.classList.remove('hidden');
      else mc.classList.add('hidden');
    }
    // 全局合计（总DPS 实时 + 总击杀 累计跨波）
    var live = computeLiveTotals();
    var dpsEl = $('stat-dps');
    if (dpsEl) dpsEl.textContent = (live.totalDps >= 10) ? String(Math.round(live.totalDps)) : live.totalDps.toFixed(1);
    var killsEl = $('stat-kills');
    if (killsEl) killsEl.textContent = String(live.totalKillsAllWaves || 0);
    // V3-2: 当前波是否是 BOSS 波（优先以 waves 表 isBossWave 为准，没读到时按 wave 3/6/8 硬匹配兜底）
    var currentWaveIdx = state.waveIndex;
    var currentWaveBoss = false;
    if (state.cfg && state.cfg.waves && state.cfg.waves[state.mapId] instanceof Array) {
      for (var i = 0; i < state.cfg.waves[state.mapId].length; i++) {
        if (state.cfg.waves[state.mapId][i].wave === currentWaveIdx) {
          currentWaveBoss = !!state.cfg.waves[state.mapId][i].isBossWave;
          break;
        }
      }
    }
    if (!currentWaveBoss) currentWaveBoss = (currentWaveIdx === 3 || currentWaveIdx === 6 || currentWaveIdx === 8);
    // phase bar
    var phaseT = $('phase-name'), extra = $('phase-extra');
    phaseT.textContent = state.phase;
    var extras = [];
    if (state.phase === PHASE.PREPARE) {
      var left = state.placementTotal - state.placementUsed;
      if (currentWaveBoss) extras.push('<span class="chip hot">★BOSS 波</span>');
      extras.push('<span class="chip hot">放置剩余 ' + left + ' / ' + state.placementTotal + '</span>');
      extras.push('<span class="chip ok">运气 ' + state.luckLevel + '</span>');
    } else if (state.phase === PHASE.BATTLE) {
      var alive = 0;
      for (var i = 0; i < state.enemies.length; i++) if (state.enemies[i].alive) alive++;
      if (currentWaveBoss) extras.push('<span class="chip hot">★BOSS 波</span>');
      extras.push('<span class="chip hot">战斗中 存活 ' + alive + '</span>');
      extras.push('<span class="chip">待生成 ' + state.spawnQueue.length + '</span>');
    } else if (state.phase === PHASE.RESERVE) {
      if (currentWaveBoss) extras.push('<span class="chip hot">★BOSS 波</span>');
      extras.push('<span class="chip hot">请选择 1 座保留</span>');
    } else if (state.phase === PHASE.WAVEEND) {
      if (currentWaveBoss) extras.push('<span class="chip hot">★BOSS 波</span>');
      extras.push('<span class="chip ok">波次结算</span>');
    } else if (state.phase === PHASE.WIN || state.phase === PHASE.LOSE) {
      extras.push('<span class="chip hot">对局结束</span>');
    } else {
      extras.push('<span class="chip">点击"开始下一波"进入游戏</span>');
    }
    extra.innerHTML = extras.join(' ');
    // V4-6 T13：顶栏"天赋"按钮 chip（剩余点数）
    var tChip = $('talent-chip');
    if (tChip) tChip.textContent = String(Number(state.talentPointsAvailable) || 0);
    renderBuffsPanel();
    // V4-7：刷新中央开始按钮 + 底部 mini-bar（按 PHASE 显隐）
    try { refreshCenterStartAndMiniBar(); } catch (_e) {}
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
    var gridObj = { type: T_CAND, instId: instId, towerCfgId: towerCfg.id, rarity: towerCfg.rarity, towerCfg: towerCfg, cooldown: 0, damageDealt: 0, kills: 0, energy: 0, skillReady: false, skillActive: false };
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
        var newGridObj = { type: T_TOWER, instId: c.instId, towerCfgId: c.towerCfg.id, rarity: c.towerCfg.rarity, towerCfg: c.towerCfg, level: 0, rollEffect: null, cooldown: 0, targetStrategy: TOWER_STRATEGIES.NEAR, damageDealt: 0, kills: 0, energy: 0, skillReady: false, skillActive: false };
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

  // ============================================================
  // V4 Synthesis / Merge System（A 升级 · B 合成 · C 进化）
  // ============================================================

  // ----- 工具：单塔 vs 配方 input slot 匹配 -----
  // actualRarity：A 升级后塔的 gridObj.rarity 已升到下一级；如传入则替代 towerCfg.rarity 参与稀有度匹配
  function _towerMatchesRecipeSlot(towerCfg, inputSlot, recipeCtx, actualRarity) {
    if (!towerCfg || !inputSlot) return false;
    // 稀有度（必填）：优先使用 actualRarity（升级后的实际稀有度）
    var effRarity = (typeof actualRarity === 'string' && actualRarity) ? actualRarity : (towerCfg.rarity || '');
    if (effRarity !== (inputSlot.RarityRequired || inputSlot.rarityRequired || '')) return false;
    // 元素（若 input 指定则必须匹配）
    var reqEl = (inputSlot.ElementRequired != null) ? inputSlot.ElementRequired : inputSlot.elementRequired;
    if (typeof reqEl === 'string' && reqEl !== '' && (towerCfg.element || '') !== reqEl) return false;
    // 特殊塔是否允许
    if (!!towerCfg.special) {
      var allow = !!(inputSlot.AllowSpecial || inputSlot.allowSpecial);
      if (!allow) return false;
      // 整体配方层 allowSpecialAsInput 再兜底一次（双重保险）
      if (recipeCtx) {
        var globalAllow = !!(recipeCtx.AllowSpecialAsInput || recipeCtx.allowSpecialAsInput);
        if (!globalAllow) return false;
      }
    }
    return true;
  }

  // ----- 工具：扫描场上所有真塔（T_TOWER 且带 towerCfg） -----
  function _allTrueTowers() {
    var out = [];
    for (var i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i] !== T_TOWER) continue;
      var g = state.grid[i];
      if (!g || !g.towerCfg) continue;
      out.push({ i: i, cfg: g.towerCfg, gridObj: g });
    }
    return out;
  }

  // ----- 模式切换 + 按钮高光刷新 -----
  function _refreshMergeButtons() {
    var m = state.merge;
    var modes = ['upgrade', 'fusion', 'evolve'];
    for (var i = 0; i < modes.length; i++) {
      var btn = document.querySelector('.btn.merge[data-merge="' + modes[i] + '"]');
      if (!btn) continue;
      btn.classList.toggle('on', m.mode === modes[i]);
    }
    // 进化按钮 detectEvolvable 高光：PREPARE + 任意配方可达
    var evoBtn = document.getElementById('btn-evolve');
    if (evoBtn) {
      var glow = !!(state.phase === PHASE.PREPARE && state.evolvable && state.evolvable.any);
      evoBtn.classList.toggle('glow', glow);
    }
  }

  // ===== V4-1 难度/地图选择器 =====
  // 难度契约表（与 HTML Tab title 一致）
  var DIFFICULTY_TABLE = {
    normal:    { hp: 1.0, speed: 1.0,  gold: 1.0, baseMaxHP: 20, label: '普通' },
    hard:      { hp: 1.8, speed: 1.15, gold: 1.3, baseMaxHP: 15, label: '困难' },
    nightmare: { hp: 3.0, speed: 1.35, gold: 1.6, baseMaxHP: 10, label: '噩梦' }
  };
  function setDifficulty(d, opts) {
    opts = opts || {};
    if (!DIFFICULTY_TABLE[d]) return { ok: false, msg: '未知难度: ' + d };
    // 已锁定：不更新 state.difficultyMul（防作弊）
    if (state.difficultyLocked) {
      state.difficulty = d; // 仅更新显示值（UI 可以切、chip 显示但 multiplier 不动）
      renderMenuChooser();
      refreshHUD();
      return { ok: false, locked: true, msg: '本难度已锁定，想换难度请点"重开"重新开局' };
    }
    state.difficulty = d;
    var t = DIFFICULTY_TABLE[d];
    state.difficultyMul = { hp: Number(t.hp), speed: Number(t.speed), gold: Number(t.gold), baseMaxHP: Number(t.baseMaxHP) };
    // MENU 时 baseMaxHP 立即生效（否则开局 HUD 还显示 20）：PREPARE prepareNextWave 末尾再第二次覆盖保证生效
    if (state.phase === PHASE.MENU) {
      var tMul0 = calcTalentMul();
      state.baseMaxHP = (state.difficultyMul.baseMaxHP || 20) + (Number(tMul0.baseMaxHPBonus) || 0);
      state.baseHP = state.baseMaxHP;
    }
    renderMenuChooser();
    refreshHUD();
    return { ok: true };
  }
  function setMapId(m, opts) {
    opts = opts || {};
    var mid = Number(m) | 0;
    if (mid < 1 || mid > 3) return { ok: false, msg: '地图 id=' + m + ' 不存在' };
    // opts.force=true: 读档恢复专用，跳过 phase 和 unlocked 检查（直接写入 state）
    if (!opts.force) {
      if (state.phase !== PHASE.MENU) {
        renderMenuChooser();
        return { ok: false, locked: true, msg: '对局已开始，地图切换无效；想换地图请点"重开"' };
      }
      if (!(state.unlockedMaps && state.unlockedMaps[mid])) {
        renderMenuChooser();
        return { ok: false, unlocked: false, msg: '该地图未解锁（通关上一张地图后解锁）' };
      }
    }
    state.mapId = mid;
    // V4-2 Task 5：真正切换 cfg.mapDetail + cfg.waves（从 loader 预加载的 mapDetailsById / wavesById 读取）
    if (state.cfg) {
      var mds = state.cfg.mapDetailsById && state.cfg.mapDetailsById[mid];
      var wvs = state.cfg.wavesById       && state.cfg.wavesById[mid];
      if (mds) {
        state.cfg.mapDetail = mds;
        log('i', '切换地图 detail → mapId=' + mid + ' name=' + mds.name);
      }
      if (wvs && wvs.length) {
        state.cfg.waves = wvs;
        log('i', '切换地图 waves  → mapId=' + mid + ' count=' + wvs.length);
      }
      // V4-背景图：切到新地图 detail 后重新加载对应 backgroundImage
      if (mds) ensureMapBgLoaded(mds);
      // MENU 阶段：如果已经 applyCfg 初始化过 cols/rows/tiles，则重建本地 tiles/grid/canvas 与新地图一致
      if (state.cfg.mapDetail && (state.tiles && state.tiles.length)) {
        var md = state.cfg.mapDetail;
        state.cols = md.gridWidth;
        state.rows = md.gridHeight;
        state.configCellSize = md.cellSize | 0 || state.configCellSize || 48;
        state.cell = state.configCellSize;
        state.tiles = (md.tiles || []).slice();
        // 强制打 S/E 标记（applyCfg 中同样的逻辑）
        if (md.spawnPoints && md.spawnPoints.length) {
          var sp = md.spawnPoints[0];
          if (sp && sp.x >= 0 && sp.y >= 0 && sp.x < state.cols && sp.y < state.rows) state.tiles[idx(sp.x, sp.y)] = T_START;
        }
        if (md.base && md.base.x >= 0 && md.base.y >= 0 && md.base.x < state.cols && md.base.y < state.rows) state.tiles[idx(md.base.x, md.base.y)] = T_END;
        if (md.checkpoints && md.checkpoints.length) {
          for (var cci2 = 0; cci2 < md.checkpoints.length; cci2++) {
            var cp2 = md.checkpoints[cci2];
            if (!cp2) continue;
            if (cp2.x >= 0 && cp2.y >= 0 && cp2.x < state.cols && cp2.y < state.rows) {
              if (state.tiles[idx(cp2.x, cp2.y)] === T_STONE) state.tiles[idx(cp2.x, cp2.y)] = T_GRASS;
            }
          }
        }
        state.grid = new Array(state.cols * state.rows);
        for (var ii = 0; ii < state.grid.length; ii++) state.grid[ii] = null;
        state.towersByInst = {};
        state.canvas.width  = state.cols * state.cell;
        state.canvas.height = state.rows * state.cell;
        try { fitCanvasToContainer(); } catch (_) {}
        // 同步 MENU 阶段初始值：金币/生命/波次/放置次数 复原（基础 50 金 + 富裕开端天赋 + 难度 gold 奖励）
        var _tMul = calcTalentMul();
        state.gold              = 50 + (Number(_tMul.startGoldBonus) || 0);
        var _mdBaseHP = (md.base && md.base.hp) ? Number(md.base.hp) : 20;
        state.baseMaxHP         = _mdBaseHP + (Number(_tMul.baseMaxHPBonus) || 0);
        state.baseHP            = state.baseMaxHP;
        state.maxWaves          = (state.cfg.waves || []).length;
        state.waveIndex         = 0;
        state.placementTotal    = 5;
        state.placementUsed     = 0;
        state.candidates        = [];
        state.activeBuffs       = [];
        state.buffRollsLeft     = 0;
        state.shopTowerMode     = false;
        state.shopTowerPending  = null;
        state.shopTowerPaidGold = 0;
        state.enemies           = [];
        state.projectiles       = [];
        state.spawnQueue        = [];
        state.waveElapsed       = 0;
        state.waveKillGold      = 0;
        state.waveBonusGold     = 0;
        var _baseLuck = Number(state.cfg.luckInitialLevel) || 1;
        state.luckLevel         = Math.max(1, _baseLuck + (Number(_tMul.startLuckLevelBonus) || 0));
        state.phase             = PHASE.MENU;
        state.difficultyLocked  = false;
        try { setDifficulty(state.difficulty, { silent: true }); } catch (_) {}
      }
    }
    if (!opts.silent) {
      renderMenuChooser();
      refreshHUD();
      draw();
    }
    return { ok: true };
  }
  function renderMenuChooser() {
    // 难度 Tab active
    var dTabs = document.querySelectorAll('#difficulty-choices .ctab');
    for (var di = 0; di < dTabs.length; di++) {
      var dT = dTabs[di];
      var dVal = dT.getAttribute('data-difficulty') || '';
      dT.classList.toggle('active', dVal === state.difficulty);
      if (state.difficultyLocked) dT.classList.add('disabled');
      else dT.classList.remove('disabled');
    }
    // 地图 Tab active / unlocked
    var mTabs = document.querySelectorAll('#map-choices .ctab');
    for (var mi2 = 0; mi2 < mTabs.length; mi2++) {
      var mT = mTabs[mi2];
      var mVal = Number(mT.getAttribute('data-map')) | 0;
      mT.classList.toggle('active', mVal === Number(state.mapId));
      var unlocked = !!(state.unlockedMaps && state.unlockedMaps[mVal]);
      if (!unlocked) mT.classList.add('disabled');
      else mT.classList.remove('disabled');
      // V4-2 未实现前暂时锁 lava/ice（由 HTML 自带 disabled 兜底），这里仅同步展示：锁定 tag 是否存在？
      var lockNode = mT.querySelector('.locked');
      if (unlocked && lockNode) lockNode.parentNode.removeChild(lockNode);
      else if (!unlocked && !lockNode) {
        var span = document.createElement('span');
        span.className = 'locked';
        span.textContent = '未解锁';
        mT.appendChild(span);
      }
    }
    // MENU 可见性
    var mc = document.getElementById('menu-chooser');
    if (mc) {
      if (state.phase === PHASE.MENU) mc.classList.remove('hidden');
      else mc.classList.add('hidden');
    }
  }

  function setMergeMode(mode) {
    // 阶段门禁：仅 PREPARE 允许（BATTLE 塔布局冻结，不能改）
    if (state.phase !== PHASE.PREPARE) {
      toast('仅准备阶段可合成/升级/进化', 'er');
      setMsg('合成系统仅在 PREPARE 阶段可用。当前：' + state.phase, true);
      return;
    }
    // 切换到新模式（点击同按钮 = 取消）
    if (state.merge.mode === mode) {
      cancelMerge('已取消');
      return;
    }
    state.merge.mode = mode;
    state.merge.selected = [];
    state.merge.lastPreview = null;
    if (mode !== 'evolve') {
      state.merge.activeRecipeId = null;
    }
    var tips = {
      upgrade: '【A 升级】请点击 2 座「同类型·同稀有度」的非特殊真塔 → 预览弹窗确认。',
      fusion:  '【B 合成】请点击 3 座「不同类型·同稀有度」的非特殊真塔 → 预览弹窗确认（产物为更高稀有度随机类型）。',
      evolve:  '【C 进化】顶部配方条已显示可用进化配方。请点击 3 座符合配方的真塔（部分配方允许特殊塔作为材料）→ 预览弹窗确认。'
    };
    setMsg(tips[mode] || '');
    log('i', '进入合成模式: ' + mode);
    if (mode === 'evolve') {
      // 首次进入进化：若存在可达成配方，则把 ribbon 激活并显示（用户还可在 ribbon 切换）
      detectEvolvable();
      renderEvolveRibbon(true);
      var ribbon = document.getElementById('evolve-ribbon');
      if (ribbon) ribbon.classList.remove('hidden');
    } else {
      var ribbon2 = document.getElementById('evolve-ribbon');
      if (ribbon2 && !state.evolvable.any) ribbon2.classList.add('hidden');
    }
    _refreshMergeButtons();
    draw();
  }

  function cancelMerge(reasonMsg) {
    state.merge.mode = null;
    state.merge.selected = [];
    state.merge.activeRecipeId = null;
    state.merge.lastPreview = null;
    closeMergeModal();
    _refreshMergeButtons();
    // ribbon：无激活进化模式且没有任何可达成配方 → 隐藏
    var ribbon = document.getElementById('evolve-ribbon');
    if (ribbon) {
      if (!state.evolvable.any) ribbon.classList.add('hidden');
      else renderEvolveRibbon(false); // 仍显示，仅恢复到非激活态样式
    }
    setMsg(reasonMsg || '');
    draw();
  }

  // ----- 选塔（toggle）+ 数量达到阈值 → 自动打开预览 modal -----
  function _requiredCountForMode(mode) {
    if (mode === 'upgrade') return 2;
    if (mode === 'fusion')  return 3;
    if (mode === 'evolve')  return 3;
    return 0;
  }

  function toggleSelectTower(gridIdx) {
    if (!state.merge.mode) return;
    if (state.tiles[gridIdx] !== T_TOWER) { toast('只能选择真塔进行合成', 'er'); return; }
    var g = state.grid[gridIdx];
    if (!g || !g.towerCfg) return;
    // 已经选中 → 取消
    var pos = state.merge.selected.indexOf(gridIdx);
    if (pos >= 0) {
      state.merge.selected.splice(pos, 1);
      draw();
      return;
    }
    var req = _requiredCountForMode(state.merge.mode);
    if (state.merge.selected.length >= req) {
      toast('已选满 ' + req + ' 座，请在弹窗确认或取消。', 'info');
      return;
    }
    // 加入选中 → 立刻做部分校验（A/B 禁止 special；若模式不合法立即提示）
    var cfg = g.towerCfg;
    var mm = state.merge.mode;
    if ((mm === 'upgrade' || mm === 'fusion') && cfg.special) {
      toast(mm === 'upgrade' ? '升级模式不支持特殊塔，请走 C 进化合成特殊塔链。' : '合成模式不支持特殊塔，请走 C 进化合成特殊塔链。', 'er');
      return;
    }
    state.merge.selected.push(gridIdx);
    draw();
    // 达到数量 → 校验 + 开预览
    if (state.merge.selected.length === req) {
      var res = validateAndBuildPreview();
      if (!res.ok) {
        toast(res.msg || '选择不符合规则', 'er');
        setMsg(res.msg || '选择不符合规则，请重新选择。错误：' + (res.msg || ''), true);
        log('w', '合成预览校验失败(mode=' + mm + '): ' + (res.msg || ''));
        // 全部清空让玩家重选更简洁
        state.merge.selected = [];
        draw();
        return;
      }
      openMergeModal(res.preview);
    }
  }

  // ----- 三种模式校验 + 构造 preview 对象 -----
  function validateAndBuildPreview() {
    try {
      if (state.merge.mode === 'upgrade') return _validateUpgrade();
      if (state.merge.mode === 'fusion')  return _validateFusion();
      if (state.merge.mode === 'evolve')  return _validateEvolve();
    } catch (e) {
      return { ok: false, msg: '合成校验异常: ' + ((e && e.message) || String(e)) };
    }
    return { ok: false, msg: '未进入合成模式' };
  }

  // A: 2 塔同 cfgId & 同 rarity & !special → 下一稀有度同类型塔
  function _validateUpgrade() {
    var sel = state.merge.selected;
    if (sel.length !== 2) return { ok: false, msg: '升级需要 2 座塔' };
    var a = state.grid[sel[0]], b = state.grid[sel[1]];
    if (!a || !b || !a.towerCfg || !b.towerCfg) return { ok: false, msg: '选中塔数据缺失' };
    if (a.towerCfg.special || b.towerCfg.special) return { ok: false, msg: 'A 升级：不能使用特殊塔（特殊塔仅用于 C 进化）。' };
    if (a.towerCfg.id !== b.towerCfg.id) return { ok: false, msg: 'A 升级：必须是 2 座相同类型的塔（id 相同）。' };
    if (a.rarity !== b.rarity) return { ok: false, msg: 'A 升级：必须同稀有度。' };
    var baseRarity = a.rarity || a.towerCfg.rarity;
    var nextRar = state.cfg.nextRarityUp(baseRarity);
    if (!nextRar) return { ok: false, msg: 'A 升级：当前塔已是传奇，无法再升级。请改用 B/C 合成。' };
    // 产物：towerCfg 不变（同 id），仅把 rarity 提到 nextRar
    var outCfg = Object.assign({}, a.towerCfg, { rarity: nextRar });
    var inputs = sel.map(function (i) { return _buildInputCard(i); });
    return {
      ok: true,
      preview: {
        mode: 'upgrade',
        title: '升级（A 类）确认',
        sub: '同类型 × 2 → 稀有度 +1，塔位置 = 第 2 座素材塔处',
        inputs: inputs,
        outputCard: _buildOutputCardFromCfg(outCfg, { showRarity: true }),
        outputDesc: '产物：' + rarityLabel(nextRar) + ' ' + (outCfg.name || ''),
        placeAt: sel[1],
        // 执行时用到的核心信息
        _exec: {
          kind: 'upgrade',
          materialIdx: [sel[0], sel[1]],
          placeAt: sel[1],
          outputCfgId: a.towerCfg.id,
          outputRarity: nextRar
        }
      }
    };
  }

  // B: 3 塔同 rarity，3 个不同 towerCfgId，!special → 下一稀有度随机非特殊塔（预览只显示稀有度）
  function _validateFusion() {
    var sel = state.merge.selected;
    if (sel.length !== 3) return { ok: false, msg: '合成需要 3 座塔' };
    var ids = {}, rarities = {};
    for (var i = 0; i < sel.length; i++) {
      var g = state.grid[sel[i]];
      if (!g || !g.towerCfg) return { ok: false, msg: '选中塔数据缺失' };
      if (g.towerCfg.special) return { ok: false, msg: 'B 合成：不能使用特殊塔。' };
      ids[g.towerCfg.id] = true;
      rarities[g.rarity || g.towerCfg.rarity] = true;
    }
    if (Object.keys(ids).length !== 3) return { ok: false, msg: 'B 合成：必须 3 座 不同类型 的塔。' };
    var rk = Object.keys(rarities);
    if (rk.length !== 1) return { ok: false, msg: 'B 合成：必须 3 座 同稀有度 的塔。' };
    var baseRar = rk[0];
    var nextRar = state.cfg.nextRarityUp(baseRar);
    if (!nextRar) return { ok: false, msg: 'B 合成：传奇稀有度无法再提升，请改用 C 进化合成传奇特殊塔。' };
    // 预览时就预先 Roll 一个具体塔，供 modal 点击确认时直接使用（保证预览=实际产物，避免玩家"取消重选"刷稀有）
    var preRolled = state.cfg.pickRandomNonSpecialByRarity(nextRar);
    if (!preRolled) return { ok: false, msg: 'B 合成：下一稀有度(' + nextRar + ')无可用塔。' };
    var inputs = sel.map(function (i) { return _buildInputCard(i); });
    return {
      ok: true,
      preview: {
        mode: 'fusion',
        title: '合成（B 类）确认',
        sub: '3 塔不同类型 · 同稀有度 → 下一稀有度随机塔（位置 = 第 3 座素材塔处）',
        inputs: inputs,
        // B 类：按 spec，预览只显示"下一稀有度 XXX"，不展示具体塔名（保持 Roll 感）
        outputCard: _buildOutputCardRarityOnly(nextRar, preRolled),
        outputDesc: '产物稀有度：' + rarityLabel(nextRar) + '（具体塔在确认时随机 Roll，不可撤销）',
        warning: 'B 类合成：确认即锁定随机结果，取消后重选会重新 Roll。',
        placeAt: sel[2],
        _exec: {
          kind: 'fusion',
          materialIdx: [sel[0], sel[1], sel[2]],
          placeAt: sel[2],
          preRolledCfg: preRolled,  // 预览时已 Roll，确认时直接用
          outputRarity: nextRar
        }
      }
    };
  }

  // C: 3 塔 + 某配方 → 产出特殊塔（若 activeRecipeId 不为空则只匹配该配方，否则遍历找第一个匹配）
  function _validateEvolve() {
    var sel = state.merge.selected;
    if (sel.length !== 3) return { ok: false, msg: '进化需要 3 座塔' };
    var recipes = state.cfg.recipes || [];
    if (!recipes.length) return { ok: false, msg: '当前配置无进化配方。' };
    // 构造选中的 cfg 列表（按 gridIdx）
    var selCfgs = [];
    for (var s = 0; s < sel.length; s++) {
      var gg = state.grid[sel[s]];
      if (!gg || !gg.towerCfg) return { ok: false, msg: '选中塔数据缺失' };
      selCfgs.push({ i: sel[s], cfg: gg.towerCfg });
    }
    var tryList = recipes;
    if (state.merge.activeRecipeId) {
      var locked = state.cfg.recipesById && state.cfg.recipesById[state.merge.activeRecipeId];
      if (locked) tryList = [locked];
    }
    var matchedRecipe = null;
    for (var r = 0; r < tryList.length; r++) {
      if (_recipeMatchSelection(tryList[r], selCfgs)) { matchedRecipe = tryList[r]; break; }
    }
    if (!matchedRecipe) return { ok: false, msg: 'C 进化：当前 3 座塔不匹配任何配方。请在顶部配方条查看可用配方。' };
    // 产物：special-towersById 里找 outputTowerId
    var outId = Number(matchedRecipe.OutputTowerId != null ? matchedRecipe.OutputTowerId : matchedRecipe.outputTowerId) || 0;
    var outCfg = (state.cfg.specialTowersById && state.cfg.specialTowersById[outId])
                 || (state.cfg.towersById && state.cfg.towersById[outId]);
    if (!outCfg) return { ok: false, msg: 'C 进化：配方产物塔配置缺失（id=' + outId + '）。请确认特殊塔配置是否加载。' };
    var inputs = sel.map(function (i) { return _buildInputCard(i); });
    return {
      ok: true,
      preview: {
        mode: 'evolve',
        title: '进化（C 类）确认：' + (matchedRecipe.name || matchedRecipe.id || ''),
        sub: (matchedRecipe.note || matchedRecipe.Note || ''),
        inputs: inputs,
        outputCard: _buildOutputCardFromCfg(outCfg, { showRarity: true, showPassive: true }),
        outputDesc: (outCfg.passiveDesc ? ('被动：' + outCfg.passiveDesc) : ('稀有度：' + rarityLabel(outCfg.rarity || matchedRecipe.rarity))),
        placeAt: sel[2],
        recipe: matchedRecipe,
        _exec: {
          kind: 'evolve',
          materialIdx: [sel[0], sel[1], sel[2]],
          placeAt: sel[2],
          outputCfgId: outId,
          outputRarity: outCfg.rarity || matchedRecipe.rarity
        }
      }
    };
  }

  // 判断 recipe 是否匹配一组选中塔（允许任意排列：3! = 6 排列全试）
  function _recipeMatchSelection(recipe, towers) {
    if (!recipe || !recipe.inputs || !towers) return false;
    if (recipe.inputs.length !== towers.length) return false;
    // 额外全局约束预检（避免每个排列都跑一遍重计算）
    // inputSlotsAllDistinctElements: 所有塔元素必须互不相同
    var distinctEl = !!(recipe.inputSlotsAllDistinctElements || recipe.InputSlotsAllDistinctElement);
    if (distinctEl) {
      var seen = {};
      for (var ee = 0; ee < towers.length; ee++) {
        var e1 = (towers[ee].cfg && towers[ee].cfg.element) || '';
        if (!e1 || seen[e1]) return false;
        seen[e1] = true;
      }
    }
    // atLeastOneHasElement: 至少 1 座塔有非空元素
    var atLeastOne = !!(recipe.atLeastOneHasElement || recipe.AtLeastOneHasElement);
    if (atLeastOne) {
      var ok = false;
      for (var ee2 = 0; ee2 < towers.length; ee2++) {
        if (towers[ee2].cfg && (typeof towers[ee2].cfg.element === 'string') && towers[ee2].cfg.element !== '') { ok = true; break; }
      }
      if (!ok) return false;
    }
    // twoEpicsMustDifferElement: 若有 2 座 epic → 这俩元素要不同（RAIGATEKI 专用）
    var twoEpicsDiff = !!(recipe.twoEpicsMustDifferElement || recipe.TwoEpicsMustDifferElement);
    if (twoEpicsDiff) {
      var epics = [];
      for (var ee3 = 0; ee3 < towers.length; ee3++) {
        if (towers[ee3].cfg && (towers[ee3].cfg.rarity || '') === 'epic') epics.push(towers[ee3].cfg.element || '');
      }
      if (epics.length >= 2 && epics[0] === epics[1]) return false;
    }
    // inputsMustBeDifferentTower: grid idx 不同（选中来自不同塔自然满足，但冗余保护）
    var diffTower = !!(recipe.inputsMustBeDifferentTower || recipe.InputsMustBeDifferentTower);
    if (diffTower) {
      var set = {};
      for (var ee4 = 0; ee4 < towers.length; ee4++) {
        if (set[towers[ee4].i]) return false;
        set[towers[ee4].i] = true;
      }
    }
    // 尝试所有排列匹配 slot
    return _permMatch(recipe.inputs.slice(), towers.slice(), 0, recipe);
  }
  function _permMatch(slots, towers, depth, recipeCtx) {
    if (depth >= slots.length) return true;
    for (var i = depth; i < towers.length; i++) {
      if (!_towerMatchesRecipeSlot(towers[i].cfg, slots[depth], recipeCtx, towers[i].gridObj && towers[i].gridObj.rarity)) continue;
      // swap to depth
      var tmp = towers[depth]; towers[depth] = towers[i]; towers[i] = tmp;
      if (_permMatch(slots, towers, depth + 1, recipeCtx)) return true;
      // swap back
      var tmp2 = towers[depth]; towers[depth] = towers[i]; towers[i] = tmp2;
    }
    return false;
  }

  // ----- 素材/产物卡牌 HTML 构造 -----
  function _buildInputCard(gridIdx) {
    var g = state.grid[gridIdx];
    var cfg = g && g.towerCfg;
    if (!cfg) return '';
    var gx = gridIdx % state.cols, gy = Math.floor(gridIdx / state.cols);
    return '<div class="merge-card r-' + (cfg.rarity || 'common') + (cfg.special ? ' spec' : '') + '">'
      + '<div class="mc-swatch" style="background:' + (cfg.color || '#999') + '"></div>'
      + '<div class="mc-name">' + (cfg.special ? '★ ' : '') + (cfg.name || '') + '</div>'
      + '<div class="mc-meta">' + rarityLabel(cfg.rarity) + ' · ' + elementLabel(cfg.element) + '</div>'
      + '<div class="mc-pos">(' + gx + ',' + gy + ')</div>'
      + '</div>';
  }
  function _buildOutputCardFromCfg(cfg, opt) {
    if (!cfg) return '';
    opt = opt || {};
    return '<div class="merge-card out r-' + (cfg.rarity || 'common') + (cfg.special ? ' spec' : '') + '">'
      + '<div class="mc-swatch" style="background:' + (cfg.color || '#999') + '"></div>'
      + '<div class="mc-name">' + (cfg.special ? '★ ' : '') + (cfg.name || '') + '</div>'
      + '<div class="mc-meta">' + rarityLabel(cfg.rarity) + ' · ' + elementLabel(cfg.element) + '</div>'
      + '<div class="mc-stats">'
      +   '伤害 ' + Math.round(cfg.baseDamage || 0) + ' · 范围 ' + (cfg.rangeInCells || 0).toFixed(1) + '格'
      +   ' · 射速 ' + (cfg.attackInterval ? (1 / cfg.attackInterval).toFixed(2) : '?') + '/s'
      +   (cfg.isAOE ? ' · AOE' : '')
      + '</div>'
      + (cfg.special && opt.showPassive && cfg.passiveDesc ? ('<div class="mc-passive">' + cfg.passiveDesc + '</div>') : '')
      + '</div>';
  }
  function _buildOutputCardRarityOnly(rarity, preRolledHintCfg) {
    // B 类：只展示稀有度大字（不展示具体塔名），但内部分配一份预览配色让玩家感受"即将产生的颜色"
    var color = rarityCssColor(rarity);
    var hintName = '';  // 留空：不暴露具体塔名，符合 spec
    // 但加个小提示："下一级稀有度 + 1"
    return '<div class="merge-card out r-' + rarity + '">'
      + '<div class="mc-swatch" style="background:' + color + ';opacity:0.85"></div>'
      + '<div class="mc-name big">' + rarityLabel(rarity) + '</div>'
      + '<div class="mc-meta">（随机 Roll：下一稀有度）</div>'
      + '<div class="mc-stats small">类型随机 · 不可撤销 · 取消后重选会重新 Roll</div>'
      + '</div>';
  }

  // ----- merge modal 显示/关闭/确认 -----
  function openMergeModal(preview) {
    if (!preview) return;
    state.merge.lastPreview = preview;
    var titleEl = document.getElementById('merge-title');
    var subEl   = document.getElementById('merge-sub');
    var inHost  = document.getElementById('merge-inputs');
    var outHost = document.getElementById('merge-output');
    var outDesc = document.getElementById('merge-output-desc');
    var warnEl  = document.getElementById('merge-warning');
    var confirmBtn = document.getElementById('btn-merge-confirm');
    if (titleEl) titleEl.textContent = preview.title || '合成确认';
    if (subEl)   subEl.innerHTML   = preview.sub   || '';
    if (inHost)  inHost.innerHTML  = (preview.inputs || []).join('');
    if (outHost) outHost.innerHTML = preview.outputCard || '';
    if (outDesc) outDesc.innerHTML = preview.outputDesc || '';
    if (warnEl) {
      if (preview.warning) {
        warnEl.textContent = preview.warning;
        warnEl.classList.remove('hidden');
      } else {
        warnEl.textContent = '';
        warnEl.classList.add('hidden');
      }
    }
    if (confirmBtn) {
      confirmBtn.textContent = (preview.mode === 'evolve') ? '确认进化'
                            : (preview.mode === 'fusion') ? '确认合成'
                            : '确认升级';
    }
    document.getElementById('merge-modal').classList.remove('hidden');
  }
  function closeMergeModal() {
    var m = document.getElementById('merge-modal');
    if (m) m.classList.add('hidden');
  }

  // 取消按钮（modal 内）→ 仅清 modal + 清空选中，不退出模式（允许玩家继续重选素材）
  function onMergeModalCancel() {
    closeMergeModal();
    state.merge.selected = [];
    state.merge.lastPreview = null;
    draw();
  }

  // 确认合成：执行改动（删除素材塔 → 在最后一个素材位置生成新塔）
  function onMergeModalConfirm() {
    var pv = state.merge.lastPreview;
    if (!pv || !pv._exec) { closeMergeModal(); return; }
    var ex = pv._exec;
    // 1) 收集要移除的材料塔 & 将要放置的新塔配置
    var removeIdx = (ex.materialIdx || []).slice();
    var placeIdx  = Number(ex.placeAt) | 0;
    if (!removeIdx.length) return;
    // 2) 获取产物 cfg（按合成方式）
    var newCfg = null, newRarity = null;
    if (ex.kind === 'upgrade') {
      newCfg = state.cfg.towersById[Number(ex.outputCfgId)];
      newRarity = ex.outputRarity;
    } else if (ex.kind === 'fusion') {
      newCfg = ex.preRolledCfg || null;
      if (newCfg) newRarity = newCfg.rarity || ex.outputRarity;
    } else if (ex.kind === 'evolve') {
      newCfg = (state.cfg.specialTowersById && state.cfg.specialTowersById[ex.outputCfgId])
            || (state.cfg.towersById && state.cfg.towersById[ex.outputCfgId]);
      newRarity = ex.outputRarity || (newCfg && newCfg.rarity);
    }
    if (!newCfg) { toast('产物配置缺失，已取消', 'er'); closeMergeModal(); return; }

    // 3) 移除材料塔：tile 改为 T_GRASS + grid 清空 + towersByInst 删除
    for (var ri = 0; ri < removeIdx.length; ri++) {
      var rmIdx = removeIdx[ri];
      var old = state.grid[rmIdx];
      if (old && typeof old.instId === 'number' && state.towersByInst[old.instId]) {
        delete state.towersByInst[old.instId];
      }
      state.tiles[rmIdx] = T_GRASS;
      state.grid[rmIdx] = null;
    }

    // 4) 在 placeIdx 放置新塔（直接 T_TOWER；不走 terrainGate：
    //    因为移除 N 座塔后只放 1 座，所有原先不可走格中「N-1 格恢复为可走 + 1 格仍是不可走」，
    //    严格单调改善路径 → 不会封死；若 placeIdx 刚好在 start/end 上，那原来也有塔是合法的所以仍安全。）
    var instId = state.nextInstId++;
    var newGridObj = {
      type: T_TOWER,
      instId: instId,
      towerCfgId: newCfg.id,
      rarity: newRarity || newCfg.rarity,
      towerCfg: newCfg,
      cooldown: 0,
      targetStrategy: TOWER_STRATEGIES.NEAR,
      damageDealt: 0,
      kills: 0,
      energy: 0, skillReady: false, skillActive: false
    };
    // 兼容性：如果 placeIdx 是起点/终点（理论不该出现，之前 gate 阻止过），退回原 placeIdx 所在的第一个材料格
    // 正常情况下保留：placeIdx = 最后一个材料格
    state.tiles[placeIdx] = T_TOWER;
    state.grid[placeIdx] = newGridObj;
    state.towersByInst[instId] = newGridObj;

    // 5) 日志 + toast + 清理合成状态
    var kindLabel = { upgrade: '【A 升级】', fusion: '【B 合成】', evolve: '【C 进化】' }[ex.kind] || '';
    var logMsg = kindLabel + '成功：'
      + '产物 [' + rarityLabel(newRarity || newCfg.rarity) + '] ' + newCfg.name
      + (newCfg.special ? ' (★特殊塔)' : '')
      + '，位于 (' + (placeIdx % state.cols) + ',' + Math.floor(placeIdx / state.cols) + ')'
      + '，消耗 ' + removeIdx.length + ' 座素材塔。';
    log('s', logMsg);
    toast(logMsg, 'ok');

    // 6) 重置合成状态 + 刷新 UI
    closeMergeModal();
    state.merge.mode = null;
    state.merge.selected = [];
    state.merge.lastPreview = null;
    state.merge.activeRecipeId = null;
    // 重跑进化检测（因为场上塔集合发生了变化）
    detectEvolvable();
    renderEvolveRibbon(false);
    _refreshMergeButtons();
    refreshHUD();
    draw();
  }

  // ----- 进化配方检测：哪些配方可实现（用于高亮进化按钮 + ribbon 显示） -----
  function detectEvolvable() {
    var resultIds = [];
    if (state.phase !== PHASE.PREPARE) {
      state.evolvable = { any: false, recipeIds: [] };
      return;
    }
    var towers = _allTrueTowers();
    if (!towers.length) { state.evolvable = { any: false, recipeIds: [] }; return; }
    var recipes = state.cfg.recipes || [];
    for (var r = 0; r < recipes.length; r++) {
      var rec = recipes[r];
      if (!rec || !rec.inputs || !rec.inputs.length) continue;
      // 尝试从 towers 中抽 n 座（n=inputs.length）不重复塔贪心匹配 recipe
      if (_recipeSatisfiableFromPool(rec, towers)) resultIds.push(rec.id);
    }
    state.evolvable = { any: resultIds.length > 0, recipeIds: resultIds };
  }

  // 从池（允许≥配方数量）中抽取不重复的几座来满足配方（用于"是否可达成"预检测）
  function _recipeSatisfiableFromPool(recipe, pool) {
    var need = (recipe.inputs || []).length;
    if (pool.length < need) return false;
    // 与 _recipeMatchSelection 相同：先跑全局约束预检（元素互异等）
    // 注意：预检是基于"最终选中的塔"，而池子里有超过 N 座时不能直接拒绝；因此跳过预检，直接枚举组合。
    // 组合规模小（池通常 ≤ 30 塔、配方 3 座 → 30 choose 3 = 4060），可接受。
    var picks = [];
    return _combine(recipe, pool, 0, picks, 0);
  }
  function _combine(recipe, pool, start, picks, depth) {
    if (depth === (recipe.inputs || []).length) {
      return _recipeMatchSelection(recipe, picks);
    }
    for (var i = start; i < pool.length; i++) {
      picks.push(pool[i]);
      if (_combine(recipe, pool, i + 1, picks, depth + 1)) return true;
      picks.pop();
    }
    return false;
  }

  // ----- 顶部进化 ribbon 渲染 -----
  function renderEvolveRibbon(isEvolveMode) {
    var ribbon = document.getElementById('evolve-ribbon');
    var tabsHost = document.getElementById('evolve-tabs');
    var needHost = document.getElementById('evolve-need');
    if (!ribbon) return;
    // 不处于 PREPARE 直接隐藏
    if (state.phase !== PHASE.PREPARE) { ribbon.classList.add('hidden'); return; }
    var recipes = state.cfg.recipes || [];
    if (!recipes.length) { ribbon.classList.add('hidden'); return; }
    // tab：每个可达成配方高亮为可点击 tab；未达成的也列出来但灰色
    if (tabsHost) {
      tabsHost.innerHTML = '';
      for (var r = 0; r < recipes.length; r++) {
        var rc = recipes[r];
        var achievable = state.evolvable.recipeIds.indexOf(rc.id) >= 0;
        var isActive = (state.merge.activeRecipeId === rc.id)
          || (!state.merge.activeRecipeId && achievable && r === 0 && isEvolveMode);
        if (state.merge.activeRecipeId === rc.id) isActive = true;
        var tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'etab r-' + (rc.rarity || 'common')
          + (achievable ? ' ok' : ' disabled')
          + (isActive ? ' on' : '');
        tab.textContent = (achievable ? '✓ ' : '○ ') + (rc.name || rc.id);
        tab.title = rc.note || '';
        tab.setAttribute('data-recipe', rc.id);
        if (!achievable) {
          tab.setAttribute('aria-disabled', 'true');
          tab.addEventListener('click', function () {
            var rr = this.getAttribute('data-recipe');
            toast('材料不足：' + ((state.cfg.recipesById && state.cfg.recipesById[rr] && state.cfg.recipesById[rr].note) || rr), 'info');
          });
        } else {
          tab.addEventListener('click', function () {
            var rr = this.getAttribute('data-recipe');
            state.merge.activeRecipeId = rr;
            if (!state.merge.mode) setMergeMode('evolve');
            setMsg('已锁定配方：' + ((state.cfg.recipesById && state.cfg.recipesById[rr] && state.cfg.recipesById[rr].name) || rr) + '。请按配方选择 3 座真塔。');
            renderEvolveRibbon(true);
            draw();
          });
        }
        tabsHost.appendChild(tab);
      }
    }
    // need：激活的配方显示"需要 3 个槽 × 条件"
    if (needHost) {
      var rid = state.merge.activeRecipeId || (state.evolvable.recipeIds[0]);
      var rc2 = rid ? (state.cfg.recipesById && state.cfg.recipesById[rid]) : null;
      if (rc2 && rc2.inputs) {
        var html = '<div class="need-title">配方【' + (rc2.name || rc2.id) + '】· 产物：'
          + '<span class="rar-' + (rc2.rarity || 'common') + '">' + rarityLabel(rc2.rarity) + '</span>'
          + '</div><div class="need-slots">';
        for (var ss = 0; ss < rc2.inputs.length; ss++) {
          var sl = rc2.inputs[ss];
          var elReq = (sl.ElementRequired != null) ? String(sl.ElementRequired) : (typeof sl.elementRequired === 'string' ? sl.elementRequired : '');
          var rar = sl.RarityRequired || sl.rarityRequired || '';
          var allowSp = !!(sl.AllowSpecial || sl.allowSpecial);
          html += '<div class="slot s-' + rar + '">'
            + '<span class="n"># ' + (ss + 1) + '</span>'
            + '<span class="r">' + rarityLabel(rar) + '</span>'
            + (elReq ? ('<span class="el">' + elementLabel(elReq) + '</span>') : '<span class="el any">任意元素</span>')
            + (allowSp ? '<span class="sp">含★</span>' : '')
            + '</div>';
        }
        html += '</div><div class="need-note">' + (rc2.note || '') + '</div>';
        needHost.innerHTML = html;
      } else {
        needHost.innerHTML = '<div class="need-empty">暂无激活配方。点击上方 ✓ 配方可锁定并提示所需材料。</div>';
      }
    }
    // 显示策略：进化模式打开，或有可达成配方 → 显示；否则隐藏
    if (isEvolveMode || state.evolvable.any || state.merge.activeRecipeId) {
      ribbon.classList.remove('hidden');
    } else if (!state.evolvable.any && !isEvolveMode) {
      ribbon.classList.add('hidden');
    }
  }

  // ---------- Waveend modal ----------
  function showWaveendModal() {
    state.phase = PHASE.WAVEEND;
    // V4-6 T12：若玩家在波末切换时处于「商店塔」放置中未落地 → 退金 + 取消
    cancelShopTowerMode();
    // V4-6 T12：每波结算 Buff 抽卡次数重置
    state.buffRollsLeft = Number(state.cfg && state.cfg.buffRollsPerWave) || 5;
    // 顶部 summary + DPS 榜
    _refreshWaveendSummary();
    renderDpsBoardHTML(state.waveDamageStats, 'waveend-dps-board');
    // Tab: 默认 Buff 面板
    activateWeTab('buff');
    // 1. 运气面板（初始渲染，升运气 tab 切到可见）
    renderLuckPanel();
    // 2. Buff Tab：价格 + 剩余次数 + 列表（空时提示）
    var buffCostEl = document.getElementById('buff-roll-cost');
    if (buffCostEl) buffCostEl.textContent = String(state.cfg.buffRollCostGold || 40);
    var buffLeftEl = document.getElementById('buff-roll-left');
    if (buffLeftEl) buffLeftEl.textContent = String(state.buffRollsLeft);
    var buffMaxEl = document.getElementById('buff-roll-max');
    if (buffMaxEl) buffMaxEl.textContent = String(state.cfg.buffRollsPerWave || 5);
    var subEl = document.getElementById('we-tab-buff-sub');
    if (subEl) subEl.textContent = state.buffRollsLeft + '/' + (state.cfg.buffRollsPerWave || 5);
    var resultEl = document.getElementById('buff-roll-result');
    if (resultEl) resultEl.textContent = '';
    renderActiveBuffsList();
    // 3. 商店塔 Tab：显示价格 + 按钮状态重置
    var shopCost = document.getElementById('shop-tower-cost');
    if (shopCost) shopCost.textContent = String(state.cfg.shopTowerCostGold || 120);
    var shopStatus = document.getElementById('shop-tower-status');
    if (shopStatus) shopStatus.textContent = '点击按钮后进入放置模式，点击画布上的空地即可落塔（跳过候选/保留，直接落地生效）。';
    var shopBtn = document.getElementById('btn-shop-tower');
    if (shopBtn) {
      shopBtn.disabled = state.gold < (state.cfg.shopTowerCostGold || 120);
    }
    // 4. 预览 Tab：下一波配置表
    renderPreviewTable();
    // 下一波按钮文字
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
    // V3-5 本地波末 autosave（独立于账号，LOSE 后可"恢复到最近波末"继续玩）
    _writeLocalWaveendAutosave();
    // V3-1 云端 autosave（已登录时）
    autoSaveIfLoggedIn('waveend');
  }
  function hideWaveendModal() {
    document.getElementById('waveend-modal').classList.add('hidden');
  }

  // ========= V4-6 T13: 天赋树 =========
  function renderTalentTree() {
    var host = document.getElementById('talent-grid-host');
    if (!host) return;
    host.innerHTML = '';
    var set = state.talentNodesActive || {};
    var total = TALENT_DEFS.length;
    var activatedCount = 0;
    for (var k in set) { if (set[k] && talentDefById(k)) activatedCount++; }
    var ptsEl = document.getElementById('talent-points-big');
    if (ptsEl) ptsEl.textContent = '剩余点数：' + (Number(state.talentPointsAvailable) || 0);
    var cntEl = document.getElementById('talent-activated-count');
    if (cntEl) cntEl.textContent = '已激活 ' + activatedCount + ' / ' + total + ' 个天赋';
    var briefEl = document.getElementById('talent-activated-brief');
    if (briefEl) {
      var tm = calcTalentMul();
      var parts = [];
      if (tm.towerDamageMulAll !== 1)          parts.push('伤害 ' + tm.towerDamageMulAll.toFixed(2) + '×');
      if (tm.towerAttackIntervalMulAll !== 1)  parts.push('攻速 ' + (1/tm.towerAttackIntervalMulAll).toFixed(2) + '×');
      if (tm.towerRangeMulAll !== 1)           parts.push('射程 ' + tm.towerRangeMulAll.toFixed(2) + '×');
      if (tm.killGoldMulAll !== 1)             parts.push('金币收益 ' + tm.killGoldMulAll.toFixed(2) + '×');
      if (tm.startGoldBonus > 0)                parts.push('开局金币 +' + tm.startGoldBonus);
      if (tm.baseMaxHPBonus > 0)                parts.push('基地 HP +' + tm.baseMaxHPBonus);
      if (tm.startLuckLevelBonus > 0)           parts.push('初始运气 Lv +' + tm.startLuckLevelBonus);
      if (tm.critRateBonus > 0)                 parts.push('暴击率 +' + Math.round(tm.critRateBonus*100) + '%');
      briefEl.textContent = '效果概览：' + (parts.length ? parts.join('，') : '无');
    }
    // 按 row 行分组（3 行 × 5 列），但 CSS 已经 grid 自动布局。每个节点建 div：
    for (var i = 0; i < TALENT_DEFS.length; i++) {
      var def = TALENT_DEFS[i];
      var div = document.createElement('div');
      var active = !!set[def.id];
      var unLock = talentCanUnlock(def);
      var cls = 'talent-node';
      if (active) cls += ' activated';
      else if (unLock.ok) cls += ' unlockable';
      else if (unLock.reason.indexOf('激活') !== 0 && unLock.reason.indexOf('已激活') !== 0) cls += ' locked';
      // 不满足前置时也显示 locked 样式，但需要区分"点不够"和"未前置"：都 locked
      if (!active && !unLock.ok) cls += ' locked';  // 覆盖已有的 unlockable（点不够但前置满足时，unlockable 和 locked 冲突；直接 locked 即可）
      div.className = cls;
      div.setAttribute('data-tid', def.id);
      div.setAttribute('title', unLock.ok ? ('点击解锁，消耗 ' + def.cost + ' 天赋点') : unLock.reason);
      // 前置红点：未激活前置时显示 require label
      var reqLabel = '';
      if (!active && !unLock.ok && unLock.reason.indexOf('激活') === 0) {
        // 提取第一个 require
        var firstReq = (def.requires && def.requires[0]) ? talentDefById(def.requires[0]) : null;
        reqLabel = '<span class="tn-require">需要' + (firstReq ? firstReq.name : '前置') + '</span>';
      }
      div.innerHTML = reqLabel
        + '<div class="tn-icon">' + (def.icon || '✨') + '</div>'
        + '<div class="tn-name">' + def.name + '</div>'
        + '<div class="tn-desc">' + def.desc + '</div>'
        + '<span class="tn-cost">' + (active ? '已激活' : (def.cost + ' 点')) + '</span>';
      div.addEventListener('click', function (ev) {
        var cur = ev && ev.currentTarget;
        if (!cur) return;
        var id = cur.getAttribute('data-tid');
        if (!id) return;
        var r = talentUnlock(id);
        if (!r.ok) { toast(r.reason || '无法激活天赋', 'warn'); return; }
        var name = (talentDefById(id) && talentDefById(id).name) || id;
        toast('✔ 天赋激活：' + name, 'ok');
        renderTalentTree();
      });
      host.appendChild(div);
    }
  }
  function openTalentModal() {
    // 先刷新一下（合并最新 account）
    try { mergeTalents(); } catch (e) {}
    var m = document.getElementById('talent-modal');
    if (m) m.classList.remove('hidden');
    renderTalentTree();
  }
  function closeTalentModal() {
    var m = document.getElementById('talent-modal');
    if (m) m.classList.add('hidden');
  }
  // 绑定天赋按钮（在 init 最后）
  function bindTalentButtons() {
    var openBtn = document.getElementById('btn-talents');
    if (openBtn) openBtn.addEventListener('click', openTalentModal);
    var closeBtn = document.getElementById('talent-close');
    if (closeBtn) closeBtn.addEventListener('click', closeTalentModal);
    var resetBtn = document.getElementById('talent-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        if (!state.talentNodesList.length) { toast('当前未激活任何天赋', 'info'); return; }
        var ok = window.confirm('确定清空全部已激活天赋？天赋点不会返还（用于防止反复刷点）。');
        if (!ok) return;
        talentResetAll(false);
        renderTalentTree();
        toast('已清空，下次建议谨慎加点~', 'info');
      });
    }
    var modal = document.getElementById('talent-modal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target && e.target.id === 'talent-modal') closeTalentModal();
      });
    }
  }

  // ========= V4-6 T14: 排行榜 =========
  var _LB_LAST = { mapId: 1, difficulty: 'normal' };
  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function _fmtLBDate(ms) {
    if (!ms) return '—';
    var d = new Date(Number(ms));
    if (isNaN(d.getTime())) return '—';
    function p2(n){ return (n<10?'0':'')+n; }
    return d.getFullYear() + '-' + p2(d.getMonth()+1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  function renderLeaderboardRows(rows) {
    var table = document.getElementById('lb-table');
    var empty = document.getElementById('lb-empty');
    var tbody = document.getElementById('lb-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!rows || !rows.length) {
      if (table) table.style.display = 'none';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (table) table.style.display = '';
    if (empty) empty.style.display = 'none';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var rank = r.rank || (i+1);
      var rankClass = 'rN';
      if (rank === 1) rankClass = 'r1';
      else if (rank === 2) rankClass = 'r2';
      else if (rank === 3) rankClass = 'r3';
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><span class="lb-rank ' + rankClass + '">' + rank + '</span></td>' +
        '<td><span class="lb-username ' + (r.guest ? 'guest' : '') + '">' + escapeHTML(String(r.username || ('#'+r.uid))) + '</span></td>' +
        '<td><b>第 ' + r.waveIndex + ' 波</b></td>' +
        '<td>' + Number(r.gold||0) + ' 💰</td>' +
        '<td>' + Number(r.baseHP||0) + '/' + Number(r.baseMaxHP||0) + '</td>' +
        '<td>Lv.' + Number(r.luckLevel||1) + '</td>' +
        '<td style="color:#64748b; font-size:12px;">' + _fmtLBDate(r.updatedAtMs) + '</td>';
      tbody.appendChild(tr);
    }
  }
  function fetchLeaderboard(mapId, difficulty) {
    var mid = Number(mapId) || 1;
    var d = String(difficulty || 'normal');
    _LB_LAST.mapId = mid; _LB_LAST.difficulty = d;
    var tip = document.getElementById('lb-query-tip');
    if (tip) tip.textContent = '查询中…';
    var empty = document.getElementById('lb-empty');
    if (empty) empty.style.display = 'block';
    var tbl = document.getElementById('lb-table');
    var tb = document.getElementById('lb-tbody');
    if (tbl) tbl.style.display = 'none';
    if (tb) tb.innerHTML = '';
    var url = '/api/td/leaderboard?mapId=' + encodeURIComponent(mid) + '&difficulty=' + encodeURIComponent(d) + '&k=10';
    fetch(url, { method: 'GET', credentials: 'same-origin' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var ok = !!(data && data.ok);
        var rows = (data && data.rows) ? data.rows : [];
        var mapName = ({1:'🌿 草原',2:'🌋 熔岩',3:'❄ 冰霜'})[mid] || ('Map#'+mid);
        var diffName = ({normal:'普通',hard:'困难',nightmare:'噩梦'})[d] || d;
        if (tip) tip.textContent = mapName + ' · ' + diffName + ' Top 10' + (ok ? '' : '（查询失败）');
        renderLeaderboardRows(rows);
      })
      .catch(function (e) {
        if (tip) tip.textContent = '查询失败：' + String(e && e.message || e);
        // 兜底：显示空
        renderLeaderboardRows([]);
      });
  }
  function openLeaderboard() {
    var m = document.getElementById('leaderboard-modal');
    if (m) m.classList.remove('hidden');
    fetchLeaderboard(_LB_LAST.mapId, _LB_LAST.difficulty);
  }
  function closeLeaderboard() {
    var m = document.getElementById('leaderboard-modal');
    if (m) m.classList.add('hidden');
  }
  function bindLeaderboardTabs() {
    // Map tabs
    var mapTabs = document.querySelectorAll('#lb-map-tabs .lb-map');
    for (var i = 0; i < mapTabs.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          for (var j = 0; j < mapTabs.length; j++) mapTabs[j].classList.remove('active');
          btn.classList.add('active');
          var mid = Number(btn.getAttribute('data-map')) || 1;
          fetchLeaderboard(mid, _LB_LAST.difficulty);
        });
      })(mapTabs[i]);
    }
    var diffTabs = document.querySelectorAll('#lb-diff-tabs .lb-diff');
    for (var i2 = 0; i2 < diffTabs.length; i2++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          for (var j = 0; j < diffTabs.length; j++) diffTabs[j].classList.remove('active');
          btn.classList.add('active');
          var d = btn.getAttribute('data-diff') || 'normal';
          fetchLeaderboard(_LB_LAST.mapId, d);
        });
      })(diffTabs[i2]);
    }
  }
  function bindLeaderboardButtons() {
    var openBtn = document.getElementById('btn-leaderboard');
    if (openBtn) openBtn.addEventListener('click', openLeaderboard);
    var closeBtn = document.getElementById('lb-close');
    if (closeBtn) closeBtn.addEventListener('click', closeLeaderboard);
    var refBtn = document.getElementById('lb-refresh');
    if (refBtn) refBtn.addEventListener('click', function () { fetchLeaderboard(_LB_LAST.mapId, _LB_LAST.difficulty); toast('排行榜已刷新', 'info'); });
    var modal = document.getElementById('leaderboard-modal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target && e.target.id === 'leaderboard-modal') closeLeaderboard();
      });
    }
    bindLeaderboardTabs();
  }

  function _refreshWaveendSummary() {
    var reward = currentWaveCfg() ? (currentWaveCfg().rewardGold || 0) : 0;
    var html = '第 <b>' + state.waveIndex + '</b> / ' + state.maxWaves + ' 波完成。<br>'
      + '击杀金币 <b>' + state.waveKillGold + '</b>；奖励稀有度 Roll <b>' + state.waveBonusGold + '</b>；波次奖励 <b>' + reward + '</b>。<br>'
      + '当前金币：<b>' + state.gold + '</b>；生命：<b>' + state.baseHP + '/' + state.baseMaxHP + '</b>；运气等级：<b>' + state.luckLevel + '</b>；已激活 Buff <b>' + state.activeBuffs.length + '</b> 条。'
      + (state.shopTowerMode ? '<br><span class="chip" style="margin-top:4px;display:inline-block;background:#1d4ed8;color:#dbeafe;padding:1px 8px;border-radius:999px;font-size:11px;">🏪 放置模式：请在画布空地点击落塔（点击遮罩外任意处/ESC 取消退金）</span>' : '');
    var s = document.getElementById('waveend-summary');
    if (s) s.innerHTML = html;
  }

  // ========= V4-6 T12: WAVEEND 4 Tab 切换 =========
  function activateWeTab(name) {
    var bar = document.querySelector('#waveend-modal .we-tab-bar');
    if (!bar) return;
    var tabs = bar.querySelectorAll('.we-tab');
    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i];
      var t = tab.getAttribute('data-we-tab') || '';
      tab.classList.toggle('active', t === name);
    }
    var panels = document.querySelectorAll('#waveend-modal .we-tab-panel');
    for (var j = 0; j < panels.length; j++) {
      var p = panels[j];
      var pn = p.getAttribute('data-we-panel') || '';
      p.classList.toggle('hidden', pn !== name);
    }
    // TAB-specific side effects
    if (name === 'luck') renderLuckPanel();
    if (name === 'preview') renderPreviewTable();
    if (name === 'buff') renderActiveBuffsList();
    if (name === 'shop') {
      var btn = document.getElementById('btn-shop-tower');
      if (btn) btn.disabled = state.gold < (state.cfg.shopTowerCostGold || 120);
    }
  }

  function renderActiveBuffsList() {
    var host = document.getElementById('buff-list-active');
    if (!host) return;
    host.innerHTML = '';
    if (!state.activeBuffs.length) {
      var empt = document.createElement('div');
      empt.className = 'buff-empty';
      empt.textContent = '（尚无激活 Buff，可在顶部抽 Buff Roll 获得）';
      host.appendChild(empt);
      return;
    }
    for (var i = 0; i < state.activeBuffs.length; i++) {
      var b = state.activeBuffs[i];
      var r = (b && b.rarity) || 'common';
      var row = document.createElement('div');
      row.className = 'bi ' + r;
      var effArr = [];
      var eff = (b && b.effect) || {};
      if (eff.towerDamageMulAll != null && Number(eff.towerDamageMulAll) !== 1) effArr.push('伤×' + Number(eff.towerDamageMulAll).toFixed(2));
      if (eff.towerAttackIntervalMulAll != null && Number(eff.towerAttackIntervalMulAll) !== 1) effArr.push('攻速×' + (1/Number(eff.towerAttackIntervalMulAll)).toFixed(2));
      if (eff.towerRangeMulAll != null && Number(eff.towerRangeMulAll) !== 1) effArr.push('射程×' + Number(eff.towerRangeMulAll).toFixed(2));
      if (eff.killGoldMulAll != null && Number(eff.killGoldMulAll) !== 1) effArr.push('金×' + Number(eff.killGoldMulAll).toFixed(2));
      if (eff.slowStrengthMulAll != null && Number(eff.slowStrengthMulAll) !== 1) effArr.push('减速×' + Number(eff.slowStrengthMulAll).toFixed(2));
      if (eff.killBonusGoldChanceAddAll) effArr.push('+奖励率 ' + (Math.round(Number(eff.killBonusGoldChanceAddAll)*100)) + '%');
      row.innerHTML = '<span class="n">[' + rarityLabel(r) + '] ' + (b && b.name ? b.name : (b && b.id || 'Buff')) + '</span><span class="r">' + effArr.join(' / ') + '</span>';
      host.appendChild(row);
    }
  }

  function renderPreviewTable() {
    var host = document.getElementById('preview-table-host');
    if (!host) return;
    host.innerHTML = '';
    var noW = document.getElementById('preview-wave-no');
    var nextIdx = state.waveIndex + 1;
    if (noW) noW.textContent = state.waveIndex >= state.maxWaves ? '（通关，无下一波）' : String(nextIdx);
    if (state.waveIndex >= state.maxWaves) {
      host.innerHTML = '<div class="preview-empty">通关，无后续波次 🎉</div>';
      return;
    }
    var waves = state.cfg.waves || [];
    var w = (nextIdx >= 1 && nextIdx <= waves.length) ? waves[nextIdx - 1] : null;
    if (!w || !w.groups || !w.groups.length) {
      host.innerHTML = '<div class="preview-empty">下一波配置为空</div>';
      return;
    }
    var en = state.cfg.enemiesById || {};
    var html = '<table class="preview-tb"><thead><tr><th>组</th><th>敌人</th><th>数量</th><th>出现延迟</th><th>同组间隔</th></tr></thead><tbody>';
    for (var gi = 0; gi < w.groups.length; gi++) {
      var g = w.groups[gi];
      var eid = String(g.enemyId);
      var ecfg = en[eid];
      var eName = ecfg ? (ecfg.name || 'enemy#' + eid) : ('enemy#' + eid);
      var r = (ecfg && ecfg.rarity) || 'common';
      html += '<tr>'
        + '<td class="gname">第' + (gi + 1) + '组</td>'
        + '<td class="gname"><span class="rar rar-' + r + '">[' + rarityLabel(r) + ']</span> ' + eName + '</td>'
        + '<td class="count">' + (g.count || 0) + '</td>'
        + '<td class="delay">' + (g.startDelaySec != null ? Number(g.startDelaySec).toFixed(1) + 's' : '—') + '</td>'
        + '<td class="interv">' + (g.intervalSec != null ? Number(g.intervalSec).toFixed(2) + 's' : '—') + '</td>'
        + '</tr>';
    }
    html += '</tbody></table>';
    if (w.rewardGold) {
      html += '<div class="hint small" style="color:#94a3b8; padding:8px 2px 0;">通关奖励：<b style="color:#fbbf24;">+' + w.rewardGold + '</b> 金</div>';
    }
    host.innerHTML = html;
  }

  // ========= V4-6 T12: 商店塔（WAVEEND 直接购买落地） =========
  function startShopTowerMode() {
    if (state.phase !== PHASE.WAVEEND) { setMsg('只能在波次结算阶段购买塔', true); return; }
    if (state.shopTowerMode) { setMsg('已处于购买放置模式，请先在画布点空地放置或取消', true); return; }
    var cost = Number(state.cfg && state.cfg.shopTowerCostGold) || 120;
    if (state.gold < cost) { setMsg('金币不足，购买塔需 ' + cost + ' 金', true); return; }
    if (!state.cfg || typeof state.cfg.rollTowerByLuck !== 'function') { setMsg('塔配置未就绪', true); return; }
    var towerCfg = state.cfg.rollTowerByLuck(state.luckLevel, { skipSpecial: true });
    if (!towerCfg) { setMsg('塔池为空', true); return; }
    // 扣金 + 进入放置模式
    state.gold -= cost;
    state.shopTowerMode = true;
    state.shopTowerPending = towerCfg;
    state.shopTowerPaidGold = cost;
    setMsg('请点击画布空地放置 🏪 [' + rarityLabel(towerCfg.rarity || 'common') + '] ' + (towerCfg.name || towerCfg.id) + '（ESC/点击遮罩外任意处取消 → 退 ' + cost + ' 金）', false);
    toast('购买成功：[' + rarityLabel(towerCfg.rarity || 'common') + '] ' + (towerCfg.name || towerCfg.id) + '，请在空地落塔', 'info');
    log('i', '[SHOP-TOWER]  Roll 到 ' + (towerCfg.id || towerCfg.name) + ' (rarity=' + (towerCfg.rarity || '?') + ')，等待空地放置（已扣 ' + cost + ' 金）');
    var st = document.getElementById('shop-tower-status');
    if (st) st.innerHTML = '<span style="color:#7dd3fc;">放置中：<b>[' + rarityLabel(towerCfg.rarity || 'common') + '] ' + (towerCfg.name || towerCfg.id) + '</b>。点击画布空地落地；<a id="shop-tower-cancel" href="javascript:;" style="color:#f87171;text-decoration:underline;margin-left:4px;">取消购买（退金）</a></span>';
    var ca = document.getElementById('shop-tower-cancel');
    if (ca) ca.addEventListener('click', function (e) { e.preventDefault(); cancelShopTowerMode(); });
    var shopBtn = document.getElementById('btn-shop-tower');
    if (shopBtn) shopBtn.disabled = true;
    _refreshWaveendSummary();
    refreshHUD();
    draw();
  }
  function cancelShopTowerMode() {
    if (!state.shopTowerMode) return;
    var cost = state.shopTowerPaidGold || 0;
    if (cost > 0) {
      state.gold += cost;
      log('i', '[SHOP-TOWER] 取消，退 ' + cost + ' 金');
    }
    state.shopTowerMode = false;
    state.shopTowerPending = null;
    state.shopTowerPaidGold = 0;
    var st = document.getElementById('shop-tower-status');
    if (st) st.textContent = '点击按钮后进入放置模式，点击画布上的空地即可落塔（跳过候选/保留，直接落地生效）。';
    var shopBtn = document.getElementById('btn-shop-tower');
    if (shopBtn) shopBtn.disabled = state.gold < (Number(state.cfg && state.cfg.shopTowerCostGold) || 120);
    _refreshWaveendSummary();
    refreshHUD();
    draw();
  }
  function placeShopTowerAt(gx, gy) {
    if (state.phase !== PHASE.WAVEEND || !state.shopTowerMode || !state.shopTowerPending) return false;
    if (gx < 0 || gy < 0 || gx >= state.cols || gy >= state.rows) return false;
    var tIdx = idx(gx, gy);
    if (state.tiles[tIdx] !== T_EMPTY || state.grid[tIdx] != null) { setMsg('此处非空地，无法放置', true); return false; }
    var towerCfg = state.shopTowerPending;
    var cost = state.shopTowerPaidGold || 0;
    var instId = 'shop_' + state.nextInstId++;
    state.grid[tIdx] = {
      type: 3, // T_TOWER
      towerCfg: towerCfg,
      towerId: towerCfg.id,
      towerInstanceId: instId,
      rarity: (towerCfg.rarity || 'common'),
      level: 0,
      rollEffect: null,
      damageDealt: 0,
      kills: 0,
      targetStrategy: 0,
      energy: 0, skillReady: false, skillActive: false
    };
    state.towersByInst[instId] = {
      instId: instId,
      gridIdx: tIdx,
      cfg: towerCfg,
      cooldown: 0,
      gx: gx, gy: gy
    };
    // 路径封路检测：通过 placeCandidate 的逻辑类似
    var gateRes = terrainGate(state.tiles, state.cols, state.rows);
    if (!gateRes.ok) {
      // 回滚
      state.grid[tIdx] = null;
      delete state.towersByInst[instId];
      setMsg('放置失败：会封死敌人路径（' + (gateRes.msg || '路径不通') + '）', true);
      toast('封路拒绝：请另选空地', 'er');
      return false;
    }
    // 放置成功
    log('s', '[SHOP-TOWER] ' + (towerCfg.name || towerCfg.id) + ' 落地 (' + gx + ',' + gy + ')');
    toast('商店塔落地：[' + rarityLabel(towerCfg.rarity || 'common') + '] ' + (towerCfg.name || towerCfg.id), 'ok');
    state.shopTowerMode = false;
    state.shopTowerPending = null;
    state.shopTowerPaidGold = 0;
    var st = document.getElementById('shop-tower-status');
    if (st) st.innerHTML = '<span style="color:#a7f3d0;">✓ 已落地 [' + rarityLabel(towerCfg.rarity || 'common') + '] ' + (towerCfg.name || towerCfg.id) + '。可继续购买。</span>';
    var shopBtn = document.getElementById('btn-shop-tower');
    if (shopBtn) shopBtn.disabled = state.gold < (Number(state.cfg && state.cfg.shopTowerCostGold) || 120);
    // 本波购买累计：金币 - 塔数 HUD 已实时
    _refreshWaveendSummary();
    renderPreviewTable();
    refreshHUD();
    draw();
    return true;
  }

  function renderLuckPanel() {
    var host = document.getElementById('luck-panel');
    if (!host) return;
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
    // V4-6 T12：升运气后 Buff 按钮/Buff 剩余次数可能因金币变化需要重置按钮 disabled
    var brBtn = document.getElementById('btn-roll-buff');
    if (brBtn) brBtn.disabled = state.gold < (state.cfg.buffRollCostGold || 40) || state.buffRollsLeft <= 0;
    var shopBtn = document.getElementById('btn-shop-tower');
    if (shopBtn && !state.shopTowerMode) shopBtn.disabled = state.gold < (state.cfg.shopTowerCostGold || 120);
    _refreshWaveendSummary();
  }

  function rollOneBuff() {
    if (state.buffRollsLeft <= 0) { setMsg('本波 Buff 抽取次数已用完', true); return; }
    var cost = Number(state.cfg.buffRollCostGold) || 40;
    if (state.gold < cost) { setMsg('金币不足抽 Buff', true); return; }
    var b = state.cfg.rollBuffByLuck(state.luckLevel);
    if (!b) { setMsg('Buff 配置为空', true); return; }
    state.gold -= cost;
    state.buffRollsLeft -= 1;
    state.activeBuffs.push({ id: b.id, name: b.name, rarity: b.rarity, effect: b.effect });
    log('s', '抽 Buff：[' + rarityLabel(b.rarity) + '] ' + b.name + '（花 ' + cost + ' 金币，剩余 ' + state.buffRollsLeft + ' 次）');
    var rr = document.getElementById('buff-roll-result');
    if (rr) rr.innerHTML = '获得 <span class="hit">[' + rarityLabel(b.rarity) + '] ' + b.name + '</span>';
    var bl = document.getElementById('buff-roll-left');
    if (bl) bl.textContent = String(state.buffRollsLeft);
    var sub = document.getElementById('we-tab-buff-sub');
    if (sub) sub.textContent = state.buffRollsLeft + '/' + (state.cfg.buffRollsPerWave || 5);
    var brBtn = document.getElementById('btn-roll-buff');
    if (brBtn) brBtn.disabled = state.gold < cost || state.buffRollsLeft <= 0;
    refreshHUD();
    renderLuckPanel();
    renderActiveBuffsList();
    var shopBtn = document.getElementById('btn-shop-tower');
    if (shopBtn && !state.shopTowerMode) shopBtn.disabled = state.gold < (state.cfg.shopTowerCostGold || 120);
    _refreshWaveendSummary();
  }

  function closeWaveendGoNextOrWin() {
    // 若还在商店塔放置模式 → 先取消（退金）再进入下一波
    cancelShopTowerMode();
    hideWaveendModal();
    if (state.waveIndex >= state.maxWaves) {
      // WIN
      state.phase = PHASE.WIN;
      // V4-2 Task 5：WIN 解锁下一张地图
      var unlockResB = tryUnlockNextMap(state.mapId, 'WIN_WAVEEND');
      var unlockHTMLB = '';
      if (unlockResB && unlockResB.nextId) unlockHTMLB = (unlockResB.already ? '<br>（地图 ' + unlockResB.nextId + ' 已解锁）' : '<br>🎁 新地图解锁：Map ' + unlockResB.nextId);
      document.getElementById('end-title').textContent = '通关胜利！';
      document.getElementById('end-summary').innerHTML =
        '击败 <b>' + state.maxWaves + '</b> 波全部敌人。<br>' +
        '剩余金币 <b>' + state.gold + '</b>；剩余生命 <b>' + state.baseHP + '</b>；运气 <b>Lv.' + state.luckLevel + '</b>；Buff <b>' + state.activeBuffs.length + '</b> 条。' + unlockHTMLB;
      // DPS 榜（结局弹框中展示：使用上一波快照）
      renderDpsBoardHTML(state.waveDamageStats, 'end-dps-board');
      // V3-5 刷新 autosave UI（WIN 不显示恢复按钮，但显示提示）
      refreshEndAutosaveUI('win');
      document.getElementById('end-modal').classList.remove('hidden');
      state.running = false;
      log('s', '★ 通关胜利！');
      refreshHUD(); draw();
      // V3-1 云端 autosave（已登录时）
      autoSaveIfLoggedIn('win');
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
    // V4-1: 正式开始第一波 PREPARE → 锁定难度（之后 Tab 再点也不改 difficultyMul）
    if (state.waveIndex >= 1) state.difficultyLocked = true;
    var w = currentWaveCfg();
    state.placementTotal = (w && typeof w.placementPerWave === 'number') ? w.placementPerWave : 5;
    state.placementUsed = 0;
    state.phase = PHASE.PREPARE;
    // V4-1: 难度 baseHP 生效（Task 2）：保证开局/每波 PREPARE 入口后 baseMaxHP 就是本难度的配置值
    //   若 baseHP 仍等于上一个 baseMaxHP（没掉过血 / 重置后满血）→ 同步 baseHP，避免"困难基地15血但 HUD 仍显示 20/20"的显示残差
    var oldMax = Number(state.baseMaxHP) || 0;
    var tMulBaseHP = (Number(calcTalentMul().baseMaxHPBonus) || 0);
    state.baseMaxHP = (Number(state.difficultyMul.baseMaxHP) || 20) + tMulBaseHP;
    if (oldMax === 0 || state.baseHP >= oldMax) {
      state.baseHP = state.baseMaxHP;
    } else if (state.baseHP > state.baseMaxHP) {
      // 例如困难→噩梦切换（实际 PREPARE 时已锁定，不会发生）兜底
      state.baseHP = state.baseMaxHP;
    }
    // Guarantee the RAF render loop is live for the coming placement + battle phases.
    // This recovers from any earlier code path (e.g. resetLevelState on logout) that
    // had cancelled the RAF chain or set state.running=false, fixing the "first time
    // no monsters appear until 重开" bug when RAF was dead before PREPARE.
    ensureRenderLoop();
    // DPS 统计：波初清零所有塔的「本波伤害/击杀」（战斗统计只在本波内累计）
    resetTowerWaveStats();
    var isBoss = !!(w && w.isBossWave);
    if (!isBoss) isBoss = (state.waveIndex === 3 || state.waveIndex === 6 || state.waveIndex === 8);
    var bossTag = isBoss ? '【★BOSS 波】' : '';
    setMsg(bossTag + '第 ' + state.waveIndex + ' 波 准备阶段：剩余 ' + state.placementTotal + ' 次放置机会。点击空地 Roll 塔。');
    log(isBoss ? 'w' : 'i', bossTag + '进入第 ' + state.waveIndex + ' 波（放置 ' + state.placementTotal + ' 次）');
    // v4: 进化配方检测 + 进化 ribbon 刷新 + 按钮高光（每波 PREPARE 入场必做一次，保证显示与场上塔集合一致）
    detectEvolvable();
    renderEvolveRibbon(false);
    _refreshMergeButtons();
    refreshHUD(); draw();
  }

  // ---------- DPS 统计工具 ----------
  // 实时计算：所有真塔 × 当前 buff 的 DPS 总合（用于 HUD / 塔信息弹框 / 榜汇总）
  function computeLiveTotals() {
    var mul = currentBuffMul();
    var totalDps = 0;
    var waveDmg = 0;
    var waveKills = 0;
    if (state.grid) {
      for (var i = 0; i < state.grid.length; i++) {
        if (state.tiles[i] !== T_TOWER) continue;
        var g = state.grid[i];
        if (!g || !g.towerCfg) continue;
        var tev = calcTowerEffective(g.towerCfg, mul, g);
        if (tev && tev.dps > 0) totalDps += tev.dps;
        waveDmg += Number(g.damageDealt) || 0;
        waveKills += Number(g.kills) || 0;
      }
    }
    return {
      totalDps: totalDps,
      waveDamage: waveDmg,
      waveKills: waveKills,
      totalKillsAllWaves: Number(state.totalKillsAllWaves) || 0
    };
  }
  // 波初重置：把所有塔（T_TOWER，不包括候选/墙）的本波伤害/击杀清零
  function resetTowerWaveStats() {
    if (!state.grid) return;
    for (var i = 0; i < state.grid.length; i++) {
      var g = state.grid[i];
      if (!g) continue;
      if (state.tiles[i] !== T_TOWER) continue;
      g.damageDealt = 0;
      g.kills = 0;
    }
  }
  // 战斗结束时快照：保存到 state.waveDamageStats，供结算页面或结算后点塔时作为上波数据参考
  function snapshotTowerWaveStats() {
    var list = [];
    var waveKills = 0;
    for (var i = 0; i < state.grid.length; i++) {
      if (state.tiles[i] !== T_TOWER) continue;
      var g = state.grid[i];
      if (!g || !g.towerCfg) continue;
      var k = Number(g.kills) || 0;
      waveKills += k;
      list.push({
        gridIdx: i,
        towerCfgId: g.towerCfgId,
        name: g.towerCfg.name,
        rarity: g.rarity || g.towerCfg.rarity,
        damageDealt: Number(g.damageDealt) || 0,
        kills: k
      });
    }
    // 按伤害降序
    list.sort(function (a, b) { return b.damageDealt - a.damageDealt; });
    // 幂等保护：同一 waveIndex 只累计一次 waveKills 到 totalKillsAllWaves，防止 snapshot 被多次调用重复累加
    var prevSnap = state.waveDamageStats;
    var alreadyAccumulatedForWave = !!(prevSnap && (prevSnap.waveIndex === state.waveIndex) && prevSnap._accumulated);
    state.waveDamageStats = { waveIndex: state.waveIndex, towers: list, at: Date.now(), waveKills: waveKills, _accumulated: true };
    if (!alreadyAccumulatedForWave) {
      state.totalKillsAllWaves = (Number(state.totalKillsAllWaves) || 0) + waveKills;
    }
  }
  // 把 DPS 榜打到游戏日志（便于玩家不点开每个塔就能看到总体贡献）
  function logDpsLeaderboard(snap) {
    if (!snap || !snap.towers || snap.towers.length === 0) return;
    var total = 0;
    var kills = 0;
    for (var i = 0; i < snap.towers.length; i++) {
      total += snap.towers[i].damageDealt;
      kills += snap.towers[i].kills || 0;
    }
    var live = computeLiveTotals();
    var head = '— 第' + (snap.waveIndex||0) + '波 伤害榜 合计伤害 ' + total + ' · 本波击杀 ' + kills + ' · 当前总DPS ≈' + (live.totalDps>=10?Math.round(live.totalDps):live.totalDps.toFixed(1)) + ' · 累计击杀 ' + live.totalKillsAllWaves + ' —';
    log('i', head);
    var top = snap.towers.slice(0, 5);
    for (var j = 0; j < top.length; j++) {
      var t1 = top[j];
      var share = total > 0 ? Math.round(t1.damageDealt * 100 / total) : 0;
      log('i', '  #' + (j+1) + ' [' + rarityShort(t1.rarity) + ']' + t1.name + ' 伤害 ' + t1.damageDealt + '（' + share + '%） 击杀 ' + t1.kills);
    }
  }
  // 渲染 DPS 榜 HTML（填到 waveend / end modal 的 .dpsboard 容器）
  function renderDpsBoardHTML(snap, hostId) {
    var host = document.getElementById(hostId);
    if (!host) return;
    if (!snap || !snap.towers || snap.towers.length === 0) {
      host.innerHTML = '<div class="dps-board-empty">（本波无塔伤害数据）</div>';
      return;
    }
    var total = 0;
    var waveKills = 0;
    for (var i = 0; i < snap.towers.length; i++) {
      total += snap.towers[i].damageDealt;
      waveKills += snap.towers[i].kills || 0;
    }
    var live = computeLiveTotals();
    var liveDps = (live.totalDps >= 10) ? Math.round(live.totalDps) : live.totalDps.toFixed(1);
    var html = '';
    html += '<div class="db-title"><span>本波塔伤害榜 #' + (snap.waveIndex||0) + '</span><span class="tot">合计伤害 ' + total + ' · 本波击杀 ' + waveKills + '</span></div>';
    html += '<div class="db-total-bar">' +
      '<span class="it"><b class="k">当前总DPS</b><b class="v dps">' + liveDps + '</b></span>' +
      '<span class="it"><b class="k">本波总击杀</b><b class="v">' + waveKills + '</b></span>' +
      '<span class="it"><b class="k">累计总击杀</b><b class="v">' + live.totalKillsAllWaves + '</b></span>' +
      '</div>';
    html += '<div class="db-row head"><span class="r">#</span><span>防御塔</span><span class="d">伤害</span><span class="p">占比</span><span class="k">击杀</span></div>';
    var list = snap.towers.slice();
    list.sort(function (a, b) { return b.damageDealt - a.damageDealt; });
    for (var j = 0; j < list.length; j++) {
      var t2 = list[j];
      var pct = total > 0 ? Math.round(t2.damageDealt * 100 / total) : 0;
      html += '<div class="db-row">'
        + '<span class="r">' + (j+1) + '</span>'
        + '<span class="n"><span class="rar ' + (t2.rarity||'common') + '">' + rarityShort(t2.rarity) + '</span>' + t2.name + '</span>'
        + '<span class="d">' + (t2.damageDealt||0) + '</span>'
        + '<span class="p">' + pct + '%</span>'
        + '<span class="k">' + (t2.kills||0) + '</span>'
        + '</div>';
    }
    host.innerHTML = html;
  }

  // ---------- 塔实际属性计算（buff 叠加后）----------
  // 与 damageEnemy 里的伤害公式一致：armor/resist 在命中时按敌人计算，
  // 这里显示的是「塔对无护甲无抗性假想敌」的实际值（最直观的对比基准）
  // 参数可选 buffMul：若不传则按 state.activeBuffs 实时计算（点塔时使用）
  function currentBuffMul() {
    var bm = { towerDamageMulAll:1, towerAttackIntervalMulAll:1, towerRangeMulAll:1, killGoldMulAll:1, slowStrengthMulAll:1, _talentCritRateBonus: 0 };
    if (state.cfg && typeof state.cfg.applyBuffs === 'function') {
      var eff = state.cfg.applyBuffs(state.activeBuffs || []);
      var m = (eff && eff.mul) ? eff.mul : null;
      if (m) {
        if (typeof m.towerDamageMulAll === 'number')         bm.towerDamageMulAll *= m.towerDamageMulAll;
        if (typeof m.towerAttackIntervalMulAll === 'number') bm.towerAttackIntervalMulAll *= m.towerAttackIntervalMulAll;
        if (typeof m.towerRangeMulAll === 'number')          bm.towerRangeMulAll *= m.towerRangeMulAll;
        if (typeof m.killGoldMulAll === 'number')            bm.killGoldMulAll *= m.killGoldMulAll;
        if (typeof m.slowStrengthMulAll === 'number')        bm.slowStrengthMulAll *= m.slowStrengthMulAll;
      }
    }
    // V4-6 T13：天赋数值叠加（与 Buff 相乘）
    var tm = calcTalentMul();
    bm.towerDamageMulAll *= tm.towerDamageMulAll;
    bm.towerAttackIntervalMulAll *= tm.towerAttackIntervalMulAll;
    bm.towerRangeMulAll *= tm.towerRangeMulAll;
    bm.killGoldMulAll *= tm.killGoldMulAll;
    bm.slowStrengthMulAll *= tm.slowStrengthMulAll;
    bm._talentCritRateBonus = tm.critRateBonus || 0;
    bm._talentStartGoldBonus = tm.startGoldBonus || 0;
    bm._talentStartLuckBonus = tm.startLuckLevelBonus || 0;
    bm._talentBaseMaxHPBonus = tm.baseMaxHPBonus || 0;
    return bm;
  }
  function currentEnvironment() {
    // V4-2 Task 5：优先读 mapDetail.environment（map JSON 直接带），兜底 mapsListById[mapId].environment
    var mdEnv = state.cfg && state.cfg.mapDetail && state.cfg.mapDetail.environment;
    if (mdEnv && mdEnv.id) return mdEnv;
    if (state.cfg && state.cfg.mapsListById && state.cfg.mapsListById[state.mapId] && state.cfg.mapsListById[state.mapId].environment) {
      return state.cfg.mapsListById[state.mapId].environment;
    }
    return { id: 'grass', towerMul: {}, enemyMul: {} };
  }
  function calcTowerEffective(cfg, buffMul, gridObj) {
    if (!cfg) return null;
    var mul = buffMul || currentBuffMul();
    var env = currentEnvironment();
    var tMul = env.towerMul || {};
    var cs = (state.cell || 40);
    // ===== V4-5：等级 level + L3 rollEffect 叠加 =====
    var lv = 0, fx = null;
    if (gridObj) {
      lv = Number(gridObj.level) || 0;
      if (typeof gridObj.rollEffect === 'string' && lv >= LEVEL_MAX) fx = getL3Effect(gridObj.rollEffect);
    }
    var lvMul = towerLevelMul(lv);
    // 最终基础 = cfg.base × levelPow × (buffMul × env) × L3 effect
    var baseDmg = Number(cfg.baseDamage) || 0;
    var dmgMul = lvMul.dmg * (mul.towerDamageMulAll || 1) * (Number(tMul.damageMul) || 1);
    var rangeMul = lvMul.range * (mul.towerRangeMulAll || 1) * (Number(tMul.rangeMul) || 1);
    var intvMul = lvMul.interval * (mul.towerAttackIntervalMulAll || 1) * (Number(tMul.attackIntervalMul) || 1);
    var slowMulExtra = 1;
    if (fx && fx.stat) {
      if (fx.stat.damageMul) dmgMul *= fx.stat.damageMul;
      if (fx.stat.rangeMul)  rangeMul *= fx.stat.rangeMul;
      if (fx.stat.control) {
        // 减速塔：slowStrengthMul 放大；AOE 塔：aoeRadiusMul 放大；否则攻速 bonus（interval 更小）
        var isSlowTower = (cfg.element === 'ice' || cfg.element === 'poison');
        var isAOETower   = !!(cfg.isAOE && Number(cfg.aoeRadiusPx) > 0);
        if (isSlowTower && typeof fx.stat.slowStrengthMul === 'number') slowMulExtra = fx.stat.slowStrengthMul;
        if (!isSlowTower && !isAOETower && typeof fx.stat.fallbackAttackIntervalMul === 'number') intvMul *= fx.stat.fallbackAttackIntervalMul;
      }
    }
    var effDmg = baseDmg * dmgMul;
    var effIntv = Math.max(0.05, (Number(cfg.attackInterval) || 0) * intvMul);
    var baseRangeCells = Number(cfg.rangeInCells) || 0;
    var effRangePx = baseRangeCells * cs * rangeMul;
    var baseRangePx = baseRangeCells * cs;
    // 减速：基础效果按 element 查表（与 damageEnemy 保持一致）；control effect 额外 × slowMulExtra（仅减速塔）
    var baseSlowPct = 0, baseSlowSec = 0;
    if (cfg.element === 'ice')    { baseSlowPct = 0.30; baseSlowSec = 2.0; }
    if (cfg.element === 'poison') { baseSlowPct = 0.20; baseSlowSec = 1.5; }
    var effSlowPct = (baseSlowPct > 0) ? Math.min(0.95, baseSlowPct * (mul.slowStrengthMulAll || 1) * slowMulExtra) : 0;
    var dps = (effIntv > 0) ? (effDmg / effIntv) : 0;
    // AOE：基础 AOE 半径（像素）不变，control L3 effect 时 AOE radius × aoeRadiusMul
    var cfgAOE = Number(cfg.aoeRadiusPx) || 0;
    var aoeRadiusPx = cfgAOE;
    if (fx && fx.stat && fx.stat.control && cfgAOE > 0 && typeof fx.stat.aoeRadiusMul === 'number') aoeRadiusPx = cfgAOE * fx.stat.aoeRadiusMul;
    var aoeTag = (cfg.isAOE && aoeRadiusPx > 0) ? '（AOE 半径 ' + Math.round(aoeRadiusPx) + '）' : '';
    return {
      cfg: cfg, gridObj: gridObj || null, level: lv, rollEffect: fx ? fx.id : null, rollEffectObj: fx,
      levelMul: lvMul,
      slowMulExtra: slowMulExtra,
      base: { damage: baseDmg, interval: (Number(cfg.attackInterval)||0), rangePx: baseRangePx, rangeCells: baseRangeCells, slowPct: baseSlowPct, slowSec: baseSlowSec },
      eff:  { damage: effDmg, interval: effIntv, rangePx: effRangePx, rangeCells: baseRangeCells * rangeMul, slowPct: effSlowPct, slowSec: baseSlowSec, aoeRadiusPx: aoeRadiusPx },
      effRangeCellsCalc: baseRangeCells * rangeMul,
      dps: dps,
      aoeTag: aoeTag,
      aoeRadiusPx: aoeRadiusPx,
      talentCritRateBonus: (Number(mul._talentCritRateBonus) || 0)
    };
  }

  function startBattleForWave(waveNum) {
    // Guarantee RAF is alive before any battle ticks, so even if the render
    // chain was killed earlier (e.g. resetLevelState on logout → state.rafId=0
    // + state.running=false), the coming BATTLE phase still ticks properly.
    ensureRenderLoop();
    var w = currentWaveCfg();
    state.enemies = [];
    state.projectiles = [];
    state.spawnQueue = [];
    state.waveElapsed = 0;
    state.waveKillGold = 0;
    state.waveBonusGold = 0;
    var groups = (w && w.groups) ? w.groups : null;
    // Defense: if no wave config was available (empty waves, server returned
    // [], config loading fallback missed it), log clearly and inject a minimal
    // default wave so players still SEE monsters moving + taking damage instead
    // of an empty/stuck field. Without this, the phase silently progresses to
    // WIN/WAVEEND with no visual feedback and only "重开" recovers.
    if (!groups || groups.length === 0) {
      var fallbackId = 'NORMAL';
      if (state.cfg && state.cfg.enemiesById && !state.cfg.enemiesById[fallbackId]) {
        // pick first available enemy
        var keys = Object.keys(state.cfg.enemiesById || {});
        fallbackId = keys[0] || fallbackId;
      }
      log('e', 'startBattleForWave: 第 ' + waveNum + ' 波 groups 为空，使用保底出怪（enemy=' + fallbackId + ' ×5 间隔 0.5s delay 0）。cfg=' + (state.cfg && state.cfg.source || '?'));
      try { setMsg('波次配置缺失，已使用默认保底配置出怪（第 ' + waveNum + ' 波）', true); } catch (_) {}
      for (var j = 0; j < 5; j++) {
        state.spawnQueue.push({ enemyId: fallbackId, spawnAt: j * 0.5 });
      }
    } else {
      groups.forEach(function (g) {
        var delay = g.delay || 0;
        for (var i = 0; i < (g.count || 0); i++) {
          state.spawnQueue.push({ enemyId: g.enemyId, spawnAt: delay + i * (g.interval || 1) });
        }
      });
    }
    state.spawnQueue.sort(function (a, b) { return a.spawnAt - b.spawnAt; });
  }

  // ---------- combat tick ----------
  function spawnEnemy(enemyId) {
    var cfg = state.cfg.enemiesById[enemyId];
    if (!cfg) return;
    var md = state.cfg.mapDetail;
    var sp = (md.spawnPoints && md.spawnPoints[0]) ? md.spawnPoints[0] : { x: 0, y: 0 };
    // V4：按检测点生成"起点→m1→m2→…→基地"的整条长路径（checkpoints 为空时自动退化回老 S→E A*）
    var path = buildFullPathWithCheckpoints();
    // 起点 tile 本身可能不是 START（敌人出生点偶尔不是草地）：兜底再跑一次
    if (!path) {
      setTile(sp.x, sp.y, T_START); setTile(md.base.x, md.base.y, T_END);
      path = buildFullPathWithCheckpoints();
    }
    if (!path) { log('e', '无法为敌人找到路径（封死了？但 terrainGate 理应阻止）'); return; }
    var startPx = cellCenterPx(sp.x, sp.y);
    // V4-1 难度倍率（Task 2 TR-2.1）：直接乘到本 enemy 实例字段，永不回写 cfg（防数值污染）
    var diff = state.difficultyMul || {};
    var diffHp = Number(diff.hp) || 1;
    var diffSpeed = Number(diff.speed) || 1;
    // V4-2 Task 5：地图 environment enemyMul（HP / Speed / Armor 等；damageMul 用于基地扣血 reachBase）
    var envE = (currentEnvironment().enemyMul) || {};
    var envHp = Number(envE.hpMul) || 1;
    var envSp = Number(envE.speedMul) || 1;
    var envAr = Number(envE.armorMul) || 1;
    var baseHPVal = Math.round((Number(cfg.baseHP) || 0) * diffHp * envHp * 100) / 100; // 保留 2 位小数
    var speedVal = (Number(cfg.speed) || 0) * diffSpeed * envSp;
    // 环境 armorMul（例如冰霜 ctrl3: -5% HP + armor）：覆盖到实例上，damageEnemy 仍读 cfg.armor，但 cfg.armor
    // 为全局常量不能改；这里临时挂到 e.envArmorMul 上，damageEnemy 再额外乘（1 * envAr）即可。envAr !=1 才挂，减少分支。
    var e = {
      cfg: cfg,
      hp: baseHPVal, maxHp: baseHPVal,
      speed: speedVal, // px per second（难度 speed 倍率 + environment speed 倍率生效）
      shield: Number(cfg.shield) || 0, // V4 Task7：初始护盾值（先于 HP 抵扣伤害）
      px: startPx.cx, py: startPx.cy,
      pathIdx: 1, // next target cell
      path: path,
      slowPct: 0, slowSec: 0,
      lavaTickTimer: 0, // V4-2 Task 5：熔岩 DoT 累计计时（tile=7 时每 env.lavaEverySec 秒扣一次）
      healAcc: 0, // V4 Task7：HEALER 累计时间（整秒触发）
      summonAcc: 0, // V4 Task7：SUMMONER 累计时间（满 summonEveryNSec 召唤）
      // V4 Task8：每个 Skill 独立 {elapsed, castAt, warningLeft, firing, params} 状态映射（key=skill.id）
      skillStates: null,
      alive: true,
      instId: state.nextInstId++
    };
    if (envAr !== 1) e.envArmorMul = envAr;
    state.enemies.push(e);
  }

  function stepEnemy(e, dt) {
    if (!e.alive) return;
    // 减速过期
    if (e.slowSec > 0) {
      e.slowSec -= dt;
      if (e.slowSec <= 0) { e.slowSec = 0; e.slowPct = 0; }
    }

    // ========= V4 Task7：HEALER（按 healRadiusCells 治疗周围友军） =========
    var healPerSec = Number(e.cfg.healPerSec) || 0;
    if (healPerSec > 0) {
      e.healAcc = (e.healAcc || 0) + dt;
      // 整 0.25s 小步长分摊治疗，避免"整秒跳一次巨大治疗"视觉突兀
      var step = 0.25;
      while (e.healAcc >= step) {
        e.healAcc -= step;
        _healAlliesNearby(e, healPerSec * step);
      }
    }

    // ========= V4 Task7：SUMMONER（计时到点 → N 只 FAST 立即 spawn 在自身当前 tile 附近） =========
    var summonEveryN = Number(e.cfg.summonEveryNSec) || 0;
    if (summonEveryN > 0 && state.phase === PHASE.BATTLE) {
      e.summonAcc = (e.summonAcc || 0) + dt;
      if (e.summonAcc >= summonEveryN) {
        e.summonAcc -= summonEveryN; // 不要用 =0，避免 dt 过大丢节拍
        var spawnId = Number(e.cfg.summonSpawnId) || 0;
        var perCount = Math.max(1, parseInt(e.cfg.summonCountPer || 2, 10));
        if (spawnId > 0) _spawnMinionsAt(e, spawnId, perCount);
      }
    }

    // 移动
    var effSpeed = e.speed * (1 - (e.slowPct || 0));
    // ===== V4 Task8：ice slow remnant（全局敌人速度 × state.iceSlowMul，冻结阶段 dt=0 仍然走这里但值无关）=====
    if (state.slowRemnantUntil && state.waveElapsed < state.slowRemnantUntil) {
      var slMul = Number(state.iceSlowMul) || 1;
      if (slMul > 0 && slMul < 1) effSpeed *= slMul;
    }
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

  // --- Task7 辅助：HEALER 半径内友军治疗 ---
  function _healAlliesNearby(healerE, amount) {
    if (amount <= 0) return;
    var md = state.cfg.mapDetail;
    var cs = state.cellSize || 48;
    var radiusCells = Number(healerE.cfg.healRadiusCells) || 2;
    var radiusPx = radiusCells * cs;
    var rSq = radiusPx * radiusPx;
    var hx = healerE.px, hy = healerE.py;
    for (var i = 0; i < state.enemies.length; i++) {
      var a = state.enemies[i];
      if (!a || !a.alive || a === healerE) continue;
      var ddx = a.px - hx, ddy = a.py - hy;
      if (ddx * ddx + ddy * ddy <= rSq) {
        if (a.hp < a.maxHp) {
          var before = a.hp;
          a.hp = Math.min(a.maxHp, a.hp + amount);
          // 治疗量如果很大（超过上限的部分不统计 DPS，保持原样即可）
          log('d', '[HEALER] ' + (healerE.cfg.name || '治疗师') + ' 治疗 ' + (a.cfg.name || '友军')
            + ' HP ' + before.toFixed(1) + ' → ' + a.hp.toFixed(1) + ' (+' + (a.hp - before).toFixed(2) + ')');
        }
      }
    }
  }

  // --- Task7 辅助：SUMMONER 原地召唤小怪（不走 spawnQueue、不计入波次已出怪数、在当前位置偏移 spawn） ---
  function _spawnMinionsAt(summonerE, spawnCfgId, count) {
    if (count <= 0) return;
    // 直接在 summon 处生成新 enemy 对象（复制 spawnEnemy 主体但跳过 queue，path 用当前召唤者 path 及 pathIdx 的后续段）
    var cfg = state.cfg.enemiesById[spawnCfgId];
    if (!cfg) return;
    var diff = state.difficultyMul || {};
    var envE = (currentEnvironment().enemyMul) || {};
    var diffHp = Number(diff.hp) || 1, diffSp = Number(diff.speed) || 1;
    var envHp = Number(envE.hpMul) || 1, envSp = Number(envE.speedMul) || 1, envAr = Number(envE.armorMul) || 1;
    var baseHPVal = Math.round((Number(cfg.baseHP) || 0) * diffHp * envHp * 100) / 100;
    var speedVal = (Number(cfg.speed) || 0) * diffSp * envSp;
    for (var k = 0; k < count; k++) {
      // 从召唤者的 pathIdx 处继续走（稍作偏移避免完全重叠）
      var angle = (k / Math.max(1, count)) * Math.PI * 2;
      var offPx = 4;
      var inst = {
        cfg: cfg,
        hp: baseHPVal, maxHp: baseHPVal,
        speed: speedVal,
        shield: Number(cfg.shield) || 0,
        px: summonerE.px + Math.cos(angle) * offPx,
        py: summonerE.py + Math.sin(angle) * offPx,
        pathIdx: Math.min(summonerE.pathIdx, Math.max(0, (summonerE.path && summonerE.path.length) ? summonerE.path.length - 1 : 0)),
        path: summonerE.path,
        slowPct: 0, slowSec: 0,
        lavaTickTimer: 0,
        healAcc: 0, summonAcc: 0,
        skillStates: null,
        alive: true,
        instId: state.nextInstId++
      };
      if (envAr !== 1) inst.envArmorMul = envAr;
      state.enemies.push(inst);
    }
    log('i', '[SUMMONER] ' + (summonerE.cfg.name || '召唤师') + ' 召唤 ' + count + ' × [' + (cfg.name || ('enemy#'+spawnCfgId)) + ']');
  }

  // ==========================================================================
  // V4 Task 8：BOSS 主动技能 castSkillsIfDue + 陨石/冰冻 效果状态
  // state.skillFx[] = [{type:'meteorWarning'|'meteorImpact', casterE, cx, cy, rPx, color, tLeft, impactT, durationSec, trueDamage, towerStunSec}, ...]
  // ==========================================================================
  function _initSkillFx() {
    if (!state.skillFx) state.skillFx = [];
  }
  function castSkillsIfDue(dtRaw) {
    if (dtRaw <= 0) return;
    if (state.phase !== PHASE.BATTLE) return;
    _initSkillFx();
    // ---- (A) 推进已登记的 特效 + 到期执行 impact ----
    var nowT = state.waveElapsed;
    var keepFx = [];
    for (var fxI = 0; fxI < state.skillFx.length; fxI++) {
      var fx = state.skillFx[fxI];
      fx.tLeft -= dtRaw;
      // meteor warning 到期 → 命中执行（真实伤害 + 塔眩晕）
      if (fx.type === 'meteorWarning' && fx.tLeft <= 0) {
        _applyMeteorImpact(fx);
      } else {
        keepFx.push(fx);
      }
    }
    state.skillFx = keepFx;
    // ---- (B) 推进每个 enemy 的 skills 计时（cfg.skills）----
    for (var ei = 0; ei < state.enemies.length; ei++) {
      var en = state.enemies[ei];
      if (!en || !en.alive) continue;
      var skills = en.cfg && en.cfg.skills;
      if (!skills || !skills.length) continue;
      if (!en.skillStates) en.skillStates = {};
      for (var si = 0; si < skills.length; si++) {
        var sk = skills[si];
        if (!sk || !sk.id) continue;
        var st = en.skillStates[sk.id];
        if (!st) {
          st = {
            elapsed: 0,            // 自出生（或上次触发 Every）累计
            castIndex: 0,          // 已成功触发次数
            warnElapsed: 0,        // 预警剩余（>0 表示正在预警）
            lastFireAt: -1
          };
          en.skillStates[sk.id] = st;
        }
        st.elapsed += dtRaw;
        var first = Number(sk.firstAtSec) || 0;
        var every = Number(sk.everySec) || 0;

        // 当次应触发的相对时间（首/次 or every(castIndex-1) 之后）
        var due = first;
        if (st.castIndex > 0) {
          if (every <= 0) continue; // 只触发 1 次
          due = every;
          // elapsed 在每次触发后不归零（因为首触发&every共用同一个累计器），
          // 这里改成按 castIndex * every + first 对齐判定
          due = first + st.castIndex * every;
        }
        if (st.elapsed >= due && st.warnElapsed <= 0) {
          // 进入预警
          var warnSec = Number(sk.warningSec) || 1.0;
          st.warnElapsed = warnSec;
          _queueSkillWarning(en, sk, warnSec);
        }
        // 预警中推进
        if (st.warnElapsed > 0) {
          st.warnElapsed -= dtRaw;
          if (st.warnElapsed <= 0) {
            st.warnElapsed = 0;
            st.castIndex += 1;
            st.lastFireAt = nowT;
            _executeSkillCast(en, sk);
          }
        }
      }
    }
  }
  function _queueSkillWarning(casterE, skill, warnSec) {
    _initSkillFx();
    var warnColor = skill.warningColor || (skill.id === 'ice' ? '#4299e1' : '#ef4444');
    var extra = skill.extra || {};
    if (skill.id === 'meteor') {
      // 目标：在格子里随机 2-3 个点（优先 塔位置 20%/普通路径 70%/随机 10%）；简单取 2 个，一个在敌人前方路径，一个在塔最多行
      var targets = _pickMeteorTargets(casterE, Math.max(1, Number(extra.targetCount) || 2));
      var radiusCells = Number(extra.radiusCells) || 1.5;
      var cs = state.cellSize || 48;
      for (var ti = 0; ti < targets.length; ti++) {
        var tgt = targets[ti];
        state.skillFx.push({
          type: 'meteorWarning',
          casterInstId: casterE.instId,
          cx: tgt.px, cy: tgt.py,
          rPx: radiusCells * cs,
          color: warnColor,
          tLeft: warnSec,
          warnTotal: warnSec,
          durationSec: Number(skill.durationSec) || 0.3,
          trueDamage: Number(extra.trueDamage) || 200,
          towerStunSec: Number(extra.towerStunSec) || 1,
          targetCell: { x: tgt.gx, y: tgt.gy }
        });
      }
      log('w', '[SKILL] ' + (casterE.cfg.name || 'BOSS') + ' 启动 meteor 预警：' + targets.length + ' 处陨石坠落（' + warnSec + 's）');
    } else if (skill.id === 'ice') {
      // ice 技能：全图冻结（无警告点），直接画全屏蓝层； warnSec 结束执行冻结 + 减速残响
      state.skillFx.push({
        type: 'iceWarning',
        casterInstId: casterE.instId,
        color: warnColor,
        tLeft: warnSec,
        warnTotal: warnSec,
        freezeSec: Number(extra.freezeSec) || 2.0,
        slowMul: Number(extra.slowMul) || 0.5,
        slowRemnantSec: Number(extra.slowRemnantSec) || 4.0
      });
      log('w', '[SKILL] ' + (casterE.cfg.name || 'BOSS') + ' 启动 ice 预警：即将冻结全场（' + warnSec + 's）');
    }
  }
  function _executeSkillCast(casterE, skill) {
    // ice：立即生效冻结（iceUntil = now + freezeSec） + 减速残响 (slowRemnantUntil = now + freezeSec + slowRemnantSec)
    if (skill.id === 'ice') {
      var extra = skill.extra || {};
      var frSec = Number(extra.freezeSec) || 2.0;
      var slMul = Number(extra.slowMul) || 0.5;
      var slSec = Number(extra.slowRemnantSec) || 4.0;
      state.iceUntil = state.waveElapsed + frSec;
      state.slowRemnantUntil = state.waveElapsed + frSec + slSec;
      state.iceSlowMul = slMul;
      log('e', '[SKILL] 冰冻 开始：' + frSec.toFixed(1) + ' 秒完全冻结，之后 ' + slSec.toFixed(1) + ' 秒敌人速度 × ' + slMul.toFixed(2));
      showTopToast('冰冻来袭：操作冻结 ' + frSec.toFixed(1) + ' 秒', 'warn');
    }
  }
  function _pickMeteorTargets(casterE, n) {
    // 简单策略：60% 取塔存在的格中心、30% 取敌人位置、10% 取随机草地格
    var arr = [];
    var cs = state.cellSize || 48;
    var towerCells = [];
    for (var gi = 0; gi < state.grid.length; gi++) {
      var gg = state.grid[gi];
      if (gg && (gg.tower || gg.towerCfg)) {
        towerCells.push({ gx: gi % state.cols, gy: Math.floor(gi / state.cols) });
      }
    }
    var aliveEnemies = [];
    for (var i = 0; i < state.enemies.length; i++) if (state.enemies[i].alive) aliveEnemies.push(state.enemies[i]);
    for (var kk = 0; kk < n; kk++) {
      var r = Math.random();
      if (r < 0.6 && towerCells.length) {
        var tc = towerCells[Math.floor(Math.random() * towerCells.length)];
        var ccp = cellCenterPx(tc.gx, tc.gy);
        arr.push({ gx: tc.gx, gy: tc.gy, px: ccp.cx, py: ccp.cy });
      } else if (r < 0.9 && aliveEnemies.length) {
        var ae = aliveEnemies[Math.floor(Math.random() * aliveEnemies.length)];
        var gxe = Math.max(0, Math.min(state.cols - 1, Math.floor(ae.px / cs)));
        var gye = Math.max(0, Math.min(state.rows - 1, Math.floor(ae.py / cs)));
        arr.push({ gx: gxe, gy: gye, px: ae.px, py: ae.py });
      } else {
        var gxR = Math.floor(Math.random() * state.cols);
        var gyR = Math.floor(Math.random() * state.rows);
        var crp = cellCenterPx(gxR, gyR);
        arr.push({ gx: gxR, gy: gyR, px: crp.cx, py: crp.cy });
      }
    }
    return arr;
  }
  function _applyMeteorImpact(fx) {
    // (1) 范围内敌人：扣 trueDamage（忽略 shield/armor/resist）
    var rPx = fx.rPx, trueDmg = fx.trueDamage || 200;
    var rSq = rPx * rPx;
    var hitAnyEnemy = false;
    for (var i = 0; i < state.enemies.length; i++) {
      var ee = state.enemies[i];
      if (!ee.alive) continue;
      var ddx = ee.px - fx.cx, ddy = ee.py - fx.cy;
      if (ddx * ddx + ddy * ddy <= rSq) {
        // 先扣盾（true damage 仍走护盾常规抵扣：因为任务描述是"忽略盾"）— Task 8 说 meteor 真实伤害忽略盾，直接扣 HP
        ee.hp -= trueDmg;
        hitAnyEnemy = true;
        log('w', '[METEOR] 命中 enemy#' + ee.instId + ' ' + (ee.cfg.name || '') + ' -' + trueDmg + ' HP (真实伤害)');
        if (ee.hp <= 0) killEnemy(ee, null, null, { sourceGridIdx: null });
      }
    }
    // (2) 范围内塔：设置 stunUntil（stepTowers 跳过攻击直到 stunUntil）
    var stunSec = fx.towerStunSec || 1;
    var stunUntil = state.waveElapsed + stunSec;
    if (fx.targetCell) {
      var cs2 = state.cellSize || 48;
      var rCells = rPx / cs2;
      var xMin = Math.max(0, Math.floor(fx.targetCell.x - rCells));
      var xMax = Math.min(state.cols - 1, Math.ceil(fx.targetCell.x + rCells));
      var yMin = Math.max(0, Math.floor(fx.targetCell.y - rCells));
      var yMax = Math.min(state.rows - 1, Math.ceil(fx.targetCell.y + rCells));
      for (var yy = yMin; yy <= yMax; yy++) {
        for (var xx = xMin; xx <= xMax; xx++) {
          var cCtr = cellCenterPx(xx, yy);
          var d2x = cCtr.cx - fx.cx, d2y = cCtr.cy - fx.cy;
          if (d2x * d2x + d2y * d2y <= rSq) {
            var idx = yy * state.cols + xx;
            var gTower = state.grid[idx];
            if (gTower && gTower.towerCfg) {
              gTower.stunUntil = Math.max(gTower.stunUntil || 0, stunUntil);
            }
          }
        }
      }
    }
    log('w', '[METEOR] 陨石落地：中心 (' + Math.round(fx.cx) + ',' + Math.round(fx.cy) + ') 真实伤害 ' + trueDmg + '，塔眩晕 ' + stunSec + ' 秒');
    // push 一个短暂的 impact 视觉供 draw 使用（闪烁 0.3s）
    state.skillFx.push({
      type: 'meteorImpact',
      cx: fx.cx, cy: fx.cy, rPx: rPx, color: fx.color,
      tLeft: fx.durationSec || 0.3,
      total: fx.durationSec || 0.3
    });
  }

  function reachBase(e) {
    if (!e.alive) return;
    e.alive = false;
    var cfgDmg = (e.cfg && e.cfg.damageToBase) ? e.cfg.damageToBase : 1;
    // V4-2 Task 5：环境 enemyMul.damageMul（熔岩洞穴 0.8x 基地伤害）
    var envDmgMul = Number((currentEnvironment().enemyMul || {}).damageMul) || 1;
    var dmg = Math.max(0, Math.round(cfgDmg * envDmgMul * 100) / 100);
    state.baseHP = Math.max(0, state.baseHP - dmg);
    log('e', (e.cfg && e.cfg.name ? e.cfg.name : '敌人') + '冲入基地，造成 ' + dmg + ' 点伤害' + (envDmgMul !== 1 ? '（环境 damageMul=' + envDmgMul.toFixed(3) + '，原始 ' + cfgDmg + '）' : ''));
    if (state.baseHP <= 0 && state.phase === PHASE.BATTLE) {
      triggerLose();
    }
  }

  function triggerLose() {
    state.phase = PHASE.LOSE;
    state.running = false;
    // DPS 快照（防线崩溃前记录本波实际贡献，结算面板/点塔都能看）
    snapshotTowerWaveStats();
    logDpsLeaderboard(state.waveDamageStats);
    document.getElementById('end-title').textContent = '防线崩溃！';
    document.getElementById('end-summary').innerHTML =
      '坚持至第 <b>' + state.waveIndex + '</b> 波。<br>' +
      '剩余金币 <b>' + state.gold + '</b>；运气 <b>Lv.' + state.luckLevel + '</b>；Buff <b>' + state.activeBuffs.length + '</b> 条。';
    // DPS 榜（结局弹框中展示）
    renderDpsBoardHTML(state.waveDamageStats, 'end-dps-board');
    // V3-5: 显示/隐藏"从 autosave(波末) 恢复"按钮
    refreshEndAutosaveUI('lose');
    document.getElementById('end-modal').classList.remove('hidden');
    log('e', '★ 防线崩溃，对局失败。');
    refreshHUD(); draw();
    // V3-1 autosave（已登录时，结局也可记录）
    autoSaveIfLoggedIn('lose');
  }

  // V3-5 END modal 小提示区：有可用 autosave 才显按钮，LOST 时才允许恢复（WIN 不恢复）
  function refreshEndAutosaveUI(reason) {
    var info = document.getElementById('end-autosave-line');
    var btn  = document.getElementById('btn-end-restore');
    var snap = _readLocalWaveendAutosave();
    if (info) info.textContent = '';
    if (btn)  btn.classList.add('hidden');
    if (reason === 'lose' && snap) {
      var w = snap.fromWaveIndex ? ('第' + snap.fromWaveIndex + '波末') : '最近波末';
      var t = snap.savedAt ? new Date(snap.savedAt) : null;
      var tStr = '';
      if (t && !isNaN(t.getTime())) {
        var mm = String(t.getMinutes()).padStart(2, '0');
        var hh = String(t.getHours()).padStart(2, '0');
        tStr = '  ' + hh + ':' + mm;
      }
      if (info) info.textContent = '已检测到 ' + w + ' autosave' + tStr + '，可回到波末继续战斗。';
      if (btn)  btn.classList.remove('hidden');
    } else if (snap && snap.fromWaveIndex) {
      if (info) info.textContent = '最近波末 autosave：第' + snap.fromWaveIndex + '波末（仅防线崩溃时可恢复）。';
    } else if (info) {
      info.textContent = '（暂无波末 autosave，恢复功能不可用）';
    }
  }

  // 伤害公式：dmg = towerCfg.baseDamage * buffMul.towerDamageMulAll * (1 - armor * 0.5) * elemRes
  //   简化：armor 0~0.4，抵扣 0.5 armor 比例伤害；抗性表 resistances[element] = 减伤比例
  //   记录来源塔（sourceGridIdx）用于 DPS 统计累计到对应塔 grid[sourceGridIdx].damageDealt/.kills
  //   V4 Task7：shield > 0 时先抵扣 shield（不计 armor * 0.5 已应用后的 dmg）
  //   V4 Task9：extra.finalDamageOverride 直接跳过 baseDamage 计算（double_shot/ricochet 上层计算好再传）
  //            extra.critMul 若提供则在 armor/resist/shield 后 ×critMul（致命暴击）；命中后打折线 & 飘字 critFx
  //            extra.ricochetFx / extra.isCrit 用于 canvas 命中视觉（e._hitFx 数组保留 0.25s 自动过期）
  //   V4-7 塔能量技能解耦：ext.skillDamageMul / skillArmorIgnorePct / skillSlowMul / skillSlowTicksSec
  //         - skillDamageMul：在 crit/shield 前、armor/resist 前 整体 ×（对 finalDamageOverride 也生效，保证"穿甲+倍率"组合可叠加）
  //         - skillArmorIgnorePct：0~1 比例忽略敌人 armor（1=穿甲，0=不穿）
  //         - skillSlowMul：0.05~1 减速强度（1=不减速，0.5=减速50%），叠加到元素减速
  //         - skillSlowTicksSec：技能减速持续秒数（>0 时与元素/control 取更强 + 更长）
  function damageEnemy(e, towerCfg, hitsLow, buffMul, extra) {
    if (!e.alive) return 0;
    var ext = extra || {};
    var baseArmor = (e.cfg.armor || 0) * (Number(e.envArmorMul) || 1);
    // ---- V4-7 能量技能：穿甲 armorIgnore（clamp 0~1） ----
    var skillArmorIgnore = Number(ext.skillArmorIgnorePct) || 0;
    if (skillArmorIgnore < 0) skillArmorIgnore = 0;
    if (skillArmorIgnore > 1) skillArmorIgnore = 1;
    var armor = Math.max(0, baseArmor * (1 - skillArmorIgnore));
    var res = (towerCfg && e.cfg.resistances && e.cfg.resistances[towerCfg.element]) ? Number(e.cfg.resistances[towerCfg.element]) : 0;
    // ---- V4-7 能量技能：伤害倍率（对 finalDamageOverride / 非 override 两条路径都生效，clamp ≥1） ----
    var skillDmgMul = Number(ext.skillDamageMul) || 1;
    if (!(skillDmgMul >= 1)) skillDmgMul = 1;
    // V4 Task9：finalDamageOverride 优先级最高（上层 stepTowers/弹射链 已按 level/effect/double_shot/ricochet 算好）
    var dmg;
    if (typeof ext.finalDamageOverride === 'number' && ext.finalDamageOverride >= 0) {
      dmg = Math.max(1, Math.floor(ext.finalDamageOverride * skillDmgMul));
    } else {
      var baseDmg = (towerCfg ? (Number(towerCfg.baseDamage) || 0) : 0);
      dmg = baseDmg * (buffMul ? (buffMul.towerDamageMulAll || 1) : 1);
      dmg = dmg * skillDmgMul;
      dmg *= Math.max(0, 1 - armor * 0.5);
      dmg *= Math.max(0, 1 - res);
      dmg = Math.max(1, Math.floor(dmg));
    }

    // ---- shield 先抵扣（与 Task7 一致） ----
    var dealtToHp = dmg;
    if (Number(e.shield) > 0) {
      var absorb = Math.min(e.shield, dmg);
      e.shield -= absorb;
      dealtToHp = dmg - absorb;
    }

    // ---- V4 Task9：致命暴击 critMul（仅在 shield 抵扣后、未 finalDamageOverride 前提下生效） ----
    //   critMul 触发时：最终 HP 扣血 × critMul，dealtToHp 也乘，保证 DPS 统计反映真实倍率
    var isCrit = !!ext.isCrit;
    var critMul = Number(ext.critMul) || 0;
    if (!isCrit && critMul > 1 && typeof ext.finalDamageOverride !== 'number') {
      // 兼容上层同时传 critMul 而未显式 isCrit 的情况
      isCrit = Math.random() < 1; // 已由 stepTowers 预先判定，这里不再 roll
      isCrit = false;
    }
    if (isCrit && critMul > 1) {
      dealtToHp = Math.max(1, Math.floor(dealtToHp * critMul));
    }
    if (dealtToHp > 0) e.hp -= dealtToHp;

    // DPS 累计
    var gi = null;
    if (typeof ext.sourceGridIdx === 'number') gi = ext.sourceGridIdx;
    if (gi != null && dealtToHp > 0) {
      var g = state.grid[gi];
      if (g) g.damageDealt = (g.damageDealt || 0) + dealtToHp;
    }

    // ---- V4 Task9：命中视觉 fx（crit 红色折线 / ricochet 弹射子弹轨迹）—— 在 e 上暂存 0.25s，draw 里消费 ----
    if (isCrit || ext.ricochetFx) {
      if (!e._hitFx) e._hitFx = [];
      e._hitFx.push({
        type: isCrit ? 'crit' : 'ricochet',
        t: 0,
        life: 0.28,
        amount: dealtToHp,
        from: (ext.ricochetFx && ext.ricochetFx.from) ? ext.ricochetFx.from : null
      });
    }

    // 减速（control L3 effect 的 slowStrengthMul 由上层在 calcTowerEffective/slowMulExtra 中通过 finalDamageOverride 外另传 ext.slowMulExtra 叠加）
    // V4-7 新增：能量技能减速 skillSlowMul(0.05~1, 与元素 slowPct 并集，skillSlowTicksSec 独立持续)
    var slowPct = 0, slowSec = 0;
    if (towerCfg) {
      if (towerCfg.element === 'ice')    { slowPct = 0.30; slowSec = 2.0; }
      if (towerCfg.element === 'poison') { slowPct = 0.20; slowSec = 1.5; }
    }
    // V4-7 技能减速：skillSlowMul 表示剩余速度比（0.05~1），换算为 slowPct = 1 - slowMul；与元素减速取更强值
    var sSlowMul = Number(ext.skillSlowMul) || 1;
    if (!(sSlowMul > 0)) sSlowMul = 1;
    if (sSlowMul < 0.05) sSlowMul = 0.05;
    if (sSlowMul > 1)    sSlowMul = 1;
    var sSlowPct = (sSlowMul < 1) ? (1 - sSlowMul) : 0;
    var sSlowSec = Number(ext.skillSlowTicksSec) || 0;
    if (!(sSlowSec >= 0)) sSlowSec = 0;
    if (sSlowPct > 0 && sSlowSec > 0) {
      if (sSlowPct > slowPct) { slowPct = sSlowPct; slowSec = Math.max(slowSec, sSlowSec); }
      else                     { slowSec = Math.max(slowSec, sSlowSec); }
    }
    if (slowPct > 0) {
      if (buffMul) slowPct = slowPct * (buffMul.slowStrengthMulAll || 1);
      if (typeof ext.slowMulExtra === 'number') slowPct = slowPct * ext.slowMulExtra;
      slowPct = Math.min(0.95, slowPct);
    }
    if (slowPct > 0 && slowSec > 0) {
      if (slowPct > (e.slowPct || 0)) e.slowPct = slowPct;
      e.slowSec = Math.max(e.slowSec || 0, slowSec);
    }
    if (e.hp <= 0) killEnemy(e, towerCfg, buffMul, { sourceGridIdx: gi });
    return dealtToHp;
  }

  // 清空每帧过期的命中视觉（crit 折线 / ricochet 连线）—— 在 battleTick 末尾调用
  function stepHitFx(dt) {
    for (var j = 0; j < state.enemies.length; j++) {
      var e = state.enemies[j];
      if (!e._hitFx || !e._hitFx.length) continue;
      var keep = [];
      for (var k = 0; k < e._hitFx.length; k++) {
        var f = e._hitFx[k];
        f.t += dt;
        if (f.t < (f.life || 0.28)) keep.push(f);
      }
      e._hitFx = keep.length ? keep : null;
    }
  }

  function killEnemy(e, towerCfg, buffMul, extra) {
    if (!e.alive) return;
    e.alive = false;
    // DPS 击杀累计（若命中塔传来源，则累计到该塔 kills）
    var gi = (extra && typeof extra.sourceGridIdx === 'number') ? extra.sourceGridIdx : null;
    if (gi != null) {
      var g = state.grid[gi];
      if (g) { g.kills = (g.kills || 0) + 1; }
    }
    // ========== V4 Task7：SPLITTER 死亡分裂（在赏金结算前生成，避免状态不一致；分裂出的小怪仍走正常战斗路径） ==========
    var splitCfg = e.cfg && e.cfg.splitInto;
    if (splitCfg) {
      var splitId = Number(splitCfg.enemyId) || 0;
      var splitCount = Math.max(0, parseInt(splitCfg.count || 0, 10));
      if (splitId > 0 && splitCount > 0) {
        _spawnMinionsAt(e, splitId, splitCount);
        var splitC = state.cfg.enemiesById[splitId];
        log('i', '[SPLITTER] ' + (e.cfg.name || '分裂者') + ' 死亡分裂 ' + splitCount + ' × [' + (splitC && splitC.name ? splitC.name : ('enemy#'+splitId)) + ']');
      }
    }
    // 击杀基础金币
    var baseGold = (e.cfg && e.cfg.killBaseGold) ? e.cfg.killBaseGold : 0;
    // V4-1: 难度 gold 倍率（Task 2 TR-2.2）× killGold 全局 buff 倍率
    var goldDiffMul = Number((state.difficultyMul && state.difficultyMul.gold) || 1);
    var gold = Math.floor(baseGold * (buffMul ? buffMul.killGoldMulAll : 1) * goldDiffMul);
    state.gold += gold;
    state.waveKillGold += gold;
    var enemyName = (e.cfg && e.cfg.name) ? e.cfg.name : '敌人';
    var isBoss = !!(e.cfg && e.cfg.isBoss);
    // 稀有度奖励 Roll（按 dropBonusRate + Buff add）
    var rollChance = ((e.cfg && e.cfg.dropBonusRate) ? Number(e.cfg.dropBonusRate) : 0)
                   + ((towerCfg && towerCfg.element === 'light') ? 0.15 : 0)
                   + ((towerCfg && towerCfg.element === 'dark')  ? 0.10 : 0);
    if (buffMul && typeof buffMul.killBonusGoldChanceAddAll === 'number') rollChance += buffMul.killBonusGoldChanceAddAll;
    var rolls = isBoss ? 2 : 1;
    var results = [];
    var bGoldTotal = 0;
    var hit = Math.random() < rollChance;
    for (var ri = 0; ri < rolls; ri++) {
      if (!hit) {
        results.push({ rar: '未命中', gold: 0 });
        continue;
      }
      var rar = state.cfg.rollBonusRarityByLuck(state.luckLevel);
      var bonusMap = state.cfg.bonusGoldMap || { common:5, rare:15, epic:50, legendary:200 };
      var bGold = Math.round((bonusMap[rar] || 5) * goldDiffMul); // V4-1: Roll 金也按难度 gold× 放大（与 TR-2.2 波奖励一致）
      state.gold += bGold;
      state.waveBonusGold += bGold;
      bGoldTotal += bGold;
      results.push({ rar: rarityLabel(rar), gold: bGold });
    }
    // 日志：基础击杀 + Boss Roll1/Roll2
    log('i', '击杀 ' + enemyName + '，+' + gold + ' 金');
    if (results.length > 0) {
      if (isBoss) {
        log('s', '★击杀 Boss ' + enemyName
          + '  Roll1→[' + results[0].rar + ']+' + results[0].gold
          + '  Roll2→[' + results[1].rar + ']+' + results[1].gold
          + ' 合计+' + (results[0].gold + results[1].gold) + ' 金币');
      } else {
        if (hit) {
          log('s', '击杀奖励 Roll→[' + results[0].rar + ']+' + results[0].gold + ' 金币');
        }
      }
    }
  }

  // V3-4: 4 种塔目标策略。默认 'near'，存 grid[i].targetStrategy（缺省自动回 'near'）
  var TOWER_STRATEGIES = { NEAR: 'near', FAR: 'far', HIGH: 'high', LOW: 'low' };
  function _normStrategy(s) {
    if (!s) return TOWER_STRATEGIES.NEAR;
    if (s === TOWER_STRATEGIES.NEAR || s === TOWER_STRATEGIES.FAR || s === TOWER_STRATEGIES.HIGH || s === TOWER_STRATEGIES.LOW) return s;
    return TOWER_STRATEGIES.NEAR;
  }
  function strategyLabel(s) {
    return ({ near:'最近', far:'进度最快', high:'血最多', low:'血最少' })[_normStrategy(s)] || '最近';
  }

  // ==========================================================================
  // V4-5 Task 9：塔升级等级成本 / level 线性加成 / L3 5 种特殊效果注册表
  // ==========================================================================
  var LEVEL_UP_COST_L = [40, 80, 120]; // L0→L1, L1→L2, L2→L3（对应 g.level → nextLv = g.level+1，index=g.level）
  var LEVEL_MAX = 3;
  // 每级线性系数：伤害 ×1.30，攻速 +10%（interval ÷1.1），范围 ×1.05；累计 Lk = level 级就是 Math.pow(k, lv)
  var LV_MUL_DMG = 1.30, LV_MUL_ATK_SPD = 1.10, LV_MUL_RANGE = 1.05;

  // 5 种 L3 特殊效果（等概率随机，互斥）：icon 用于 canvas 角标 & L3 roll modal / L3 展示块
  var L3_EFFECTS = [
    { id: 'effect_offense',      icon: '⚔', name: '进攻狂潮',   desc: '伤害 +40%，范围 +15%',
      stat: { damageMul: 1.40, rangeMul: 1.15 } },
    { id: 'effect_control',      icon: '❄', name: '极寒控制',   desc: '减速塔减速幅度+25%；AOE塔半径+30%；否则攻速+20%',
      stat: { control: true, slowStrengthMul: 1.25, aoeRadiusMul: 1.30, fallbackAttackIntervalMul: 1/1.2 } },
    { id: 'effect_double_shot',  icon: '🎯', name: '双重打击',   desc: '每次攻击另选范围内不同敌人再打 80% 伤害',
      stat: { trigger: 'double_shot', extraDamageMul: 0.80 } },
    { id: 'effect_crit',         icon: '💥', name: '致命暴击',   desc: '15% 概率打出 2.5× 伤害（命中红折线飞出）',
      stat: { trigger: 'crit', critChance: 0.15, critMul: 2.5 } },
    { id: 'effect_ricochet',     icon: '↯',  name: '弹射链击',   desc: '命中后弹射另一敌人 60%，再弹 42%（最多2次，衰减70%）',
      stat: { trigger: 'ricochet', maxBounces: 2, firstMul: 0.60, decayEach: 0.70 } }
  ];
  var L3_EFFECT_BY_ID = {};
  (function(){ for (var i=0;i<L3_EFFECTS.length;i++) L3_EFFECT_BY_ID[L3_EFFECTS[i].id] = L3_EFFECTS[i]; })();
  function rollL3Effect() { return L3_EFFECTS[Math.floor(Math.random() * L3_EFFECTS.length)]; }
  function getL3Effect(id){ return (id && L3_EFFECT_BY_ID[id]) ? L3_EFFECT_BY_ID[id] : null; }
  function towerLevelMul(level) {
    var lv = Number(level) || 0;
    if (lv <= 0) return { dmg: 1, interval: 1, range: 1 };
    var d = 1, i = 1, r = 1;
    for (var k = 0; k < lv; k++) { d *= LV_MUL_DMG; i /= LV_MUL_ATK_SPD; r *= LV_MUL_RANGE; }
    return { dmg: d, interval: i, range: r };
  }

  // ==========================================================================
  // V4-7 塔能量系统：能量配置 / 技能配置 解耦，每塔 towerCfg.energyCfg + towerCfg.skillCfg
  //   - towerCfg.energyCfg = { id, max, perAttack, perSecond }
  //   - towerCfg.skillCfg  = { id, name, icon, desc, skillType, damageMul, armorIgnorePct, slowMul, slowTicksSec }
  //   - 没有挂 energyCfg / skillCfg 的情况下（如旧塔、特殊塔动态合成后）走这里的 FALLBACK 兜底
  // ==========================================================================
  var TOWER_ENERGY_MAX       = 100;   // 全局 fallback 上限（已升级为 per-tower）
  var TOWER_ENERGY_PER_ATTACK  = 1;   // 全局 fallback
  var TOWER_ENERGY_PER_SECOND  = 1;   // 全局 fallback
  var TOWER_DEFAULT_SKILL_ID   = 'double_strike';
  var TOWER_DEFAULT_SKILL_NAME = '蓄势一击';
  var TOWER_DEFAULT_SKILL_DESC = '满能后下一次攻击造成双倍伤害';
  var TOWER_SKILL_DOUBLE_MUL   = 2;   // 全局 fallback 倍率（已升级为 per-tower）
  var _FALLBACK_ENERGY_CFG = { id: 'normal',     max: 100, perAttack: 1,   perSecond: 1 };
  var _FALLBACK_SKILL_CFG  = { id: 'double_strike', name: TOWER_DEFAULT_SKILL_NAME, icon: '💥', desc: TOWER_DEFAULT_SKILL_DESC,
                               skillType: 'damage_mult', damageMul: TOWER_SKILL_DOUBLE_MUL, armorIgnorePct: 0, slowMul: 1, slowTicksSec: 0 };

  /** 安全从 gridObj 取 towerCfg（g.towerCfg 可能旧版本没有 energyCfg/skillCfg）—— 返回 never-null 对象 */
  function _getTowerCfg(g) { return (g && g.towerCfg) ? g.towerCfg : {}; }
  function getTowerEnergyCfg(g) {
    var tc = _getTowerCfg(g);
    var c = tc.energyCfg || null;
    if (!c || typeof c !== 'object') return _FALLBACK_ENERGY_CFG;
    // 防御式 clamp
    var max       = Number(c.max);
    var perAttack = Number(c.perAttack);
    var perSecond = Number(c.perSecond);
    if (!(max > 0))              max       = _FALLBACK_ENERGY_CFG.max;
    if (!(perAttack >= 0))       perAttack = _FALLBACK_ENERGY_CFG.perAttack;
    if (!(perSecond >= 0))       perSecond = _FALLBACK_ENERGY_CFG.perSecond;
    return {
      id:        (typeof c.id === 'string' && c.id) ? c.id : _FALLBACK_ENERGY_CFG.id,
      max:       max,
      perAttack: perAttack,
      perSecond: perSecond,
      desc:      (typeof c.desc === 'string') ? c.desc : ''
    };
  }
  function getTowerSkillCfg(g) {
    var tc = _getTowerCfg(g);
    var c = tc.skillCfg || null;
    if (!c || typeof c !== 'object') return _FALLBACK_SKILL_CFG;
    var dmgMul       = Number(c.damageMul);
    var armorIgnore  = Number(c.armorIgnorePct);
    var slowMul      = Number(c.slowMul);
    var slowSec      = Number(c.slowTicksSec);
    if (!(dmgMul >= 1))           dmgMul      = _FALLBACK_SKILL_CFG.damageMul;
    if (!(armorIgnore >= 0))      armorIgnore = 0;   // NaN / 负数 → 0（后端 omitempty 导致缺字段，Number(undefined)=NaN）
    if (!(armorIgnore <= 1))      armorIgnore = 1;
    if (!(slowMul > 0))           slowMul     = 1;   // NaN / 非正数 → 1（= 不减速）
    if (!(slowSec >= 0))          slowSec     = 0;
    return {
      id:             (typeof c.id === 'string' && c.id) ? c.id : _FALLBACK_SKILL_CFG.id,
      name:           (typeof c.name === 'string' && c.name) ? c.name : _FALLBACK_SKILL_CFG.name,
      icon:           (typeof c.icon === 'string' && c.icon) ? c.icon : _FALLBACK_SKILL_CFG.icon,
      desc:           (typeof c.desc === 'string') ? c.desc : '',
      skillType:      (typeof c.skillType === 'string' && c.skillType) ? c.skillType : _FALLBACK_SKILL_CFG.skillType,
      damageMul:      dmgMul,
      armorIgnorePct: armorIgnore,
      slowMul:        slowMul,
      slowTicksSec:   slowSec
    };
  }
  /** 给 gridObj 能量赋值安全钳制 & 自动切 skillReady（按 per-tower max） */
  function _towerAddEnergy(g, add) {
    if (!g) return;
    if (typeof g.energy !== 'number') g.energy = 0;
    var max = getTowerEnergyCfg(g).max;
    g.energy = Math.max(0, Math.min(max, g.energy + Number(add || 0)));
    if (g.energy >= max) { g.skillReady = true; }
  }
  function _towerResetEnergy(g) {
    if (!g) return;
    g.energy = 0;
    g.skillReady = false;
    g.skillActive = false;
  }
  function _towerConsumeSkillEnergy(g) {
    if (!g) return;
    g.energy = 0;
    g.skillReady = false;
    g.skillActive = false;
  }
  // 保证对象上有 energy/skillReady/skillActive 三个字段（所有"新建塔"路径都调用一次）
  function _towerEnsureEnergyFields(g, initEnergy) {
    if (!g) return;
    var max = getTowerEnergyCfg(g).max;
    if (typeof g.energy !== 'number') g.energy = Math.max(0, Math.min(max, Number(initEnergy) || 0));
    else                               g.energy = Math.max(0, Math.min(max, Number(g.energy)      || 0));
    if (typeof g.skillReady !== 'boolean') g.skillReady = (g.energy >= max);
    if (typeof g.skillActive !== 'boolean') g.skillActive = false;
  }

  function stepTowers(dt, buffMul) {
    var cs = state.cell;
    var nowWe = state.waveElapsed;
    for (var i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i] !== T_TOWER) continue;
      var g = state.grid[i];
      if (!g || !g.towerCfg) continue;
      // ===== V4 Task8：meteor 眩晕，waveElapsed < stunUntil 跳过本塔攻击 =====
      if (g.stunUntil && nowWe < g.stunUntil) continue;
      // ===== V4 Task9：等级 + L3 effect → 统一走 calcTowerEffective（含 buff/env/level/L3）=====
      if (typeof g.level !== 'number') g.level = 0;
      var tev = calcTowerEffective(g.towerCfg, buffMul, g);
      if (!tev) continue;
      var eff = tev.eff;
      var attackIntv = Math.max(0.05, eff.interval);
      g.cooldown = Math.max(0, (g.cooldown || 0) - dt);
      if (g.cooldown > 0) continue;
      // 保证统计字段存在
      if (typeof g.damageDealt !== 'number') g.damageDealt = 0;
      if (typeof g.kills !== 'number') g.kills = 0;
      var gx = i % state.cols, gy = Math.floor(i / state.cols);
      var center = cellCenterPx(gx, gy);
      // eff.rangePx 已是 level*buff*env*effect 最终范围（calcTowerEffective 已乘 rangeMul 全量）
      var effRange = eff.rangePx;
      var strategy = _normStrategy(g.targetStrategy);
      var best = _pickTargetInRange(center, effRange, strategy, null);
      if (!best) continue;
      // ===== V4-7 塔能量系统：本次发炮 ATTACK_ENERGY（perAttack 因塔而异）+ 若 skillReady 且未激活 → 激活 skillActive =====
      _towerEnsureEnergyFields(g, 0);
      var _enCfgNow = getTowerEnergyCfg(g);
      _towerAddEnergy(g, _enCfgNow.perAttack);
      var skillFire = false;
      var skillParams = { skillDamageMul: 1, skillArmorIgnorePct: 0, skillSlowMul: 1, skillSlowTicksSec: 0 };
      if (g.skillReady && !g.skillActive) {
        g.skillActive = true;
        skillFire = true;
        var _sc = getTowerSkillCfg(g);
        skillParams.skillDamageMul       = _sc.damageMul;
        skillParams.skillArmorIgnorePct  = _sc.armorIgnorePct;
        skillParams.skillSlowMul         = _sc.slowMul;
        skillParams.skillSlowTicksSec    = _sc.slowTicksSec;
      }
      // L3 effect 预计算：trigger
      var fx = tev.rollEffectObj || null;
      var trigger = (fx && fx.stat && fx.stat.trigger) ? fx.stat.trigger : null;
      // crit roll：致命暴击（15% + 天赋暴击本能 bonus × critMul 2.5）
      var isCrit = false;
      var critMul = 1;
      if (trigger === 'crit' && typeof fx.stat.critChance === 'number' && typeof fx.stat.critMul === 'number') {
        var tCritBonus = Number(tev.talentCritRateBonus) || 0;
        var critRate = Math.max(0, Math.min(0.95, Number(fx.stat.critChance) + tCritBonus));
        isCrit = Math.random() < critRate;
        critMul = fx.stat.critMul;
      }
      // 塔攻击序列帧（使用最新 cell×1.2÷720 的动态 scale；窗口 ResizeObserver 改 cell 后下次 spawn 自动生效）
      if (globalAnimPlayer && globalAnimPlayer.hasAnim('towerAttack')) {
        var animTargetPx = (Number(state.cell) || 48) * 1.2;
        var animScale = animTargetPx / 720;
        var anchor = cellTowerAnchorPx(gx, gy);
        globalAnimPlayer.spawn('towerAttack', {
          x: anchor.x,
          y: anchor.y,
          loop: 'none',
          speed: 1,
          scale: animScale > 0 ? animScale : undefined
        });
      }
      // 主子弹：携带最终伤害（level/buff/env 已乘到 damage）+ crit 信息
      var src = { sourceGridIdx: i };
      state.projectiles.push({
        x: center.cx, y: center.cy,
        targetId: best.instId,
        speed: 520,
        color: g.towerCfg.color || '#fde047',
        towerCfg: g.towerCfg,
        sourceGridIdx: i,
        // V4 Task9：最终单发伤害（不含 critMul，命中时再 ×；finalDamageOverride 中不含 armor/resist，会在 damageEnemy 中走 apply 再用 finalDamageOverride）
        finalDamage: eff.damage,
        effInterval: attackIntv,
        effAoeRadiusPx: (tev.aoeRadiusPx > 0) ? tev.aoeRadiusPx : (Number(g.towerCfg.aoeRadiusPx) || 0),
        isCrit: isCrit,
        critMul: critMul,
        ricochetCfg: (trigger === 'ricochet') ? fx.stat : null,
        slowMulExtra: (fx && fx.stat && fx.stat.control && typeof (tev.slowMulExtra||1) === 'number') ? (tev.slowMulExtra || 1) : 1,
        // V4-7 塔能量技能：skillFire=true 时把 skillParams 透传进 damageEnemy（替代旧版 energySkillActive 直接翻倍）
        energySkillActive: !!skillFire,
        skillDamageMul: skillParams.skillDamageMul,
        skillArmorIgnorePct: skillParams.skillArmorIgnorePct,
        skillSlowMul: skillParams.skillSlowMul,
        skillSlowTicksSec: skillParams.skillSlowTicksSec
      });
      // ===== double_shot：再选一个与 best 不同的敌人，打 extraDamageMul（0.80）伤害，无 crit 无弹射链 =====
      if (trigger === 'double_shot') {
        var dblTarget = _pickTargetInRange(center, effRange, TOWER_STRATEGIES.NEAR, best.instId);
        if (dblTarget) {
          var extra = Number(fx.stat.extraDamageMul) || 0.8;
          state.projectiles.push({
            x: center.cx, y: center.cy,
            targetId: dblTarget.instId,
            speed: 560,
            color: g.towerCfg.color || '#fde047',
            towerCfg: g.towerCfg,
            sourceGridIdx: i,
            finalDamage: Math.max(1, Math.floor(eff.damage * extra)),
            effInterval: attackIntv,
            effAoeRadiusPx: 0, // double shot 不触发 AOE
            isCrit: false,
            critMul: 1,
            ricochetCfg: null,
            slowMulExtra: (fx && fx.stat && fx.stat.control) ? (tev.slowMulExtra || 1) : 1,
            tag: 'double',
            // double_shot 也享受同一发技能能量加成（用户感知：满能双弹都翻倍）
            energySkillActive: !!skillFire,
            skillDamageMul: skillParams.skillDamageMul,
            skillArmorIgnorePct: skillParams.skillArmorIgnorePct,
            skillSlowMul: skillParams.skillSlowMul,
            skillSlowTicksSec: skillParams.skillSlowTicksSec
          });
        }
      }
      g.cooldown = attackIntv;
    }
  }

  // 与 stepTowers 解耦：给定中心、范围、策略，返回一个 alive 敌人（可选排除某 instId）
  function _pickTargetInRange(center, rangePx, strategy, excludeInstId) {
    var rr2 = rangePx * rangePx;
    var best = null;
    var s = _normStrategy(strategy);
    if (s === TOWER_STRATEGIES.FAR) {
      var bestScore = -Infinity;
      for (var j = 0; j < state.enemies.length; j++) {
        var e = state.enemies[j];
        if (!e.alive) continue;
        if (excludeInstId != null && e.instId === excludeInstId) continue;
        var ddx = e.px - center.cx, ddy = e.py - center.cy;
        var dd = ddx * ddx + ddy * ddy;
        if (dd > rr2) continue;
        var score = e.pathIdx * 1e9 + (dd * 0.001);
        if (score > bestScore) { best = e; bestScore = score; }
      }
    } else if (s === TOWER_STRATEGIES.HIGH) {
      var bh = -Infinity;
      for (var j = 0; j < state.enemies.length; j++) {
        var e = state.enemies[j]; if (!e.alive) continue;
        if (excludeInstId != null && e.instId === excludeInstId) continue;
        var ddx = e.px - center.cx, ddy = e.py - center.cy;
        var dd = ddx * ddx + ddy * ddy;
        if (dd > rr2) continue;
        if (e.hp > bh) { best = e; bh = e.hp; }
      }
    } else if (s === TOWER_STRATEGIES.LOW) {
      var lh = Infinity;
      for (var j = 0; j < state.enemies.length; j++) {
        var e = state.enemies[j]; if (!e.alive) continue;
        if (excludeInstId != null && e.instId === excludeInstId) continue;
        var ddx = e.px - center.cx, ddy = e.py - center.cy;
        var dd = ddx * ddx + ddy * ddy;
        if (dd > rr2) continue;
        if (e.hp < lh) { best = e; lh = e.hp; }
      }
    } else {
      var bd = Infinity;
      for (var j = 0; j < state.enemies.length; j++) {
        var e = state.enemies[j]; if (!e.alive) continue;
        if (excludeInstId != null && e.instId === excludeInstId) continue;
        var ddx = e.px - center.cx, ddy = e.py - center.cy;
        var dd = ddx * ddx + ddy * ddy;
        if (dd <= rr2 && dd < bd) { best = e; bd = dd; }
      }
    }
    return best;
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
        // ===== hit =====
        var src = { sourceGridIdx: (typeof p.sourceGridIdx === 'number') ? p.sourceGridIdx : null };
        // V4 Task9：优先使用 finalDamage（level/buff/env 已算好）+ critMul
        if (typeof p.finalDamage === 'number' && p.finalDamage >= 0) {
          var baseFinal = p.finalDamage;
          // ===== V4-7 塔能量技能解耦：不再在外部 × 固定倍率，改为把 skillDamageMul/armor/slow 透传进 damageEnemy =====
          src.finalDamageOverride = baseFinal;
          src.isCrit = !!p.isCrit;
          src.critMul = Number(p.critMul) || 1;
          if (typeof p.slowMulExtra === 'number') src.slowMulExtra = p.slowMulExtra;
          // 把子弹上的 skill 参数直接透传到伤害函数（damageEnemy 内统一 × skillDmgMul、穿甲、减速）
          if (typeof p.skillDamageMul      === 'number') src.skillDamageMul      = p.skillDamageMul;
          if (typeof p.skillArmorIgnorePct === 'number') src.skillArmorIgnorePct = p.skillArmorIgnorePct;
          if (typeof p.skillSlowMul        === 'number') src.skillSlowMul        = p.skillSlowMul;
          if (typeof p.skillSlowTicksSec   === 'number') src.skillSlowTicksSec   = p.skillSlowTicksSec;
          // V4-7：子弹命中后给 source 塔清零能量（如果是 skillFire=true 的那发）—— 放到 damageEnemy 前，确保 AOE/单体 无论是否击杀都能正确"扣能量"
          if (p.energySkillActive && typeof src.sourceGridIdx === 'number') {
            var srcG = state.grid[src.sourceGridIdx];
            if (srcG) _towerConsumeSkillEnergy(srcG);
          }
        }
        var lastFrom = { px: target.px, py: target.py };
        damageEnemy(target, p.towerCfg, false, buffMul, src);
        // AOE（若有 effAoeRadiusPx 覆盖配置默认）
        var aoeR = Number(p.effAoeRadiusPx);
        if (p.towerCfg.isAOE && aoeR > 0) {
          var r2 = aoeR * aoeR;
          for (var k = 0; k < state.enemies.length; k++) {
            var e2 = state.enemies[k];
            if (!e2.alive || e2.instId === target.instId) continue;
            var ddx = e2.px - target.px, ddy = e2.py - target.py;
            if (ddx * ddx + ddy * ddy <= r2) {
              var srcAoe = { sourceGridIdx: src.sourceGridIdx };
              if (typeof p.finalDamage === 'number' && p.finalDamage >= 0) {
                var aoeBase = p.finalDamage;
                srcAoe.finalDamageOverride = aoeBase;
                srcAoe.isCrit = false;
                srcAoe.critMul = 1;
                if (typeof p.slowMulExtra === 'number') srcAoe.slowMulExtra = p.slowMulExtra;
                // V4-7：AOE 同样透传技能参数（伤害×/穿甲/减速全部享受，保证 AOE 塔"满能爆炸"感知一致）
                if (typeof p.skillDamageMul      === 'number') srcAoe.skillDamageMul      = p.skillDamageMul;
                if (typeof p.skillArmorIgnorePct === 'number') srcAoe.skillArmorIgnorePct = p.skillArmorIgnorePct;
                if (typeof p.skillSlowMul        === 'number') srcAoe.skillSlowMul        = p.skillSlowMul;
                if (typeof p.skillSlowTicksSec   === 'number') srcAoe.skillSlowTicksSec   = p.skillSlowTicksSec;
              }
              damageEnemy(e2, p.towerCfg, false, buffMul, srcAoe);
            }
          }
        }
        // ===== V4 Task9：Ricochet（弹射链击）—— 主目标命中后，链式选其他敌人 =====
        if (p.ricochetCfg && !p._isBounced) {
          var maxBounces = Math.max(0, parseInt(p.ricochetCfg.maxBounces || 0, 10));
          if (maxBounces > 0) {
            var firstMul = Number(p.ricochetCfg.firstMul) || 0.6;
            var decay = Number(p.ricochetCfg.decayEach) || 0.7;
            var fromPt = lastFrom;
            var prevDmg = (typeof p.finalDamage === 'number') ? p.finalDamage : (p.towerCfg ? Number(p.towerCfg.baseDamage) : 0);
            // V4-7 塔能量技能：弹射链不再在外部 × 固定倍率，改为透传 skill 参数（在 damageEnemy 内叠加到 chain 衰减后的每一跳）
            var chainMul = firstMul;
            var already = {};
            already[target.instId] = true;
            for (var bi = 0; bi < maxBounces; bi++) {
              var nextDmg = Math.max(1, Math.floor(prevDmg * chainMul));
              var nxTarget = _pickNearestAliveExclusive(fromPt, 9999, already);
              if (!nxTarget) break;
              var srcR = { sourceGridIdx: src.sourceGridIdx, finalDamageOverride: nextDmg, isCrit: false, critMul: 1, ricochetFx: { from: { px: fromPt.px, py: fromPt.py } } };
              if (typeof p.slowMulExtra === 'number') srcR.slowMulExtra = p.slowMulExtra;
              // V4-7：弹射链每一跳都携带技能参数（×/穿甲/减速与主弹保持一致）
              if (typeof p.skillDamageMul      === 'number') srcR.skillDamageMul      = p.skillDamageMul;
              if (typeof p.skillArmorIgnorePct === 'number') srcR.skillArmorIgnorePct = p.skillArmorIgnorePct;
              if (typeof p.skillSlowMul        === 'number') srcR.skillSlowMul        = p.skillSlowMul;
              if (typeof p.skillSlowTicksSec   === 'number') srcR.skillSlowTicksSec   = p.skillSlowTicksSec;
              damageEnemy(nxTarget, p.towerCfg, false, buffMul, srcR);
              already[nxTarget.instId] = true;
              fromPt = { px: nxTarget.px, py: nxTarget.py };
              prevDmg = nextDmg;
              chainMul = chainMul * decay;
            }
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

  // 找离 center 最近且不在已命中集合里的 alive 敌人（用于弹射链）
  function _pickNearestAliveExclusive(center, maxPx, excludeMap) {
    var best = null;
    var bd = (Number(maxPx) || 9999) * 9999;
    for (var j = 0; j < state.enemies.length; j++) {
      var e = state.enemies[j];
      if (!e.alive) continue;
      if (excludeMap && excludeMap[e.instId]) continue;
      var ddx = e.px - center.px, ddy = e.py - center.py;
      var dd = ddx * ddx + ddy * ddy;
      if (dd <= bd) { best = e; bd = dd; }
    }
    return best;
  }

  function battleTick(nowMs) {
    if (state.phase !== PHASE.BATTLE) return;
    if (!state.lastFrame) state.lastFrame = nowMs;
    var dtRaw = (nowMs - state.lastFrame) / 1000;
    state.lastFrame = nowMs;
    if (dtRaw > 0.1) dtRaw = 0.1; // cap
    // ====== V4 Task8：ice freezer → 冻结阶段（战斗 dt=0，持续 freezeSec 秒，不推进但战斗 tick 仍刷新 canvas）======
    var dt = dtRaw;
    if (state.iceUntil && state.waveElapsed < state.iceUntil) {
      dt = 0;
    }
    // slow remnant：残留减速所有敌人（ice skill 在 interval (iceUntil, slowRemnantUntil] 对 enemy.speed 额外 × slowMul）
    //   这个不在这里乘；在 stepEnemy 开头 effSpeed 前判断 state.slowRemnantUntil
    if (state.slowRemnantUntil && state.waveElapsed >= state.slowRemnantUntil) {
      state.slowRemnantUntil = 0; state.iceSlowMul = 1;
    }
    state.waveElapsed += dtRaw; // waveElapsed 永远推进（包括冻结时），避免技能"卡住"时间轴
    // V4-Anim: 推进所有塔攻击/粒子序列帧（none 模式播放完自动 kill，实例不堆积）
    if (globalAnimPlayer) globalAnimPlayer.update(dtRaw);
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
    // ====== V4 Task8：BOSS / 精英主动技能推进（meteor 眩晕、ice 冰冻减速残留等）======
    castSkillsIfDue(dtRaw);
    // V4-2 Task 5：environment.onTick（熔岩地图 tile=7 敌人每 lavaEverySec 秒扣 lavaDmg 真实伤害，不计塔 DPS）
    var env2 = currentEnvironment();
    if (env2 && env2.onTick === 'lava_damage_5hp' && (env2.lavaDmg || 0) > 0) {
      var everySec = Number(env2.lavaEverySec) || 0.5;
      var dmgPer = Number(env2.lavaDmg) || 5;
      for (var ie = 0; ie < state.enemies.length; ie++) {
        var e2 = state.enemies[ie];
        if (!e2.alive) continue;
        // 将 e 像素位置反推格子；再判断 tile 是否 == T_LAVA (7)
        var cc = pxToCell(e2.px, e2.py);
        if (cc && cc.x >= 0 && cc.y >= 0 && tileAt(cc.x, cc.y) === T_LAVA) {
          e2.lavaTickTimer = (Number(e2.lavaTickTimer) || 0) + dt;
          if (e2.lavaTickTimer >= everySec) {
            e2.lavaTickTimer -= everySec;
            e2.hp -= dmgPer;
            // 熔岩真实伤害：不累计塔 DPS，但允许击杀（不算塔击杀，无金币奖励更爽？→ 给基础击杀金，sourceIdx=null）
            if (e2.hp <= 0) killEnemy(e2, null, null, { sourceGridIdx: null });
          }
        } else {
          e2.lavaTickTimer = 0; // 离开熔岩格重置计时（避免踏一格立刻触发上一次累计）
        }
      }
    }
    // ====== V4-7 塔能量系统：每塔独立 PER_SECOND_ENERGY（perSecond）======
    if (dt > 0) {
      for (var _ei = 0; _ei < state.tiles.length; _ei++) {
        if (state.tiles[_ei] !== T_TOWER) continue;
        var _g2 = state.grid[_ei];
        if (!_g2 || _g2.skillActive) continue;   // 已经激活技能等待命中：本帧不再充能直到命中后归零
        var _eCfg = getTowerEnergyCfg(_g2);
        if (_eCfg.perSecond <= 0) continue;
        _towerAddEnergy(_g2, dt * _eCfg.perSecond);
      }
    }
    // 塔攻击
    stepTowers(dt, buffMul);
    // 子弹
    stepProjectiles(dt, buffMul);
    // 命中视觉过期（crit折线 / 弹射连线）—— 用战斗 dtRaw 让视觉"速度稳定"（即使被 ice 冻结也推进消失，避免卡屏）
    stepHitFx(dtRaw);
    // 检查战斗是否结束
    var anyAlive = false;
    for (var j = 0; j < state.enemies.length; j++) if (state.enemies[j].alive) { anyAlive = true; break; }
    if (state.phase === PHASE.BATTLE && !anyAlive && state.spawnQueue.length === 0) {
      // 波末：奖励金币
      var w = currentWaveCfg();
      var rewardRaw = w ? (w.rewardGold || 0) : 0;
      // V4-1 TR-2.2：波末奖励 × difficultyMul.gold（向上取整，玩家不吃亏）
      var reward = rewardRaw > 0 ? Math.max(1, Math.round(rewardRaw * (Number((state.difficultyMul && state.difficultyMul.gold) || 1)))) : 0;
      if (reward > 0) { state.gold += reward; log('s', '波次奖励 +' + reward + ' 金币' + (reward !== rewardRaw ? '（难度 ×' + state.difficultyMul.gold + '，原 ' + rewardRaw + '）' : '')); }
      log('s', '第 ' + state.waveIndex + ' 波战斗结束');
      // DPS 快照：在切到 WAVEEND 前保存本波伤害/击杀榜（点塔时可看到上波数据）
      snapshotTowerWaveStats();
      logDpsLeaderboard(state.waveDamageStats);
      // 若为最后一波 → WIN
      if (state.waveIndex >= state.maxWaves) {
        state.phase = PHASE.WIN;
        // V4-2 Task 5：WIN 解锁下一张地图（map1→map2, map2→map3）
        var unlockRes = tryUnlockNextMap(state.mapId, 'WIN');
        var unlockHTML = '';
        if (unlockRes && unlockRes.nextId) unlockHTML = (unlockRes.already ? '<br>（地图 ' + unlockRes.nextId + ' 已解锁）' : '<br>🎁 新地图解锁：Map ' + unlockRes.nextId + '（下次重开可见）');
        document.getElementById('end-title').textContent = '通关！';
        document.getElementById('end-summary').innerHTML =
          '全部 <b>' + state.maxWaves + '</b> 波通关！剩余金币 <b>' + state.gold + '</b>；基地 <b>' + state.baseHP + '/' + state.baseMaxHP + '</b>。' + unlockHTML;
        // DPS 榜（结局弹框中展示）
        renderDpsBoardHTML(state.waveDamageStats, 'end-dps-board');
        refreshEndAutosaveUI('win');
        document.getElementById('end-modal').classList.remove('hidden');
        refreshHUD(); draw();
        // V3-1 云端 autosave（已登录时）
        autoSaveIfLoggedIn('win');
        return;
      }
      state.phase = PHASE.WAVEEND;
      showWaveendModal();
    }
    refreshHUD();
    draw();
  }

  function renderLoop(now) {
    // Always re-register RAF FIRST so the chain stays alive permanently,
    // even if battleTick throws or state.running transiently becomes false.
    // This prevents the classic "放完5次塔后不出怪，点重开就好" bug caused
    // by a dead RAF chain (any single-frame error or running=false would kill
    // the chain permanently because the previous implementation registered RAF
    // AFTER the running check / battleTick work).
    state.rafId = requestAnimationFrame(renderLoop);
    if (!state.running) return;
    try {
      battleTick(now);
    } catch (e) {
      var msg = (e && e.message) ? e.message : String(e || 'unknown');
      var stack = (e && e.stack) ? String(e.stack).slice(0, 500) : '';
      log('e', '[battleTick] 异常: ' + msg + (stack ? ('\n' + stack) : ''));
      try { setMsg('战斗帧异常，已自动保护继续运行：' + msg, true); } catch (_) {}
    }
  }

  // Idempotent guarantee that the render loop is alive and running.
  // Safe to call at any phase transition that must be followed by live animation ticks.
  function ensureRenderLoop() {
    state.running = true;
    if (!state.rafId) {
      try { cancelAnimationFrame(state.rafId); } catch (_) {}
      state.rafId = requestAnimationFrame(renderLoop);
    }
  }

  // ---------- V3-4 Tower Info Modal ----------
  var _towerInfoIdx = null;
  // V4 Task9：L3 roll 动画阶段控制（null / 'spinning' / 'landed'）
  var _l3RollState = null;
  var _l3RollTargetGridIdx = null;
  var _l3RollResult = null;

  function upgradeTower(gridIdx) {
    if (gridIdx == null) return;
    var g = state.grid[gridIdx];
    if (!g || !g.towerCfg) return;
    if (typeof g.level !== 'number') g.level = 0;
    // 阶段：升级按钮仅允许在 PREPARE / WAVEEND 阶段（战斗中 / RESERVE / 结局 → 统一禁用，UI 层也会 disabled）
    if (state.phase !== PHASE.PREPARE && state.phase !== PHASE.WAVEEND) {
      toast('仅在准备阶段 / 波次结算可升级', 'info');
      return;
    }
    if (g.level >= LEVEL_MAX) {
      toast('已达到最高等级 L' + LEVEL_MAX, 'info');
      return;
    }
    var costIdx = g.level; // L0→L1: index 0, L1→L2: index 1, L2→L3: index 2
    var cost = LEVEL_UP_COST_L[costIdx] || 0;
    if (state.gold < cost) {
      toast('金币不足（需要 ' + cost + ' 金）', 'er');
      return;
    }
    state.gold -= cost;
    g.level += 1;
    log('s', '塔(' + (gridIdx % state.cols) + ',' + Math.floor(gridIdx / state.cols) + ')升级 → L' + g.level + '，消耗 ' + cost + ' 金币');
    if (g.level >= LEVEL_MAX) {
      // L3：roll effect + 弹窗动画 + 落定后写入 g.rollEffect
      _l3RollTargetGridIdx = gridIdx;
      _l3RollResult = rollL3Effect();
      startL3RollAnimation(_l3RollResult, function () {
        // 落定回调：写入 rollEffect（也作为"动画已经播过一次"的标识，后续不再重复弹）
        g.rollEffect = _l3RollResult.id;
        log('s', '塔(' + (gridIdx % state.cols) + ',' + Math.floor(gridIdx / state.cols) + ') L3 特殊效果 → ' + _l3RollResult.name + '（' + _l3RollResult.desc + '）');
        // 若升级弹框仍开着 → 刷新等级/效果显示 & 升级按钮置为已满级
        if (_towerInfoIdx === gridIdx) {
          openTowerInfoModal(gridIdx);
        }
        refreshHUD(); draw();
      });
    } else {
      // L0→L1 / L1→L2：即时刷新塔信息弹框 & HUD & 画布
      setMsg('升级成功！L' + g.level + '（-' + cost + ' 金）');
      if (_towerInfoIdx === gridIdx) openTowerInfoModal(gridIdx);
      refreshHUD(); draw();
    }
  }

  function startL3RollAnimation(effectObj, onDone) {
    var modal = document.getElementById('l3-roll-modal');
    var stage = document.getElementById('l3-roll-stage');
    var iconEl = document.getElementById('l3-roll-icon');
    var nameEl = document.getElementById('l3-roll-name');
    var descEl = document.getElementById('l3-roll-desc');
    if (!modal || !stage) { if (typeof onDone === 'function') onDone(); return; }
    // 清理旧态
    stage.classList.remove('landed');
    stage.classList.add('spinning');
    if (iconEl) { iconEl.className = ''; iconEl.textContent = ''; }
    if (nameEl) nameEl.textContent = '抽取中…';
    if (descEl) descEl.textContent = '从 5 种 L3 特殊效果中随机解锁 1 种';
    modal.classList.remove('hidden');
    _l3RollState = 'spinning';
    // 先跑 ~1.2s 随机切换 icon，模拟"旋转抽卡"
    var tickCount = 0;
    var total = 16;
    var tickMs = 75;
    var tickTimer = setInterval(function () {
      tickCount++;
      if (iconEl) {
        var tmp = L3_EFFECTS[Math.floor(Math.random() * L3_EFFECTS.length)];
        iconEl.textContent = tmp.icon;
        iconEl.className = 'ic l3fx-' + tmp.id;
      }
      if (tickCount >= total) {
        clearInterval(tickTimer);
        // 落定：显示抽中的 effectObj
        if (iconEl) {
          iconEl.textContent = effectObj.icon;
          iconEl.className = 'ic l3fx-' + effectObj.id;
        }
        if (nameEl) nameEl.textContent = effectObj.name;
        if (descEl) descEl.textContent = effectObj.desc;
        stage.classList.remove('spinning');
        stage.classList.add('landed');
        _l3RollState = 'landed';
        // 给 CSS keyframes 0.9s 结束后再回调（也允许玩家提前点关闭）
        setTimeout(function () {
          if (typeof onDone === 'function') { try { onDone(); } catch (_) {} }
        }, 950);
      }
    }, tickMs);
  }
  function hideL3RollModal() {
    var modal = document.getElementById('l3-roll-modal');
    if (modal) modal.classList.add('hidden');
    _l3RollState = null;
  }

  /** 塔信息弹窗定位：根据塔格子(gx,gy)自适应到对侧（左塔→右，右塔→左；放不下自动换边；Y 轴对齐塔中心，溢出贴边） */
  function _positionTowerInfoModal(gridIdx) {
    if (gridIdx == null || !state.canvas || !state.cols || !state.rows) return;
    var modal = document.getElementById('tower-info-modal');
    var body = modal && modal.querySelector('.modal-body');
    if (!modal || !body) return;
    // 1. 塔格中心的页面坐标（canvas 当前 CSS 渲染尺寸换算，适配 Resize/手机）
    var gx = gridIdx % state.cols;
    var gy = Math.floor(gridIdx / state.cols);
    var rect = state.canvas.getBoundingClientRect();
    var cssCell = (rect.width > 0 && state.cols > 0) ? (rect.width / state.cols) : (Number(state.cell) || 48);
    var tx = rect.left + (gx + 0.5) * cssCell;
    var ty = rect.top  + (gy + 0.5) * cssCell;
    // 2. 弹窗尺寸：如果还未 layout 就等到下一帧（防止 hidden→visible 瞬间 offsetWidth=0）
    var W = body.offsetWidth;
    var H = body.offsetHeight;
    if (W < 20 || H < 20) {
      try {
        requestAnimationFrame(function () { _positionTowerInfoModal(gridIdx); });
      } catch(e) { setTimeout(function () { _positionTowerInfoModal(gridIdx); }, 20); }
      return;
    }
    var viewW = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    var viewH = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    var PAD = 12;   // 距视口边缘安全边距
    var GAP = 10;   // 距塔格边缘的间距
    var cellHalf = cssCell / 2;
    // 3. 横向决策：优先"塔在对侧显示"（左半→弹窗在右，右半→弹窗在左），放不下就反方向，再不行贴边
    var preferRight = (tx < viewW / 2);
    var left = '', right = '';
    function tryRight() {
      var L = tx + cellHalf + GAP;
      if (L + W <= viewW - PAD) { left = L + 'px'; right = ''; return true; }
      return false;
    }
    function tryLeft() {
      // 弹窗左缘 = 塔左缘 - GAP - W
      var L = tx - cellHalf - GAP - W;
      if (L >= PAD) { left = L + 'px'; right = ''; return true; }
      return false;
    }
    var placed = false;
    if (preferRight) { placed = tryRight(); if (!placed) placed = tryLeft(); }
    else              { placed = tryLeft();  if (!placed) placed = tryRight(); }
    if (!placed) {
      // 两边都放不下（极窄屏）：贴安全边到左或右（尽量靠对侧）
      if (preferRight) {
        var L = viewW - PAD - W;
        left = Math.max(PAD, L) + 'px'; right = '';
      } else {
        left = PAD + 'px'; right = '';
      }
    }
    // 4. 纵向：以塔中心为基准上下对称；溢出就贴视口边（尽量让弹窗与塔重叠最少）
    var top = ty - H / 2;
    if (top < PAD) top = PAD;
    var topMax = Math.max(PAD, viewH - H - PAD);
    if (top > topMax) top = topMax;
    // 5. 应用（CSS transition 会平滑过渡）
    body.style.left = left;
    body.style.right = right;
    body.style.top = top + 'px';
    body.style.bottom = '';
  }

  function openTowerInfoModal(gridIdx) {
    var g = state.grid[gridIdx];
    if (!g || !g.towerCfg) return;
    _towerInfoIdx = gridIdx;
    var cfg = g.towerCfg;
    if (typeof g.level !== 'number') g.level = 0;
    var lv = g.level;
    var fx = getL3Effect(g.rollEffect);
    // A 升级后 gridObj.rarity 优先于配置的 towerCfg.rarity 显示
    var displayRarity = g.rarity || cfg.rarity;
    // 标题：[稀有] 名称 · Ln
    var title = document.getElementById('ti-title');
    if (title) title.textContent = '[' + rarityLabel(displayRarity) + '] ' + cfg.name + ' · L' + lv;
    // 属性：取 buff 叠加后的实际值，并显示「实际(基础)」
    var tev = calcTowerEffective(cfg, currentBuffMul(), g);
    var gx = gridIdx % state.cols, gy = Math.floor(gridIdx / state.cols);
    var tName = cfg.element ? elementLabel(cfg.element) : '';
    // 格式化：eff (base) 若与基础相同则只显示一个，避免冗余
    function fmtEffBase(eff, base, unit, digits) {
      var d = (typeof digits === 'number') ? digits : 0;
      var es = (typeof eff === 'number') ? eff.toFixed(d) : String(eff);
      var bs = (typeof base === 'number') ? base.toFixed(d) : String(base);
      unit = unit || '';
      if (es === bs) return es + unit;
      return es + unit + ' <span class="base-meta">(' + bs + unit + ')</span>';
    }
    function slowText(effPct, effSec, basePct, baseSec) {
      if (!effPct && !basePct) return '无';
      var d = 0;
      var es = Math.round(effPct * 100) + '% / ' + effSec.toFixed(1) + '秒';
      var bs = Math.round(basePct * 100) + '% / ' + baseSec.toFixed(1) + '秒';
      if (Math.round(effPct*100) === Math.round(basePct*100) && effSec === baseSec) return es;
      return es + ' <span class="base-meta">(' + bs + ')</span>';
    }
    var html = '';
    html += '<div class="row"><span class="k">位置</span><span class="v">(' + gx + ',' + gy + ')</span></div>';
    html += '<div class="row"><span class="k">元素</span><span class="v">' + (tName || '-') + '</span></div>';
    html += '<div class="row"><span class="k">稀有度</span><span class="v rar-' + (displayRarity||'common') + '">' + rarityLabel(displayRarity) + '</span></div>';
    html += '<div class="row"><span class="k">等级</span><span class="v">L' + lv + ' / L' + LEVEL_MAX + '</span></div>';
    if (fx) {
      html += '<div class="row l3-row"><span class="k">L3 效果</span><span class="v l3v">' +
        '<span class="l3v-icon">' + (fx.icon || '') + '</span>' +
        '<span class="l3v-name">' + (fx.name || '') + '</span>' +
        '<span class="l3v-desc">' + (fx.desc || '') + '</span>' +
        '</span></div>';
    }
    html += '<div class="row"><span class="k">伤害</span><span class="v">' + fmtEffBase(Math.round(tev.eff.damage), Math.round(tev.base.damage), tev.aoeTag, 0) + '</span></div>';
    html += '<div class="row"><span class="k">攻击间隔</span><span class="v">' + fmtEffBase(tev.eff.interval.toFixed(2), tev.base.interval.toFixed(2), ' 秒', -1) + '</span></div>';
    html += '<div class="row"><span class="k">攻击范围</span><span class="v">' + fmtEffBase(tev.eff.rangeCells.toFixed(2), tev.base.rangeCells.toFixed(2), ' 格', -1) + ' <span class="base-meta">≈ ' + Math.round(tev.eff.rangePx) + ' px</span></span></div>';
    html += '<div class="row"><span class="k">减速效果</span><span class="v">' + slowText(tev.eff.slowPct, tev.eff.slowSec, tev.base.slowPct, tev.base.slowSec) + '</span></div>';
    html += '<div class="row sep"><span class="k">DPS（估算）</span><span class="v dps">' + (tev.dps >= 10 ? Math.round(tev.dps) : tev.dps.toFixed(1)) + '</span></div>';
    html += '<div class="row"><span class="k">本波伤害</span><span class="v">' + (Number(g.damageDealt) || 0) + '</span></div>';
    html += '<div class="row"><span class="k">本波击杀</span><span class="v">' + (Number(g.kills) || 0) + '</span></div>';
    // 上波快照
    var snap = state.waveDamageStats;
    if (snap && snap.towers && (state.phase === PHASE.WAVEEND || state.phase === PHASE.WIN || state.phase === PHASE.LOSE)) {
      var s1 = null;
      for (var si = 0; si < snap.towers.length; si++) if (snap.towers[si].gridIdx === gridIdx) { s1 = snap.towers[si]; break; }
      if (s1) {
        html += '<div class="row"><span class="k">上波伤害#<span class="snap-wave">' + (snap.waveIndex||0) + '</span></span><span class="v">' + (Number(s1.damageDealt)||0) + '</span></div>';
        html += '<div class="row"><span class="k">上波击杀#<span class="snap-wave">' + (snap.waveIndex||0) + '</span></span><span class="v">' + (Number(s1.kills)||0) + '</span></div>';
      }
    }
    var live = computeLiveTotals();
    var liveDpsTxt = (live.totalDps >= 10) ? String(Math.round(live.totalDps)) : live.totalDps.toFixed(1);
    html += '<div class="row sep"><span class="k">当前总DPS</span><span class="v dps">' + liveDpsTxt + '</span></div>';
    html += '<div class="row"><span class="k">本波总击杀</span><span class="v">' + live.waveKills + '</span></div>';
    html += '<div class="row"><span class="k">累计总击杀</span><span class="v">' + live.totalKillsAllWaves + '</span></div>';
    html += '<div class="row sep"><span class="k">当前策略</span><span class="v">' + strategyLabel(g.targetStrategy) + '</span></div>';
    // ===== V4-7 塔能量系统：能量条 + 技能名 + 状态图标（全部改为按 per-tower 配置动态取值） =====
    _towerEnsureEnergyFields(g, 0);
    var _enCfgLocal = getTowerEnergyCfg(g);
    var _skCfgLocal = getTowerSkillCfg(g);
    var _enMax = _enCfgLocal.max;
    var _en = Math.max(0, Math.min(_enMax, Number(g.energy) || 0));
    var _enPct = _enMax > 0 ? (_en / _enMax) : 0;
    var _enState = '充能中';
    var _enIcon = '🔋';
    // 文案摘要：根据技能配置（有穿甲/减速的话优先展示，否则展示倍率）
    var _skSummary = '';
    if (_skCfgLocal.damageMul > 1) _skSummary += '×' + _skCfgLocal.damageMul.toFixed(2).replace(/\.?0+$/, '') + '伤害';
    if (_skCfgLocal.armorIgnorePct > 0) _skSummary += (_skSummary ? '+' : '') + '穿甲' + Math.round(_skCfgLocal.armorIgnorePct * 100) + '%';
    if (_skCfgLocal.slowMul < 1 && _skCfgLocal.slowTicksSec > 0) _skSummary += (_skSummary ? '+' : '') + '减速' + Math.round((1 - _skCfgLocal.slowMul) * 100) + '%/' + _skCfgLocal.slowTicksSec + 's';
    if (!_skSummary) _skSummary = '×' + _skCfgLocal.damageMul.toFixed(2).replace(/\.?0+$/, '') + '伤害';
    if (g.skillActive) { _enState = '激活中（本弹命中后生效：' + _skSummary + '）'; _enIcon = '⚡'; }
    else if (g.skillReady || _en >= _enMax) { _enState = '满能 · 下一击 ' + _skSummary; _enIcon = _skCfgLocal.icon || '💥'; }
    var _barStyle = 'width:100%;height:10px;background:#0b1220;border:1px solid #1e293b;border-radius:4px;overflow:hidden;margin-top:4px;';
    var _fillStyle = 'height:100%;background:linear-gradient(90deg,';
    if (g.skillActive) _fillStyle += '#fb923c,#f97316';
    else if (g.skillReady || _en >= _enMax) _fillStyle += '#fde047,#facc15,#ca8a04';
    else _fillStyle += '#4ade80,#22c55e,#16a34a';
    _fillStyle += ');width:' + Math.round(_enPct * 100) + '%;transition:width .15s linear;';
    html += '<div class="row sep"><span class="k">' + _enIcon + ' 能量技能</span><span class="v"><b>' + _skCfgLocal.name + '</b>（' + _enState + '）'
      + '<br><span style="font-size:11px;color:#94a3b8;">说明：' + (_skCfgLocal.desc || TOWER_DEFAULT_SKILL_DESC) + '</span>'
      + '<div style="' + _barStyle + '"><div style="' + _fillStyle + '"></div></div>'
      + '<span style="font-size:11px;color:#cbd5e1;">' + Math.floor(_en) + ' / ' + _enMax
      + '（攻击 +' + _enCfgLocal.perAttack + '，每秒 +' + _enCfgLocal.perSecond + '）</span>'
      + '<br><span style="font-size:11px;color:#94a3b8;">能量配置：' + (_enCfgLocal.id || 'normal') + ' · ' + (_enCfgLocal.desc || '') + '</span>'
      + '</span></div>';
    var stats = document.getElementById('ti-stats');
    if (stats) stats.innerHTML = html;
    // L3 effect block（弹窗右上角）：无效果时隐藏；有效果时显示
    var fxBlock = document.getElementById('ti-effect-block');
    if (fxBlock) {
      if (fx) {
        fxBlock.classList.remove('hidden');
        var fxIc = fxBlock.querySelector('.fx-icon');
        var fxNm = fxBlock.querySelector('.fx-name');
        var fxDs = fxBlock.querySelector('.fx-desc');
        if (fxIc) { fxIc.textContent = fx.icon || ''; fxIc.className = 'fx-icon l3fx-' + fx.id; }
        if (fxNm) fxNm.textContent = fx.name || '';
        if (fxDs) fxDs.textContent = fx.desc || '';
      } else {
        fxBlock.classList.add('hidden');
      }
    }
    // 升级按钮文案/禁用态
    var upgBtn = document.getElementById('ti-upgrade');
    if (upgBtn) {
      var phaseOk = (state.phase === PHASE.PREPARE || state.phase === PHASE.WAVEEND);
      if (lv >= LEVEL_MAX) {
        upgBtn.textContent = '已满级 L' + LEVEL_MAX;
        upgBtn.classList.add('disabled');
        upgBtn.disabled = true;
      } else {
        var cost = LEVEL_UP_COST_L[lv] || 0;
        var canAfford = (state.gold >= cost);
        var enable = phaseOk && canAfford;
        upgBtn.textContent = '升级 L' + (lv + 1) + '（-' + cost + ' 金）';
        upgBtn.disabled = !enable;
        if (enable) upgBtn.classList.remove('disabled'); else upgBtn.classList.add('disabled');
        if (!phaseOk && lv < LEVEL_MAX) {
          // 显示原因悬浮到按钮 title
          var reason = (state.phase === PHASE.BATTLE) ? '战斗中不可升级'
            : (state.phase === PHASE.RESERVE) ? '保留阶段不可升级'
            : (state.phase === PHASE.MENU) ? '开始游戏后可升级'
            : '当前阶段不可升级';
          if (!canAfford) reason = '金币不足（需要 ' + cost + ' 金）';
          upgBtn.title = reason;
        } else {
          upgBtn.title = '';
        }
      }
    }
    // 策略按钮高亮
    _refreshStrategyButtons();
    var m = document.getElementById('tower-info-modal');
    if (m) {
      m.classList.remove('hidden');
      // 自适应定位：放到塔的对侧（左塔→右，右塔→左；放不下换边）
      _positionTowerInfoModal(gridIdx);
    }
  }
  function _refreshStrategyButtons() {
    if (_towerInfoIdx == null) return;
    var g = state.grid[_towerInfoIdx];
    var cur = _normStrategy(g ? g.targetStrategy : TOWER_STRATEGIES.NEAR);
    var btns = document.querySelectorAll('.btn.ti-strat');
    for (var i = 0; i < btns.length; i++) {
      var s = btns[i].getAttribute('data-strategy');
      if (s === cur) btns[i].classList.add('on'); else btns[i].classList.remove('on');
    }
  }
  function closeTowerInfoModal() {
    _towerInfoIdx = null;
    var m = document.getElementById('tower-info-modal');
    if (m) m.classList.add('hidden');
  }
  function setTowerStrategy(strategy) {
    if (_towerInfoIdx == null) return;
    var g = state.grid[_towerInfoIdx];
    if (!g) return;
    var ns = _normStrategy(strategy);
    g.targetStrategy = ns;
    _refreshStrategyButtons();
    // 更新"当前策略"显示
    var stats = document.getElementById('ti-stats');
    if (stats) {
      var rows = stats.querySelectorAll('.row');
      for (var i = 0; i < rows.length; i++) {
        var k = rows[i].querySelector('.k');
        if (k && k.textContent === '当前策略') {
          var v = rows[i].querySelector('.v');
          if (v) v.textContent = strategyLabel(ns);
          break;
        }
      }
    }
    setMsg('塔策略已切换为【' + strategyLabel(ns) + '】');
    log('i', '塔(' + (_towerInfoIdx % state.cols) + ',' + Math.floor(_towerInfoIdx / state.cols) + ') 策略 → ' + strategyLabel(ns));
  }
  function elementLabel(el) {
    var map = { fire: '火', water: '水', earth: '土', wind: '风', thunder: '雷', ice: '冰', poison: '毒', light: '光', dark: '暗', physical: '物理' };
    return map[el] || (el || '');
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
    var ph = state.phase;
    // V3-3: RESERVE / WAVEEND / WIN / LOSE / MENU → 地图点击全部锁定
    //   V4-6 T12 例外：WAVEEND 且处于 shopTowerMode 放置模式 → 空地点击 → placeShopTowerAt 落地
    if (ph === PHASE.WAVEEND && state.shopTowerMode) {
      placeShopTowerAt(x, y);
      draw();
      return;
    }
    if (ph === PHASE.RESERVE || ph === PHASE.WAVEEND || ph === PHASE.WIN || ph === PHASE.LOSE || ph === PHASE.MENU) {
      var locked = '【' + ph + '】当前阶段不可操作地图';
      if (ph === PHASE.RESERVE)  locked = '保留阶段：请在上方弹框选择保留的防御塔';
      if (ph === PHASE.WAVEEND)  locked = '波次结算：请在弹框 Tab 抽 Buff / 升运气 / 购塔 / 预览，或点击"进入下一波"';
      if (ph === PHASE.WIN || ph === PHASE.LOSE) locked = '对局结束：请点击"重开"或"开始下一波"重新开始';
      if (ph === PHASE.MENU)     locked = '请先点击"开始下一波"进入对局';
      setMsg(locked, true);
      draw();
      return;
    }
    // ---- 以下 PREPARE / BATTLE 阶段才允许操作 ----
    // v4 合成模式：点真塔 → 选中/取消；点空地 → 视为无效操作（提示）；忽略 T_WALL/T_CAND
    if (state.merge && state.merge.mode) {
      if (t === T_TOWER) {
        toggleSelectTower(idx(x, y));
      } else {
        toast(('升级' === state.merge.mode ? '【A升级】'
             : 'fusion' === state.merge.mode ? '【B合成】' : '【C进化】')
             + '请点击已建成的真塔进行选择（点击空地无效）。', 'info');
      }
      draw();
      return;
    }
    // 1) 点墙 → 免费拆（两个阶段都允许，过 terrainGate 防封死）
    if (t === T_WALL) {
      var d = demolishWall(x, y);
      if (!d.ok) { setMsg(d.msg || '无法拆除', true); if (d.msg && d.msg.indexOf('封死') >= 0) log('e', d.msg); }
      refreshHUD(); draw();
      return;
    }
    // 2) 点塔 / 候选 → 打开塔信息弹框（含策略切换）
    if (t === T_TOWER || t === T_CAND) {
      var g = state.grid[idx(x, y)];
      if (g && g.towerCfg) {
        var c2 = g.towerCfg;
        log('i', '[' + rarityLabel(c2.rarity) + '] ' + c2.name + ' 伤害' + Math.round(c2.baseDamage) + ' 范围' + c2.rangeInCells + '格');
        setMsg('[' + rarityLabel(c2.rarity) + '] ' + c2.name + ' 伤害' + Math.round(c2.baseDamage) + ' 范围' + c2.rangeInCells + '格');
        openTowerInfoModal(idx(x, y));
      }
      draw();
      return;
    }
    // 3) 空地（T_EMPTY=1 或其他可放置）
    if (ph === PHASE.PREPARE) {
      var p = placeCandidate(x, y);
      if (!p.ok) { setMsg(p.msg || '无法放置', true); if (p.msg && p.msg.indexOf('封死') >= 0) log('e', p.msg); }
      refreshHUD(); draw();
      if (p.ok && state.placementUsed >= state.placementTotal) {
        showReserveModal();
      }
      return;
    }
    // BATTLE 阶段空地：禁止放置（防作弊阶段本来也没有 placement 次数）
    if (ph === PHASE.BATTLE) {
      setMsg('【BATTLE】战斗中不可放置防御塔；可点墙免费拆除 / 点塔查看属性', true);
      draw();
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
    // V4-背景图：根据当前地图 backgroundImage 异步预加载
    ensureMapBgLoaded(md);
    // V4-自适应：配置 cellSize 仅作"最大不要超过 3x"的参考；实际 cell 由容器等比填满
    state.configCellSize = md.cellSize | 0 || 48;
    state.cell = state.configCellSize;   // 暂时占位，等 canvas parent 尺寸 ready 后 fitCanvasToContainer() 会重算
    state.tiles = (md.tiles || []).slice();
    // ===== 地图原始 tiles 通常只含 0/1（草地/石头）—— 起点/基地/检测点 的 S/E/M 标记需要额外打上：
    //   1) 起点 tile = T_START（草地带 S 大字绿底）
    //   2) 基地 tile = T_END（深红底 E 大字）
    //   3) 检测点 tile：若当前碰巧是石头(1)，必须改成草地(0) 才能通过 — 否则 A* 会判断检测点本身不可走，段路径判定直接断
    if (md.spawnPoints && md.spawnPoints.length) {
      var sp = md.spawnPoints[0];
      if (sp && inBounds(sp.x, sp.y)) state.tiles[idx(sp.x, sp.y)] = T_START;
    }
    if (md.base && inBounds(md.base.x, md.base.y)) {
      state.tiles[idx(md.base.x, md.base.y)] = T_END;
    }
    if (md.checkpoints && md.checkpoints.length) {
      for (var cci = 0; cci < md.checkpoints.length; cci++) {
        var cp = md.checkpoints[cci];
        if (!cp || !inBounds(cp.x, cp.y)) continue;
        var ci = idx(cp.x, cp.y);
        var cv = state.tiles[ci] | 0;
        if (cv === T_STONE) state.tiles[ci] = T_GRASS;
      }
    }
    // tiles 里可能全是 0/1/2/3，没有墙/塔/候选
    state.grid = new Array(state.cols * state.rows);
    for (var i = 0; i < state.grid.length; i++) state.grid[i] = null;
    state.towersByInst = {};
    state.nextInstId = 1;
    // 先给一个合理的 canvas internal 尺寸，避免 layout 抖动期 draw() 报错
    state.canvas.width  = state.cols * state.cell;
    state.canvas.height = state.rows * state.cell;
    // 自适应：容器（.game-main）尺寸一布局完就把 canvas/cell 填到容器最大可用空间
    ensureResizeObserver();
    // ResizeObserver 回调是异步的（或容器尺寸可能还在布局中），这里同步先试一次；若失败 requestAnimationFrame 再兜底
    var fitted = fitCanvasToContainer();
    if (!fitted) requestAnimationFrame(function () { if (fitCanvasToContainer()) draw(); });
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
    // V4-Anim: 开始加载塔攻击序列帧（异步；战斗 tick 中若未加载到就跳过动画，不影响流程）
    ensureTowerAttackAnimLoaded();
    // V4-1 MENU 阶段：Tab 同步（难度/地图 active + unlocked）+ stat chip 文本（上一行 refreshHUD 已先写 chip 数值，但 Tab active 状态必须 render 一次）
    setDifficulty(state.difficulty, { silent: true });
    setMapId(state.mapId);
    state.difficultyLocked = false; // 新开局解锁 Tab（applyCfg 是重开/首次加载调用）
    renderMenuChooser();
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
    // V4-2 Task 5：先合并地图解锁（游客/登录）再 applyCfg — applyCfg 末尾会 renderMenuChooser 读 state.unlockedMaps
    mergeUnlockedMaps();
    // V4-6 T13：天赋初始化（登录读 users 表/游客读 localStorage）
    mergeTalents();
    // V4-Anim: 优先 attach 到 window.animPlayer（td-animation.js 应该先加载；若没加载也不报错）
    if (!globalAnimPlayer && typeof window !== 'undefined' && window.animPlayer) {
      globalAnimPlayer = window.animPlayer;
    }
    ensureTowerAttackAnimLoaded();
    state.canvas.addEventListener('mousemove', onCanvasMove);
    state.canvas.addEventListener('mouseleave', onCanvasLeave);
    state.canvas.addEventListener('click', onCanvasClick);
    // ===== V4-6 T16 移动端：禁用双指/双击缩放 + 手势缩放 + touchend 映射为 canvas click（防止 300ms 延迟） =====
    (function _mobileZoomBlockAndTap() {
      // 1) iOS Safari gesture 系列：gesturestart/gesturechange/gestureend 都是双指缩放
      function noop(e) { if (e && typeof e.preventDefault === 'function') e.preventDefault(); }
      document.addEventListener('gesturestart', noop, { passive: false });
      document.addEventListener('gesturechange', noop, { passive: false });
      document.addEventListener('gestureend', noop, { passive: false });
      // 2) Android Chrome / 现代浏览器：touchstart 若有 2 指以上，立刻阻断后续 touchmove 缩放
      document.addEventListener('touchstart', function (e) {
        if (e.touches && e.touches.length > 1) {
          try { e.preventDefault(); } catch (_) {}
        }
      }, { passive: false });
      // 3) 双击缩放防护：300ms 内连续两次 touchend → 阻止（iOS Safari 老版本）
      var _lastTouchEnd = 0;
      document.addEventListener('touchend', function (e) {
        var now = Date.now();
        if (now - _lastTouchEnd < 300) { try { e.preventDefault(); } catch (_) {} }
        _lastTouchEnd = now;
      }, { passive: false });
      // 4) Canvas：touch 结束 → 合成一次 click（移动端部分浏览器 touch→click 会有 300ms+ 延迟或不触发）
      var _cv = state.canvas;
      if (_cv) {
        var _tapX = null, _tapY = null, _moved = false;
        _cv.addEventListener('touchstart', function (e) {
          if (!e.touches || e.touches.length !== 1) return;
          var t = e.touches[0];
          _tapX = t.clientX; _tapY = t.clientY; _moved = false;
        }, { passive: true });
        _cv.addEventListener('touchmove', function (e) {
          if (_tapX == null || !e.touches || e.touches.length !== 1) { _moved = true; return; }
          var t = e.touches[0];
          // 阈值 25px：电容屏手指微抖 10-20px 很常见，过小会把有效 tap 误判为滑动 → 合成 click 被吞（手机端"点了没反应"）
          if (Math.abs(t.clientX - _tapX) > 25 || Math.abs(t.clientY - _tapY) > 25) _moved = true;
        }, { passive: true });
        _cv.addEventListener('touchend', function (e) {
          if (_tapX == null || _moved) { _tapX = null; _tapY = null; return; }
          // 合成 click 事件（坐标用 changedTouches 的最后一个点 clientX/Y 与原生一致）
          try { e.preventDefault(); } catch (_) {}
          var ct = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
          var cx = ct ? ct.clientX : _tapX, cy = ct ? ct.clientY : _tapY;
          var rect = _cv.getBoundingClientRect();
          var evt;
          try {
            evt = new MouseEvent('click', {
              bubbles: true, cancelable: true, view: window,
              clientX: cx, clientY: cy,
                offsetX: cx - rect.left, offsetY: cy - rect.top,
                button: 0, buttons: 1
            });
          } catch (_ie) {
            // IE 兜底
            evt = document.createEvent('MouseEvent');
            evt.initMouseEvent('click', true, true, window, 1, cx, cy, cx, cy, false, false, false, false, 0, null);
          }
          _cv.dispatchEvent(evt);
          _tapX = null; _tapY = null;
        }, { passive: false });
      }
    })();

    document.getElementById('btn-start').addEventListener('click', btnStartClick);
    // V4-7：中央"开始第 N 波"大按钮（同样走 btnStartClick；WIN/LOSE 也走这里）
    var cs = document.getElementById('btn-start-wave');
    if (cs) cs.addEventListener('click', btnStartClick);
    // V4-7：菜单抽屉 + 遮罩 + ESC 关闭
    var menuBtn = document.getElementById('btn-menu');
    if (menuBtn) menuBtn.addEventListener('click', function () { toggleMenuDrawer(); });
    var menuClose = document.getElementById('btn-menu-close');
    if (menuClose) menuClose.addEventListener('click', function () { closeMenuDrawer(); });
    var menuMask = document.getElementById('menu-mask');
    if (menuMask) menuMask.addEventListener('click', function () { closeMenuDrawer(); });

    document.getElementById('btn-restart').addEventListener('click', function () { fullReset(); });
    document.getElementById('btn-next-wave').addEventListener('click', closeWaveendGoNextOrWin);
    document.getElementById('btn-roll-buff').addEventListener('click', rollOneBuff);
    // ---- V4-6 T12 WAVEEND 4 Tab 商店绑定 ----
    var weTabs = document.querySelectorAll('#waveend-modal .we-tab');
    for (var wti = 0; wti < weTabs.length; wti++) {
      weTabs[wti].addEventListener('click', function (ev) {
        var b = ev && ev.currentTarget;
        if (!b) return;
        var t = b.getAttribute('data-we-tab');
        if (t) activateWeTab(t);
      });
    }
    var shopBtn = document.getElementById('btn-shop-tower');
    if (shopBtn) shopBtn.addEventListener('click', startShopTowerMode);
    // ---- V4-6 T13 天赋按钮绑定 ----
    bindTalentButtons();

    // ---- V4-1 难度/地图 Tab 绑定（V4-7 精简布局：Tab 在菜单抽屉内，选择器直接抓 .chooser-tabs .ctab）----
    var cTabs = document.querySelectorAll('.chooser-tabs .ctab');
    for (var cti = 0; cti < cTabs.length; cti++) {
      cTabs[cti].addEventListener('click', function (ev) {
        var btn = ev && ev.currentTarget;
        if (!btn) return;
        if (btn.classList.contains('disabled') || btn.hasAttribute('disabled')) return;
        var d = btn.getAttribute('data-difficulty');
        if (d) {
          var r1 = setDifficulty(d);
          if (r1 && !r1.ok && r1.msg) { setMsg(r1.msg, !!r1.locked); if (r1.locked) toast(r1.msg, 'warn'); }
          return;
        }
        var mId = btn.getAttribute('data-map');
        if (mId) {
          var r2 = setMapId(mId);
          if (r2 && !r2.ok && r2.msg) { setMsg(r2.msg, !r2.ok); toast(r2.msg, (r2.locked || r2.unlocked === false) ? 'warn' : 'er'); }
          return;
        }
      });
    }

    // ---- V4 合成三按钮 + 预览/进化模态 ----
    var mergeBtns = document.querySelectorAll('.btn.merge');
    for (var mbi = 0; mbi < mergeBtns.length; mbi++) {
      mergeBtns[mbi].addEventListener('click', function (ev) {
        var mode = (ev.currentTarget && ev.currentTarget.getAttribute('data-merge')) || null;
        if (!mode) return;
        setMergeMode(mode);
      });
    }
    document.getElementById('btn-merge-cancel').addEventListener('click', onMergeModalCancel);
    document.getElementById('btn-merge-confirm').addEventListener('click', onMergeModalConfirm);
    var mergeModal = document.getElementById('merge-modal');
    if (mergeModal) {
      mergeModal.addEventListener('click', function (e) {
        if (e.target && e.target.id === 'merge-modal') onMergeModalCancel();
      });
    }
    // ESC 快捷取消合成
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        // V4-7：菜单抽屉打开时优先关闭
        var sd = document.getElementById('side-menu');
        if (sd && sd.classList.contains('open')) { closeMenuDrawer(); return; }
        // V4-6 T12：商店塔放置模式优先取消（退金）
        if (state.shopTowerMode) {
          var c = state.shopTowerPaidGold || 0;
          cancelShopTowerMode();
          if (c > 0) toast('商店塔购买已取消（退回 ' + c + ' 金）', 'info');
          else toast('商店塔购买已取消', 'info');
        }
        if (state.merge && state.merge.mode) { cancelMerge('ESC 已取消合成'); }
        // 其他模态：塔信息/保留/结算/结束/账号 → 兼容不关闭（保留游戏原生交互）
      }
    });
    document.getElementById('btn-reserve-cancel').addEventListener('click', function () {
      setMsg('规则：必须选择 1 座保留，无法取消。', true);
    });
    document.getElementById('btn-end-restart').addEventListener('click', function () {
      document.getElementById('end-modal').classList.add('hidden');
      fullReset();
    });
    // V3-5: END modal 恢复 autosave（波末）
    var restoreBtn = document.getElementById('btn-end-restore');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', function () {
        var snap = _readLocalWaveendAutosave();
        if (!snap) { toast('没有可用的波末 autosave', 'er'); return; }
        var r = applySaveRecord(snap);
        if (!r.ok) { toast('恢复失败: ' + (r.msg || '未知错误'), 'er'); return; }
        // applySaveRecord 已根据 phase 自动打开 waveend-modal，把 end-modal 关闭即可
        document.getElementById('end-modal').classList.add('hidden');
        toast('已恢复到最近波末 autosave', 'ok');
        log('w', 'END：从波末 autosave 恢复，wave=' + state.waveIndex);
      });
    }

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

    // ---- V3-4 塔策略弹框绑定 ----
    document.getElementById('ti-close').addEventListener('click', closeTowerInfoModal);
    document.getElementById('tower-info-modal').addEventListener('click', function (e) {
      if (e.target && e.target.id === 'tower-info-modal') closeTowerInfoModal();
    });
    var stratBtns = document.querySelectorAll('.btn.ti-strat');
    for (var bi = 0; bi < stratBtns.length; bi++) {
      stratBtns[bi].addEventListener('click', function (ev) {
        var s = ev.currentTarget.getAttribute('data-strategy');
        setTowerStrategy(s);
      });
    }
    // ---- V4 Task9 塔升级按钮（.btn.ti-upgrade）----
    var upg = document.getElementById('ti-upgrade');
    if (upg) upg.addEventListener('click', function () { upgradeTower(_towerInfoIdx); });
    var l3c = document.getElementById('l3-close');
    if (l3c) l3c.addEventListener('click', function () { hideL3RollModal(); });
    var l3m = document.getElementById('l3-roll-modal');
    if (l3m) l3m.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'l3-roll-modal') hideL3RollModal();
    });

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

    // ---- V4-6 T14 排行榜按钮绑定 ----
    bindLeaderboardButtons();

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
    // V4-1 难度/地图
    setDifficulty: setDifficulty,
    setMapId:      setMapId,
    _renderMenuChooser: renderMenuChooser,
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
    _calcTowerEffective: calcTowerEffective,
    _upgradeTower: upgradeTower,
    _openTowerInfoModal: openTowerInfoModal,
    _rollL3Effect: rollL3Effect,
    _getL3Effect: getL3Effect,
    _stepTowers: function (dt, mul) { stepTowers(dt, mul || {}); },
    _stepProjectiles: function (dt, mul) { stepProjectiles(dt, mul || {}); },
    _stepEnemy: function (e, dt) { stepEnemy(e, dt); },
    _damageEnemy: function (e, cfg, low, mul, extra) { return damageEnemy(e, cfg, low, mul, extra); },
    _LEVEL_UP_COST_L: LEVEL_UP_COST_L.slice(),
    _LEVEL_MAX: LEVEL_MAX,
    _LV_MUL: { dmg: LV_MUL_DMG, atkSpd: LV_MUL_ATK_SPD, range: LV_MUL_RANGE },
    _L3_EFFECTS: L3_EFFECTS.slice(),
    // V4-6 T12: 商店/商店塔调试接口
    _showWaveendModal: function () { showWaveendModal(); },
    _hideWaveendModal: function () { hideWaveendModal(); },
    _activateWeTab: activateWeTab,
    _rollOneBuff: function () { rollOneBuff(); },
    _upgradeLuck: function (lv) { upgradeLuck(lv); },
    _startShopTowerMode: function () { startShopTowerMode(); },
    _cancelShopTowerMode: function () { cancelShopTowerMode(); },
    _placeShopTowerAt: function (gx, gy) { return placeShopTowerAt(gx, gy); },
    _renderPreviewTable: function () { renderPreviewTable(); },
    _renderActiveBuffsList: function () { renderActiveBuffsList(); },
    // V4-6 T13 天赋调试接口
    _TALENT_DEFS: TALENT_DEFS.slice(),
    _mergeTalents: function () { mergeTalents(); },
    _calcTalentMul: function () { return calcTalentMul(); },
    _talentCanUnlock: function (id) { return talentCanUnlock(talentDefById(id)); },
    _talentUnlock: function (id) { return talentUnlock(id); },
    _talentResetAll: function (refund) { talentResetAll(!!refund); },
    _renderTalentTree: function () { renderTalentTree(); },
    _openTalentModal: function () { openTalentModal(); },
    _closeTalentModal: function () { closeTalentModal(); },
    _getTalentState: function () { return { points: state.talentPointsAvailable, nodes: state.talentNodesList.slice(), active: Object.keys(state.talentNodesActive || {}).filter(function (k) { return state.talentNodesActive[k]; }) }; },
    // V4-7 散图序列帧加载（Spine 导出 PNG 序列直接可用，无需打包 FramePacker）
    _loadFrameAnim: ensureFrameAnimByName,
    // V4-7 测试：直接加载 /assets/png/chuxue 下 6 张 Attack 散图 → 动画名 towerAttack_chuxue，自动按 cell×1.2 自适应尺寸
    _loadChuxueAnim: function () { return _demoLoadChuxue(); },
    // 在指定格 (gx, gy) 锚点处 spawn 一套已加载好的动画（animName 如 towerAttack_chuxue），用于 AC 直观验证
    _spawnAnimAt: function (animName, gx, gy, opts) {
      if (!globalAnimPlayer) return null;
      var a = cellTowerAnchorPx(gx | 0, gy | 0);
      return globalAnimPlayer.spawn(animName, Object.assign({ x: a.x, y: a.y, loop: 'none' }, opts || {}));
    },
    // 调试 / 浏览器自动化：后台标签 RAF 节流时手动推进战斗（dt 秒，内部按 0.05s 切片模拟多帧）
    _stepBattle: function (dtSec) {
      if (state.phase !== PHASE.BATTLE) return 0;
      var remain = Math.max(0, Number(dtSec) || 0);
      var slice = 0.05;
      var effBuffs = (state.cfg && typeof state.cfg.applyBuffs === 'function')
        ? state.cfg.applyBuffs(state.activeBuffs || [])
        : { mul: { towerDamageMulAll:1, towerAttackIntervalMulAll:1, towerRangeMulAll:1, killGoldMulAll:1, slowStrengthMulAll:1 }, add: {} };
      var mul = effBuffs.mul || {};
      var ran = 0;
      while (remain > 0) {
        var dt = Math.min(remain, slice);
        remain -= dt; ran += dt;
        state.waveElapsed += dt;
        while (state.spawnQueue.length && state.spawnQueue[0].spawnAt <= state.waveElapsed) {
          var s = state.spawnQueue.shift(); spawnEnemy(s.enemyId);
        }
        for (var i = 0; i < state.enemies.length; i++) stepEnemy(state.enemies[i], dt);
        stepTowers(dt, mul);
        stepProjectiles(dt, mul);
      }
      // 帧尾：检查战斗是否结束（WIN / WAVEEND）
      var anyAlive = false;
      for (var j = 0; j < state.enemies.length; j++) if (state.enemies[j].alive) { anyAlive = true; break; }
      if (state.phase === PHASE.BATTLE && !anyAlive && state.spawnQueue.length === 0) {
        var w = currentWaveCfg();
        var rewardRaw2 = w ? (w.rewardGold || 0) : 0;
        var reward2 = rewardRaw2 > 0 ? Math.max(1, Math.round(rewardRaw2 * (Number((state.difficultyMul && state.difficultyMul.gold) || 1)))) : 0;
        if (reward2 > 0) { state.gold += reward2; log('s', '波次奖励 +' + reward2 + ' 金币'); }
        log('s', '第 ' + state.waveIndex + ' 波战斗结束');
        snapshotTowerWaveStats();
        logDpsLeaderboard(state.waveDamageStats);
        if (state.waveIndex >= state.maxWaves) {
          state.phase = PHASE.WIN;
          var unlockResC = tryUnlockNextMap(state.mapId, 'WIN_RAF');
          var unlockHTMLC = '';
          if (unlockResC && unlockResC.nextId) unlockHTMLC = (unlockResC.already ? '（Map ' + unlockResC.nextId + ' 已解锁）' : ' 🎁解锁Map ' + unlockResC.nextId);
          document.getElementById('end-title').textContent = '通关！';
          document.getElementById('end-summary').innerHTML =
            '全部 <b>' + state.maxWaves + '</b> 波通关！剩余金币 <b>' + state.gold + '</b>；基地 <b>' + state.baseHP + '/' + state.baseMaxHP + '</b>。' + unlockHTMLC;
          renderDpsBoardHTML(state.waveDamageStats, 'end-dps-board');
          refreshEndAutosaveUI('win');
          autoSaveIfLoggedIn('win');
          document.getElementById('end-modal').classList.remove('hidden');
        } else {
          state.phase = PHASE.WAVEEND;
          if (state.placementUsed < state.placementTotal) log('w', '异常：进入 WAVEEND 前 placementUsed ' + state.placementUsed + '/' + state.placementTotal);
          showWaveendModal();
          autoSaveIfLoggedIn('waveend');
        }
        refreshHUD();
      }
      draw();
      return ran;
    },
    _dbgKnownVersion: function () { return _knownSaveUpdatedAt; }, // SSO + 乐观锁测试：获取当前 JS 内存里存档 known updatedAt
    _dbgSetKnownVersion: function (v) { _knownSaveUpdatedAt = v || ''; }, // SSO 冲突测试：强制设置 known version 模拟"拿着旧版本戳写"
    // V3-6 统计辅助：实时总DPS / 总击杀 / 本波击杀 汇总（HUD/弹框共用）
    computeLiveTotals: computeLiveTotals,
    reserveOne: reserveOne,
    btnStartClick: btnStartClick,
    // -------- V4 合成系统调试接口（仅浏览器自动化/测试用）--------
    _v4: {
      // 1) 暴露合成核心函数
      setMergeMode: setMergeMode,
      cancelMerge: cancelMerge,
      toggleSelectTower: toggleSelectTower,
      onMergeModalConfirm: onMergeModalConfirm,
      detectEvolvable: detectEvolvable,
      // 2) 根据 id / code / name 在配置中找 towerCfg
      findTowerCfg: function (idOrCode) {
        var all = (state.cfg && state.cfg.towers ? state.cfg.towers.slice() : []).concat(
                   state.cfg && state.cfg.specialTowers ? state.cfg.specialTowers.slice() : []);
        var s = String(idOrCode);
        for (var i = 0; i < all.length; i++) {
          if (String(all[i].id) === s) return all[i];
          if (all[i].code && all[i].code === s) return all[i];
          if (all[i].name && all[i].name === s) return all[i];
        }
        return null;
      },
      // 3) 找 n 个空可放置的 tiles（T_GRASS），返回 [{gx,gy,idx}]
      findEmptyTiles: function (n) {
        n = n || 1;
        var res = [];
        var cols = state.cols, rows = state.rows;
        for (var gy = 0; gy < rows && res.length < n; gy++) {
          for (var gx = 0; gx < cols && res.length < n; gx++) {
            var t = tileAt(gx, gy);
            if (t === T_GRASS) res.push({ gx: gx, gy: gy, idx: idx(gx, gy) });
          }
        }
        return res;
      },
      // 4) 直接在 (gx,gy) 放置真塔（指定 towerCfg / towerId，可选 rarity 覆盖）
      //    走 terrainGate 保证合法（不封路）；忽略 PREPARE/placementUsed 限制
      putRealTower: function (gx, gy, towerCfgOrId, rarityOverride) {
        var cfg = (typeof towerCfgOrId === 'object' && towerCfgOrId) ? towerCfgOrId : this.findTowerCfg(towerCfgOrId);
        if (!cfg) return { ok: false, msg: 'cfg not found' };
        var t = tileAt(gx, gy);
        if (t !== T_GRASS && t !== T_WALL) return { ok: false, msg: 'tile not placeable: ' + t };
        var rarity = rarityOverride || cfg.rarity;
        var instId = state.nextInstId++;
        var gridObj = {
          type: T_TOWER, instId: instId, towerCfgId: cfg.id, rarity: rarity,
          towerCfg: cfg, level: 0, rollEffect: null, cooldown: 0,
          targetStrategy: TOWER_STRATEGIES.NEAR, damageDealt: 0, kills: 0,
          energy: 0, skillReady: false, skillActive: false
        };
        var res = terrainGate({ kind: 'reserve_tower', gx: gx, gy: gy, newTile: T_TOWER, gridObj: gridObj });
        if (!res.ok) return res;
        state.towersByInst[instId] = gridObj;
        // 加入 state.towers（与 RESERVE 流程后续一致：computeLiveTotals 会用 state.towers）
        var levels = cfg.levels || [];
        var lv0 = levels[0] || { atk: cfg.atk || 10, range: cfg.range || 1, speed: cfg.speed || 1 };
        state.towers.push({
          id: 'dbg_' + instId,
          towerId: cfg.id,
          r: gy, c: gx,
          rarity: rarity,
          level: 0,
          atk: lv0.atk, range: lv0.range, speed: lv0.speed,
          element: cfg.element || '',
          isSpecial: !!cfg.special,
          name: cfg.name
        });
        draw();
        return { ok: true, instId: instId, idx: idx(gx, gy), cfgId: cfg.id, cfgName: cfg.name, rarity: rarity };
      },
      // 5) 批量放塔：传入配置 id 数组（长度 2~3），按顺序放
      putRealTowersBatch: function (cfgIds, rarity) {
        var n = cfgIds.length;
        var spots = this.findEmptyTiles(n);
        if (spots.length < n) return { ok: false, msg: 'not enough empty tiles, need=' + n + ' found=' + spots.length };
        var result = [];
        for (var i = 0; i < n; i++) {
          var r = this.putRealTower(spots[i].gx, spots[i].gy, cfgIds[i], rarity);
          result.push({ spot: spots[i], result: r });
          if (!r.ok) return { ok: false, msg: 'failed at #' + i + ': ' + r.msg, partial: result };
        }
        return { ok: true, placed: result };
      },
      // 6) 清空所有真塔和墙（debug用）
      clearAllBuilt: function () {
        var cols = state.cols, rows = state.rows;
        for (var gy = 0; gy < rows; gy++) for (var gx = 0; gx < cols; gx++) {
          var k = idx(gx, gy);
          var t = state.tiles[k];
          if (t === T_TOWER || t === T_WALL || t === T_CAND) {
            state.tiles[k] = T_GRASS;
            state.grid[k] = null;
          }
        }
        state.towers = [];
        state.candidates = [];
        state.towersByInst = {};
        state.nextInstId = 1;
        state.placementUsed = 0;
        draw();
        return { ok: true };
      },
      // 7) 把 towers/grid 当前状态导出成可断言的 summary
      summary: function () {
        var tow = [];
        for (var i = 0; i < state.tiles.length; i++) {
          if (state.tiles[i] === T_TOWER && state.grid[i] && state.grid[i].towerCfg) {
            var g = state.grid[i];
            tow.push({
              idx: i,
              cfgId: g.towerCfgId,
              cfgName: g.towerCfg ? g.towerCfg.name : null,
              rarity: g.rarity,
              level: g.level || 0,
              special: !!(g.towerCfg && g.towerCfg.special),
              code: g.towerCfg ? g.towerCfg.code : null
            });
          }
        }
        return {
          phase: state.phase,
          towersCount: tow.length,
          towers: tow,
          merge: state.merge ? {
            mode: state.merge.mode,
            activeRecipeId: state.merge.activeRecipeId,
            selectedCount: state.merge.selected.length,
            selectedIdx: state.merge.selected.slice(),
            lastPreview: state.merge.lastPreview ? {
              cfgId: state.merge.lastPreview.towerCfg ? state.merge.lastPreview.towerCfg.id : null,
              cfgName: state.merge.lastPreview.towerCfg ? state.merge.lastPreview.towerCfg.name : null,
              rarity: state.merge.lastPreview.rarity,
              special: !!(state.merge.lastPreview.towerCfg && state.merge.lastPreview.towerCfg.special)
            } : null
          } : null,
          evolvable: state.evolvable || null
        };
      },
      // 8) Roll 辅助：调用 1 次 rollTowerByLuck 并返回结果（用于验证 Roll 池无特殊塔）
      rollOnce: function () {
        if (!state.cfg || typeof state.cfg.rollTowerByLuck !== 'function') return { ok: false, msg: 'no rollTowerByLuck' };
        var t = state.cfg.rollTowerByLuck(state.luckLevel);
        return { ok: !!t, cfg: t ? { id: t.id, name: t.name, rarity: t.rarity, special: !!t.special } : null };
      },
      rollByRarity: function (rarity) {
        if (!state.cfg || typeof state.cfg.pickRandomNonSpecialByRarity !== 'function') return { ok: false, msg: 'no pickRandomNonSpecialByRarity' };
        var t = state.cfg.pickRandomNonSpecialByRarity(rarity);
        return { ok: !!t, cfg: t ? { id: t.id, name: t.name, rarity: t.rarity, special: !!t.special } : null };
      },
      // 9) 强制把 state.phase 改成 PREPARE（测试用）
      forcePhase: function (p) { state.phase = p; refreshHUD(); draw(); return state.phase; },
      setGold: function (g) { state.gold = g|0; refreshHUD(); return state.gold; },
      // 10) 显示调试：打开塔信息弹窗（V4 显示验证用）+ 强制重绘 canvas
      openTowerInfo: function (gridIdx) { openTowerInfoModal(gridIdx); },
      redraw: function () { draw(); return true; },
      // 11) 读取塔 (r, c) 渲染用的 displayRarity + 实际角标绘制颜色（直接走 draw 内部同样的逻辑）
      debugDisplayRarity: function (gridIdx) {
        var g = state.grid[gridIdx];
        if (!g || !g.towerCfg) return null;
        var cfg = g.towerCfg;
        var displayRarity = g.rarity || cfg.rarity; // 修复点1+2 同此逻辑
        return {
          gridRarity: g.rarity,
          cfgRarity: cfg.rarity,
          displayRarity: displayRarity,
          rarityCssColor: rarityCssColor(displayRarity),
          rarityShort: rarityShort(displayRarity),
          rarityLabel: rarityLabel(displayRarity),
          // 画布上稀有度角标颜色填充的实际文字像素中心坐标（gx, gy）
          gx: gridIdx % state.cols,
          gy: Math.floor(gridIdx / state.cols),
          cs: state.cell
        };
      }
    },
    // ============================================================
    // mergeTest: V4-3 塔合成 A/B/C 端到端自动化验证 helpers
    // ============================================================
    mergeTest: (function () {
      // ------- 内部工具 -------
      function _ensurePhasePrepare() {
        if (state.phase !== PHASE.PREPARE) {
          // 强制进入 PREPARE（测试用），同时刷新合成相关 UI
          state.phase = PHASE.PREPARE;
          state.waveIndex = 1;
          state.baseHP = state.baseMaxHP || 20;
          state.enemies = [];
          state.spawnQueue = [];
          detectEvolvable();
          renderEvolveRibbon(false);
          _refreshMergeButtons();
          refreshHUD();
          draw();
        }
        return true;
      }
      function _selClear() {
        state.merge.selected = [];
        state.merge.mode = null;
        state.merge.activeRecipeId = null;
        state.merge.lastPreview = null;
        closeMergeModal();
        _refreshMergeButtons();
        draw();
      }
      function _validateCurrentAndPreview() {
        var val = validateAndBuildPreview();
        if (!val || !val.ok) return { ok: false, msg: val ? val.msg : '校验失败', toastMsg: _lastToastMsg };
        var pv = val.preview;
        if (!pv) return { ok: false, msg: '校验返回无 preview', toastMsg: _lastToastMsg };
        state.merge.lastPreview = pv;
        return { ok: true, preview: pv };
      }
      function _countTowersByIdxList(idxs) {
        var n = 0;
        for (var i = 0; i < idxs.length; i++) {
          if (state.grid[idxs[i]] && state.grid[idxs[i]].towerCfg) n++;
        }
        return n;
      }
      // ------- 对外 API -------
      return {
        // [1] 清理：清空所有塔/墙 + 重置合成状态 + 进入 PREPARE（测试起点）
        cleanupGrid: function () {
          var cols = state.cols, rows = state.rows;
          for (var gy = 0; gy < rows; gy++) for (var gx = 0; gx < cols; gx++) {
            var k = idx(gx, gy);
            var t = state.tiles[k];
            if (t === T_TOWER || t === T_WALL || t === T_CAND) {
              state.tiles[k] = T_GRASS;
              state.grid[k] = null;
            }
          }
          state.towers = [];
          state.candidates = [];
          state.towersByInst = {};
          state.nextInstId = 1;
          state.placementUsed = 0;
          _selClear();
          _ensurePhasePrepare();
          return { ok: true, toast: { msg: _lastToastMsg, type: _lastToastType } };
        },
        // [2] 批量生成塔：specs = [{cfgId:1,rarity:'rare'}, ...] 或 [{cfgId:1}]（rarity 省略则用 cfg 默认）
        //     自动找空地，返回 [{spec, placed, idx, gx, gy, cfgName, rarity, ok}]
        spawnGridTowers: function (specs) {
          specs = specs || [];
          _ensurePhasePrepare();
          var spots = TDGame._v4.findEmptyTiles(specs.length + 3); // +3 缓冲
          var results = [];
          for (var i = 0; i < specs.length; i++) {
            var sp = specs[i];
            var sp2 = spots[i];
            if (!sp2) { results.push({ spec: sp, ok: false, msg: 'no empty tile #' + i }); continue; }
            var r = TDGame._v4.putRealTower(sp2.gx, sp2.gy, sp.cfgId, sp.rarity);
            results.push({
              spec: sp,
              ok: r.ok,
              msg: r.msg || '',
              idx: r.idx,
              gx: sp2.gx, gy: sp2.gy,
              cfgName: r.cfgName,
              rarity: r.rarity
            });
          }
          detectEvolvable();
          renderEvolveRibbon(false);
          draw();
          return { ok: results.every(function (x) { return x.ok; }), results: results, toast: { msg: _lastToastMsg, type: _lastToastType } };
        },
        // [3] 执行 A 类合成（升级）：传入 2 个 grid idx，模拟"点升级→选2塔→弹窗→确认"全流程
        runMergeA: function (idx1, idx2) {
          _selClear();
          _ensurePhasePrepare();
          setMergeMode('upgrade');
          toggleSelectTower(idx1);
          toggleSelectTower(idx2);
          var v = _validateCurrentAndPreview();
          if (!v.ok) return { ok: false, phase: 'validate', msg: v.msg, toast: v.toastMsg, summary: TDGame._v4.summary() };
          // 产物预期稀有度（断言用）
          var baseR = state.grid[idx1].rarity || state.grid[idx1].towerCfg.rarity;
          var expectedNext = state.cfg.nextRarityUp(baseR);
          var expectedPlaceIdx = idx2; // 第二座（最后选择的）
          onMergeModalConfirm();
          // 验证产物：placeIdx 处有塔且稀有度 = expectedNext
          var g = state.grid[expectedPlaceIdx];
          var pass = !!(g && g.towerCfg && (g.rarity || g.towerCfg.rarity) === expectedNext);
          // 验证素材 1 已被清除
          var mat1Cleared = !(state.grid[idx1] && state.grid[idx1].towerCfg);
          // 验证特殊塔：A 不能产特殊塔
          var isSpecial = !!(g && g.towerCfg && g.towerCfg.special);
          detectEvolvable();
          renderEvolveRibbon(false);
          draw();
          return {
            ok: pass && mat1Cleared && !isSpecial,
            phase: 'done',
            expected: { rarity: expectedNext, placeIdx: expectedPlaceIdx },
            actual: {
              rarity: g ? (g.rarity || (g.towerCfg && g.towerCfg.rarity)) : null,
              placeIdxHasTower: !!g,
              placeIdxCfgId: g && g.towerCfg ? g.towerCfg.id : null,
              placeIdxCfgName: g && g.towerCfg ? g.towerCfg.name : null,
              special: isSpecial,
              mat1Cleared: mat1Cleared
            },
            toast: { msg: _lastToastMsg, type: _lastToastType },
            summary: TDGame._v4.summary()
          };
        },
        // [4] 执行 B 类合成（3 同稀有度不同塔）：idx1,idx2,idx3 顺序，产物在 idx3
        runMergeB: function (idx1, idx2, idx3) {
          _selClear();
          _ensurePhasePrepare();
          setMergeMode('fusion');
          toggleSelectTower(idx1);
          toggleSelectTower(idx2);
          toggleSelectTower(idx3);
          var v = _validateCurrentAndPreview();
          if (!v.ok) return { ok: false, phase: 'validate', msg: v.msg, toast: v.toastMsg, summary: TDGame._v4.summary() };
          var baseR = state.grid[idx1].rarity || state.grid[idx1].towerCfg.rarity;
          var expectedNext = state.cfg.nextRarityUp(baseR);
          var expectedPlaceIdx = idx3;
          onMergeModalConfirm();
          var g = state.grid[expectedPlaceIdx];
          var pass = !!(g && g.towerCfg && (g.rarity || g.towerCfg.rarity) === expectedNext);
          var matsCleared = !(state.grid[idx1] && state.grid[idx1].towerCfg)
                         && !(state.grid[idx2] && state.grid[idx2].towerCfg);
          var isSpecial = !!(g && g.towerCfg && g.towerCfg.special);
          detectEvolvable();
          renderEvolveRibbon(false);
          draw();
          return {
            ok: pass && matsCleared && !isSpecial,
            phase: 'done',
            expected: { rarity: expectedNext, placeIdx: expectedPlaceIdx },
            actual: {
              rarity: g ? (g.rarity || (g.towerCfg && g.towerCfg.rarity)) : null,
              placeIdxHasTower: !!g,
              placeIdxCfgId: g && g.towerCfg ? g.towerCfg.id : null,
              placeIdxCfgName: g && g.towerCfg ? g.towerCfg.name : null,
              special: isSpecial,
              matsCleared: matsCleared
            },
            toast: { msg: _lastToastMsg, type: _lastToastType },
            summary: TDGame._v4.summary()
          };
        },
        // [5] 执行 C 类进化：idx1,idx2,idx3 顺序（产物在 idx3），可选 recipeId 锁定配方
        runMergeC: function (idx1, idx2, idx3, recipeId) {
          _selClear();
          _ensurePhasePrepare();
          setMergeMode('evolve');
          if (recipeId) state.merge.activeRecipeId = recipeId;
          toggleSelectTower(idx1);
          toggleSelectTower(idx2);
          toggleSelectTower(idx3);
          var v = _validateCurrentAndPreview();
          if (!v.ok) return { ok: false, phase: 'validate', msg: v.msg, toast: v.toastMsg, summary: TDGame._v4.summary() };
          var pv = v.preview;
          var matchedRecipeId = (pv.recipe && (pv.recipe.id || pv.recipe.Id)) || state.merge.activeRecipeId || null;
          var expectedPlaceIdx = idx3;
          var expectedSpecial = true;
          onMergeModalConfirm();
          var g = state.grid[expectedPlaceIdx];
          var actualSpecial = !!(g && g.towerCfg && g.towerCfg.special);
          var actualCfgId = g && g.towerCfg ? g.towerCfg.id : null;
          var matsCleared = !(state.grid[idx1] && state.grid[idx1].towerCfg)
                         && !(state.grid[idx2] && state.grid[idx2].towerCfg);
          var pass = !!(g && g.towerCfg) && actualSpecial && matsCleared;
          detectEvolvable();
          renderEvolveRibbon(false);
          draw();
          return {
            ok: pass,
            phase: 'done',
            matchedRecipeId: matchedRecipeId,
            expected: { placeIdx: expectedPlaceIdx, special: expectedSpecial },
            actual: {
              placeIdxHasTower: !!g,
              cfgId: actualCfgId,
              cfgName: g && g.towerCfg ? g.towerCfg.name : null,
              rarity: g ? (g.rarity || (g.towerCfg && g.towerCfg.rarity)) : null,
              special: actualSpecial,
              passiveId: g && g.towerCfg ? g.towerCfg.passiveId : null,
              matsCleared: matsCleared
            },
            toast: { msg: _lastToastMsg, type: _lastToastType },
            summary: TDGame._v4.summary()
          };
        },
        // [6] 断言某 idx 塔的稀有度（canvas 渲染显示值）
        assertRarity: function (gridIdx, expectedRarity) {
          var info = TDGame._v4.debugDisplayRarity(gridIdx);
          if (!info) return { pass: false, gridIdx: gridIdx, reason: 'no tower at idx=' + gridIdx };
          var pass = info.displayRarity === expectedRarity;
          return {
            pass: pass,
            gridIdx: gridIdx,
            expected: expectedRarity,
            actual: info.displayRarity,
            gridRarity: info.gridRarity,
            cfgRarity: info.cfgRarity,
            rarityShort: info.rarityShort,
            rarityCssColor: info.rarityCssColor
          };
        },
        // [7] 断言产物位置：expectedIdx 有塔且 materialIdx（除 expectedIdx 外）为空
        assertProductPosition: function (materialIdxList, expectedProductIdx) {
          var matCleared = true;
          for (var i = 0; i < materialIdxList.length; i++) {
            var m = materialIdxList[i];
            if (m === expectedProductIdx) continue;
            if (state.grid[m] && state.grid[m].towerCfg) { matCleared = false; break; }
          }
          var productExists = !!(state.grid[expectedProductIdx] && state.grid[expectedProductIdx].towerCfg);
          return {
            pass: matCleared && productExists,
            expectedProductIdx: expectedProductIdx,
            productExists: productExists,
            materialsCleared: matCleared,
            productCfg: productExists ? {
              cfgId: state.grid[expectedProductIdx].towerCfg.id,
              cfgName: state.grid[expectedProductIdx].towerCfg.name,
              rarity: state.grid[expectedProductIdx].rarity || state.grid[expectedProductIdx].towerCfg.rarity,
              special: !!state.grid[expectedProductIdx].towerCfg.special
            } : null
          };
        },
        // [8] 获取最后一条 toast（失败断言用）
        getLastToast: function () {
          return { msg: _lastToastMsg, type: _lastToastType };
        },
        // [9] 获取 ribbon 状态：每个 recipe 是否 achievable（高亮 ✓）、是否激活
        getRibbonState: function () {
          detectEvolvable();
          var recipes = state.cfg.recipes || [];
          var list = [];
          for (var i = 0; i < recipes.length; i++) {
            var r = recipes[i];
            var achievable = state.evolvable && state.evolvable.recipeIds && state.evolvable.recipeIds.indexOf(r.id) >= 0;
            list.push({
              recipeId: r.id,
              recipeName: r.name,
              outputTowerId: r.outputTowerId || r.OutputTowerId,
              achievable: achievable,
              active: state.merge.activeRecipeId === r.id
            });
          }
          // DOM 侧：.etab.ok / .etab.on 数量
          var tabsOkCount = 0, tabsOnCount = 0, ribbonVisible = false;
          try {
            var ribbon = document.getElementById('evolve-ribbon');
            ribbonVisible = ribbon ? !ribbon.classList.contains('hidden') : false;
            var tabs = document.querySelectorAll('#evolve-tabs .etab');
            for (var j = 0; j < tabs.length; j++) {
              if (tabs[j].classList.contains('ok')) tabsOkCount++;
              if (tabs[j].classList.contains('on')) tabsOnCount++;
            }
          } catch (e) {}
          return {
            phase: state.phase,
            evolvableAny: state.evolvable ? state.evolvable.any : false,
            evolvableCount: state.evolvable && state.evolvable.recipeIds ? state.evolvable.recipeIds.length : 0,
            recipes: list,
            dom: { ribbonVisible: ribbonVisible, tabsOkCount: tabsOkCount, tabsOnCount: tabsOnCount },
            btnEvolveGlow: (function () { var b = document.getElementById('btn-evolve'); return b ? b.classList.contains('glow') : false; })()
          };
        },
        // [10] 获取某 idx 塔详情弹窗的稀有度显示（模拟 HTML 生成，取自同一段代码）
        getTowerModalRarityDisplay: function (gridIdx) {
          var g = state.grid[gridIdx];
          if (!g || !g.towerCfg) return null;
          var cfg = g.towerCfg;
          var displayRarity = g.rarity || cfg.rarity;
          var title = '[' + rarityLabel(displayRarity) + '] ' + (cfg.special ? '★ ' : '') + (cfg.name || '');
          return {
            gridIdx: gridIdx,
            displayRarity: displayRarity,
            rarityLabel: rarityLabel(displayRarity),
            titleText: title,
            special: !!cfg.special,
            cfgName: cfg.name,
            cfgId: cfg.id
          };
        },
        // [11] AB 特殊塔拒绝测试：尝试 runMergeA/B 带特殊塔材料，返回校验阶段错误
        tryMergeAWithSpecial: function (idx1, idx2) {
          _selClear();
          _ensurePhasePrepare();
          state.merge.mode = 'upgrade';
          state.merge.selected = [idx1, idx2];
          var v = validateAndBuildPreview();
          var rejected = !!(v && !v.ok);
          var msg = v ? v.msg : '';
          _selClear();
          return { rejected: rejected, validateOk: !!(v && v.ok), msg: msg, toast: _lastToastMsg };
        },
        tryMergeBWithSpecial: function (idx1, idx2, idx3) {
          _selClear();
          _ensurePhasePrepare();
          state.merge.mode = 'fusion';
          state.merge.selected = [idx1, idx2, idx3];
          var v = validateAndBuildPreview();
          var rejected = !!(v && !v.ok);
          var msg = v ? v.msg : '';
          _selClear();
          return { rejected: rejected, validateOk: !!(v && v.ok), msg: msg, toast: _lastToastMsg };
        },
        // [12] 失败用例快捷：A 类不同稀有度 2 塔，B 类仅 2 塔或不同稀有度，C 类不匹配配方
        tryMergeADifferentRarity: function (idxCommon, idxRare) {
          _selClear();
          _ensurePhasePrepare();
          state.merge.mode = 'upgrade';
          state.merge.selected = [idxCommon, idxRare];
          var v = validateAndBuildPreview();
          var rejected = !!(v && !v.ok);
          var msg = v ? v.msg : '';
          _selClear();
          return { rejected: rejected, validateOk: !!(v && v.ok), msg: msg, toast: _lastToastMsg };
        },
        tryMergeBOnly2Towers: function (idx1, idx2) {
          _selClear();
          _ensurePhasePrepare();
          state.merge.mode = 'fusion';
          state.merge.selected = [idx1, idx2];
          var v = validateAndBuildPreview();
          var rejected = !!(v && !v.ok);
          var msg = v ? v.msg : '';
          _selClear();
          return { rejected: rejected, validateOk: !!(v && v.ok), msg: msg, toast: _lastToastMsg };
        },
        tryMergeCNoMatch: function (idx1, idx2, idx3) {
          _selClear();
          _ensurePhasePrepare();
          state.merge.mode = 'evolve';
          state.merge.selected = [idx1, idx2, idx3];
          var v = validateAndBuildPreview();
          var rejected = !!(v && !v.ok);
          var msg = v ? v.msg : '';
          _selClear();
          return { rejected: rejected, validateOk: !!(v && v.ok), msg: msg, toast: _lastToastMsg };
        },
        // [13] 快捷：一次性汇总场上塔信息（canvas 显示+详情弹窗显示一致性检查）
        allTowersDisplayInfo: function () {
          var list = [];
          for (var i = 0; i < state.tiles.length; i++) {
            if (state.tiles[i] === T_TOWER && state.grid[i] && state.grid[i].towerCfg) {
              list.push({
                idx: i,
                canvas: TDGame._v4.debugDisplayRarity(i),
                modal: this.getTowerModalRarityDisplay(i)
              });
            }
          }
          return list;
        }
      };
    })()
  };

  // ---------- 全局简写（方便浏览器自动化/调试直接调用）----------
  window.calcTowerEffective = calcTowerEffective;
  window.damageEnemy = damageEnemy;
  window.findTowerCfgById = function (id) {
    var all = (state.cfg && state.cfg.towers ? state.cfg.towers.slice() : []).concat(
               state.cfg && state.cfg.specialTowers ? state.cfg.specialTowers.slice() : []);
    for (var i = 0; i < all.length; i++) if (String(all[i].id) === String(id)) return all[i];
    return null;
  };
})();
