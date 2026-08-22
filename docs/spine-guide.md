# Spine 资产制作操作指南

> 适用版本：**Spine Editor 3.8.x**（与 `spine-runtimes@3.8.x` Web Runtime 对应）
> 渲染方案：**spine-webgl**（WebGL 高性能渲染） + Canvas 2D 叠加层
> 导出目标：Web 浏览器

---

## 一、环境准备

### 1.1 Spine Editor 安装

1. 访问 https://esotericsoftware.com/spine-purchase 购买/下载 Spine Editor
2. **推荐版本：3.8.99**（3.8 系列最终稳定版，与 Web Runtime 完全对齐）
3. 安装后首次启动，在 `Preferences` → `Export` 设置默认导出目录

### 1.2 运行时库

项目使用 **Spine Runtimes 3.8**（`spine-all.js` 捆绑了 core + webgl 全部模块）：

```html
<!-- spine-runtimes 3.8 (spine-all.js 包含 spine-core + spine-webgl + player 等所有模块) -->
<script src="https://cdn.jsdelivr.net/gh/EsotericSoftware/spine-runtimes@3.8/spine-ts/build/spine-all.js"></script>
```

> **备注**：Spine 3.8 runtime 未发布 npm 包，需从 GitHub 仓库 [`EsotericSoftware/spine-runtimes` → `3.8` 分支](https://github.com/EsotericSoftware/spine-runtimes/tree/3.8/spine-ts/build) 获取。可下载 `spine-all.js` 放在本地 `web/vendor/` 目录下使用。如果只需要 WebGL 渲染器，也可以使用 `spine-webgl.js`（但需额外加载 `spine-core.js`）。

**锁定版本**：Spine Runtime 版本必须与 Editor 导出的 Skeleton 数据版本匹配。
- Editor 3.8.x → Runtime 3.8.x ✅
- Editor 3.8.x → Runtime 4.x ❌（不兼容）

### 1.3 项目目录结构

所有 Spine 资源放在以下目录：

```
baoshiTD/
├── assets/
│   └── spine/
│       ├── enemies/
│       ├── towers/
│       └── effects/
└── scripts/
    └── verify_atlas.js
```

---

## 二、Spine Editor 项目设置

### 2.1 新建项目

1. `File` → `New Project`
2. 项目命名：`baoshiTD-enemies` / `baoshiTD-towers` / `baoshiTD-effects`（按类别分项目）
3. **单位设置（关键）**：
   - `User data` → `Orientation`: **North（朝上）** — 塔防中敌人朝上方行走
   - `User data` → `Width`: **根据角色大小设置**（小兵 128，Boss 512）
   - `User data` → `Height`: **同上**

### 2.2 导入 PSD / PNG 素材

1. `Images` 面板 → `New Image`
2. 导入分层 PSD（保持图层分离）或单张 PNG
3. 命名规范：
   ```
   enemies/grunt/body.png
   enemies/grunt/head.png
   enemies/grunt/shadow.png
   towers/fire/base.png
   towers/fire/barrel.png
   ```

### 2.3 创建骨骼结构

#### 敌人骨骼结构
```
root
├── body（身体）
│   ├── head（头）
│   ├── left_arm → left_hand
│   ├── right_arm → right_hand
│   ├── left_leg → left_foot
│   └── right_leg → right_foot
└── shadow（阴影，固定在底部）
```

#### 塔骨骼结构
```
root
├── base（基座，不旋转）
├── tower_body（塔身，可旋转瞄准）
│   └── barrel（炮管）
├── gem_slot_1（宝石插槽 1）
├── gem_slot_2（宝石插槽 2）
└── muzzle_flash（炮口火焰）
```

### 2.4 制作动画

#### 敌人动画清单

| 动画名 | 用途 | 循环 | 预估时长 |
|--------|------|------|---------|
| `idle` | 待机（部署阶段） | ✓ 循环 | 2s |
| `walk` | 行走/移动 | ✓ 循环 | 0.6s |
| `attack` | 攻击动作 | ✗ 单次 | 0.5s |
| `hit` | 受击反应 | ✗ 单次 | 0.2s |
| `death` | 死亡动画 | ✗ 单次 | 1.5s |
| `skill_1` | Boss 技能 1 | ✗ 单次 | 1.0s |
| `skill_2` | Boss 技能 2 | ✗ 单次 | 1.5s |

#### 塔动画清单

| 动画名 | 用途 | 循环 | 预估时长 |
|--------|------|------|---------|
| `idle` | 待机瞄准默认方向 | ✓ 循环 | 3s |
| `fire` | 发射动作 | ✗ 单次 | 0.3s |
| `level_up` | 升级特效 | ✗ 单次 | 0.8s |
| `destroyed` | 被摧毁动画 | ✗ 单次 | 1.0s |

**关键帧提示**：
- 使用 `Event` 轨道标记攻击帧（通知前端发射子弹）
- 使用 `Event` 轨道标记受击/死亡帧（音效触发）
- 所有循环动画首尾帧无缝衔接

---

## 三、导出设置（关键步骤）

### 3.1 导出流程

1. `File` → `Export`（或 Ctrl+E）
2. 配置以下参数
3. 点击 `Export`

### 3.2 完整导出参数

| 参数 | 值 | 说明 |
|------|-----|------|
| **Pack** | ✅ 勾选 | 打包贴图到 Atlas |
| **Pack settings** | 见下方 | Atlas 打包细节 |

#### Pack Settings

| 参数 | 值 |
|------|-----|
| Max page width | **2048** |
| Max page height | **2048** |
| Padding | **2** |
| Alpha padding | ✅ 勾选 |
| Output | Separate page files |
| Atlas extension | `.atlas` |
| Region naming | Long |

#### 数据设置

| 参数 | 值 | 说明 |
|------|-----|------|
| **Skeleton** | `.json` / `.skel` | JSON 或二进制骨架数据（3.8 两者都支持，推荐 `.skel` 体积更小） |
| **Atlas** | `.atlas` | Atlas 描述 |
| **Images** | `.png` | 打包贴图 |
| **Nonessential files** | 清除 | 不导出无关文件 |

#### ⚠️ 版本兼容性（关键）

| 参数 | 值 | 说明 |
|------|-----|------|
| **Version** | **3.8** | 与 Runtime 版本一致 |
| **Scale** | **1.0** | 原始像素 |

### 3.3 导出后文件

```
grunt/
├── grunt.json          # Skeleton 数据（JSON 格式）或
├── grunt.skel          # Skeleton 数据（二进制格式，推荐）
├── grunt.atlas         # Atlas 描述文件
├── grunt.png           # 打包贴图
└── grunt_1.png         # 多页时的第 2 页（如有）
```

💡 **提示**：Spine 3.8 同时支持 `.json` 和 `.skel` 两种骨架格式。`.skel` 是二进制格式，体积更小、加载更快，**推荐优先使用**。如果使用 `.skel`，前端需要用 `SkeletonBinary` 替代 `SkeletonJson` 来解析。

---

## 四、Atlas 文件格式说明（Spine 3.8）

### 4.1 Page 块格式

```
page1.png           ← 第一行为图片文件名
size: 688,688       ← 页面尺寸（必须与 PNG 实际尺寸一致！）
format: RGBA8888    ← 可选：像素格式
filter: Linear,Linear ← 可选：过滤方式
repeat: none        ← 可选：重复方式
```

### 4.2 Region 块格式

```
region_name         ← 第一行为区域名称
rotate: true        ← 是否旋转 90°
xy: 244, 2          ← 在 page 中的位置 (x, y 像素坐标)
size: 10, 32        ← region 尺寸 (width, height)
orig: 12, 32        ← 原始（未裁剪）尺寸
offset: 1, 0        ← 裁剪偏移 (offsetX, offsetY)
index: -1           ← 可选：帧动画序号
```

### 4.3 与 Spine 4.x atlas 格式对比

| 字段 | Spine 3.8 | Spine 4.x |
|------|-----------|-----------|
| 位置+尺寸 | `xy: x,y` + `size: w,h`（分开） | `bounds: x,y,w,h`（合并） |
| 原始信息 | `orig: ow,oh` + `offset: ox,oy`（分开） | `offsets: ox,oy,ow,oh`（合并） |
| 旋转 | `rotate: true/false` | `rotate: true/false`（相同） |
| 索引 | `index: n` | `index: n`（相同） |

### 4.4 运行时加载规则

```
必须遵守：
1. 先加载 .atlas 文本
2. 解析 atlas 中的 page 文件名（禁止字符串拼接猜测）
3. 加载所有 page PNG 图片
4. 创建 TextureAtlas（绑定图片）
5. 创建 AtlasAttachmentLoader + SkeletonJson
6. 解析 .json 骨架数据
```

---

## 五、前端加载与渲染

### 5.1 双图层架构

```
┌─────────────────────────────────────────────┐
│ HTML Container                              │
│ ┌─────────────────────────────────────────┐ │
│ │ WebGL Canvas (底层)                      │ │
│ │  - spine-webgl: 角色骨骼动画            │ │
│ │  - 塔 / 敌人 / Boss 渲染                │ │
│ ├─────────────────────────────────────────┤ │
│ │ Canvas 2D Canvas (叠加层)                │ │
│ │  - 地图网格 / 路径                       │ │
│ │  - 弹道 / 粒子特效                       │ │
│ │  - 血条 / 飘字                           │ │
│ ├─────────────────────────────────────────┤ │
│ │ HTML DOM (顶层)                          │ │
│ │  - HUD / 按钮 / 菜单 / 宝石面板          │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### 5.2 资产管理器（Spine 3.8）

```javascript
// spine-loader.js
// 使用 Spine Runtimes 3.8 API

class SpineAssetManager {
    constructor() {
        this.skeletonDataMap = new Map();  // 缓存 SkeletonData
        this.textureAtlasMap = new Map();  // 缓存 TextureAtlas
    }

    // 加载单个资产（.atlas + .skel/.json + .png）
    async load(name, folder) {
        try {
            // 1. 加载 .atlas 文本
            const atlasText = await this._fetchText(`${folder}/${name}.atlas`);

            // 2. 优先加载 .skel（二进制），fallback 到 .json
            let skeletonData;
            const skelResponse = await fetch(`${folder}/${name}.skel`);
            if (skelResponse.ok) {
                const skelBuffer = await skelResponse.arrayBuffer();
                skeletonData = this._parseSkel(atlasText, skelBuffer);
            } else {
                // fallback: 加载 .json
                const jsonText = await this._fetchText(`${folder}/${name}.json`);
                skeletonData = this._parseJson(atlasText, jsonText);
            }

            // 3. 缓存
            this.skeletonDataMap.set(name, skeletonData);

            console.log(`✅ 加载完成: ${name}`);
            return skeletonData;
        } catch (err) {
            console.error(`❌ 加载 ${name} 失败:`, err);
            throw err;
        }
    }

    // 使用 SkeletonBinary 解析 .skel
    _parseSkel(atlasText, skelBuffer) {
        const textureAtlas = this._createTextureAtlas(atlasText);
        const attachmentLoader = new spine.AtlasAttachmentLoader(textureAtlas);
        const parser = new spine.SkeletonBinary(attachmentLoader);
        parser.setScale(1);
        return parser.readSkeletonData(skelBuffer);
    }

    // 使用 SkeletonJson 解析 .json
    _parseJson(atlasText, jsonText) {
        const textureAtlas = this._createTextureAtlas(atlasText);
        const attachmentLoader = new spine.AtlasAttachmentLoader(textureAtlas);
        const parser = new spine.SkeletonJson(attachmentLoader);
        return parser.readSkeletonData(jsonText);
    }

    // 从 atlas 创建 TextureAtlas 并加载所有 PNG
    _createTextureAtlas(atlasText) {
        const pngFiles = this._extractPngFiles(atlasText);
        const images = {};
        for (const pngFile of pngFiles) {
            images[pngFile] = this._loadImageSync ? this._loadImageSync(pngFile) : this._loadImage(pngFile);
        }

        return new spine.TextureAtlas(atlasText, (line, callback) => {
            if (images[line]) {
                callback(images[line]);
            } else {
                console.error(`Atlas 中引用的图片未加载: ${line}`);
                callback(null);
            }
        });
    }

    // 批量加载
    async loadAll(assetList) {
        return Promise.all(
            assetList.map(a => this.load(a.name, a.folder))
        );
    }

    // 实例化骨骼
    createInstance(name) {
        const data = this.skeletonDataMap.get(name);
        if (!data) throw new Error(`"${name}" 未加载`);

        const skeleton = new spine.Skeleton(data);
        const animState = new spine.AnimationState(data);
        animState.apply(skeleton);
        skeleton.updateWorldTransform();
        return { skeleton, animState };
    }

    setAnimation(instance, trackIndex, animName, loop) {
        instance.animState.setAnimation(trackIndex, animName, loop);
    }

    addAnimation(instance, trackIndex, animName, loop, delay = 0) {
        instance.animState.addAnimation(trackIndex, animName, loop, delay);
    }

    setSkin(instance, skinName) {
        instance.skeleton.setSkinByName(skinName);
        instance.skeleton.setSlotsToSetupPose();
    }

    getSkeletonData(name) {
        return this.skeletonDataMap.get(name);
    }

    getTextureAtlas(name) {
        return this.textureAtlasMap.get(name);
    }

    dispose() {
        for (const [, atlas] of this.textureAtlasMap) {
            // Spine 3.8 中 TextureAtlas 的 dispose 方式
            if (atlas.dispose) atlas.dispose();
        }
        this.skeletonDataMap.clear();
        this.textureAtlasMap.clear();
    }

    // ---- 内部方法 ----

    async _fetchText(url) {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
        return resp.text();
    }

    _loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`图片加载失败: ${url}`));
            img.src = url;
        });
    }

    _extractPngFiles(atlasText) {
        const files = [];
        const lines = atlasText.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (/\.(png|jpg|jpeg)$/i.test(trimmed)) {
                files.push(trimmed);
            }
        }
        // 去重
        return [...new Set(files)];
    }
}
```

### 5.3 渲染器

```javascript
// game-renderer.js
// 使用 Spine Runtimes 3.8 API

