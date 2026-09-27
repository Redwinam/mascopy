# 大师拷贝 4.0.1

基于 Tauri 2 + Vue 3 的 macOS 照片与视频整理工具，可将 SD / DJI 素材按日期备份到本地磁盘或已挂载的 NAS，也支持联机拍摄与 Eagle 导入。

官网与下载：<https://mascopy.if9.cool>（源码在 `website/`，见其中的 README）。

## 功能

- SD / DJI 媒体扫描、日期与元数据提取、快速扫描
- 按文件内容判重；同名不同内容自动重命名，支持显式覆盖
- 批量上传及暂停、继续、取消，显示进度与错误
- 来源、目标路径收藏与配置保存
- 文件夹监听、相机 FTP 接收和按日期归档
- Eagle 本地 API 导入与图片预览、裁剪

## 环境与开发

- macOS 与 Xcode Command Line Tools（`xcode-select --install`）
- Node.js `20.19+`（20.x）或 `22.12+`；建议使用受支持的 LTS 版本
- Rust `1.88+` 与 Cargo；根锁文件中的 `image 0.25.10` 要求 Rust 1.88
- Tauri CLI 已列入前端开发依赖，无需另装 `cargo-tauri`

在项目根目录执行：

```bash
npm --prefix src-ui ci --ignore-scripts
npm --prefix src-ui run tauri -- dev
```

也可以在 `src-ui` 内执行 `npm ci --ignore-scripts`、`npm run tauri -- dev`。Tauri 脚本会切换到工作区根目录，开发和构建 hook 都在 `src-ui` 运行。

单独调试前端可运行 `npm --prefix src-ui run dev`，但普通浏览器没有桌面 IPC、系统对话框与文件操作能力，完整功能需通过 Tauri 启动。

## 构建与验证

```bash
# 前端生产构建
npm --prefix src-ui run build

# 前端逻辑回归测试
npm --prefix src-ui test

# Rust 回归测试与静态检查
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings

# 发布逻辑的隔离回归测试：外部命令均为 stub，不联网、不发布
node --test scripts/release_dmg.test.mjs

# macOS 应用与 DMG；自动执行前端构建
npm --prefix src-ui run tauri -- build --bundles dmg -- --locked
```

Cargo 工作区只使用根目录 `Cargo.lock`；前端使用 `src-ui/package-lock.json`。修改版本时同步 `src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 和 `src-ui/package.json`，并更新锁文件。

依赖维护使用 `npm --prefix src-ui audit`。兼容范围修复可执行 `npm --prefix src-ui audit fix --ignore-scripts`，随后重跑前端构建和回归测试；不要用 `--force` 跳过大版本升级评估。

## 扫描与上传

1. 选择 SD / DJI 来源与目标目录；NAS 需先挂载为可写目录。
2. 按需设置覆盖和快速扫描，预扫描后检查上传、覆盖及跳过列表。
3. 开始上传并查看进度；错误详情会指出未完成的项目。

标准扫描会读取照片 EXIF；MP4 / MOV / M4V / 3GP / OSV / LRF 读取 `mvhd` v0 / v1 创建时间，其他视频或无有效时间字段时回退到文件修改时间。快速扫描仅使用文件修改时间。

同名、等长不等于同一文件；只有内容比较一致才跳过。复制过程中先写临时文件，成功后发布最终文件。扫描或上传期间切换路径或模式会受任务状态限制，避免任务写入与界面选择不一致。

## 联机拍摄与恢复

监听模式接收 EOS Utility 等软件保存到所选目录的素材。它按 1.2 秒静默和文件版本检查复制稳定快照，不能证明上游已经完成写入，因此始终保留来源文件。建议上游保存完成后原子改名；请确认原件完整后再手动清理。旧版配置中的监听自动删源选项不再执行。

FTP 模式供相机在同一局域网传输，界面显示地址、端口和用户；协议为 FTP，不是 FTPS / SFTP。

FTP 先写入 `.mascopy-inbox/.mascopy-staging/`，完整上传成功后才原子提交到 `.mascopy-inbox/.mascopy-completed/` 并入库；完成区文件可在重启后继续入库。中断或失败残片保留在 staging，升级前旧收件箱中的未知文件原地保留，均不会因静默或大小稳定而自动入库。请核对原件后手动恢复，或由相机完整重传；当前不提供 FTP REST 断点续传。停止联机任务会等待后台工作结束，再允许启动下一次会话。

目标暂时不可写时，联机任务保留待处理文件并退避重试。只有 FTP 已完成提交的文件，在成功归档或确认目标内容完全相同后才自动清理收件箱副本；普通监听不删除来源。

## 配置

配置保存于系统配置目录，并兼容迁移旧版 `~/.mascopy-config.json`。内容包括 SD / DJI 的路径、覆盖策略、收藏夹、Eagle 和联机设置。配置可能含用户设置的服务凭据，不应加入版本控制或诊断日志。

生产 WebView 使用显式 CSP，允许应用脚本、本地素材、数据图片和 Tauri IPC；开发环境额外允许本机 Vite HMR。素材预览保留用户选择任意本地目录的能力。

## 发布 DMG

默认产物位于 `target/release/bundle/dmg/`；若配置了 Cargo 目标目录，则以 `cargo metadata` 返回的目录为准。当前使用本地 ad-hoc 签名，公开分发所需的 Developer ID 签名与公证需另行配置。

### 发布到下载服务 dl.if9.cool（官网下载按钮用这个）

```bash
# 构建 → 上传 DMG → 写版本清单 → 晋升 stable 渠道
node scripts/publish_dl.mjs --notes "这一版的更新说明"

