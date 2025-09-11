#!/bin/bash

# 设置版本号和发布说明
VERSION="v2.2.2"
RELEASE_FILE="release.md"

# 1. 创建tag
echo "创建tag $VERSION..."
git tag -a $VERSION -m "大师拷贝 $VERSION 发布"

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

# 计算DMG文件路径（由 electron-builder 生成，执行：npm run mascopy -- build）
ARCH="arm64" # 如需同时支持 x64，可改为脚本参数
DMG_FILE="dist/大师拷贝-${VERSION#v}-${ARCH}.dmg"

# 校验 DMG 是否存在
if [ ! -f "$DMG_FILE" ]; then
    echo "错误: 未找到 $DMG_FILE ，请先执行：npm run mascopy -- build 生成安装包"
    exit 1
fi

# 创建发布版本并上传DMG文件
echo "创建GitHub发布版本并上传 $DMG_FILE ..."
gh release create $VERSION \
    --title "大师拷贝 $VERSION" \
    --notes "$NOTES" \
    "$DMG_FILE"

echo "完成！大师拷贝 $VERSION 已发布到GitHub。"
echo "发布地址：https://github.com/Redwinam/mascopy/releases/tag/$VERSION"