class GameRenderer {
    constructor(webglCanvas, overlayCanvas) {
        // WebGL 层：用于 Spine 动画
        this.glCanvas = webglCanvas;
        this.gl = webglCanvas.getContext('webgl', {
            premultipliedAlpha: true,
            alpha: true
        });

        // 创建 Spine WebGL 渲染器
        this.webglRenderer = new spine.WebGL(this.gl);

        // 叠加层：Canvas 2D（地图/弹道/血条）
        this.overlayCanvas = overlayCanvas;
        this.ctx2d = overlayCanvas.getContext('2d');

        // Spine 实例列表（按 Y 排序渲染）
        this.instances = [];
    }

    resize(width, height) {
        const dpr = window.devicePixelRatio || 1;
        this.glCanvas.width = width * dpr;
        this.glCanvas.height = height * dpr;
        this.glCanvas.style.width = width + 'px';
        this.glCanvas.style.height = height + 'px';

        this.overlayCanvas.width = width * dpr;
        this.overlayCanvas.height = height * dpr;
        this.overlayCanvas.style.width = width + 'px';
        this.overlayCanvas.style.height = height + 'px';

        this.webglRenderer.resize(width * dpr, height * dpr);
    }

    addSpineInstance(name, x, y, scale = 1) {
        const inst = assetManager.createInstance(name);
        const wrapper = {
            skeleton: inst.skeleton,
            animState: inst.animState,
            x,
            y,
            scale
        };
        this.instances.push(wrapper);
        return wrapper;
    }

