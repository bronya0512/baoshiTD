#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
restore_trimmed_atlas_png.py
============================
把 Spine Texture Packer 导出后又被外部工具（如 RTS/Asekai 网页预览器）
自动 **Trim（裁掉四周全透明的像素行列）** 的 PNG 复原回来，
保证其像素坐标与 .atlas 文本里的 `xy / size / orig / offset` 描述
（基于 **未裁剪** 的打包尺寸）一一对应，从而 Spine Runtime 采样 region 时
不再取到错位像素。

原理
----
.atlas 文本在每个 page 头部写的 `size: W,H` 是 Texture Packer 输出时
"画布"的原始尺寸。但 RTS 之类工具会把 page PNG 四周完全透明的行列裁掉，
导致实际 PNG 尺寸变成 (W−L−R, H−T−B)，而 region 仍然写原始坐标。

本脚本：
    1. 解析 .atlas，对每个 page：
       - 读出声明尺寸 `size: declW, declH` 以及该页引用的 PNG 名
       - 枚举该页所有 region，结合 `rotate`（真则 width↔height 交换）
         计算出所有 region 在 page 画布上的覆盖矩形
       - 得到所有矩形的 minX / minY / maxX / maxY
       - trimLeft   = minX
         trimTop    = minY
         trimRight  = declW − maxX
         trimBottom = declH − maxY
    2. 读取对应的「被 Trim 过的 PNG」：
       - 若尺寸恰好等于 (declW−trimL−trimR, declH−trimT−trimB)：
         说明 **只有 Trim**，没有缩放，直接 pad 透明边即可。
       - 否则，**先以高质量 Lanczos 等比缩放**到该「Trim 版原始尺寸」，
         再 pad 透明边。（RTS 除了 Trim 还会额外压缩缩放的情况会走这里。）
    3. pad 回 (declW × declH)，保存为复原 PNG。

对多 Page atlas（一个 .atlas 引用多张 PNG），每个 page 单独计算 trim 参数。

用法
----
    # 最常见：单 page atlas，PNG 就在 atlas 同目录
    py scripts/restore_trimmed_atlas_png.py ^
        --atlas assets/spine/xia_guang/build_char_423_blemsh.atlas ^
        --trim-png "C:/path/to/trimmed_522x522.png"

    # 指定输出路径（不指定就默认 <original_png_stem>_restored.png，保存在 --trim-png 同目录）
    py scripts/restore_trimmed_atlas_png.py --atlas x.atlas --trim-png t.png --out restored.png

    # 多 page atlas 下，为第 2 个 page 指定不同的 Trim 版 PNG
    #   --page-index 0 对应 atlas 中出现的第一个 PNG（默认值）
    py scripts/restore_trimmed_atlas_png.py --atlas multi.atlas --trim-png page2_trim.png --page-index 1

    # 仅查看 atlas 参数（不做写操作），用于核对 trim 是否计算正确
    py scripts/restore_trimmed_atlas_png.py --atlas x.atlas --dry-run

