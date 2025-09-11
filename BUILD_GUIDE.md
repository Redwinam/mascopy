# 大师拷贝 Electron 打包与发布指南（统一 CLI 版）

以下命令均以 npm 脚本方式调用：
```bash
npm run mascopy -- <subcommand> [options]
```

## 一键流程（推荐）
```bash
npm run mascopy -- bump 2.1.1
npm run mascopy -- all --install --sign --release --arch arm64
```

## 手动分步

### 1. 构建
推荐使用统一 CLI：
```bash
npm run mascopy -- build [--install]
```
构建产物：
- 应用：`dist/mac/大师拷贝.app`（或 `dist/mac-arm64/大师拷贝.app` / `dist/mac-x64/大师拷贝.app`）
- DMG：`dist/大师拷贝-<version>-arm64.dmg`

### 2. 自签名（可选）
```bash
npm run mascopy -- sign
```
说明：
- 默认使用 adhoc 签名（-），无需开发者证书
- 如需使用开发者证书，请编辑 sign_app.sh 的 `codesign --sign` 值

### 3. 发布到 GitHub（可选）
```bash
npm run mascopy -- release --arch arm64
```
说明：
- 依赖 GitHub CLI（`gh`），首次会引导安装/登录
- 使用 release.md 作为发布说明
- 自动读取 DMG：`dist/大师拷贝-<version>-<arch>.dmg`

### 4. 全流程（构建→签名→发布）
```bash
npm run mascopy -- all --install --sign --release --arch arm64
```

## 版本管理
```bash
npm run mascopy -- bump 2.1.1
```
- 同步修改 package.json 版本
- 自动尝试同步 publish_release.sh 的 VERSION 值

## 故障排除
- 构建后未见 .app，但有 DMG：
  - Electron Builder 可能将 .app 放在 `dist/mac-arm64` 或 `dist/mac-x64`
  - CLI 与 sign_app.sh 已兼容上述路径
- 发布找不到 DMG：
  - 确认已执行构建，DMG 位于 `dist/大师拷贝-<version>-<arch>.dmg`
- GitHub CLI 未登录/未安装：
  - 执行 `gh auth login`，或按提示安装 `gh`
