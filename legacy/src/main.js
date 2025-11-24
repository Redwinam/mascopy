const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs").promises;
const { MediaScanner } = require("./services/mediaScanner");
const { MediaUploader } = require("./services/mediaUploader");
const { ConfigManager } = require("./services/configManager");

class MasCopyApp {
  constructor() {
    this.mainWindow = null;
    this.configManager = new ConfigManager();
    this.mediaScanner = new MediaScanner();
    this.mediaUploader = new MediaUploader();

    this.mediaUploader.on("fileProcessed", (result) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send("upload:fileProcessed", result);
      }
    });

    this.mediaUploader.on("file-progress", (progress) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send("upload:file-progress", progress);
      }
    });

    this.mediaUploader.on("file-start", (data) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send("upload:file-start", data);
      }
    });

    this.mediaUploader.on("progress", (progress) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send("upload:progress", progress);
      }
    });
    this.mediaService = {
      scan: (...args) => this.mediaScanner.scanDirectory(...args),
      upload: (...args) => this.mediaUploader.uploadFiles(...args),
      pauseUpload: () => this.mediaUploader.pause(),
      resumeUpload: () => this.mediaUploader.resume(),
      cancelUpload: () => this.mediaUploader.cancel(),
    };
    this.isDev = process.argv.includes("--dev");
  }

  async createWindow() {
    // 根据平台设置不同的窗口选项
    const windowOptions = {
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 640,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        preload: path.join(__dirname, "preload.js"),
      },
      show: true,
      icon: path.join(__dirname, "..", "assets", "icon.png"),
    };

    // macOS 特定配置
    if (process.platform === "darwin") {
      windowOptions.titleBarStyle = "hiddenInset";
      windowOptions.titleBarOverlay = false;
      windowOptions.trafficLightPosition = { x: 15, y: 16 }; // 调整红绿灯按钮位置，向左移动
      windowOptions.customButtonsOnHover = true; // 只在悬停时显示按钮
    } else {
      windowOptions.titleBarStyle = "default";
    }

    this.mainWindow = new BrowserWindow(windowOptions);

    try {
      await this.mainWindow.loadFile(path.join(__dirname, "renderer/index.html"));

      if (this.isDev) {
        this.mainWindow.webContents.openDevTools();
      }
    } catch (error) {
      console.error("Failed to load renderer:", error);
    }

    this.mainWindow.webContents.on("did-finish-load", () => {
      const platform = process.platform;
      const js = `document.body.classList.add('platform-${platform}')`;
      this.mainWindow.webContents.executeJavaScript(js);
    });

    this.mainWindow.on("closed", () => {
      this.mainWindow = null;
    });
  }

  setupIpcHandlers() {
    ipcMain.handle("config:load", async () => {
      return await this.configManager.loadConfig();
    });

    ipcMain.handle("config:save", async (event, config) => {
      return await this.configManager.saveConfig(config);
    });

    ipcMain.handle("dialog:selectFolder", async (event, options) => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        title: options.title || "选择文件夹",
        properties: ["openDirectory"],
        defaultPath: options.defaultPath,
      });
      return result;
    });

    ipcMain.handle("media:scan", async (event, sourceDir, targetDir, overwrite, mode = "sd", fast = false) => {
      console.log("IPC `media:scan` received:", { sourceDir, targetDir, overwrite, mode, fast });

      const progressListener = (progress) => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send("scan:progress", progress);
        }
      };

      this.mediaScanner.on("progress", progressListener);

      try {
        // 设置扫描器模式
        this.mediaScanner.setMode(mode);
        this.mediaScanner.setFastMode(!!fast);
        const results = await this.mediaService.scan(sourceDir, targetDir, overwrite);

        // 兼容：mediaScanner可能返回{ files, uploadCount, overwriteCount, skipCount }
        const safeStats = results.stats || {
          total: Array.isArray(results.files) ? results.files.length : 0,
          upload: results.uploadCount || 0,
          overwrite: results.overwriteCount || 0,
          skip: results.skipCount || 0,
        };

        return {
          success: true,
          data: {
            files: results.files,
            stats: safeStats,
          },
        };
      } catch (error) {
        console.error("!!!!!!!!!!!!!!!!!! IPC media:scan FAILED !!!!!!!!!!!!!!!!!!");
        console.error("Caught error object type:", typeof error);
        console.error("Caught error object:", error);
        console.error("Error message:", error ? error.message : "N/A");
        console.error("Error stack:", error ? error.stack : "N/A");
        console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        const errorMessage = error ? error.message || String(error) : "An undefined error occurred";
        return {
          success: false,
          error: `扫描出错: ${errorMessage}`,
          data: {
            files: [],
            stats: { total: 0, upload: 0, overwrite: 0, skip: 0 },
          },
        };
      } finally {
        this.mediaScanner.removeListener("progress", progressListener);
      }
    });

    ipcMain.handle("media:upload", async (event, files, targetDir, overwrite) => {
      try {
        const result = await this.mediaService.upload(files, targetDir, overwrite);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("upload:pause", async () => {
      this.mediaService.pauseUpload();
      return true;
    });

    ipcMain.handle("upload:resume", async () => {
      this.mediaService.resumeUpload();
      return true;
    });

    ipcMain.handle("upload:cancel", async () => {
      this.mediaService.cancelUpload();
      return true;
    });

    ipcMain.handle("system:openPath", async (event, filePath) => {
      await shell.openPath(filePath);
    });

    ipcMain.handle("system:showInFolder", async (event, filePath) => {
      shell.showItemInFolder(filePath);
    });
  }

  async ensureConfigFileExists() {
    return await this.configManager.ensureConfigFileExists();
  }

  async initialize() {
    // 确保 Electron 已就绪后再创建窗口
    if (!app.isReady()) {
      await app.whenReady();
    }
    // 先注册 IPC 处理器，确保渲染进程早期的调用（如 config:load）有处理器可用
    this.setupIpcHandlers();
    await this.ensureConfigFileExists();
    await this.createWindow();
  }
}

const masCopyApp = new MasCopyApp();
// 使用 Electron 官方推荐的 whenReady 模式，避免在 app 未就绪前创建窗口
if (app.isReady()) {
  masCopyApp.initialize().catch(console.error);
} else {
  app.whenReady().then(() => masCopyApp.initialize()).catch(console.error);
}

module.exports = masCopyApp;
