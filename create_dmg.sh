#!/bin/bash

# 安装create-dmg工具(如果没有)
brew list create-dmg || brew install create-dmg

# 为应用创建DMG镜像
create-dmg \
  --volname "MasCopy安装器" \
  --volicon "mascopy.icns" \
  --window-pos 200 120 \
  --window-size 800 400 \
  --icon-size 100 \
  --icon "MasCopy.app" 200 190 \
  --hide-extension "MasCopy.app" \
  --app-drop-link 600 185 \
  "MasCopy安装器.dmg" \
  "dist/MasCopy.app"

echo "DMG安装包已创建: MasCopy安装器.dmg" 