#!/bin/bash

# Electron应用代码签名脚本

# 选择待签名的 .app（兼容多种输出目录）
APP_CANDIDATES=(
  "dist/mac/MasCopy.app"
  "dist/mac-arm64/MasCopy.app"
  "dist/mac-x64/MasCopy.app"
)

APP_PATH=""
for p in "${APP_CANDIDATES[@]}"; do
  if [ -d "$p" ]; then
    APP_PATH="$p"
    break
  fi
done

if [ -z "$APP_PATH" ]; then
  echo "错误: 未找到应用文件；已检查以下路径："
  for p in "${APP_CANDIDATES[@]}"; do echo " - $p"; done
  echo "请先运行：npm run mascopy -- build"
  exit 1
fi

echo "签名目标：$APP_PATH"

# 查看可用的签名身份
echo "可用的签名身份："
security find-identity -v -p codesigning || true

echo "将使用 adhoc 自签名（-），如需使用开发者证书，请修改本脚本 codesign 的 --sign 值。"

# 使用adhoc签名（无需开发者证书）
echo "正在进行自签名..."
codesign --force --deep --sign - "$APP_PATH"

echo "✅ 签名完成"
echo "注意：自签名应用首次运行时仍会显示安全警告"
echo "您可以在Finder中右键点击应用并选择'打开'，或在系统偏好设置中允许此应用运行"