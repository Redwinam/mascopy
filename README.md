# 照片/视频 NAS 上传工具

一个用于将相机 SD 卡中的照片和视频上传到 NAS 的 Python 工具，支持按拍摄日期自动分类。

## 功能特点

- 支持照片和视频文件
- 自动读取 EXIF 数据获取拍摄日期
- 按日期自动创建文件夹并分类
- 支持检查重复文件
- 支持覆盖重复文件选项
- 支持暂停/继续上传
- 支持预扫描功能
- 支持记住上次选择的路径
- 支持嵌套文件夹扫描

## 支持的媒体格式

### 照片格式

- JPG/JPEG
- PNG
- HEIC
- NEF (尼康 RAW 格式)
- CR2 (佳能 RAW 格式)
- ARW (索尼 RAW 格式)
- DNG (徕卡及其他 RAW 格式)
- CR3 (佳能新 RAW 格式)

### 视频格式

- MP4
- MOV
- AVI
- M4V
- 3GP
- MKV

## 使用要求

- Python 3.6+
- macOS 系统
- NAS 目录已挂载到本地

## 开发和构建

- 环境设置:
  - 克隆仓库
  - (可选) 创建和激活虚拟环境
  - 安装依赖: pip install -r requirements.txt
- 运行开发版本:
  - 如何直接运行源代码: python main.py
- 打包应用:
  - 运行构建脚本: bash build_app.sh
  - 说明生成的 .app 文件位于 dist/ 目录。
- 创建 DMG 安装包:
  - 运行 DMG 创建脚本: bash create_dmg.sh (可能需要先 brew install create-dmg)
  - 说明生成的 .dmg 文件位于项目根目录。
- (可选) 发布流程:
  - 简要说明 publish_release.sh 的作用（创建 tag、推送到 GitHub、创建 Release 并上传 DMG）。

## 安装依赖

```bash
pip install -r requirements.txt
```

## 使用方法

1. 运行程序：

```bash
python main.py
```

2. 在程序界面中：
   - 选择源目录（相机 SD 卡目录）
   - 选择目标目录（NAS 目录）
   - 选择是否覆盖重复文件
   - 点击 "预扫描" 查看文件处理计划
   - 点击 "开始上传" 开始处理

## 注意事项

1. 确保 NAS 目录已正确挂载到 Mac 上
2. 建议先使用预扫描功能查看文件处理计划
3. 上传过程中可以随时暂停/继续
4. 程序会自动记住上次选择的路径

## 许可证

本项目采用 [CC BY-NC-SA 4.0](LICENSE) 许可证。
