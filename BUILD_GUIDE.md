# MasCopy Electron 应用打包指南

## 快速开始

### 1. 开发和测试
```bash
# 安装依赖
npm install

# 开发模式运行
npm run dev

# 普通模式运行
npm start
```

### 2. 构建应用
```bash
# 方式一：使用npm脚本
npm run build-mac

# 方式二：使用构建脚本
./build_electron.sh
```

### 3. 代码签名（可选）
```bash
./sign_app.sh
```

### 4. 创建DMG安装包
```bash
./create_dmg.sh
```

### 5. 发布到GitHub（可选）
```bash
./publish_release.sh
```

## 构建输出

- **应用文件**: `dist/mac/MasCopy.app`
- **DMG安装包**: `MasCopy Installer.dmg`

## 注意事项

1. 确保已安装Node.js 16+
2. 首次构建会下载Electron二进制文件，需要网络连接
3. DMG创建需要安装create-dmg工具（脚本会自动安装）
4. 代码签名使用自签名，首次运行会有安全提示

## 故障排除

### 构建失败
- 检查Node.js版本：`node --version`
- 清理并重新安装依赖：`rm -rf node_modules && npm install`
- 检查网络连接（下载Electron二进制文件）

### DMG创建失败
- 确保已安装Homebrew
- 手动安装create-dmg：`brew install create-dmg`
- 检查应用是否已成功构建

### 应用无法启动
- 检查控制台错误信息
- 尝试开发模式：`npm run dev`
- 检查依赖是否完整安装