    removeSpineInstance(wrapper) {
        this.instances = this.instances.filter(i => i !== wrapper);
    }

    render(dt) {
        const dpr = window.devicePixelRatio || 1;

        // === WebGL 层：渲染所有 Spine 实例 ===
        this.webglRenderer.clear(0, 0, 0, 0);
        this.webglRenderer.begin();

        // 按 Y 排序实现深度排序
        this.instances.sort((a, b) => a.y - b.y);

        for (const inst of this.instances) {
            // 1. 更新动画状态
            inst.animState.update(dt);
            inst.animState.apply(inst.skeleton);
            inst.skeleton.updateWorldTransform();

            // 2. 计算屏幕坐标
            //    Spine 坐标系：原点在中心，Y 朝上
            //    屏幕坐标系：原点在左上，Y 朝下
            const worldX = inst.x * dpr;
            const worldY = (this.glCanvas.height - inst.y) * dpr;

            // 3. 设置骨架位置和缩放
            inst.skeleton.setPosition(worldX, worldY);
            inst.skeleton.setScale(inst.scale * dpr, inst.scale * dpr);

            // 4. 绘制
            this.webglRenderer.drawSkeleton(inst.skeleton);
        }

        this.webglRenderer.end();

        // === Canvas 2D 叠加层 ===
        this.ctx2d.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

        // 绘制地图网格、路径、弹道、血条等
        if (this.drawGrid) this.drawGrid(this.ctx2d, dpr);
        if (this.drawPath) this.drawPath(this.ctx2d, dpr);
        if (this.drawProjectiles) this.drawProjectiles(this.ctx2d, dpr);
        if (this.drawHealthBars) this.drawHealthBars(this.ctx2d, dpr);
        if (this.drawFloatingTexts) this.drawFloatingTexts(this.ctx2d, dpr);
    }
}
```

### 5.4 初始化完整示例

```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>宝石塔防</title>
    <style>
        body { margin: 0; background: #1a1d29; }
        #game-container { position: relative; width: 960px; height: 720px; }
        #gl-canvas, #overlay-canvas {
            position: absolute; top: 0; left: 0;
            width: 100%; height: 100%;
        }
        #ui-overlay {
            position: absolute; top: 0; left: 0;
            width: 100%; height: 100%; pointer-events: none;
        }
        #ui-overlay > * { pointer-events: auto; }
    </style>
