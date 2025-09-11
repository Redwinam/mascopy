class MasCopierUI {
  constructor() {
    console.log("MasCopierUI: constructor start");
    this.elements = {};
    this.config = {};
    this.scanResult = null;
    this.isPaused = false;
    this.currentFilter = "all"; // 添加当前筛选状态
    this.currentMode = "sd"; // 添加当前模式状态

    this.init();
    console.log("MasCopierUI: constructor end");
  }

  init() {
    this.selectDOMElements();
    // 初始化渲染器以承载UI渲染相关职责
    if (window.UIRenderer) {
      this.renderer = new window.UIRenderer(this);
    }
    this.loadConfig();
    this.setupEventListeners();
    this.setupIpcListeners();

    // 初始化tab控件显示状态
    this.switchTab("results");
  }

  selectDOMElements() {
    this.elements = {
      // SD模式元素
      sourcePath: document.getElementById("sourcePath"),
      targetPath: document.getElementById("targetPath"),
      selectSourceBtn: document.getElementById("selectSourceBtn"),
      selectTargetBtn: document.getElementById("selectTargetBtn"),

      // DJI模式元素
      djiSourcePath: document.getElementById("djiSourcePath"),
      djiTargetPath: document.getElementById("djiTargetPath"),
      selectDjiSourceBtn: document.getElementById("selectDjiSourceBtn"),
      selectDjiTargetBtn: document.getElementById("selectDjiTargetBtn"),

      overwriteCheck: document.getElementById("overwriteCheck"),
      fastScanCheck: document.getElementById("fastScanCheck"),
      scanBtn: document.getElementById("scanBtn"),
      startBtn: document.getElementById("startBtn"),
      pauseBtn: document.getElementById("pauseBtn"),
      cancelBtn: document.getElementById("cancelBtn"),
      progressSection: document.getElementById("progressSection"),
      uploadProgressSection: document.getElementById("uploadProgressSection"),
      overallProgressContainer: document.getElementById("overallProgressContainer"),
      progressFill: document.getElementById("progressFill"),
      progressText: document.getElementById("progressText"),
      currentFileProgressContainer: document.getElementById("currentFileProgressContainer"),
      currentFileProgressFill: document.getElementById("currentFileProgressFill"),
      currentFileProgressText: document.getElementById("currentFileProgressText"),
      currentFileName: document.getElementById("currentFileName"),
      logContainer: document.getElementById("logContainer"),
      clearLogBtn: document.getElementById("clearLogBtn"),

      // Scan progress elements (in-page)
      scanProgressContainer: document.getElementById("scanProgressContainer"),
      scanProgressLabel: document.getElementById("scanProgressLabel"),
      scanProgressFill: document.getElementById("scanProgressFill"),
      scanProgressText: document.getElementById("scanProgressText"),
      scanFileName: document.getElementById("scanFileName"),

      // Tab elements (results/logs in info-section only)
      resultsTabButtons: document.querySelectorAll(".info-section .tab-buttons .tab-btn"),
      resultsTabContents: document.querySelectorAll(".info-section .tab-content"),
      resultsTab: document.getElementById("resultsTab"),
      logsTab: document.getElementById("logsTab"),
      resultsPlaceholder: document.querySelector(".results-placeholder"),
      resultsContent: document.querySelector(".results-content"),

      // Result elements (now in-page)
      statsFilterGrid: document.getElementById("statsFilterGrid"),
      fileList: document.getElementById("fileList"),

      // 模式tab元素
      modeTabButtons: document.querySelectorAll('.tab-btn[data-tab="sdMode"], .tab-btn[data-tab="djiMode"]'),
      sdModeTab: document.getElementById("sdModeTab"),
      djiModeTab: document.getElementById("djiModeTab"),
    };
  }

  async loadConfig() {
    console.log("MasCopierUI: loadConfig start");
    this.config = await window.electronAPI.config.load();

    // 迁移旧版全局配置到 sdMode（一次性）
    let migrated = false;
    if (!this.config.sdMode) {
      this.config.sdMode = { sourceDir: "", targetDir: "", overwriteDuplicates: false, fastScan: false };
      migrated = true;
    }
    if (!this.config.djiMode) {
      this.config.djiMode = { sourceDir: "", targetDir: "", overwriteDuplicates: false, fastScan: false };
      migrated = true;
    }
    if (!this.config.sdMode.sourceDir && (this.config.sourceDir || this.config.targetDir || typeof this.config.overwriteDuplicates === "boolean")) {
      this.config.sdMode.sourceDir = this.config.sourceDir || "";
      this.config.sdMode.targetDir = this.config.targetDir || "";
      this.config.sdMode.overwriteDuplicates = !!this.config.overwriteDuplicates;
      if (typeof this.config.fastScan === "boolean") this.config.sdMode.fastScan = !!this.config.fastScan;
      migrated = true;
    }
    if (!this.config.currentMode) {
      this.config.currentMode = "sd";
      migrated = true;
    }
    if (migrated) {
      await this.saveConfig();
    }

    // 设置当前模式
    this.currentMode = this.config.currentMode || "sd";

    // 更新UI显示
    this.updateModeUI();
    this.updateActionButtons();
    console.log("MasCopierUI: loadConfig end");
  }

  updateModeUI() {
    // 更新模式tab显示
    this.elements.modeTabButtons.forEach((btn) => {
      const tabMode = btn.getAttribute("data-tab");
      if ((tabMode === "sdMode" && this.currentMode === "sd") || (tabMode === "djiMode" && this.currentMode === "dji")) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // 显示/隐藏对应的配置区域
    if (this.currentMode === "sd") {
      this.elements.sdModeTab.classList.add("active");
      this.elements.djiModeTab.classList.remove("active");
    } else {
      this.elements.sdModeTab.classList.remove("active");
      this.elements.djiModeTab.classList.add("active");
    }

    // 更新路径显示
    const modeConfig = this.config[this.currentMode + "Mode"] || {};

    if (this.currentMode === "sd") {
      this.elements.sourcePath.textContent = modeConfig.sourceDir || "未选择";
      this.elements.targetPath.textContent = modeConfig.targetDir || "未选择";
    } else {
      this.elements.djiSourcePath.textContent = modeConfig.sourceDir || "未选择";
      this.elements.djiTargetPath.textContent = modeConfig.targetDir || "未选择";
    }

    this.elements.overwriteCheck.checked = modeConfig.overwriteDuplicates || false;
    if (this.elements.fastScanCheck) {
      this.elements.fastScanCheck.checked = !!modeConfig.fastScan;
    }
  }

  async saveConfig() {
    await window.electronAPI.config.save(this.config);
  }

  setupEventListeners() {
    console.log("MasCopierUI: setupEventListeners start");

    // SD模式按钮
    this.elements.selectSourceBtn.addEventListener("click", () => this.selectFolder("source"));
    this.elements.selectTargetBtn.addEventListener("click", () => this.selectFolder("target"));

    // DJI模式按钮
    this.elements.selectDjiSourceBtn.addEventListener("click", () => this.selectFolder("djiSource"));
    this.elements.selectDjiTargetBtn.addEventListener("click", () => this.selectFolder("djiTarget"));

    this.elements.overwriteCheck.addEventListener("change", (e) => {
      const modeConfig = this.config[this.currentMode + "Mode"] || {};
      modeConfig.overwriteDuplicates = e.target.checked;
      this.config[this.currentMode + "Mode"] = modeConfig;
      this.saveConfig();
    });

    if (this.elements.fastScanCheck) {
      this.elements.fastScanCheck.addEventListener("change", (e) => {
        const modeConfig = this.config[this.currentMode + "Mode"] || {};
        modeConfig.fastScan = !!e.target.checked;
        this.config[this.currentMode + "Mode"] = modeConfig;
        this.saveConfig();
      });
    }

    this.elements.scanBtn.addEventListener("click", () => this.startScan());
    this.elements.startBtn.addEventListener("click", () => this.startUpload());
    this.elements.pauseBtn.addEventListener("click", () => this.togglePause());
    this.elements.cancelBtn.addEventListener("click", () => this.cancelUpload());

    this.elements.clearLogBtn.addEventListener("click", () => this.clearLogs());

    // Tab switching for results/logs
    this.elements.resultsTabButtons.forEach((button) => {
      const tab = button.getAttribute("data-tab");
      if (tab === "results" || tab === "logs") {
        button.addEventListener("click", () => {
          this.switchTab(tab);
        });
      }
    });

    // Mode tab switching
    this.elements.modeTabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const tabMode = button.getAttribute("data-tab");
        if (tabMode === "sdMode") {
          this.switchMode("sd");
        } else if (tabMode === "djiMode") {
          this.switchMode("dji");
        }
      });
    });

    console.log("MasCopierUI: setupEventListeners end");
  }

  switchMode(mode) {
    if (this.currentMode === mode) return;

    this.currentMode = mode;
    this.config.currentMode = mode;

    // 保存配置并更新UI
    this.saveConfig();
    this.updateModeUI();
    this.updateActionButtons();

    // 清空之前的扫描结果，因为模式改变了
    this.scanResult = null;
    this.renderResults();

    console.log(`Switched to ${mode} mode`);
  }

  setupIpcListeners() {
    window.electronAPI.on("scan:progress", (progress) => {
      if (!progress) return;

      if (progress.phase === "collecting") {
        this.elements.scanProgressLabel.textContent = "正在收集文件列表...";
        this.elements.scanFileName.textContent = progress.message || "";
        this.elements.scanProgressFill.style.width = "100%";
        this.elements.scanProgressFill.classList.add("indeterminate");
        this.elements.scanProgressText.textContent = "...";
      } else {
        this.elements.scanProgressFill.classList.remove("indeterminate");
        const percentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
        const message = progress.phase === "analyzing" ? "正在分析文件..." : "正在扫描文件...";

        this.elements.scanProgressLabel.textContent = `${message} (${progress.current}/${progress.total})`;
        this.elements.scanFileName.textContent = progress.message || "";
        this.elements.scanProgressFill.style.width = `${percentage}%`;
        this.elements.scanProgressText.textContent = `${Math.round(percentage)}%`;
      }
    });

    window.electronAPI.on("upload:progress", (progress) => {
      const percentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
      this.elements.progressFill.style.width = `${percentage}%`;
      this.elements.progressText.textContent = `${Math.round(percentage)}%`;
      this.log("info", `总进度: ${progress.current}/${progress.total}`);
    });

    window.electronAPI.on("upload:fileProcessed", (result) => {
      this.updateFileStatusInUI(result.file, result.success, result.message);
    });

    window.electronAPI.on("upload:file-start", ({ file }) => {
      this.log("info", `开始复制: ${file.filename}`);

      // 更新当前文件名
      this.elements.currentFileName.textContent = file.filename || "未知文件";

      // 重置当前文件进度
      this.elements.currentFileProgressFill.style.width = "0%";
      this.elements.currentFileProgressText.textContent = "0%";

      // 设置文件为上传中状态
      this.setFileUploading(file);
    });

    window.electronAPI.on("upload:file-progress", (progress) => {
      if (progress.current !== undefined && progress.total !== undefined) {
        const percentage = Math.round((progress.current / progress.total) * 100);

        // 更新当前文件进度条
        this.elements.currentFileProgressFill.style.width = `${percentage}%`;
        this.elements.currentFileProgressText.textContent = `${percentage}%`;

        // 更新当前文件名（如果有变化）
        if (progress.file && progress.file.filename !== this.elements.currentFileName.textContent) {
          this.elements.currentFileName.textContent = progress.file.filename;
        }
      }

      const fileRow = document.querySelector(`[data-file-path="${progress.file.filePath}"]`);
      if (fileRow) {
        const progressBar = fileRow.querySelector(".file-progress-bar");
        const progressFill = fileRow.querySelector(".file-progress-fill");
        const progressText = fileRow.querySelector(".file-progress-text");

        if (progressBar) {
          progressBar.style.display = "flex";
          if (progressFill) {
            progressFill.style.width = `${progress.percentage}%`;
          }
          if (progressText) {
            progressText.textContent = `${progress.percentage}%`;
          }
        }
      }
    });
  }

  async selectFolder(type) {
    const isDji = type.startsWith("dji");
    const isSource = type.includes("Source") || type === "source";
    const modeKey = isDji ? "djiMode" : "sdMode";
    const modeConfig = this.config[modeKey] || {};

    const options = {
      title: isSource ? (isDji ? "选择DJI源文件夹" : "选择源文件夹") : "选择目标文件夹",
      defaultPath: isSource ? modeConfig.sourceDir || "" : modeConfig.targetDir || "",
    };
    const result = await window.electronAPI.dialog.selectFolder(options);
    if (result.canceled || result.filePaths.length === 0) return;

    const path = result.filePaths[0];
    if (isSource) {
      modeConfig.sourceDir = path;
      if (isDji) {
        this.elements.djiSourcePath.textContent = path;
      } else {
        this.elements.sourcePath.textContent = path;
      }
    } else {
      modeConfig.targetDir = path;
      if (isDji) {
        this.elements.djiTargetPath.textContent = path;
      } else {
        this.elements.targetPath.textContent = path;
      }
    }

    this.config[modeKey] = modeConfig;
    this.saveConfig();
    this.updateActionButtons();
  }

  updateActionButtons() {
    const modeConfig = this.config[this.currentMode + "Mode"] || {};
    const canScan = !!(modeConfig.sourceDir && modeConfig.targetDir);
    this.elements.scanBtn.disabled = !canScan;

    let filesToUpload = 0;
    if (this.scanResult && this.scanResult.files) {
      filesToUpload = this.scanResult.files.filter((f) => f.status === "将上传" || f.status === "将覆盖").length;
    }
    this.elements.startBtn.disabled = filesToUpload === 0;
  }

  async startScan() {
    this.log("info", "开始预扫描...");
    this.elements.uploadProgressSection.style.display = "none";
    this.showScanProgress();
    try {
      const modeKey = this.currentMode + "Mode";
      const modeConfig = this.config[modeKey] || {};
      const sourceDir = modeConfig.sourceDir;
      const targetDir = modeConfig.targetDir;
      const overwriteFlag = !!modeConfig.overwriteDuplicates;
      // 优先使用复选框的状态，避免UI未同步导致的误判
      const fastFromUI = this.elements.fastScanCheck ? !!this.elements.fastScanCheck.checked : undefined;
      const fast = typeof fastFromUI === "boolean" ? fastFromUI : !!modeConfig.fastScan;
      // 将最终使用的值写回配置，保持一致
      modeConfig.fastScan = fast;
      this.config[modeKey] = modeConfig;
      this.saveConfig();
      this.log("info", `快速扫描：${fast ? "已开启" : "已关闭"}`);

      const result = await window.electronAPI.media.scan(sourceDir, targetDir, overwriteFlag, this.currentMode, fast);
      this.hideScanProgress();

      if (result.success && result.data) {
        this.scanResult = result.data;
        const files = Array.isArray(this.scanResult.files) ? this.scanResult.files : [];
        const safeStats = this.scanResult.stats || {
          total: files.length,
          upload: files.filter(f => f.status === '将上传').length,
          overwrite: files.filter(f => f.status === '将覆盖').length,
          skip: files.filter(f => f.status === '将跳过').length,
        };
        this.scanResult.stats = safeStats;

        const { total, upload, overwrite: overwriteCount, skip } = this.scanResult.stats;
        this.renderer && this.renderer.renderResults && this.renderer.renderResults();
        this.log("success", `扫描完成: 发现 ${total || 0} 个文件, ${upload || 0} 个待上传, ${overwriteCount || 0} 个待覆盖, ${skip || 0} 个将跳过.`);
        this.renderResults();
        this.switchTab("results");
        this.updateActionButtons();
      } else {
        this.log("error", `扫描出错: ${result.error}`);
        // 可在此显示更明确的错误提示
      }
    } catch (error) {
      this.hideScanProgress();
      console.error("Full error object received in renderer:", error);
      this.log("error", `扫描时发生未知错误: ${error.message || JSON.stringify(error)}`);
    }
  }

  cancelScan() {
    // In a real scenario, you'd call an API to stop the backend process.
    // window.electronAPI.media.cancelScan();
    this.hideScanProgress();
    this.log("warn", "扫描已取消");
  }

  async startUpload() {
    if (!this.scanResult) {
      this.log("error", "请先执行预扫描");
      return;
    }
    const filesToUpload = this.scanResult.files.filter((f) => f.status === "将上传" || f.status === "将覆盖");
    if (filesToUpload.length === 0) {
      this.log("info", "没有需要上传的文件。");
      return;
    }
    this.log("info", "开始上传...");
    this.isPaused = false;
    this.elements.startBtn.disabled = true;
    this.elements.scanBtn.disabled = true;
    this.elements.pauseBtn.disabled = false;
    this.elements.cancelBtn.disabled = false;

    // Show progress section and upload progress section
    this.showProgressSection();
    this.elements.uploadProgressSection.style.display = "flex";

    try {
      const modeConfig = this.config[this.currentMode + "Mode"] || {};
      const targetDir = modeConfig.targetDir;
      const overwrite = !!modeConfig.overwriteDuplicates;
      const result = await window.electronAPI.media.upload(filesToUpload, targetDir, overwrite);
      if (result.success) {
        this.log("success", "所有文件处理完毕!");
      } else {
        this.log("error", `上传出错: ${result.error}`);
      }
    } catch (error) {
      this.log("error", `上传时发生未知错误: ${error.message}`);
    } finally {
      this.resetUploadState();
    }
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      window.electronAPI.upload.pause();
      this.elements.pauseBtn.textContent = "继续";
      this.log("info", "上传已暂停");
    } else {
      window.electronAPI.upload.resume();
      this.elements.pauseBtn.textContent = "暂停";
      this.log("info", "上传已恢复");
    }
  }

  cancelUpload() {
    window.electronAPI.upload.cancel();
    this.log("warn", "上传已取消");
    this.resetUploadState();
  }

  resetUploadState() {
    this.isPaused = false;
    this.elements.startBtn.disabled = false;
    this.elements.scanBtn.disabled = false;
    this.elements.pauseBtn.disabled = true;
    this.elements.pauseBtn.textContent = "暂停";
    this.elements.cancelBtn.disabled = true;
    this.elements.progressFill.style.width = "0%";
    this.elements.progressText.textContent = "0%";

    // 隐藏上传进度区域
    this.elements.uploadProgressSection.style.display = "none";

    // Hide progress section after a delay
    setTimeout(() => {
      this.hideProgressSection();
    }, 3000);
  }

  log(type, message) {
    const logPlaceholder = this.elements.logContainer.querySelector(".log-placeholder");
    if (logPlaceholder) {
      logPlaceholder.remove();
    }

    const logEntry = document.createElement("div");
    logEntry.className = `log-entry log-${type}`;

    const timestamp = new Date().toLocaleTimeString();
    logEntry.innerHTML = `<span class="log-timestamp">${timestamp}</span><span class="log-message">${message}</span>`;

    this.elements.logContainer.appendChild(logEntry);
    this.elements.logContainer.scrollTop = this.elements.logContainer.scrollHeight;
  }

  clearLogs() {
    this.elements.logContainer.innerHTML = '<div class="log-placeholder">日志已清空</div>';
  }

  showScanProgress() {
    this.elements.scanProgressContainer.style.display = "flex";
    this.showProgressSection(); // Make sure the parent section is visible
  }

  hideScanProgress() {
    this.elements.scanProgressContainer.style.display = "none";
    // We don't hide the whole progress section if an upload might be in progress
    if (this.elements.uploadProgressSection.style.display === "none") {
      this.hideProgressSection();
    }
  }

  renderResults() {
    if (this.renderer) return this.renderer.renderResults();
    // 兼容：若渲染器未初始化，保留原有行为（最小实现）
    if (!this.scanResult) {
      this.elements.resultsPlaceholder.style.display = "flex";
      this.elements.resultsContent.style.display = "none";
      return;
    }
    this.elements.resultsPlaceholder.style.display = "none";
    this.elements.resultsContent.style.display = "block";
    this.renderStats();
    this.renderFileList();
  }

  renderStats() {
    if (this.renderer) return this.renderer.renderStats();
  }

  setFilter(filter) {
    if (this.renderer) return this.renderer.setFilter(filter);
    this.currentFilter = filter;
    this.renderFileList();
  }

  updateStats() {
    if (this.renderer) return this.renderer.updateStats();
  }

  renderFileList() {
    if (this.renderer) return this.renderer.renderFileList();
  }

  updateFileStatusInUI(file, success, message) {
    if (this.renderer) return this.renderer.updateFileStatusInUI(file, success, message);
  }

  getStatusClass(status) {
    if (this.renderer && this.renderer.getStatusClass) return this.renderer.getStatusClass(status);
    return "unknown";
  }

  setFileUploading(file) {
    if (this.renderer) return this.renderer.setFileUploading(file);
  }

  showProgressSection() {
    if (this.renderer && this.renderer.showProgressSection) return this.renderer.showProgressSection();
    if (this.elements.progressSection) {
      this.elements.progressSection.style.display = "flex";
    }
  }

  hideProgressSection() {
    if (this.renderer && this.renderer.hideProgressSection) return this.renderer.hideProgressSection();
    const scanVisible = this.elements.scanProgressContainer.style.display !== "none";
    const uploadVisible = this.elements.overallProgressContainer.style.display !== "none";
    if (this.elements.progressSection && !scanVisible && !uploadVisible) {
      this.elements.progressSection.style.display = "none";
    }
  }

  showScanProgress() {
    if (this.renderer && this.renderer.showScanProgress) return this.renderer.showScanProgress();
    this.elements.scanProgressContainer.style.display = "flex";
    this.showProgressSection();
  }

  hideScanProgress() {
    if (this.renderer && this.renderer.hideScanProgress) return this.renderer.hideScanProgress();
    this.elements.scanProgressContainer.style.display = "none";
    if (this.elements.uploadProgressSection.style.display === "none") {
      this.hideProgressSection();
    }
  }

  switchTab(tabId) {
    if (this.renderer && this.renderer.switchTab) return this.renderer.switchTab(tabId);
    // 仅切换信息区域（扫描结果/日志）的tab，不影响模式配置区域
    this.elements.resultsTabContents.forEach((content) => {
      content.classList.remove("active");
    });
    this.elements.resultsTabButtons.forEach((button) => {
      button.classList.remove("active");
    });

    document.getElementById(tabId + "Tab").classList.add("active");
    document.querySelector(`.info-section .tab-buttons .tab-btn[data-tab="${tabId}"]`).classList.add("active");

    const statsFilterGrid = document.getElementById("statsFilterGrid");
    const clearLogBtn = document.getElementById("clearLogBtn");

    if (tabId === "results") {
      if (statsFilterGrid) statsFilterGrid.style.display = "flex";
      if (clearLogBtn) clearLogBtn.style.display = "none";
    } else if (tabId === "logs") {
      if (statsFilterGrid) statsFilterGrid.style.display = "none";
      if (clearLogBtn) clearLogBtn.style.display = "flex";
    }
  }

  log(type, message) {
    if (this.renderer && this.renderer.log) return this.renderer.log(type, message);
    const logPlaceholder = this.elements.logContainer.querySelector(".log-placeholder");
    if (logPlaceholder) {
      logPlaceholder.remove();
    }
    const logEntry = document.createElement("div");
    logEntry.className = `log-entry log-${type}`;
    const timestamp = new Date().toLocaleTimeString();
    logEntry.innerHTML = `<span class="log-timestamp">${timestamp}</span><span class="log-message">${message}</span>`;
    this.elements.logContainer.appendChild(logEntry);
    this.elements.logContainer.scrollTop = this.elements.logContainer.scrollHeight;
  }

  clearLogs() {
    if (this.renderer && this.renderer.clearLogs) return this.renderer.clearLogs();
    this.elements.logContainer.innerHTML = '<div class="log-placeholder">日志已清空</div>';
  }

  showProgressSection() {
    if (this.elements.progressSection) {
      this.elements.progressSection.style.display = "flex";
    }
  }

  hideProgressSection() {
    // Hide the section only if both scan and upload are not in progress
    const scanVisible = this.elements.scanProgressContainer.style.display !== "none";
    const uploadVisible = this.elements.overallProgressContainer.style.display !== "none";
    if (this.elements.progressSection && !scanVisible && !uploadVisible) {
      this.elements.progressSection.style.display = "none";
    }
  }

  switchTab(tabId) {
    // 仅切换信息区域（扫描结果/日志）的tab，不影响模式配置区域
    this.elements.resultsTabContents.forEach((content) => {
      content.classList.remove("active");
    });
    this.elements.resultsTabButtons.forEach((button) => {
      button.classList.remove("active");
    });

    document.getElementById(tabId + "Tab").classList.add("active");
    document.querySelector(`.info-section .tab-buttons .tab-btn[data-tab="${tabId}"]`).classList.add("active");

    // 控制右侧按钮的显示
    const statsFilterGrid = document.getElementById("statsFilterGrid");
    const clearLogBtn = document.getElementById("clearLogBtn");

    if (tabId === "results") {
      // 显示筛选器，隐藏清空按钮
      if (statsFilterGrid) statsFilterGrid.style.display = "flex";
      if (clearLogBtn) clearLogBtn.style.display = "none";
    } else if (tabId === "logs") {
      // 隐藏筛选器，显示清空按钮
      if (statsFilterGrid) statsFilterGrid.style.display = "none";
      if (clearLogBtn) clearLogBtn.style.display = "flex";
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    new MasCopierUI();
  } catch (error) {
    console.error("Failed to initialize MasCopierUI:", error);
  }
});
