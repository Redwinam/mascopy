const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { MediaScanner } = require('./services/mediaScanner');
const { MediaUploader } = require('./services/mediaUploader');
const { ConfigManager } = require('./services/configManager');

class MasCopyApp {
  constructor() {
    this.mainWindow = null;
    this.mediaScanner = new MediaScanner();
    this.mediaUploader = new MediaUploader();
    this.configManager = new ConfigManager();
    this.isDev = process.argv.includes('--dev');
  }

  async createWindow() {
    // 创建主窗口
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        preload: path.join(__dirname, 'preload.js')
      },
      titleBarStyle: 'hiddenInset',
      show: false,
      icon: path.join(__dirname, '../assets/icon.png')
    });

    // 加载应用页面
    await this.mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

    // 开发模式下打开开发者工具
    this.mainWindow.webContents.openDevTools();

    // 窗口准备好后显示
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
    });

    // 页面加载完成后，根据操作系统添加CSS类
    this.mainWindow.webContents.on('did-finish-load', () => {
      const platform = process.platform;
      const js = `document.body.classList.add('platform-${platform}')`;
      this.mainWindow.webContents.executeJavaScript(js);
    });

    // 处理窗口关闭
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  setupIpcHandlers() {
    // 配置相关
    ipcMain.handle('config:load', async () => {
      return await this.configManager.loadConfig();
    });

    ipcMain.handle('config:save', async (event, config) => {
      return await this.configManager.saveConfig(config);
    });

    // 文件夹选择
    ipcMain.handle('dialog:selectFolder', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        title: '选择文件夹',
        properties: ['openDirectory']
      });
      return result;
    });

    // 媒体扫描
    ipcMain.handle('media:scan', async (event, sourceDir, targetDir, overwrite) => {
      try {
        const result = await this.mediaService.scan(sourceDir, targetDir, overwrite);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // 媒体上传
    ipcMain.handle('media:upload', async (event, files, targetDir, overwrite) => {
      try {
        await this.mediaService.upload(files, targetDir, overwrite);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // 上传控制
    ipcMain.handle('upload:pause', () => {
      this.mediaService.pauseUpload();
      return { success: true };
    });

    ipcMain.handle('upload:resume', () => {
      this.mediaService.resumeUpload();
      return { success: true };
    });

    ipcMain.handle('upload:cancel', () => {
      this.mediaService.cancelUpload();
      return { success: true };
    });

    // 系统相关
    ipcMain.handle('system:openPath', async (event, filePath) => {
      try {
        await shell.openPath(filePath);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('system:showInFolder', async (event, filePath) => {
      try {
        shell.showItemInFolder(filePath);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }

  async ensureConfigFileExists() {
    try {
      await fs.access(this.configManager.configPath);
    } catch (error) {
      // 如果文件不存在，则创建一个默认的
      if (error.code === 'ENOENT') {
        console.log('配置文件不存在，正在创建默认配置文件...');
        await this.configManager.saveConfig(this.configManager.defaultConfig);
      }
    }
  }

  async initialize() {
    // 等待应用准备就绪
    await app.whenReady();

    // 确保配置文件存在
    await this.ensureConfigFileExists();

    // 设置IPC处理器
    this.setupIpcHandlers();

    // 创建主窗口
    await this.createWindow();

    // macOS特定处理
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await this.createWindow();
      }
    });
  }
}

// 创建应用实例并初始化
const masCopyApp = new MasCopyApp();
masCopyApp.initialize().catch(console.error);

// 导出应用实例（用于测试）
module.exports = masCopyApp;