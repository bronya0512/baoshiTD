#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rescale_spine_atlas.py
======================

当 Spine 的 .atlas 文本声明尺寸（size: W,H）与手头实际 PNG 尺寸不一致，
且**两者是同一套打包布局，只是被整体等比缩放了**时（例如 RTS 把 688×688
的整页 atlas 作为图片再缩到 512×512 省流量），用本脚本重写 .atlas：

    1. 把 page 的 `size: W,H` 改为实际 PNG 尺寸 (targetW,targetH)
    2. 把每个 region 的 `xy: x, y` × scale
    3. 把每个 region 的 `size: w, h` × scale
    4. 把每个 region 的 `orig: w, h` × scale
    5. 把每个 region 的 `offset: x, y` × scale
       （offset 是 orig - size 的剩余像素，也应该随整体缩放缩放）

这样 Spine Runtime 在按新 atlas 的 xy/size 归一化 UV 时，会正确命中
小尺寸 PNG 上对应的像素。

用法
----
    # 把 688-atlas 缩放到 512×512（实际 PNG 尺寸），输出覆盖
    py scripts/rescale_spine_atlas.py --atlas assets/spine/xia_guang/build_char_423_blemsh.atlas ^
        --target-size 512,512 --out assets/spine/xia_guang/build_char_423_blemsh.atlas --force

    # 从实际 PNG 文件自动读 target-size
    py scripts/rescale_spine_atlas.py --atlas a.atlas --png png.png --out a.atlas --force

    # dry-run 仅打印会缩放多少，不写文件
    py scripts/rescale_spine_atlas.py --atlas a.atlas --target-size 512,512 --dry-run
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from typing import List, Optional, Tuple

try:
    from PIL import Image  # type: ignore
except ImportError:
    sys.stderr.write("错误: 需要 Pillow。请先运行: py -m pip install Pillow\n")
    raise SystemExit(2)


# ---------------------------------------------------------------------------
# Atlas 行级解析 + 重写（我们不做结构转换，只对行做正则缩放，更稳，保留原格式/缩进/注释）
# ---------------------------------------------------------------------------

INT_RE = re.compile(r"^-?\d+$")
PAIR_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$")


def _scale_pair(pair_str: str, sx: float, sy: float, use_float: bool = False) -> str:
    """把 'a, b' 这种字符串按 (sx, sy) 缩放。

    use_float=False（默认，为了兼容老版本）：若原是整数对，输出 round 到整数。
    use_float=True：永远输出浮点数，保留 6 位小数，避免 Spine Packed atlas 中
    rotate=true 的 region 因每个边界整数四舍五入产生 ~1px 累积误差造成 UV
    采到相邻 region 的像素（马赛克碎片）。
    """
    m = PAIR_RE.match(pair_str)
    if not m:
        return pair_str
    a = float(m.group(1)) * sx
    b = float(m.group(2)) * sy
    if (
        not use_float
        and INT_RE.match(m.group(1).lstrip('-'))
        and INT_RE.match(m.group(2).lstrip('-'))
    ):
        return f"{int(round(a))}, {int(round(b))}"
    # 浮点精确，保留 6 位小数足够（512/688 ≈ 0.744186，2 位就够了，保险起见留 6）
    fmt = lambda v: f"{v:.6f}".rstrip("0").rstrip(".")
    return f"{fmt(a)}, {fmt(b)}"