仅当输出文件尚不存在或加 --force 时才会覆盖写入，避免误操作。
"""
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

try:
    from PIL import Image  # type: ignore
except ImportError:  # pragma: no cover - 仅在未安装时触发
    sys.stderr.write(
        "错误: 需要 Pillow (PIL)。请先运行:\n"
        "    py -m pip install Pillow\n"
    )
    raise SystemExit(2)


# ---------------------------------------------------------------------------
# Atlas 解析
# ---------------------------------------------------------------------------

@dataclass
class Region:
    name: str
    rotate: bool = False
    x: int = 0
    y: int = 0
    w: int = 0          # atlas 里写的 size 宽（在 non-rotate 情况下是矩形实际宽）
    h: int = 0          # atlas 里写的 size 高


@dataclass
class AtlasPage:
    png_name: str = ""
    decl_w: int = 0     # atlas 声明的画布宽
    decl_h: int = 0     # atlas 声明的画布高
    regions: List[Region] = field(default_factory=list)
    trim_left: int = 0
    trim_top: int = 0
    trim_right: int = 0
    trim_bottom: int = 0

    @property
    def trimmed_w(self) -> int:
        return self.decl_w - self.trim_left - self.trim_right

    @property
    def trimmed_h(self) -> int:
        return self.decl_h - self.trim_top - self.trim_bottom

    def compute_trim(self) -> None:
        """根据 regions 实际覆盖范围，计算四周被 Trim 掉的透明边。"""
        if not self.regions:
            raise ValueError(f"page '{self.png_name}' 没有任何 region，无法计算 trim")
        min_x = min((r.x for r in self.regions), default=self.decl_w)
        min_y = min((r.y for r in self.regions), default=self.decl_h)

        def bbox_right(r: Region) -> int:
            return r.x + (r.h if r.rotate else r.w)

        def bbox_bottom(r: Region) -> int:
            return r.y + (r.w if r.rotate else r.h)

        max_x2 = max(bbox_right(r) for r in self.regions)
        max_y2 = max(bbox_bottom(r) for r in self.regions)

        if max_x2 > self.decl_w or max_y2 > self.decl_h:
            raise ValueError(
                f"page '{self.png_name}' 中 region 超出声明画布 "
                f"({self.decl_w}x{self.decl_h})，右下边界={max_x2},{max_y2}，"
                f"atlas 可能损坏或 rotate 解析错误。"
            )

        self.trim_left = min_x
        self.trim_top = min_y
        self.trim_right = self.decl_w - max_x2
        self.trim_bottom = self.decl_h - max_y2


def parse_atlas(text: str) -> List[AtlasPage]:
    """解析 Spine 3.8 atlas 文本，返回按出现顺序的 pages。"""
    pages: List[AtlasPage] = []
    current_page: Optional[AtlasPage] = None
    current_region: Optional[Region] = None

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            # 空行结束当前 region 的字段
            current_region = None
            continue
        if not current_page:
            # page 头部第一行就是 PNG 名
            current_page = AtlasPage(png_name=line.strip())
            pages.append(current_page)
            continue
        # 缩进 → region 属性或 page 属性
        if line.startswith((' ', '\t')):
            stripped = line.strip()
            if ':' not in stripped:
                continue
            key, _, val = stripped.partition(':')
            key = key.strip()
            val = val.strip()
            if key == 'size' and current_region is None and current_page is not None:
                try:
                    w_str, h_str = val.split(',', 1)
                    current_page.decl_w = int(w_str.strip())
                    current_page.decl_h = int(h_str.strip())
                except (ValueError, IndexError) as e:
                    raise ValueError(f"非法 size 行: '{stripped}'") from e
                continue

            if current_region is None:
                # 不认识的 page 属性，跳过（format / filter / repeat 等）
                continue

            if key == 'rotate':
                current_region.rotate = val.lower() in ('true', 'yes', '1')
            elif key == 'xy':
                try:
                    xs, ys = val.split(',', 1)
                    current_region.x = int(xs.strip())
                    current_region.y = int(ys.strip())
                except (ValueError, IndexError) as e:
                    raise ValueError(f"非法 xy 行: '{stripped}'") from e
            elif key == 'size':
                try:
                    ws, hs = val.split(',', 1)
                    current_region.w = int(ws.strip())
                    current_region.h = int(hs.strip())
                except (ValueError, IndexError) as e:
                    raise ValueError(f"非法 size 行: '{stripped}'") from e
            # 其他字段 (orig / offset / index) 对 trim 计算无用，忽略
        else:
            # 非空、非缩进 → 两种情况：
            #   A. 'key: value' (含冒号且冒号前后都非空) → 当前 page 的属性 (size/format/filter/repeat 等)
            #   B. '纯名称' (不含冒号 / 冒号后空 / 或整体作为命名无 key 语义) → 新 region 名
            stripped_line = line.strip()
            colon_idx = stripped_line.find(':')
            is_top_level_keyval = False
            if colon_idx > 0 and colon_idx + 1 < len(stripped_line):
                k = stripped_line[:colon_idx].strip()
                v = stripped_line[colon_idx + 1:].strip()
                if k and v and ' ' not in k and k.isidentifier():
                    is_top_level_keyval = True

            if is_top_level_keyval and current_page is not None:
                # page 级属性（无缩进）。目前只用到 size；其余忽略。
                if k == 'size':
                    try:
                        ws, hs = v.split(',', 1)
                        current_page.decl_w = int(ws.strip())
                        current_page.decl_h = int(hs.strip())
                    except (ValueError, IndexError) as e:
                        raise ValueError(f"非法 page size 行: '{line}'") from e
                continue

            # 否则视为新 region 名
            current_region = Region(name=stripped_line)
            if current_page is None:
                raise ValueError(f"atlas 解析错误: region '{line}' 出现在任何 page 之前")
            current_page.regions.append(current_region)

    for p in pages:
        p.compute_trim()
    return pages


# ---------------------------------------------------------------------------
# 复原逻辑
# ---------------------------------------------------------------------------

def restore_png(
    page: AtlasPage,
    trimmed_png_path: str,
    out_path: str,
    *,
    force: bool = False,
) -> Tuple[str, str]:
    """对单个 atlas page 执行复原。
    返回 (trimmed_png_真实尺寸描述, 输出文件路径)。
    """
    if not os.path.isfile(trimmed_png_path):
        raise FileNotFoundError(f"找不到 Trim 版 PNG: {trimmed_png_path}")

    with Image.open(trimmed_png_path) as im:
        src_w, src_h = im.size
        # 统一 RGBA，保证 pad 时能写入透明
        src = im.convert("RGBA")

    trim_w, trim_h = page.trimmed_w, page.trimmed_h

    if src_w == trim_w and src_h == trim_h:
        # 完美命中 Trim 尺寸 → 无需缩放，直接 pad
        scaled = src
        scaled_note = f"{src_w}×{src_h} (与 Trim 尺寸完全一致，跳过缩放)"
    else:
        ratio_src = src_w / src_h
        ratio_trim = trim_w / trim_h
        if abs(ratio_src - ratio_trim) > 1e-3:
            # 宽高比不同 → 可能用户塞错了 PNG 或该 PNG 本身不是整页 Trim（比如单独 region 截图）
            # 给出警告，但仍然按目标尺寸强制缩放（避免脚本中断）
            sys.stderr.write(
                f"⚠️ 警告: Trim 版 PNG ({src_w}×{src_h}) 的宽高比 {ratio_src:.3f} "
                f"与 atlas 期望的 Trim 版尺寸 {trim_w}×{trim_h} (ratio={ratio_trim:.3f}) "
                f"不匹配，仍会强制等比缩放到 {trim_w}×{trim_h}（可能失真）。\n"
            )
        scaled = src.resize((trim_w, trim_h), Image.LANCZOS)
        scaled_note = f"{src_w}×{src_h} → 缩放至 {trim_w}×{trim_h} (Lanczos)"

    # 四周 pad 透明 → decl_w × decl_h
    decl_w, decl_h = page.decl_w, page.decl_h
    restored = Image.new("RGBA", (decl_w, decl_h), (0, 0, 0, 0))
    restored.paste(scaled, (page.trim_left, page.trim_top))

    if os.path.exists(out_path) and not force:
        raise FileExistsError(
            f"输出文件已存在: {out_path}\n"
            "加 --force 以允许覆盖。"
        )

    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    restored.save(out_path, "PNG")
    return scaled_note, out_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _default_out_path(trim_png_path: str, page_index: int, total_pages: int) -> str:
    d, base = os.path.split(trim_png_path)
    stem, ext = os.path.splitext(base)
    suffix = f"_page{page_index}" if total_pages > 1 else ""
    return os.path.join(d, f"{stem}{suffix}_restored{ext or '.png'}")


def _print_page_info(page: AtlasPage, index: int) -> None:
    print(f"\n--- Page {index}: '{page.png_name}' ---")
    print(f"  atlas 声明画布 : {page.decl_w} × {page.decl_h}")
    print(f"  region 数量    : {len(page.regions)}")
    print(
        f"  计算 trim 边框 : L={page.trim_left}  T={page.trim_top}  "
        f"R={page.trim_right}  B={page.trim_bottom}"
    )
    print(
        f"  Trim 版预期尺寸: {page.trimmed_w} × {page.trimmed_h}"
        f"   (画布 {page.decl_w}×{page.decl_h} 扣除 LTRB 后的透明裁剪部分)"
    )


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="复原被 RTS/等工具 Trim 过的 Spine atlas PNG，"
                    "使其尺寸与 .atlas 文本中声明的 size 完全对齐。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--atlas", required=True,
        help="Spine .atlas 文件路径",
    )
    parser.add_argument(
        "--trim-png",
        help="被 Trim 过的 PNG 路径。多 page atlas 时请同时用 --page-index 指定第几个 page。",
    )
    parser.add_argument(
        "--page-index", type=int, default=0,
        help="--trim-png 对应 atlas 中的第几个 page（从 0 开始，默认 0）",
    )
    parser.add_argument(
        "--out",
        help="复原 PNG 输出路径。默认与 --trim-png 同目录，在原文件名后加 _restored.png。",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="若 --out 已存在，允许覆盖。",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="仅解析 atlas 并打印每页的 trim 参数与预期 Trim 版尺寸，不读写 PNG。",
    )
    args = parser.parse_args(argv)

    if not os.path.isfile(args.atlas):
        print(f"错误: 找不到 atlas 文件 '{args.atlas}'", file=sys.stderr)
        return 2

    with open(args.atlas, "r", encoding="utf-8") as f:
        text = f.read()

    pages = parse_atlas(text)
    if not pages:
        print("错误: atlas 里没有解析到任何 page", file=sys.stderr)
        return 2

    print(f"✓ 解析 atlas: '{args.atlas}'，共 {len(pages)} 个 page")
    for i, p in enumerate(pages):
        _print_page_info(p, i)

    if args.dry_run:
        return 0

    if not args.trim_png:
        print("错误: 未提供 --trim-png（或使用 --dry-run 仅查看参数）", file=sys.stderr)
        return 2

    if not 0 <= args.page_index < len(pages):
        print(
            f"错误: --page-index={args.page_index} 超出范围 [0, {len(pages)-1}]",
            file=sys.stderr,
        )
        return 2

    page = pages[args.page_index]
    out = args.out or _default_out_path(args.trim_png, args.page_index, len(pages))

    try:
        note, saved_path = restore_png(page, args.trim_png, out, force=args.force)
    except (FileExistsError, FileNotFoundError, ValueError) as e:
        print(f"错误: {e}", file=sys.stderr)
        return 1

    print(f"\n✓ 复原成功 (page {args.page_index} → '{page.png_name}')")
    print(f"  Trim 版 PNG 处理: {note}")
    print(f"  透明边补回      : L={page.trim_left} T={page.trim_top} "
          f"R={page.trim_right} B={page.trim_bottom}")
    print(f"  输出 (复原后)   : {saved_path} ({page.decl_w}×{page.decl_h})")
    print("\n下一步: 用复原后的 PNG 覆盖 atlas 同目录下对应的原始 png_name 文件，"
          "刷新 Spine 页面即可看到角色正确拼接。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
