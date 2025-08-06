#!/bin/bash

# Electron应用代码签名脚本

# 检查应用是否存在
if [ ! -d "dist/mac/MasCopy.app" ]; then
    echo "错误: 未找到应用文件 dist/mac/MasCopy.app"
    echo "请先运行构建脚本: npm run build-mac"
    exit 1
fi

# 查看可用的签名身份
echo "可用的签名身份："
security find-identity -v -p codesigning

echo "请从上面的列表选择一个签名身份进行签名，或直接使用自签名"
echo "注意：使用自签名仍会触发系统安全警告，但可在系统偏好设置→安全性与隐私中允许运行"

# 使用adhoc签名（无需开发者证书）
echo "正在进行自签名..."
codesign --force --deep --sign - "dist/mac/MasCopy.app"

echo "✅ 签名完成"
echo "注意：自签名应用首次运行时仍会显示安全警告"
echo "您可以在Finder中右键点击应用并选择'打开'，或在系统偏好设置中允许此应用运行"