# 先发到 beta，或只上传不晋升；中途失败时加 --skip-build 重跑，已上传的同内容文件会被确认跳过
node scripts/publish_dl.mjs --channel beta
node scripts/publish_dl.mjs --no-promote
```

发布令牌优先取环境变量 `DL_RELEASE_TOKEN`，没有时用 `op` 从 1Password「开发启动器 · 发布令牌」读一次（dl.if9.cool 各应用共用）。三处版本号（`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-ui/package.json`）必须一致，工作区要干净。同一版本号的文件写入后不可覆盖，改了代码要先升版本。下载地址：`https://dl.if9.cool/v1/app/mascopy/stable/download/darwin-aarch64`。

### 发布到 GitHub Releases

```bash
# 会执行构建并真实发布到 origin 指向的 GitHub 仓库
bash scripts/release_dmg.sh

# 可选：明确指定 GitHub tag；DMG 版本仍取项目配置
bash scripts/release_dmg.sh v4.0.1
```

发布需要已配置的 GitHub `origin`。脚本优先使用现有 `gh` 登录，未安装 `gh` 时使用环境中的 `GITHUB_TOKEN`；不创建、重新生成或轮换任何令牌。备用方式需要系统 `curl`。

脚本只上传本次构建产生、与项目版本精确匹配的正式 DMG；找不到或发现多个候选时失败。已有 Release 可以追加资产，但同名资产会拒绝覆盖。HTTP 401 / 422、构建或上传失败均以非零状态退出，不打印成功提示。

## 目录

```text
大师拷贝/
├── Cargo.toml / Cargo.lock       # Rust 工作区与唯一 Cargo 锁
├── scripts/                     # 发布入口与隔离回归测试
├── src-tauri/                   # Rust 后端、Tauri 配置及权限
└── src-ui/                      # Vue 前端、npm 配置及锁文件
```

## 常见问题

- 扫描较慢：可启用快速扫描；内容判重仍需读取候选文件。
- 上传失败：检查目标挂载状态、空间和写权限，并查看错误详情。
- DMG 构建失败：检查 Xcode Command Line Tools 及上述 Node / Rust 版本。
- 端口被占用：停止使用该端口的任务，或在联机设置中选择可用端口。

## 许可证

CC BY-NC-SA 4.0：署名、非商业使用、相同方式共享。
