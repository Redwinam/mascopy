# MasCopy - 照片/视频 NAS 上传工具 (Electron版)

一个现代化的照片和视频文件管理工具，使用 Electron 构建，专为 NAS 上传而设计。

## 功能特性

### 🎯 核心功能
- **智能媒体扫描**: 自动识别照片和视频文件
- **元数据提取**: 从 EXIF 数据和视频元数据中提取拍摄日期
- **重复文件检测**: 基于文件大小和路径的智能重复检测
- **批量上传**: 支持大量文件的批量处理
- **暂停/恢复**: 上传过程可随时暂停和恢复
- **进度跟踪**: 实时显示扫描和上传进度

### 🎨 用户界面
- **现代化设计**: 简洁美观的用户界面
- **响应式布局**: 适配不同屏幕尺寸
- **实时日志**: 详细的操作日志记录
- **模态对话框**: 扫描进度和结果展示
- **文件过滤**: 按状态筛选文件列表

### ⚙️ 技术特性
- **跨平台**: 支持 Windows、macOS 和 Linux
- **高性能**: 异步处理，不阻塞用户界面
- **配置持久化**: 自动保存用户设置
- **错误处理**: 完善的错误处理和用户反馈

## 安装和运行

### 环境要求
- Node.js 16.0 或更高版本
- npm 或 yarn 包管理器

### 安装依赖
```bash
npm install
```

### 开发模式运行
```bash
npm start
```

### 构建应用（推荐）
- 使用统一 CLI：`npm run mascopy -- build`（会生成 .app 与 DMG）
- 构建产物：
  - 应用：`dist/mac/MasCopy.app`（或 `dist/mac-arm64/MasCopy.app` / `dist/mac-x64/MasCopy.app`）
  - DMG：`dist/MasCopy-<version>-arm64.dmg`

## 使用说明

### 1. 配置路径
- **源目录**: 选择包含照片和视频的文件夹
- **目标目录**: 选择 NAS 或其他目标存储位置

### 2. 设置选项
- **覆盖重复文件**: 勾选此选项将覆盖目标目录中的同名文件

### 3. 扫描文件
- 点击"预扫描"按钮开始扫描源目录
- 查看扫描结果，包括文件统计和详细列表
- 可按状态筛选文件（全部/将上传/将覆盖/将跳过）

### 4. 开始上传
- 从扫描结果对话框点击"开始上传"
- 或直接点击主界面的"开始上传"按钮（会自动先扫描）
- 监控上传进度和日志信息

### 5. 控制上传
- **暂停/继续**: 随时暂停或恢复上传过程
- **取消**: 完全停止上传操作
- **清空日志**: 清除日志记录

## 文件结构

```
mascopy/
├── main.js                    # Electron 主进程
├── package.json              # 项目配置
├── src/
│   ├── preload.js            # 预加载脚本
│   ├── services/             # 核心服务
│   │   ├── configManager.js  # 配置管理
│   │   ├── mediaScanner.js   # 媒体扫描
│   │   └── mediaUploader.js  # 文件上传
│   └── renderer/             # 渲染进程
│       ├── index.html        # 主页面
│       ├── js/
│       │   └── app.js        # 前端逻辑
│       └── styles/
│           ├── main.css      # 主样式
│           └── components.css # 组件样式
└── README.md                 # 说明文档
```

## 支持的文件格式

### 照片格式
- JPEG (.jpg, .jpeg)
- PNG (.png)
- TIFF (.tiff, .tif)
- BMP (.bmp)
- WebP (.webp)

### 视频格式
- MP4 (.mp4)
- AVI (.avi)
- MOV (.mov)
- MKV (.mkv)
- WMV (.wmv)
- FLV (.flv)

## 配置文件

应用配置自动保存在用户主目录的 `.mascopy-config.json` 文件中，包含：
- 源目录路径
- 目标目录路径
- 覆盖重复文件选项

## 故障排除

### 常见问题

1. **扫描速度慢**
   - 大量文件时扫描需要时间，请耐心等待
   - 可以查看扫描进度对话框了解当前状态

2. **上传失败**
   - 检查目标目录是否有写入权限
   - 确保网络连接稳定（如果是网络存储）
   - 查看日志获取详细错误信息

3. **应用无法启动**
   - 确保 Node.js 版本符合要求
   - 重新安装依赖：`npm install`
   - 检查控制台错误信息

### 日志位置
- 应用运行日志显示在界面的日志区域
- Electron 调试信息可通过开发者工具查看（Ctrl/Cmd + Shift + I）

## 开发说明

### 技术栈
- **Electron**: 跨平台桌面应用框架
- **Node.js**: 后端逻辑和文件处理
- **HTML/CSS/JavaScript**: 前端界面
- **Sharp**: 图像处理和 EXIF 数据提取
- **FFprobe**: 视频元数据提取

### 开发模式
```bash
npm run dev
```

### 代码结构
- 主进程负责文件系统操作和核心业务逻辑
- 渲染进程负责用户界面和交互
- 通过 IPC 进行进程间通信

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

- Node.js 16+
- macOS 系统
- NAS 目录已挂载到本地

## 开发和构建

### 环境设置
- 克隆仓库
- 安装依赖: `npm install`

### 运行开发版本
- 开发模式: `npm run dev`
- 普通启动: `npm start`

### 打包应用
- 构建应用: `npm run mascopy -- build`（或 `npm run build-mac`）
- 生成的 .app 文件位于 `dist/mac/` 目录

### 代码签名
- 使用 CLI 进行自签名（adhoc）：`npm run mascopy -- sign`（内部调用 sign_app.sh）

### 创建 DMG 安装包
- 构建时 electron-builder 会自动生成 DMG
- 生成的 .dmg 文件位于 `dist/MasCopy-<version>-arm64.dmg`

### 发布流程
- 使用 CLI 发布到 GitHub：`npm run mascopy -- release --arch arm64`
- 或直接运行脚本：`./publish_release.sh`
- 自动创建 tag、推送到 GitHub、创建 Release 并上传 DMG

## 安装依赖

```bash
npm install
```

## 使用方法

1. 运行程序：

```bash
npm start
# 或开发模式
npm run dev
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
