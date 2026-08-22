/**
 * Spine Atlas 校验脚本
 *
 * 检查 .atlas 文件中声明的 page size 是否与实际 PNG 尺寸一致。
 * 校验 region bounds 是否在 page 边界内。
 *
 * 支持 Spine 3.8 和 4.x 两种 atlas 格式:
 *
 * Spine 3.8 格式:
 *   page.png
 *   size: 688,688
 *   region_name
 *     rotate: true
 *     xy: 244, 2
 *     size: 10, 32
 *     orig: 12, 32
 *     offset: 1, 0
 *     index: -1
 *
 * Spine 4.x 格式:
 *   page.png
 *   size: 640,480
 *   region_name
 *     bounds: 519,223,17,38
 *     rotate: false
 *     offsets: 2,2,21,42
 *     split: 10,10,29,10
 *     pad: -1,-1,28,10
 *     index: -1
 *
 * 使用方法:
 *   node scripts/verify_atlas.js [assetDirectory]
 *   node scripts/verify_atlas.js ./assets/spine/
 *   node scripts/verify_atlas.js ./assets/spine/enemies/grunt
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// 解析 .atlas 文件（支持 Spine 3.8 和 4.x 格式）
// ============================================================

const STATE = {
    SCANNING: 'scanning',       // 等待 page 名或 region 名
    PAGE_ATTRS: 'page_attrs',   // 正在读取 page 属性
    REGION_ATTRS: 'region_attrs' // 正在读取 region 属性
};

function parseAtlas(atlasPath) {
    const content = fs.readFileSync(atlasPath, 'utf-8');
    const lines = content.split('\n');
    const pages = [];
    const regions = [];

    let state = STATE.SCANNING;
    let currentPage = null;
    let currentRegion = null;

    // Spine 3.8 格式临时缓存（xy + size → bounds, orig + offset → offsets）
    let tempXY = null;
    let tempSize = null;
    let tempOrig = null;
    let tempOffset = null;

    function flushRegion() {
        if (!currentRegion) return;

        // 如果是 3.8 格式，将 xy + size 合成为 bounds
        if (tempXY && tempSize && !currentRegion.bounds) {
            currentRegion.bounds = {
                x: tempXY.x,
                y: tempXY.y,
                width: tempSize.width,
                height: tempSize.height
            };
        }

        // 如果是 3.8 格式，将 orig + offset 合成为 offsets
        if (tempOrig && tempOffset && !currentRegion.offsets) {
            currentRegion.offsets = {
                x: tempOffset.x,
                y: tempOffset.y,
                originalWidth: tempOrig.width,
                originalHeight: tempOrig.height
            };
        }

        if (currentPage) {
            currentPage.regions.push(currentRegion);
        }
        regions.push(currentRegion);

        // 清理临时缓存
        tempXY = null;
        tempSize = null;
        tempOrig = null;
        tempOffset = null;
        currentRegion = null;
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // 空行：分隔不同的块
        if (line === '') {
            if (state === STATE.REGION_ATTRS) {
                flushRegion();
                state = currentPage ? STATE.SCANNING : STATE.PAGE_ATTRS;
            } else if (state === STATE.PAGE_ATTRS) {
                state = STATE.SCANNING;
            }
            continue;
        }

        // 注释行跳过
        if (line.startsWith('#')) {
            continue;
        }

        // 检查是否是键值对（key: value 格式）
        const kvMatch = line.match(/^([a-zA-Z_]+):\s*(.*)/);

        if (kvMatch) {
            const key = kvMatch[1].toLowerCase();
            const value = kvMatch[2].trim();

            if (state === STATE.REGION_ATTRS && currentRegion) {
                // region 属性
                switch (key) {
                    case 'bounds':
                        // Spine 4.x: "372,100,26,108"
                        const b = value.split(',').map(s => parseInt(s.trim()));
                        if (b.length >= 4) {
                            currentRegion.bounds = { x: b[0], y: b[1], width: b[2], height: b[3] };
                        }
                        break;
                    case 'xy':
                        // Spine 3.8: "244, 2"
                        const xy = value.split(',').map(s => parseFloat(s.trim()));
                        if (xy.length >= 2) {
                            tempXY = { x: xy[0], y: xy[1] };
                        }
                        break;
                    case 'size':
                        // Spine 3.8 region size: "10, 32"
                        // 注意：page 的 size 也用这个 key，需要通过 state 区分
                        const sz = value.split(',').map(s => parseInt(s.trim()));
                        if (sz.length >= 2) {
                            tempSize = { width: sz[0], height: sz[1] };
                        }
                        break;
                    case 'orig':
                        // Spine 3.8: "12, 32"
                        const o = value.split(',').map(s => parseInt(s.trim()));
                        if (o.length >= 2) {
                            tempOrig = { width: o[0], height: o[1] };
                        }
                        break;
                    case 'offset':
                        // Spine 3.8: "1, 0"
                        const ofs = value.split(',').map(s => parseInt(s.trim()));
                        if (ofs.length >= 2) {
                            tempOffset = { x: ofs[0], y: ofs[1] };
                        }
                        break;
                    case 'offsets':
                        // Spine 4.x: "2,2,21,42"
                        const off = value.split(',').map(s => parseInt(s.trim()));
                        if (off.length >= 4) {
                            currentRegion.offsets = {
                                x: off[0], y: off[1],
                                originalWidth: off[2], originalHeight: off[3]
                            };
                        }
                        break;
                    case 'rotate':
                        currentRegion.rotate = value === 'true' || value === '90';
                        break;
                    case 'index':
                        currentRegion.index = parseInt(value);
                        break;
                    case 'origin':
                        // Spine 4.x
                        const orig = value.split(',').map(s => parseInt(s.trim()));
                        if (orig.length >= 2) {
                            currentRegion.origin = { x: orig[0], y: orig[1] };
                        }
                        break;
                    case 'split':
                        const sp = value.split(',').map(s => parseInt(s.trim()));
                        if (sp.length >= 4) {
                            currentRegion.split = { left: sp[0], right: sp[1], top: sp[2], bottom: sp[3] };
                        }
                        break;
                    case 'pad':
                        const pd = value.split(',').map(s => parseInt(s.trim()));
                        if (pd.length >= 4) {
                            currentRegion.pad = { left: pd[0], right: pd[1], top: pd[2], bottom: pd[3] };
                        }
                        break;
                }
            } else if (state === STATE.PAGE_ATTRS && currentPage) {
                // page 属性
                switch (key) {
                    case 'size':
                        // 格式: "640,480" 或 "640, 480"
                        const ps = value.split(',').map(s => parseInt(s.trim()));
                        if (ps.length >= 2) {
                            currentPage.size = { width: ps[0], height: ps[1] };
                        }
                        break;
                    case 'format':
                        currentPage.format = value;
                        break;
                    case 'filter':
                        currentPage.filter = value;
                        break;
                    case 'repeat':
                        currentPage.repeat = value;
                        break;
                    case 'pma':
                        currentPage.pma = value === 'true' || value === '1';
                        break;
                }
            }
            // 如果在 SCANNING 状态遇到 key:value，忽略（可能是意外格式）
            continue;
        }

        // 不是键值对 → 可能是 page 名或 region 名
        if (/\.(png|jpg|jpeg)$/i.test(line)) {
            // 新 page 开始
            if (state === STATE.REGION_ATTRS) {
                flushRegion();
            }

            currentPage = {
                name: line,
                size: null,
                regions: []
            };
            pages.push(currentPage);
            state = STATE.PAGE_ATTRS;
            continue;
        }

        // 非键值对、非图片文件 → 是 region 名
        if (state === STATE.SCANNING && currentPage) {
            // 保存上一个 region（如果有）
            if (state === STATE.REGION_ATTRS) {
                flushRegion();
            }

            // 初始化新 region
            currentRegion = {
                name: line,
                bounds: null,
                rotate: false,
                index: -1,
                offsets: null,
                origin: null,
                split: null,
                pad: null,
                pageName: currentPage.name
            };
            tempXY = null;
            tempSize = null;
            tempOrig = null;
            tempOffset = null;
            state = STATE.REGION_ATTRS;
            continue;
        }

        // 在 PAGE_ATTRS 状态遇到非键值对 → 可能是 region 名（某些 atlas 格式中 page 属性后跟空行再跟 region）
        if (state === STATE.PAGE_ATTRS && currentPage) {
            // 先将此行作为 region 名处理
            currentRegion = {
                name: line,
                bounds: null,
                rotate: false,
                index: -1,
                offsets: null,
                origin: null,
                split: null,
                pad: null,
                pageName: currentPage.name
            };
            tempXY = null;
            tempSize = null;
            tempOrig = null;
            tempOffset = null;
            state = STATE.REGION_ATTRS;
            continue;
        }

        // 兜底：跳过
    }

    // 保存最后一个 region
    if (state === STATE.REGION_ATTRS) {
        flushRegion();
    }

    return { pages, regions };
}

// ============================================================
// 获取 PNG 实际尺寸
// ============================================================

function getPngDimensions(filePath) {
    try {
        const buffer = fs.readFileSync(filePath);

        // PNG 文件头检查
        if (buffer.length < 24 ||
            buffer[0] !== 0x89 || buffer[1] !== 0x50 ||
            buffer[2] !== 0x4E || buffer[3] !== 0x47) {
            return null;
        }

        // IHDR chunk 在偏移 16，包含宽高（大端序）
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);

        return { width, height };
    } catch {
        return null;
    }
}

// ============================================================
// 校验单个 atlas 文件
// ============================================================

function verifyAtlas(atlasPath) {
    const assetDir = path.dirname(atlasPath);
    const fileName = path.basename(atlasPath);
    const results = [];
    let hasError = false;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`校验: ${fileName}`);
    console.log(`路径: ${atlasPath}`);
    console.log('='.repeat(60));

    let parsed;
    try {
        parsed = parseAtlas(atlasPath);
    } catch (e) {
        console.error(`❌ 解析 atlas 失败: ${e.message}`);
        return { errors: [e.message], warnings: [] };
    }

    if (parsed.pages.length === 0) {
        console.error('❌ atlas 中没有找到 page 定义');
        return { errors: ['no pages'], warnings: [] };
    }

    console.log(`\n📄 发现 ${parsed.pages.length} 个 page，${parsed.regions.length} 个 region\n`);

    // 统计 bounds 来源，判断 atlas 格式
    let boundsFrom38 = 0;
    let boundsFrom4x = 0;
    for (const r of parsed.regions) {
        if (r._boundsFrom38) boundsFrom38++;
        else boundsFrom4x++;
    }
    // (简化版：无法直接统计，但通过 region 属性可以推断)

    // 校验每个 page
    for (const page of parsed.pages) {
        const pngPath = path.join(assetDir, page.name);

        // 检查 PNG 是否存在
        if (!fs.existsSync(pngPath)) {
            const msg = `Page "${page.name}" 对应的 PNG 文件不存在: ${pngPath}`;
            console.error(`  ❌ ${msg}`);
            results.push({ type: 'error', msg });
            hasError = true;
            continue;
        }

        // 获取 PNG 实际尺寸
        const actualSize = getPngDimensions(pngPath);
        if (!actualSize) {
            const msg = `Page "${page.name}" 无法读取尺寸（文件损坏或格式不支持）`;
            console.error(`  ❌ ${msg}`);
            results.push({ type: 'error', msg });
            hasError = true;
            continue;
        }

        // 比较 atlas 声明的 size 与实际尺寸
        if (page.size) {
            const declaredSize = page.size;
            if (declaredSize.width !== actualSize.width ||
                declaredSize.height !== actualSize.height) {
                const msg = `Page "${page.name}" 尺寸不匹配: atlas 声明 ${declaredSize.width}x${declaredSize.height}, 实际 ${actualSize.width}x${actualSize.height}`;
                console.error(`  ❌ ${msg}`);
                console.error(`     → 这将导致贴图错位！请在 Spine Editor 中重新 Pack（Images → Pack）。`);
                results.push({ type: 'error', msg });
                hasError = true;
            } else {
                console.log(`  ✅ Page "${page.name}": ${actualSize.width}x${actualSize.height} ✓ (regions: ${page.regions.length})`);
            }
        } else {
            console.log(`  ⚠️  Page "${page.name}" 在 atlas 中未声明 size（实际: ${actualSize.width}x${actualSize.height}）`);
            results.push({ type: 'warning', msg: `no size declaration for ${page.name}` });
        }

        // 校验 region 是否超出 page 边界
        if (page.size) {
            for (const region of page.regions) {
                if (!region.bounds) continue;

                const effectiveWidth = region.rotate ? region.bounds.height : region.bounds.width;
                const effectiveHeight = region.rotate ? region.bounds.width : region.bounds.height;
                const maxX = region.bounds.x + effectiveWidth;
                const maxY = region.bounds.y + effectiveHeight;

                if (maxX > page.size.width || maxY > page.size.height) {
                    const msg = `Region "${region.name}" bounds (${region.bounds.x},${region.bounds.y} ${region.bounds.width}x${region.bounds.height}) 超出 page "${page.name}" 边界 (${page.size.width}x${page.size.height})`;
                    console.error(`  ❌ ${msg}`);
                    results.push({ type: 'error', msg });
                    hasError = true;
                }
            }
        }

        // 校验 region 是否有 bounds
        const missingBounds = page.regions.filter(r => !r.bounds);
        if (missingBounds.length > 0) {
            console.log(`  ⚠️  ${missingBounds.length} 个 region 缺少 bounds 定义`);
            for (const r of missingBounds) {
                console.log(`     - "${r.name}"`);
            }
            results.push({ type: 'warning', msg: `${missingBounds.length} regions missing bounds` });
        }
    }

    // 统计结果
    const errors = results.filter(r => r.type === 'error');
    const warnings = results.filter(r => r.type === 'warning');

    console.log(`\n${'-'.repeat(60)}`);
    if (hasError) {
        console.log(`❌ 检查完成: ${errors.length} 个错误, ${warnings.length} 个警告`);
        console.log('   请在 Spine Editor 中重新 Pack（Images → Pack）并重新导出。');
    } else if (warnings.length > 0) {
        console.log(`⚠️  检查完成: ${errors.length} 个错误, ${warnings.length} 个警告`);
    } else {
        console.log(`✅ 检查通过: 所有 ${parsed.pages.length} 个 page 都正常！`);
    }

    return { errors, warnings, pages: parsed.pages.length, regions: parsed.regions.length };
}

// ============================================================
// 主入口
// ============================================================

function findAtlasFiles(dir) {
    const atlases = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            atlases.push(...findAtlasFiles(fullPath));
        } else if (entry.name.endsWith('.atlas')) {
            atlases.push(fullPath);
        }
    }

    return atlases;
}

function main() {
    const targetPath = process.argv[2] || './assets/spine';
    const resolvedPath = path.resolve(targetPath);

    if (!fs.existsSync(resolvedPath)) {
        console.error(`路径不存在: ${resolvedPath}`);
        console.error('用法: node scripts/verify_atlas.js [assetDirectory]');
        console.error('示例: node scripts/verify_atlas.js ./assets/spine');
        process.exit(1);
    }

    const stat = fs.statSync(resolvedPath);
    const atlases = stat.isDirectory()
        ? findAtlasFiles(resolvedPath)
        : [resolvedPath];

    if (atlases.length === 0) {
        console.log(`在 ${resolvedPath} 中未找到 .atlas 文件`);
        process.exit(0);
    }

    console.log(`找到 ${atlases.length} 个 .atlas 文件，开始校验...`);

    let totalErrors = 0;
    let totalWarnings = 0;
    let totalAtlases = 0;

    for (const atlasPath of atlases) {
        const result = verifyAtlas(atlasPath);
        totalErrors += result.errors.length;
        totalWarnings += result.warnings.length;
        totalAtlases++;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 汇总: 检查了 ${totalAtlases} 个 atlas 文件`);
    if (totalErrors > 0) {
        console.log(`❌ ${totalErrors} 个错误`);
    }
    if (totalWarnings > 0) {
        console.log(`⚠️  ${totalWarnings} 个警告`);
    }
    if (totalErrors === 0 && totalWarnings === 0) {
        console.log(`✅ 全部通过！`);
    }
    console.log(`${'='.repeat(60)}`);

    if (totalErrors > 0) {
        process.exit(1);
    }
}

main();
