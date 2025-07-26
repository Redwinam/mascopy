const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { MediaScanner } = require('./src/services/mediaScanner');
const { MediaUploader } = require('./src/services/mediaUploader');
const { ConfigManager } = require('./src/services/configManager');

class MasCopyApp {
  constructor() {
    this.mainWindow = null;
    this.mediaScanner = new MediaScanner();
    this.mediaUploader = new MediaUploader();
    this.configManager = new ConfigManager();
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
        preload: path.join(__dirname, 'src/preload.js')
      },
      show: true,
      center: true,
      resizable: true,
      icon: path.join(__dirname, 'assets/icon.svg')
    });

    await this.mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));

    if (this.isDev) {
      this.mainWindow.webContents.openDevTools();
    }

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  setupIpcHandlers() {
    ipcMain.handle('config:load', () => this.configManager.loadConfig());
    ipcMain.handle('config:save', (event, config) => this.configManager.saveConfig(config));

    ipcMain.handle('dialog:selectFolder', async (event, title, defaultPath) => {
      const { canceled, filePaths } = await dialog.showOpenDialog(this.mainWindow, {
        title: title || '选择文件夹',
        defaultPath: defaultPath || '',
        properties: ['openDirectory']
      });
      return !canceled && filePaths.length > 0 ? filePaths[0] : null;
    });

    ipcMain.handle('media:scan', async (event, sourceDir, targetDir, overwriteDuplicates) => {
      try {
        const results = await this.mediaScanner.scanDirectory(sourceDir, targetDir, overwriteDuplicates);
        return { success: true, data: results };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    this.mediaScanner.on('progress', (data) => {
      if (this.mainWindow) {
        this.mainWindow.webContents.send('scan:progress', data);
      }
    });

    ipcMain.handle('media:upload', async (event, files, targetDir, overwriteDuplicates) => {
      try {
        const results = await this.mediaUploader.uploadFiles(files, targetDir, overwriteDuplicates);
        return { success: true, data: results };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    this.mediaUploader.on('progress', (data) => {
      if (this.mainWindow) {
        this.mainWindow.webContents.send('upload:progress', data);
      }
    });

    this.mediaUploader.on('fileProcessed', (data) => {
      if (this.mainWindow) {
        this.mainWindow.webContents.send('upload:fileProcessed', data);
      }
    });

    ipcMain.handle('upload:pause', () => this.mediaUploader.pause());
    ipcMain.handle('upload:resume', () => this.mediaUploader.resume());
    ipcMain.handle('upload:cancel', () => this.mediaUploader.cancel());

    ipcMain.handle('system:openPath', (event, filePath) => shell.openPath(filePath));
    ipcMain.handle('system:showInFolder', (event, filePath) => shell.showItemInFolder(filePath));
  }

  async initialize() {
    await app.whenReady();
    this.setupIpcHandlers();
    await this.createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createWindow();
      }
    });
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const masCopyApp = new MasCopyApp();
masCopyApp.initialize().catch(console.error);