#!/bin/bash

# Electron应用构建脚本
# 用于快速构建应用，不包含DMG打包

set -e  # 遇到错误时退出

echo "🚀 开始构建MasCopy Electron应用..."

# 检查必要的工具
if ! command -v npm &> /dev/null; then
    echo "❌ 错误: 未找到npm，请先安装Node.js"
    exit 1
fi

# 安装依赖
echo "📦 安装项目依赖..."
npm install

# 构建Electron应用
echo "🔨 构建Electron应用..."
npm run build-mac

# 检查构建结果
if [ ! -d "dist/mac/MasCopy.app" ]; then
    echo "❌ 错误: 构建失败，未找到MasCopy.app"
    exit 1
fi

echo "✅ 构建完成!"
echo "📱 应用位置: dist/mac/MasCopy.app"
echo "💡 提示: 运行 ./sign_app.sh 进行代码签名"
echo "💡 提示: 运行 ./create_dmg.sh 创建安装包"