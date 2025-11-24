# 大师拷贝 - 照片/视频 NAS 上传工具（Tauri 版）

一个现代化的照片与视频管理工具，基于 Tauri + Vue 构建，专注 NAS 备份与整理。

## 功能特性

- 智能媒体扫描（照片/视频）
- 元数据提取（EXIF/视频信息，支持快速扫描）
- 重复文件检测与覆盖策略
- 批量上传，暂停/继续/取消控制
- 实时进度与日志显示
- 路径收藏夹（来源 SD / DJI 与目标路径），一键切换
- 自动记住上次选择的路径

## 安装与运行

- 环境要求：`Node.js 18+`、`Rust`、`Tauri CLI`
- 安装依赖：
  ```bash
  npm install
  ```
- 开发模式：
  ```bash
  npm run tauri dev
  ```
- 构建前端静态资源：
  ```bash
  npm run build
  ```

## 扫描与上传

- 选择源目录（SD 或 DJI）与目标目录（NAS）
- 选项：覆盖重复文件、快速扫描
- 预扫描后查看将上传/覆盖/跳过的文件列表
- 开始上传并跟踪总体与当前文件进度

## 配置文件

- 配置保存于系统配置目录（自动迁移兼容旧版 `~/.mascopy-config.json`）
- 包含每种模式（`sd`、`dji`）的源/目标路径与覆盖选项，以及收藏夹数据

## 打包与发布 DMG

- 构建 DMG：
  ```bash
  npm run tauri build -- --bundles dmg
  ```
- 打包产物位于：`src-tauri/target/release/bundle/dmg/*.dmg`
- 自动发布脚本：
  ```bash
  bash scripts/release_dmg.sh vX.Y.Z
  # 或不传版本，脚本将从 tauri.conf.json 读取版本并使用 v<version>
  ```
  - 需要先配置 GitHub 远程 `origin`
  - 若安装了 `gh`（GitHub CLI）将自动创建 release 并上传 DMG
  - 否则需设置 `GITHUB_TOKEN` 环境变量，脚本会使用 GitHub API 创建/上传

## 目录结构

```
mascopy/
├── src/                  # Vue 前端
│   ├── components/       # 组件（文件选择器、表格、进度等）
│   └── views/            # 主页等视图
├── src-tauri/            # Tauri 后端（Rust）
│   ├── src/              # 扫描/分析/上传/配置管理
│   └── tauri.conf.json   # 打包配置
└── scripts/              # 发布脚本
```

## 常见问题

- 扫描速度慢：开启快速扫描或耐心等待大量文件遍历
- 上传失败：检查目标目录写权限与网络；查看日志详情
- DMG 构建失败：确保安装了 `Xcode Command Line Tools` 与 `Tauri CLI`

## 许可证

- 本项目采用 CC BY-NC-SA 4.0（仅供非商业使用，署名、相同方式共享）
