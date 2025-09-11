# MasCopy Electron 打包与发布指南（统一 CLI 版）

## 快速发布

```bash
npm run mascopy -- bump 2.1.1
npm run mascopy -- all --install --sign --release --arch arm64
```

## 开发与测试

```bash
npm install
npm run dev   # 开发模式
npm start     # 普通模式
```

## 构建与打包

推荐使用统一 CLI：

```bash
# 构建 mac 应用与 DMG（可加 --install 自动安装依赖）
npm run mascopy -- build [--install]
```

- 构建产物：
  - 应用：`dist/mac/MasCopy.app`
  - DMG：`dist/MasCopy-<version>-arm64.dmg`

## 代码签名（可选）

```bash
# 使用自签名（adhoc）
npm run mascopy -- sign
```

说明：自签名不会通过 Gatekeeper；首次运行需右键-打开或在系统安全设置允许。

## 发布到 GitHub（可选）

```bash
# 读取 release.md 并上传 DMG（依赖 gh CLI）
npm run mascopy -- release --arch arm64

# 或一键全流程（构建→签名→发布）
npm run mascopy -- all --install --sign --release --arch arm64
```

首次使用需要安装并登录 GitHub CLI：

```bash
brew install gh
gh auth login
```

## 版本管理

```bash
# 同步修改 package.json 与发布脚本中的版本
npm run mascopy -- bump 2.1.1
```

## 故障排除

- 构建失败：
  - 检查 Node 版本：`node -v`
  - 重新安装依赖：`rm -rf node_modules && npm install`
  - 查看 electron-builder 版本与配置
- DMG 缺失：
  - 确认已执行构建：`npm run mascopy -- build`
  - DMG 路径：`dist/MasCopy-<version>-arm64.dmg`
- 发布失败：
  - 确认 gh 已安装并登录：`gh --version`、`gh auth status`
  - 检查 tag 权限与网络
