# Spine 资产目录

将 Spine Editor 3.8 导出的资产放在此目录下。

## 目录结构

```
assets/spine/
├── ke_qing/              # 刻晴（示例资产，需重新导出）
├── xia_guang/            # 夏光（示例资产，3.8 格式 ✅）
├── enemies/              # 敌人动画
│   ├── grunt/            # 普通小兵
│   ├── flyer/            # 飞行单位
│   ├── heavy_guard/      # 重甲守卫
│   ├── swift_scout/      # 快速侦察兵
│   ├── elite_captain/    # 精英队长
│   └── boss_dragon/      # Boss-龙
├── towers/               # 塔动画
│   ├── fire_tower/       # 火塔
│   ├── ice_tower/        # 冰塔
│   ├── thunder_tower/   # 雷塔
│   ├── poison_tower/     # 毒塔
│   ├── light_tower/      # 光塔
│   └── dark_tower/       # 暗塔
└── effects/              # 特效动画
    ├── gem_sparkle/      # 宝石闪光
    ├── explosion/        # 爆炸
    ├── laser/            # 激光
    ├── freeze/           # 冰冻
    └── lightning/        # 雷击
```

## 每个资产文件夹内包含（Spine 3.8）

```
grunt/
├── grunt.skel          # Skeleton 数据（二进制格式，推荐，体积小）
├── grunt.json          # Skeleton 数据（JSON 格式，备选）
├── grunt.atlas         # Atlas 描述文件
├── grunt.png           # 打包后的贴图
└── grunt_1.png         # 多页时的第 2 页（如有）
```

💡 **Spine 3.8 同时支持 `.skel` 和 `.json`** 两种骨架格式。推荐使用 `.skel`（二进制），体积更小、加载更快。前端需要用对应的解析器（`SkeletonBinary` vs `SkeletonJson`）。

## 导出规范

详细导出参数设置请参考：[`docs/spine-guide.md`](../../docs/spine-guide.md)

## 校验

导出后运行校验脚本检查 atlas 与 PNG 尺寸是否匹配：

```bash
node scripts/verify_atlas.js ./assets/spine
```

## 现有资产状态

| 资产 | 格式 | 状态 | 备注 |
|------|------|------|------|
| ke_qing | Spine 3.8 | ⚠️ 不完整 | 缺少 .atlas、无动画、扁平单骨骼结构、中文文件名 |
| xia_guang | Spine 3.8 | ❌ PNG 不匹配 | atlas 声明 688×688，实际 PNG 为 512×512，需重新导出 |
