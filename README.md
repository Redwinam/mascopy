# 大师拷贝 4.1.4

基于 Tauri 2 + Vue 3 的 macOS 照片与视频整理工具，可将 SD / DJI 素材按日期备份到本地磁盘或已挂载的 NAS，也支持联机拍摄与 Eagle 导入。

官网与下载：<https://mascopy.if9.cool>（源码在 `website/`，见其中的 README）。

## 功能

- SD / DJI 媒体扫描、日期与元数据提取、快速扫描
- 默认按名称和大小快速判重，可选完整内容校验；冲突文件自动改名，支持显式覆盖
- 批量上传及暂停、继续、取消，显示进度与错误
- 来源、目标路径收藏与配置保存
- 文件夹监听、相机 FTP 接收和按日期归档
- Eagle 本地 API 导入与图片预览、裁剪
- 应用内自动更新：标题栏右侧「关于与更新」，启动后与每 6 小时自动检查（4.1.0 起）

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
3. 扫描完成后默认勾选应用支持的所有待上传素材（包括 RAW、照片和视频），已备份文件不勾选；可取消个别勾选或清空选择，点击「上传所选」才开始上传。表头可全选当前列表。日期、后缀与状态筛选不会清空勾选，界面会提示被筛选隐藏的已选数量。只上传部分文件后，其余文件仍保留在结果页，可继续勾选上传。
4. 查看上传进度；失败时可立即展开单个文件的「错误详情」，或打开「日志」。

标准扫描会读取照片 EXIF；MP4 / MOV / M4V / 3GP / OSV / LRF 读取 `mvhd` v0 / v1 创建时间，其他视频或无有效时间字段时回退到文件修改时间。快速扫描仅使用文件修改时间。

默认恢复旧版快速判重：目标日期目录下同名、同大小的文件直接跳过，不读取文件内容。这不能识别同名、同大小但内容不同的文件。需要确认内容一致时，可手动开启「完整内容校验」；该设置按 SD / DJI 模式分别保存，默认关闭，与用于跳过 EXIF 的「快速扫描模式」独立。完整校验会读取源和 NAS 上的整个同名文件，因此大视频耗时较长。扫描状态在原操作栏内显示，不再增加单独的进度区域。

支持独占重命名的磁盘先写临时文件，成功后发布最终文件。不支持该操作的 NAS（例如部分 SMB 挂载）会在复制前自动检测，并用独占创建直接写入新文件，不覆盖已有文件；失败或正常取消会清理本次未完成文件。此兼容方式在复制期间可见目标文件，强退、断电或断网导致清理失败时可能留下不完整文件；此时应保留原件，开启「完整内容校验」后重新扫描，默认名称与大小判重不能替代完整性检查。显式覆盖仍先暂存，再重命名替换。

每个文件失败时立即显示错误摘要、行内「错误详情」并写入「日志」页和系统应用日志，无需等待整批结束；macOS 日志位于 `~/Library/Logs/com.redwinam.mascopy/`。扫描或上传期间切换路径或模式会受任务状态限制，避免任务写入与界面选择不一致。

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

### 发布到下载服务 dl.if9.cool（官网下载与应用内更新都用这个）

```bash
# 带签名私钥构建 DMG 与自动更新包 → 按应用内公钥验签 → 上传 → 写版本清单 → 晋升 stable 渠道
node scripts/publish_dl.mjs --notes "这一版的更新说明"

# 先发到 beta，或只上传不晋升；中途失败时加 --skip-build 重跑，已上传的同内容文件会被确认跳过
node scripts/publish_dl.mjs --channel beta
node scripts/publish_dl.mjs --no-promote

# 只构建并核对产物（不需要发布令牌），之后再 --skip-build 发布
node scripts/publish_dl.mjs --skip-upload
```

- 需要三样密钥，环境变量优先，缺的在一次 `op` 调用里从 1Password「开发」保险库读齐（只弹一次解锁）：`DL_RELEASE_TOKEN`（「开发启动器 · 发布令牌」，dl.if9.cool 各应用共用）、`TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（「大师拷贝 · 更新签名」）。条目 ID 写在脚本的 `OP_REFS` 里。
- 三处版本号（`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-ui/package.json`）必须一致，工作区要干净。同一版本号的文件写入后不可覆盖，改了代码要先升版本。
- 下载地址 `https://dl.if9.cool/v1/app/mascopy/stable/download/darwin-aarch64`；应用内更新读 `https://dl.if9.cool/v1/app/mascopy/stable/latest.json`，只接受用 `tauri.conf.json` 里 `plugins.updater.pubkey` 对应私钥签名的更新包。

### 自动更新

- 入口在标题栏右侧（ⓘ 按钮）。有新版时变成「新版本」，下载中显示百分比，装好后显示「重启更新」。拷贝或联机会话进行中不能重启，按钮会等它们结束。开发构建（`tauri dev` 或 debug）不检查。
- `tauri.conf.json` 默认 `bundle.createUpdaterArtifacts: false`，所以不带私钥的本机构建和 `release_dmg.sh` 照常成功；发布脚本构建时用 `--config` 打开它。
- 签名私钥丢了，已安装的客户端就再也收不到自动更新，只能手动重装；确需换钥时，先用旧私钥签发一个内置新公钥的版本，等客户端都升上去再改用新私钥。
- 4.0.1 及更早的版本没有更新功能，要手动装一次 4.1.0。

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

- 扫描较慢：检查是否开启了「完整内容校验」，关闭后按名称和大小快速判重；「快速扫描模式」另外控制是否读取拍摄时间。
- 上传失败：检查目标挂载状态、空间和写权限，并查看错误详情。
- DMG 构建失败：检查 Xcode Command Line Tools 及上述 Node / Rust 版本。
- 端口被占用：停止使用该端口的任务，或在联机设置中选择可用端口。

## 许可证

CC BY-NC-SA 4.0：署名、非商业使用、相同方式共享。
