#!/bin/bash

# Electron应用DMG打包脚本
# 确保在项目根目录运行此脚本

set -e  # 遇到错误时退出

echo "开始构建MasCopy Electron应用..."

# 检查必要的工具
if ! command -v npm &> /dev/null; then
    echo "错误: 未找到npm，请先安装Node.js"
    exit 1
fi

if ! command -v electron-builder &> /dev/null; then
    echo "安装electron-builder..."
    npm install -g electron-builder
fi

# 安装依赖
echo "安装项目依赖..."
npm install

# 构建Electron应用
echo "构建Electron应用..."
npm run build-mac

# 检查构建结果
if [ ! -f "dist/MasCopy-1.0.0-arm64.dmg" ]; then
    echo "错误: 构建失败，未找到DMG文件"
    exit 1
fi

echo "✅ DMG安装包已创建: dist/MasCopy-1.0.0-arm64.dmg"
echo "📦 应用大小: $(du -h "dist/MasCopy-1.0.0-arm64.dmg" | cut -f1)"
echo "🚀 可以分发此DMG文件给用户安装"