</head>
<body>
    <div id="game-container">
        <canvas id="gl-canvas"></canvas>       <!-- WebGL：Spine 层 -->
        <canvas id="overlay-canvas"></canvas>  <!-- 2D：叠加层 -->
        <div id="ui-overlay"></div>             <!-- DOM：UI 层 -->
    </div>

    <!-- Spine Runtimes 3.8 (spine-all.js 包含 spine-core + spine-webgl) -->
    <script src="https://cdn.jsdelivr.net/gh/EsotericSoftware/spine-runtimes@3.8/spine-ts/build/spine-all.js"></script>

    <script src="/js/spine-loader.js"></script>
    <script src="/js/game-renderer.js"></script>
    <script src="/js/main.js"></script>
</body>
</html>
```

```javascript
// main.js

let assetManager, renderer;

async function init() {
    const glCanvas = document.getElementById('gl-canvas');
    const overlayCanvas = document.getElementById('overlay-canvas');

    // 创建资产管理器
    assetManager = new SpineAssetManager();

    // 加载资产（三件套：.json + .atlas + .png）
    const assets = [
        { name: 'grunt',        folder: '/assets/spine/enemies/grunt' },
        { name: 'flyer',        folder: '/assets/spine/enemies/flyer' },
        { name: 'heavy_guard',  folder: '/assets/spine/enemies/heavy_guard' },
        { name: 'boss_dragon',  folder: '/assets/spine/enemies/boss_dragon' },
        { name: 'tower_fire_1', folder: '/assets/spine/towers/tower_fire_1' },
        { name: 'tower_ice_1',  folder: '/assets/spine/towers/tower_ice_1' },
        { name: 'fx_explosion', folder: '/assets/spine/effects/fx_explosion' },
        { name: 'fx_laser',     folder: '/assets/spine/effects/fx_laser' },
    ];

    console.log('加载中...');
    await assetManager.loadAll(assets);
    console.log('加载完成！');

    // 创建渲染器
    renderer = new GameRenderer(glCanvas, overlayCanvas);
    renderer.resize(960, 720);

    // 添加测试实例
    const grunt = renderer.addSpineInstance('grunt', 200, 300, 1.0);
    assetManager.setAnimation(grunt, 0, 'walk', true);

    // 主循环
    let lastTime = performance.now();
    function loop(now) {
        const dt = Math.min((now - lastTime) / 1000, 0.05); // 最大步长 50ms
        lastTime = now;

        renderer.render(dt);
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}

window.addEventListener('DOMContentLoaded', init);
```

---

## 六、性能优化

### 6.1 分级策略

| 类型 | 同屏上限 | 骨骼数 | 渲染方案 |
|------|---------|--------|---------|
| 小兵 | 20 | ≤ 15 | spine-webgl 标准渲染 |
| 飞行 | 15 | ≤ 12 | spine-webgl 标准渲染 |
| 精英 | 5 | ≤ 20 | spine-webgl 标准渲染 |
| Boss | 1 | ≤ 30 | spine-webgl 完整渲染 |
| 超量小兵 | 20+ | - | 降级为 Canvas 2D 精灵 |

### 6.2 渲染优化技巧

- 使用 `devicePixelRatio` 自适应（移动端降为 1）
- 每帧更新限制在 50ms（`dt` clamp）
- Y 轴排序避免深度闪烁
- 减少骨骼数量（小兵 ≤ 15，Boss ≤ 30）
- 重复使用 SkeletonData，每个实例独立 Skeleton
- 同屏实例 > 20 时考虑合批或降级

---

## 七、常见问题排查

### 7.1 贴图错位 / 纹理混乱

**原因**：`.atlas` 中 `size:` 声明与 PNG 实际尺寸不匹配。

**排查**：
```bash
# 运行校验脚本
node scripts/verify_atlas.js ./assets/spine
```

**修复**：在 Spine Editor 中重新 `Pack`（`Images` → `Pack`），让 Editor 重新计算 region bounds。

### 7.2 骨骼变形 / 头扁 / 分解

**原因**：前端错误地修改 atlas 数据或坐标系不匹配。

**排查**：
1. **不要在前端修改 atlas 数据**
2. Spine Editor 中 Orientation 设为 **North**
3. 前端渲染时使用正确的 Y 轴转换：
   ```javascript
   // Spine Y 朝上，屏幕 Y 朝下
   screenY = canvasHeight - worldY
   ```

### 7.3 加载失败 / 404

**排查**：
1. atlas 中声明的 page 名必须与实际 PNG 文件完全一致
2. **禁止字符串拼接猜测文件名**（如 `name + '_0.png'`）
3. 必须先解析 atlas 文本 → 获取 page 名 → 再加载图片
4. 检查文件路径是否正确
5. 检查 CORS 设置（本地开发需用 HTTP 服务器，不能用 `file://`）

### 7.4 动画播放不完整 / 黑屏

**排查**：
1. Runtime 版本与 Editor 版本主版本号一致（必须都是 3.8.x）
2. `.json` 文件不是损坏的
3. 动画名称拼写正确（区分大小写）
4. `spine-webgl.js` 是否正确加载（检查 `<script>` 标签）
5. 打开浏览器 DevTools 查看 Console 错误

### 7.5 帧率低 / 卡顿

**排查**：
1. 检查同屏 Spine 实例数量是否超限
2. 每个实例的骨骼数量是否过多
3. 考虑将超量小兵降级为 Canvas 2D 精灵
4. 检查 `dt` 是否合理（过大导致物理异常）
5. 移动端 DPR 建议降为 1

---

## 八、验收 Checklist

- [ ] `.atlas` 中所有 page 名与 PNG 文件名完全一致
- [ ] `.atlas` 中 `size:` 与 PNG 实际像素尺寸一致（用 verify_atlas.js 检查）
- [ ] `.json` 版本号与 Runtime 版本匹配（3.8.x）
- [ ] 所有命名动画在 Spine Editor 中可播放
- [ ] `idle` 和 `walk` 动画首尾帧无缝衔接
- [ ] Web 服务器可通过 HTTP 访问所有资源
- [ ] 前端加载无控制台错误
- [ ] 同屏 20 个 Spine 实例达到 60 FPS

---

## 九、快速参考卡

### 导出参数速查

```
Pack: ✓
Max page: 2048x2048
Padding: 2px
Skeleton: .skel (推荐) 或 .json
Atlas: .atlas
Images: .png
Version: 3.8
Scale: 1.0
```

### 前端加载速查（Spine 3.8）

```javascript
// 1. 引入 runtime（spine-all.js 包含 core + webgl 全部模块）
// <script src="https://cdn.jsdelivr.net/gh/EsotericSoftware/spine-runtimes@3.8/spine-ts/build/spine-all.js"></script>

// 2. 加载 atlas 和骨架数据
const atlasText = await fetch('xxx.atlas').then(r => r.text());
const skelBuffer = await fetch('xxx.skel').then(r => r.arrayBuffer());

// 3. 加载 atlas 引用的所有 PNG
const images = {};
const pngFiles = extractPngFiles(atlasText); // 自行实现解析
for (const f of pngFiles) {
    images[f] = await loadImage(f);
}

// 4. 创建 TextureAtlas
const textureAtlas = new spine.TextureAtlas(atlasText, (line, cb) => {
    cb(images[line] || null);
});

// 5. 解析骨架（二选一）
// 方式 A：二进制 .skel（推荐）
const loader = new spine.AtlasAttachmentLoader(textureAtlas);
const binaryParser = new spine.SkeletonBinary(loader);
binaryParser.setScale(1);
const skeletonData = binaryParser.readSkeletonData(skelBuffer);

// 方式 B：JSON .json
// const jsonText = await fetch('xxx.json').then(r => r.text());
// const jsonParser = new spine.SkeletonJson(loader);
// const skeletonData = jsonParser.readSkeletonData(jsonText);

// 6. 实例化
const skeleton = new spine.Skeleton(skeletonData);
const animState = new spine.AnimationState(skeletonData);

// 7. 渲染（每帧）
animState.update(dt);
animState.apply(skeleton);
skeleton.updateWorldTransform();
webglRenderer.drawSkeleton(skeleton);
```

### Spine 3.8 vs 4.x 关键差异

| 项目 | Spine 3.8 | Spine 4.x |
|------|-----------|-----------|
| Runtime 包 | `spine-runtimes` (GitHub 3.8 分支) | `@esotericsoftware/spine-core` + `@esotericsoftware/spine-webgl` |
| CDN | `cdn.jsdelivr.net/gh/EsotericSoftware/spine-runtimes@3.8/spine-ts/build/spine-all.js` | `unpkg.com/@esotericsoftware/spine-webgl@4.x.x/dist/IIFE/spine-webgl.js` |
| 二进制 .skel | ✅ 支持（推荐） | ✅ 支持 |
| Atlas 格式 | `xy` + `size` + `orig` + `offset` | `bounds` + `offsets` |
| AssetLoader | ❌ 无（需手动加载） | ✅ 有 `spine.webgl.AssetLoader` |
| 命名空间 | `spine.*` | `spine.core.*` + `spine.webgl.*` |