def rescale_atlas_text(
    text: str,
    target_w: int,
    target_h: int,
    use_float: bool = True,
) -> Tuple[str, List[Tuple[int, int, int, int]]]:
    """重写 atlas 文本，返回 (new_text, pages_info)。
    pages_info 每项：(origW, origH, newW, newH)
    use_float=True: xy/size/orig/offset 保留小数避免 1px 累积误差；
                    False: 整数四舍五入。
    """
    lines = text.splitlines()
    out: List[str] = []
    pages_info: List[Tuple[int, int, int, int]] = []

    # 状态机：Spine 3.8 atlas 每一页的段落结构是：
    #
    #   <page name (PNG 文件名，无缩进，无冒号，非空)>
    #     size: W,H                     ← page 属性（紧跟 page 名，第一个 region 名之前）
    #     format: RGBA8888              ← page 属性
    #     filter: Linear,Linear         ← page 属性
    #     repeat: none                  ← page 属性
    #   <region name (无缩进，无冒号，非空)>
    #     rotate: true                  ← region 属性
    #     xy: x, y                      ← region 属性
    #     size: w, h                    ← region 属性 (！！！和 page 属性同名)
    #     orig: w, h                    ← region 属性
    #     offset: x, y                  ← region 属性
    #     index: -1                     ← region 属性
    #   <region name 2 ...>
    #     ...
    #   <空行>                           ← 分隔，可选
    #   <下一页 page name ...>
    #
    # 关键点：page size / region size 键名完全相同，page/region 属性行都是 2 空格缩进
    # 所以必须用状态机，而不能靠缩进或键名区分。

    cur_page_orig_w = cur_page_orig_h = 0
    cur_page_sx = cur_page_sy = 1.0
    in_page_attrs = False  # True = 正在处理某页的 4 个 page 属性（size/format/filter/repeat）
    in_region_attrs = False  # True = 正在处理某个 region 的属性（rotate/xy/size/orig/offset/index）

    PAGE_ATTR_KEYS = {"size", "format", "filter", "repeat"}
    REGION_ATTR_KEYS = {
        "rotate", "xy", "size", "orig", "offset", "index",
        # 兼容罕见字段：edge/shape/pads/winding/split/degree 等（原样保留）
    }

    for raw in lines:
        line = raw.rstrip("\n")
        stripped = line.strip()

        # ---- (1) 空行：原样，重置状态 ----
        if not stripped:
            in_page_attrs = False
            in_region_attrs = False
            out.append(line)
            continue

        # ---- (2) 非缩进行 + 非 key:val → 一定是 header 行（page 名 或 region 名） ----
        header_like = (
            not line.startswith((" ", "\t"))
            and ":" not in stripped
        )
        if header_like:
            # 判断是「新 page 头」还是「region 头」：
            # Spine 3.8 的 page 名永远是 atlas 第一个 header，并且紧随其后的 4 条缩进行
            # 是 page 属性（size / format / filter / repeat）。
            # 简便可靠的判定：如果上一段是 page 属性区 or 当前还没进入 region 区，
            # 并且该 header 后紧跟着的缩进行是 PAGE_ATTR_KEYS 的 size/format——那就是新 page。
            # 这里用启发式：凡 header 含 ".png" / ".jpg" / ".webp" / ".pvr" 后缀 → page。
            lower = stripped.lower()
            is_page = any(lower.endswith(ext) for ext in (".png", ".jpg", ".jpeg", ".webp", ".pvr", ".pvr.ccz", ".atlas", ".ktx", ".astc"))
            if is_page:
                in_page_attrs = True
                in_region_attrs = False
                cur_page_orig_w = cur_page_orig_h = 0
                cur_page_sx = cur_page_sy = 1.0
            else:
                in_page_attrs = False
                in_region_attrs = True
            out.append(line)
            continue

        # ---- (3) key: val 行（必然带缩进，是 page 属性或 region 属性） ----
        if ":" in stripped:
            key, _, val = stripped.partition(":")
            key = key.strip()
            val = val.strip()
            indent = line[: len(line) - len(line.lstrip())]

            # (3a) 属于 page 属性区：size/format/filter/repeat
            if in_page_attrs and key in PAGE_ATTR_KEYS:
                if key == "size" and "," in val:
                    m = PAIR_RE.match(val)
                    if not m:
                        out.append(line)
                        continue
                    cur_page_orig_w = int(round(float(m.group(1))))
                    cur_page_orig_h = int(round(float(m.group(2))))
                    cur_page_sx = target_w / cur_page_orig_w if cur_page_orig_w else 1.0
                    cur_page_sy = target_h / cur_page_orig_h if cur_page_orig_h else 1.0
                    pages_info.append((cur_page_orig_w, cur_page_orig_h, target_w, target_h))
                    # page 的 size 只改声明尺寸（整数对）
                    out.append(f"{indent}size: {target_w}, {target_h}")
                else:
                    # format / filter / repeat 原样
                    out.append(line)
                continue

            # (3b) 属于 region 属性区：缩放 xy/size/orig/offset（浮点）
            if in_region_attrs:
                if key in ("xy", "size", "orig", "offset") and "," in val:
                    out.append(f"{indent}{key}: {_scale_pair(val, cur_page_sx, cur_page_sy, use_float)}")
                    continue
                # rotate / index / 其他 region 字段原样
                out.append(line)
                continue

            # (3c) 其他未分类的 key:val（例如在第一个 header 前出现在文件头的备注等）原样
            out.append(line)
            continue

        # ---- (4) 其他行（不应该出现）原样 ----
        out.append(line)

    return "\n".join(out) + ("\n" if text.endswith("\n") else ""), pages_info


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(
        description="把 Spine .atlas 整体缩放到指定目标尺寸（对应 PNG 被整体缩放的场景）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--atlas", required=True)
    p.add_argument("--target-size", help="目标 W,H 例：512,512。与 --png 二选一，同时指定时以该参数为准")
    p.add_argument("--png", help="按该 PNG 的实际尺寸作为目标尺寸")
    p.add_argument("--out", required=False, help="输出 atlas 路径，默认 --atlas")
    p.add_argument("--force", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)

    if not os.path.isfile(args.atlas):
        print(f"错误: 找不到 atlas '{args.atlas}'", file=sys.stderr)
        return 2

    tw = th = None
    if args.target_size:
        m = PAIR_RE.match(args.target_size)
        if not m:
            print(f"错误: --target-size 格式应为 'W,H'（例 512,512），收到 '{args.target_size}'", file=sys.stderr)
            return 2
        tw, th = int(m.group(1)), int(m.group(2))
    elif args.png:
        if not os.path.isfile(args.png):
            print(f"错误: 找不到 --png '{args.png}'", file=sys.stderr)
            return 2
        with Image.open(args.png) as im:
            tw, th = im.size
    else:
        print("错误: 需要 --target-size W,H 或 --png <实际 PNG 路径> 两者之一", file=sys.stderr)
        return 2

    with open(args.atlas, "r", encoding="utf-8") as f:
        orig_text = f.read()

    new_text, info = rescale_atlas_text(orig_text, tw, th)
    print(f"✓ 解析 atlas: '{args.atlas}'，共 {len(info)} 个 page")
    for i, (ow, oh, nw, nh) in enumerate(info):
        sx = nw / ow if ow else 1
        sy = nh / oh if oh else 1
        print(f"  Page {i}: {ow}×{oh}  →  {nw}×{nh}   (scale sx={sx:.5f}, sy={sy:.5f})")

    if args.dry_run:
        return 0

    out_path = args.out or args.atlas
    if os.path.abspath(out_path) == os.path.abspath(args.atlas) and not args.force:
        print("错误: --out 与 --atlas 为同一文件，需加 --force 覆盖", file=sys.stderr)
        return 1
    if os.path.exists(out_path) and os.path.abspath(out_path) != os.path.abspath(args.atlas) and not args.force:
        print(f"错误: 输出已存在 '{out_path}'，加 --force 覆盖", file=sys.stderr)
        return 1

    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(new_text)
    print(f"✓ 已写入: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
