#!/bin/bash

# 设置版本号和发布说明
VERSION="v1.0.1"
RELEASE_FILE="release.md"

# 1. 创建tag
echo "创建tag $VERSION..."
git tag -a $VERSION -m "MasCopy $VERSION 发布"

# 2. 推送tag到GitHub
echo "推送tag到GitHub..."
git push origin $VERSION

# 3. 使用GitHub CLI创建发布版本并上传DMG文件
# 安装GitHub CLI（如果尚未安装）
if ! command -v gh &> /dev/null; then
    echo "GitHub CLI未安装，正在安装..."
    brew install gh
fi

# 确认GitHub CLI已登录
if ! gh auth status &> /dev/null; then
    echo "请先登录GitHub CLI..."
    gh auth login
fi

# 从release.md文件中读取发布说明
NOTES=$(cat $RELEASE_FILE)

# 创建发布版本并上传DMG文件
echo "创建GitHub发布版本并上传DMG文件..."
gh release create $VERSION \
    --title "MasCopy $VERSION" \
    --notes "$NOTES" \
    "MasCopy Installer.dmg"

echo "完成！MasCopy $VERSION 已发布到GitHub。"
echo "发布地址：https://github.com/Redwinam/mascopy/releases/tag/$VERSION" 