#!/bin/bash

# 安装必要的依赖
pip install -r requirements.txt
pip install py2app pyinstaller

echo "=== 使用PyInstaller打包 ==="
# 清理之前的构建
rm -rf build dist

# 使用PyInstaller打包
pyinstaller --windowed \
            --icon=mascopy.icns \
            --name="MasCopy" \
            --add-data="mascopy.icns:." \
            --hidden-import=PyQt6 \
            --hidden-import=pymediainfo \
            --hidden-import=Pillow \
            main.py

echo "=== 打包完成 ==="
echo "应用程序位于 dist/MasCopy.app"

# 可选：也可以用py2app打包
# echo "=== 使用py2app打包（备选方案）==="
# python setup.py py2app 