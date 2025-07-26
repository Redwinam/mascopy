const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { MediaScanner } = require('./services/mediaScanner');
const { MediaUploader } = require('./services/mediaUploader');
const { ConfigManager } = require('./services/configManager');

class MasCopyApp {
  constructor() {
    this.mainWindow = null;
    this.configManager = new ConfigManager();
    this.mediaScanner = new MediaScanner();
    this.mediaUploader = new MediaUploader();
    this.mediaService = {
      scan: (...args) => this.mediaScanner.scanDirectory(...args),
      upload: (...args) => this.mediaUploader.uploadFiles(...args),
      pauseUpload: () => this.mediaUploader.pause(),
      resumeUpload: () => this.mediaUploader.resume(),
      cancelUpload: () => this.mediaUploader.cancel(),
    };
    this.isDev = process.argv.includes('--dev');
  }

  async createWindow() {
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
      show: true,
      icon: path.join(__dirname, '..', 'assets', 'icon.png')
    });

    try {
      await this.mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

      if (this.isDev) {
        this.mainWindow.webContents.openDevTools();
      }


    } catch (error) {
      console.error('Failed to load renderer:', error);
    }

    this.mainWindow.webContents.on('did-finish-load', () => {
      const platform = process.platform;
      const js = `document.body.classList.add('platform-${platform}')`;
      this.mainWindow.webContents.executeJavaScript(js);
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  setupIpcHandlers() {
    ipcMain.handle('config:load', async () => {
      return await this.configManager.loadConfig();
    });

    ipcMain.handle('config:save', async (event, config) => {
      return await this.configManager.saveConfig(config);
    });

    ipcMain.handle('dialog:selectFolder', async (event, options) => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        title: options.title || '选择文件夹',
        properties: ['openDirectory'],
        defaultPath: options.defaultPath
      });
      return result;
    });

    ipcMain.handle('media:scan', async (event, sourceDir, targetDir, overwrite) => {
      console.log('IPC `media:scan` received:', { sourceDir, targetDir, overwrite });

      const progressListener = (progress) => {
        event.sender.send('scan:progress', progress);
      };

      this.mediaScanner.on('progress', progressListener);

      try {
        const results = await this.mediaService.scan(sourceDir, targetDir, overwrite);
        return {
          success: true,
          data: {
            files: results.files,
            stats: results.stats
          }
        };
      } catch (error) {
        console.error('!!!!!!!!!!!!!!!!!! IPC media:scan FAILED !!!!!!!!!!!!!!!!!!');
        console.error('Caught error object type:', typeof error);
        console.error('Caught error object:', error);
        console.error('Error message:', error ? error.message : 'N/A');
        console.error('Error stack:', error ? error.stack : 'N/A');
        console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        const errorMessage = error ? (error.message || String(error)) : 'An undefined error occurred';
        return {
          success: false,
          error: `扫描出错: ${errorMessage}`,
          data: {
            files: [],
            stats: { total: 0, upload: 0, overwrite: 0, skip: 0 }
          }
        };
      } finally {
        this.mediaScanner.removeListener('progress', progressListener);
      }
    });

    ipcMain.handle('media:upload', async (event, files, targetDir, overwrite) => {
      return this.mediaService.upload(files, targetDir, overwrite);
    });

    ipcMain.handle('upload:pause', () => {
      return this.mediaService.pauseUpload();
    });

    ipcMain.handle('upload:resume', () => {
      return this.mediaService.resumeUpload();
    });

    ipcMain.handle('upload:cancel', () => {
      return this.mediaService.cancelUpload();
    });

    ipcMain.handle('system:openPath', async (event, filePath) => {
      try {
        await shell.openPath(filePath);
        return { success: true };
      } catch (error) {
        return { 
      success: false, 
      error: errorMessage,
      data: {
        files: [],
        stats: { total: 0, upload: 0, overwrite: 0, skip: 0 }
      }
    };
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
      if (error.code === 'ENOENT') {
        console.log('配置文件不存在，正在创建默认配置文件...');
        await this.configManager.saveConfig(this.configManager.defaultConfig);
      }
    }
  }

  async initialize() {
    await app.whenReady();

    await this.ensureConfigFileExists();

    this.setupIpcHandlers();

    await this.createWindow();

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

const masCopyApp = new MasCopyApp();
masCopyApp.initialize().catch(console.error);

module.exports = masCopyApp;