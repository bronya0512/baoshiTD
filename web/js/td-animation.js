/* ============================================================
 *  td-animation.js — 纯 Canvas 2D 序列帧播放器
 *  功能：多动画定义 / 多实例并发 / 循环（none/loop/pingpong）/
 *        速度倍率 / 帧步进 / 完成回调 / 事件钩子 / draw 变换
 *  集成到 td-game.js：
 *    - 全局单例 window.animPlayer = new FrameAnimationPlayer()
 *    - 游戏主循环 tick 中：animPlayer.update(dt)
 *    - draw() 中（塔画完后、子弹画完前）：animPlayer.drawAll(ctx)
 *    - 塔发射子弹时：animPlayer.spawn('towerAttack', {x,y,scale,loop:'none'})
 * ============================================================ */
(function (global) {
  'use strict';

  function FrameAnimationPlayer() {
    this.anims = {};      // name -> {image, frames:[{x,y,w,h, ox,oy, dur}], meta:{fps,total,loop}, defaultScale?, anchor?}
    this._instances = []; // 运行中的实例
  }
  FrameAnimationPlayer.prototype = {
    /** 从 URL 加载精灵图 + 元数据 */
    load: function (def) {
      var self = this;
      return new Promise(function (resolve, reject) {
        if (!def || !def.name) return reject(new Error('def.name 必传'));
        var img = new Image();
        img.onload = function () {
          var anim = self._parseDef(def, img);
          self.anims[def.name] = anim;
          resolve(anim);
        };
        img.onerror = function () { reject(new Error('img load fail: ' + def.imageUrl)); };
        img.crossOrigin = 'anonymous';
        img.src = def.imageUrl;
      });
    },
    /** 同步加载（精灵图已在内存：HTMLCanvasElement / HTMLImageElement / ImageBitmap） */
    loadSync: function (def) {
      if (!def || !def.name) throw new Error('def.name required');
      var img = def.image;
      if (!img || !(img.width && img.height)) throw new Error('def.image invalid (no width/height)');
      this.anims[def.name] = this._parseDef(def, img);
      return this.anims[def.name];
    },
    /** 加载 TexturePacker / FramePacker 风格的 JSON（Hash 或 Array 格式都行） + PNG
     *  def: { name, imageUrl, jsonUrl,
     *         order?: ['001','002',...] 或 (entryKey,i)=>number 排序；不传就对 Object.keys 做字符串升序
     *         fps?, loop?, defaultScale?,
     *         anchor?: {x:0.5, y:1.0} 相对 sourceSize 的锚点 (默认 x=0.5 正中, y=1.0 脚底落地 —— 适配角色/塔攻击)
     *       }
     */
    loadTP: function (def) {
      var self = this;
      return new Promise(function (resolve, reject) {
        if (!def || !def.name) return reject(new Error('def.name 必传'));
        if (!def.jsonUrl) return reject(new Error('def.jsonUrl 必传（TexturePacker .json 文件地址）'));
        // 1) 先拉 JSON
        fetch(def.jsonUrl, {cache:'no-cache'})
          .then(function (r) { if (!r.ok) throw new Error('json '+r.status); return r.json(); })
          .then(function (tp) {
            // 2) 决定帧顺序
            var keys = Object.keys(tp.frames || {});
            var orderFn, orderArr;
            if (Array.isArray(def.order)) { orderArr = def.order.slice(); }
            else if (typeof def.order === 'function') { orderFn = def.order; }
            else { keys.sort(); orderArr = keys.slice(); }
            // 过滤：orderArr 是前缀/全名匹配 tp.frames 的 key
            var resolved = [];
            if (orderArr) {
              for (var oi = 0; oi < orderArr.length; oi++) {
                var want = orderArr[oi];
                var got = null;
                if (tp.frames[want]) got = want;
                else { // 前缀匹配：want='001' 命中 '001.png' / 'attack_001' 等
                  for (var ki = 0; ki < keys.length; ki++) {
                    if (keys[ki].indexOf(want) === 0 || keys[ki].indexOf('_' + want) >= 0 || keys[ki].indexOf('-' + want) >= 0) { got = keys[ki]; break; }
                  }
                }
                if (got) resolved.push(got);
              }
            } else {
              resolved = keys.slice();
              if (orderFn) resolved.sort(function (a, b) { return orderFn(a, tp.frames[a]) - orderFn(b, tp.frames[b]); });
            }
            // 3) 解析锚点
            var anchorX = (def.anchor && typeof def.anchor.x === 'number') ? def.anchor.x : 0.5;
            var anchorY = (def.anchor && typeof def.anchor.y === 'number') ? def.anchor.y : 1.0;
            // 4) 构造逐帧 def.frames：保留 sourceSize / spriteSourceSize 的 ox/oy 偏移（trim 后不漂移）
            var frames = [];
            for (var fi = 0; fi < resolved.length; fi++) {
              var entry = tp.frames[resolved[fi]];
              var fr = entry.frame || {};            // {x,y,w,h} 图集矩形
              var src = entry.sourceSize || fr;      // {w,h} 逻辑画布
              var sss = entry.spriteSourceSize || {x:0,y:0,w:fr.w,h:fr.h}; // 实际内容在逻辑画布中的位置
              // 锚点（相对逻辑画布 src.w, src.h → 绝对像素：anchorPxX, anchorPxY）
              var apx = (src.w || fr.w) * anchorX;
              var apy = (src.h || fr.h) * anchorY;
              // 转换为 Player 需要的 ox, oy：
              //   drawImage 绘制的是 fr (图集矩形) 到屏幕 (dx,dy) 左上角，再平移 (ox,oy) — 我们希望屏幕坐标 (sx,sy) = 锚点
              //   即：sx = dx - f.w/2 - ox + sss.x + fr.w/2  →  化简：ox = sss.x - apx ; oy = sss.y - apy
              var ox = (sss.x|0) - apx;
              var oy = (sss.y|0) - apy;
              frames.push({ x: fr.x|0, y: fr.y|0, w: fr.w|0, h: fr.h|0, ox: ox, oy: oy });
            }
            // 5) 加载 imageUrl（或 tp.meta.image）
            var imageUrl = def.imageUrl || (tp.meta && tp.meta.image);
            var img = new Image();
            img.onload = function () {
              var animDef = {
                name: def.name,
                fps: def.fps || 24,
                loop: def.loop || 'none',
                frames: frames,
                defaultScale: typeof def.defaultScale === 'number' ? def.defaultScale : 1
              };
              var anim = self._parseDef(animDef, img);
              anim.defaultScale = animDef.defaultScale;
              anim.anchor = { x: anchorX, y: anchorY };
              self.anims[def.name] = anim;
              resolve(anim);
            };
            img.onerror = function () { reject(new Error('image load fail: ' + imageUrl)); };
            img.crossOrigin = 'anonymous';
            img.src = imageUrl;
          })
          .then(null, function (e) { reject(e); });
      });
    },
    /** 加载 Spine / 任何工具导出的"散图帧序列"（一帧一张 PNG，文件名含序号 00/01/02...）
     *  两种用法二选一：
     *  ① 传 frames=[url0, url1, ...]         — 直接给出帧 URL 列表，顺序即播放顺序
     *  ② 传 baseDir + prefix + suffix + count — 自动拼 frames = `${baseDir}/${prefix}${pad(i,2)}${suffix}`
     *  参数：
     *    - name: 动画名（唯一）
     *    - fps?, loop?, defaultScale?
     *    - anchor: {x:0.5, y:1.0} 基于单帧图大小的锚点（默认与角色/塔一致：脚底中央落地）
     *    - frameSize: {w, h} 可选；不传就用第一帧实际尺寸作为源大小
     *  兼容性说明：
     *    - Spine 导出 PNG APNG/Sequences 默认每帧就是完整逻辑画布，所以 ox/oy 只与 anchor 有关，没有 trim 漂移问题
     *    - 若你把图做过 trim，请改用方案 A（FramePacker/TexturePacker JSON）提供 spriteSourceSize
     */
    loadFrames: function (def) {
      var self = this;
      return new Promise(function (resolve, reject) {
        if (!def || !def.name) return reject(new Error('def.name 必传'));
        // 1) 组装 frames URL
        var urls;
        if (Array.isArray(def.frames)) {
          urls = def.frames.slice();
        } else if (def.baseDir && def.count > 0) {
          var prefix = def.prefix || '';
          var suffix = def.suffix || '.png';
          var padLen = def.padLen | 0 || 2;
          var idxStart = typeof def.startIndex === 'number' ? def.startIndex : 0;
          urls = [];
          var base = String(def.baseDir).replace(/\/+$/, '');
          for (var i = 0; i < def.count; i++) {
            var idx = String(idxStart + i);
            while (idx.length < padLen) idx = '0' + idx;
            urls.push(base + '/' + prefix + idx + suffix);
          }
        } else {
          return reject(new Error('loadFrames 需要 frames[] 或 baseDir+count'));
        }
        if (!urls.length) return reject(new Error('loadFrames 没有帧'));
        // 2) 并发加载 Image；任何一张失败都 reject；完成后按 urls 顺序合成
        var images = new Array(urls.length);
        var remain = urls.length;
        var failed = false;
        for (var ui = 0; ui < urls.length; ui++) {
          (function (u, i) {
            var img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function () {
              if (failed) return;
              images[i] = img;
              remain--;
              if (remain === 0) finish();
            };
            img.onerror = function () {
              if (failed) return;
              failed = true;
              reject(new Error('frame image load fail: ' + u));
            };
            img.src = u;
          })(urls[ui], ui);
        }
        function finish() {
          // 3) 统一帧尺寸：若 def.frameSize 提供就用；否则用第一帧 w/h 作为 logical size
          var fw = (def.frameSize && def.frameSize.w) | 0;
          var fh = (def.frameSize && def.frameSize.h) | 0;
          if (!fw || !fh) {
            // 取所有帧中最大宽高，兼容部分散图 trim 后尺寸不一致（以最大尺寸做"逻辑画布"居中对齐绘制）
            var mw = 0, mh = 0;
            for (var m = 0; m < images.length; m++) { mw = Math.max(mw, images[m].width); mh = Math.max(mh, images[m].height); }
            fw = mw; fh = mh;
          }
          var anchorX = (def.anchor && typeof def.anchor.x === 'number') ? def.anchor.x : 0.5;
          var anchorY = (def.anchor && typeof def.anchor.y === 'number') ? def.anchor.y : 1.0;
          var fps = def.fps || 24;
          var dur = 1 / fps;
          // 4) 把 N 张散图合并为一张"纵向长条精灵图"以复用现有 draw（一次 drawImage 不用分支）
          //    兼容性：Canvas 最大尺寸多数浏览器 ≥ 16384；若超限（>100 张大图）则降级为 frame.images 数组绘制
          var totalH = fh * images.length;
          var MAX_EDGE = 8192; // 保险值，所有移动浏览器都吃
          var useSpriteSheet = totalH <= MAX_EDGE;
          var frames = [];
          var animImg;
          if (useSpriteSheet) {
            var can = document.createElement('canvas');
            can.width = fw; can.height = totalH;
            var ctx2 = can.getContext('2d');
            for (var fi = 0; fi < images.length; fi++) {
              var img = images[fi];
              var dx = Math.floor((fw - img.width) / 2);
              var dy = Math.floor((fh - img.height) / 2);
              ctx2.drawImage(img, dx, dy);
            }
            animImg = can;
            var apx = fw * anchorX;
            var apy = fh * anchorY;
            // ox / oy：左上角偏移，让 (sx,sy)=锚点对齐屏幕坐标
            // sx = dx + ox + fw/2 = apx  →  ox = apx - dx - fw/2；我们这里绘制 dx 已经居中到画布，左上角 0 就刚好
            var ox = 0 - apx;
            var oy = 0 - apy;
            for (var fj = 0; fj < images.length; fj++) {
              frames.push({ x: 0, y: fj * fh, w: fw, h: fh, ox: ox, oy: oy, dur: dur });
            }
          } else {
            // 降级：保留每张图，并扩展 frames.ox/oy 相对单帧自身
            animImg = null;
            for (var fk = 0; fk < images.length; fk++) {
              var im = images[fk];
              var kapx = im.width * anchorX, kapy = im.height * anchorY;
              frames.push({
                x: 0, y: 0, w: im.width, h: im.height,
                ox: 0 - kapx, oy: 0 - kapy, dur: dur,
                // 降级标记：播放器 draw() 里会优先用 perFrameImage
                perFrameImage: im
              });
            }
          }
          var animDef = { name: def.name, fps: fps, loop: def.loop || 'none', frames: frames };
          // 如果是合成精灵图：复用 _parseDef 走现有路径以便统一 meta
          var anim;
          if (useSpriteSheet) {
            anim = self._parseDef(animDef, animImg);
          } else {
            anim = { image: null, frames: frames, meta: { name: def.name, fps: fps, total: frames.length, loop: animDef.loop || 'none' }, _perFrame: true };
          }
          anim.defaultScale = (typeof def.defaultScale === 'number') ? def.defaultScale : 1;
          anim.anchor = { x: anchorX, y: anchorY };
          self.anims[def.name] = anim;
          // 对 draw 打补丁：首次遇到 _perFrame 时按 perFrameImage 单独 drawImage（保证代码量最小）
          self._ensurePerFramePatched();
          resolve(anim);
        }
      });
    },
    _ensurePerFramePatched: function () {
      if (this.__perFramePatched) return;
      this.__perFramePatched = true;
      var origDraw = this.draw.bind(this);
      var self = this;
      this.draw = function (ctx, nameOrInst, x, y, opts) {
        // 解析 anim & frame
        var inst, a, fi;
        if (typeof nameOrInst === 'string') {
          a = self.anims[nameOrInst];
          if (!a) return;
          fi = (opts && typeof opts.frame === 'number') ? opts.frame : 0;
        } else {
          inst = nameOrInst;
          if (!inst) return;
          a = inst.anim; fi = inst.frame;
          x = (typeof x === 'number') ? x : inst.x;
          y = (typeof y === 'number') ? y : inst.y;
        }
        if (!a || !a.frames) return;
        var f = a.frames[fi];
        if (!f) return;
        if (!f.perFrameImage) { return origDraw(ctx, nameOrInst, x, y, opts || {}); }
        // 散图：逐帧自己的 Image
        opts = opts || {};
        ctx.save();
        var alpha = inst ? inst.alpha : (typeof opts.alpha === 'number' ? opts.alpha : 1);
        var scale = inst ? inst.scale : (typeof opts.scale === 'number' ? opts.scale : (typeof a.defaultScale === 'number' ? a.defaultScale : 1));
        var rot = inst ? inst.rotation : (opts.rotation | 0);
        if (alpha < 1) ctx.globalAlpha = alpha;
        var tx = x + f.ox * scale + f.w * scale / 2;
        var ty = y + f.oy * scale + f.h * scale / 2;
        ctx.translate(tx, ty);
        if (rot) ctx.rotate(rot * Math.PI / 180);
        if (scale !== 1) ctx.scale(scale, scale);
        ctx.drawImage(f.perFrameImage, -f.w / 2, -f.h / 2, f.w, f.h);
        ctx.restore();
      };
    },
    /** 把元数据 + 精灵图解析成可播放动画 */
    _parseDef: function (def, img) {
      var fps = def.fps || 24;
      var frameDur = 1 / fps;
      var frames = [];
      if (Array.isArray(def.frames)) {
        for (var i = 0; i < def.frames.length; i++) {
          var f = def.frames[i];
          frames.push({
            x: f.x|0, y: f.y|0, w: (f.w|0) || (def.frameWidth|0), h: (f.h|0) || (def.frameHeight|0),
            ox: f.ox|0, oy: f.oy|0,
            dur: (typeof f.duration === 'number') ? f.duration : frameDur
          });
        }
      } else {
        // 按 cols x rows 网格切帧
        var cols = def.cols | 0, rows = def.rows | 0 || 1;
        var fw = def.frameWidth | 0, fh = def.frameHeight | 0;
        var count = (def.count | 0) || (cols * rows);
        if (!fw) fw = Math.floor(img.width / cols);
        if (!fh) fh = Math.floor(img.height / rows);
        for (var k = 0; k < count; k++) {
          var cc = k % cols, rr = Math.floor(k / cols);
          frames.push({ x: cc * fw, y: rr * fh, w: fw, h: fh, ox: 0, oy: 0, dur: frameDur });
        }
      }
      return {
        image: img, frames: frames,
        meta: {
          name: def.name,
          fps: fps,
          total: frames.length,
          loop: typeof def.loop === 'string' ? def.loop : (def.loop ? 'loop' : 'none')
        }
      };
    },
    /** 创建一个播放实例（可同时成千上百个独立播放） */
    spawn: function (name, opts) {
      var a = this.anims[name];
      if (!a) return null; // 没加载到动画时静默（避免战斗中断）
      opts = opts || {};
      var self = this;
      var inst = {
        anim: a,
        name: name,
        t: 0,
        frame: 0,
        dir: 1,
        speed: typeof opts.speed === 'number' ? opts.speed : 1,
        loop: opts.loop || a.meta.loop || 'none',
        playing: !(opts.autoplay === false),
        x: typeof opts.x === 'number' ? opts.x : 0,
        y: typeof opts.y === 'number' ? opts.y : 0,
        scale: typeof opts.scale === 'number' ? opts.scale : (typeof a.defaultScale === 'number' ? a.defaultScale : 1),
        alpha: typeof opts.alpha === 'number' ? opts.alpha : 1,
        rotation: opts.rotation | 0,
        onComplete: opts.onComplete || null,
        onFrame: opts.onFrame || null,
        ended: false,
        _userData: opts.userData || null
      };
      // none 模式：播放完毕自动销毁，不留实例占槽
      if (!inst.onComplete && inst.loop === 'none') {
        inst.onComplete = function (doneInst, reason) {
          if (reason === 'end') self.kill(doneInst);
        };
      }
      this._instances.push(inst);
      return inst;
    },
    /** 移除实例 */
    kill: function (inst) {
      if (!inst) return;
      var i = this._instances.indexOf(inst);
      if (i >= 0) this._instances.splice(i, 1);
    },
    killAll: function () { this._instances.length = 0; },
    instances: function () { return this._instances.slice(); },
    instanceCount: function () { return this._instances.length; },
    hasAnim: function (name) { return !!this.anims[name]; },
    /** 动态改某动画的 defaultScale（例如地图 cell 变化后重设）；同时把当前存在的同名实例 scale 也同步更新（视觉立刻生效） */
    setAnimDefaultScale: function (name, scale) {
      if (typeof scale !== 'number' || !(scale > 0)) return false;
      var a = this.anims[name];
      if (!a) return false;
      a.defaultScale = scale;
      for (var i = 0; i < this._instances.length; i++) {
        var inst = this._instances[i];
        if (inst && inst.name === name) inst.scale = scale;
      }
      return true;
    },
    /** 获取当前动画的 defaultScale（调试/断言用） */
    getAnimDefaultScale: function (name) {
      var a = this.anims[name];
      return (a && typeof a.defaultScale === 'number') ? a.defaultScale : null;
    },

    /** 每帧推进所有实例时间（dt 秒数，通常来自 RAF） */
    update: function (dt) {
      if (typeof dt !== 'number' || !(dt > 0)) return;
      dt = Math.min(dt, 1/10); // clamp 避免后台 tab 回来大跳
      for (var i = this._instances.length - 1; i >= 0; i--) {
        var inst = this._instances[i];
        if (!inst || !inst.playing || inst.ended) continue;
        var a = inst.anim;
        if (!a || !a.frames || !a.frames.length) continue;
        inst.t += dt * inst.speed;
        // 累计推进到正确帧（>1 帧也能连续跳，不会丢结束事件）
        while (inst.t >= a.frames[inst.frame].dur) {
          inst.t -= a.frames[inst.frame].dur;
          var before = inst.frame;
          this._advance(inst);
          if (inst.onFrame) inst.onFrame(inst.frame, before);
          if (inst.ended) break;
        }
      }
    },
    _advance: function (inst) {
      var a = inst.anim;
      var n = a.meta.total;
      if (inst.loop === 'pingpong') {
        inst.frame += inst.dir;
        if (inst.frame >= n) { inst.frame = Math.max(0, n - 2); inst.dir = -1; }
        else if (inst.frame < 0) { inst.frame = Math.min(1, n - 1); inst.dir = 1; this._finish(inst); }
      } else if (inst.loop === 'loop') {
        inst.frame = (inst.frame + 1) % n;
        if (inst.frame === 0 && inst.onComplete) inst.onComplete(inst, 'loop');
      } else { // none
        inst.frame++;
        if (inst.frame >= n) { inst.frame = n - 1; this._finish(inst); }
      }
    },
    _finish: function (inst) {
      inst.ended = true;
      inst.playing = false;
      if (inst.onComplete) inst.onComplete(inst, 'end');
    },

    /** 单帧绘制（或绘制某个实例） */
    draw: function (ctx, nameOrInst, x, y, opts) {
      opts = opts || {};
      var inst, a, fi;
      if (typeof nameOrInst === 'string') {
        a = this.anims[nameOrInst];
        if (!a) return;
        fi = (typeof opts.frame === 'number') ? opts.frame : 0;
      } else {
        inst = nameOrInst;
        if (!inst) return;
        a = inst.anim; fi = inst.frame;
        x = (typeof x === 'number') ? x : inst.x;
        y = (typeof y === 'number') ? y : inst.y;
      }
      if (!a || !a.frames) return;
      var f = a.frames[fi];
      if (!f) return;
      ctx.save();
      var alpha = inst ? (inst.alpha) : (typeof opts.alpha === 'number' ? opts.alpha : 1);
      var scale = inst ? inst.scale : (typeof opts.scale === 'number' ? opts.scale : (typeof a.defaultScale === 'number' ? a.defaultScale : 1));
      var rot   = inst ? inst.rotation : (opts.rotation | 0);
      if (alpha < 1) ctx.globalAlpha = alpha;
      // ox, oy 已由 loadTP 把"锚点 → drawImage 左上角偏移"算好，这里直接平移 scale 倍即可
      var tx = x + f.ox * scale + f.w * scale / 2;
      var ty = y + f.oy * scale + f.h * scale / 2;
      ctx.translate(tx, ty);
      if (rot) ctx.rotate(rot * Math.PI / 180);
      if (scale !== 1) ctx.scale(scale, scale);
      ctx.drawImage(a.image, f.x, f.y, f.w, f.h, -f.w/2, -f.h/2, f.w, f.h);
      ctx.restore();
    },
    /** 绘制所有 spawn 的实例（主循环推荐） */
    drawAll: function (ctx) {
      for (var i = 0; i < this._instances.length; i++) {
        this.draw(ctx, this._instances[i]);
      }
    }
  };

  global.FrameAnimationPlayer = FrameAnimationPlayer;
  // 全局单例：td-game.js 直接用 animPlayer.xxx
  global.animPlayer = new FrameAnimationPlayer();
})(window);
