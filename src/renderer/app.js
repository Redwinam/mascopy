class MasCopierUI {
  constructor() {
    console.log("MasCopierUI: constructor start");
    this.elements = {};
    this.config = {};
    this.scanResult = null;
    this.isPaused = false;

    this.init();
    console.log("MasCopierUI: constructor end");
  }

  init() {
    this.selectDOMElements();
    this.loadConfig();
    this.setupEventListeners();
    this.setupIpcListeners();
  }

  selectDOMElements() {
    this.elements = {
      sourcePath: document.getElementById("sourcePath"),
      targetPath: document.getElementById("targetPath"),
      selectSourceBtn: document.getElementById("selectSourceBtn"),
      selectTargetBtn: document.getElementById("selectTargetBtn"),
      overwriteCheck: document.getElementById("overwriteCheck"),
      scanBtn: document.getElementById("scanBtn"),
      startBtn: document.getElementById("startBtn"),
      pauseBtn: document.getElementById("pauseBtn"),
      cancelBtn: document.getElementById("cancelBtn"),
      progressSection: document.getElementById("progressSection"),
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

      // Tab elements
      tabButtons: document.querySelectorAll(".tab-btn"),
      tabContents: document.querySelectorAll(".tab-content"),
      resultsTab: document.getElementById("resultsTab"),
      logsTab: document.getElementById("logsTab"),
      resultsPlaceholder: document.querySelector(".results-placeholder"),
      resultsContent: document.querySelector(".results-content"),

      // Result elements (now in-page)
      statsGrid: document.getElementById("statsGrid"),
      fileList: document.getElementById("fileList"),
      statusFilter: document.getElementById("statusFilter"),
    };
  }

  async loadConfig() {
    console.log("MasCopierUI: loadConfig start");
    this.config = await window.electronAPI.config.load();
    this.elements.sourcePath.textContent = this.config.sourceDir || "未选择";
    this.elements.targetPath.textContent = this.config.targetDir || "未选择";
    this.elements.overwriteCheck.checked = this.config.overwrite || false;
    this.updateActionButtons();
    console.log("MasCopierUI: loadConfig end");
  }

  async saveConfig() {
    await window.electronAPI.config.save(this.config);
  }

  setupEventListeners() {
    console.log("MasCopierUI: setupEventListeners start");
    this.elements.selectSourceBtn.addEventListener("click", () => this.selectFolder("source"));
    this.elements.selectTargetBtn.addEventListener("click", () => this.selectFolder("target"));
    this.elements.overwriteCheck.addEventListener("change", (e) => {
      this.config.overwrite = e.target.checked;
      this.saveConfig();
    });

    this.elements.scanBtn.addEventListener("click", () => this.startScan());
    this.elements.startBtn.addEventListener("click", () => this.startUpload());
    this.elements.pauseBtn.addEventListener("click", () => this.togglePause());
    this.elements.cancelBtn.addEventListener("click", () => this.cancelUpload());

    this.elements.clearLogBtn.addEventListener("click", () => this.clearLogs());

    // Tab switching
    this.elements.tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tab = button.getAttribute('data-tab');
            this.switchTab(tab);
        });
    });



    this.elements.statusFilter.addEventListener("change", () => this.renderFileList());
    console.log("MasCopierUI: setupEventListeners end");
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

      // 如果上传完成，隐藏当前文件进度条
      if (percentage >= 100) {
        setTimeout(() => {
          this.elements.currentFileProgressContainer.style.display = "none";
        }, 2000); // 2秒后隐藏
      }
    });

    window.electronAPI.on("upload:fileProcessed", (result) => {
      this.updateFileStatusInUI(result.file, result.success, result.message);
    });

    window.electronAPI.on("upload:file-start", ({ file }) => {
      this.log("info", `开始复制: ${file.filename}`);

      // 显示当前文件进度条
      this.elements.currentFileProgressContainer.style.display = "flex";

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
    const options = {
      title: type === "source" ? "选择源文件夹" : "选择目标文件夹",
      defaultPath: type === "source" ? this.config.sourceDir : this.config.targetDir,
    };
    const result = await window.electronAPI.dialog.selectFolder(options);
    if (result.canceled || result.filePaths.length === 0) return;

    const path = result.filePaths[0];
    if (type === "source") {
      this.config.sourceDir = path;
      this.elements.sourcePath.textContent = path;
    } else {
      this.config.targetDir = path;
      this.elements.targetPath.textContent = path;
    }
    this.saveConfig();
    this.updateActionButtons();
  }

  updateActionButtons() {
    const canScan = this.config.sourceDir && this.config.targetDir;
    this.elements.scanBtn.disabled = !canScan;

    let filesToUpload = 0;
    if (this.scanResult && this.scanResult.files) {
      filesToUpload = this.scanResult.files.filter((f) => f.status === "将上传" || f.status === "将覆盖").length;
    }
    this.elements.startBtn.disabled = filesToUpload === 0;
  }

  async startScan() {
    this.log("info", "开始预扫描...");
    this.elements.overallProgressContainer.style.display = 'none';
    this.showScanProgress();
    try {
      const { sourceDir, targetDir } = this.config;
      const overwrite = !!this.config.overwrite;
      const result = await window.electronAPI.media.scan(sourceDir, targetDir, overwrite);

      this.hideScanProgress();

      if (result.success && result.data) {
        this.scanResult = result.data;
        const { total, upload, overwrite, skip } = result.data.stats;
        this.log("success", `扫描完成: 发现 ${total || 0} 个文件, ${upload || 0} 个待上传, ${overwrite || 0} 个待覆盖, ${skip || 0} 个将跳过.`);
        this.renderResults();
        this.switchTab('results');
        this.updateActionButtons();
      } else {
        this.log("error", `扫描出错: ${result.error}`);
        // Optionally show error in a more prominent way
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

    // Show progress section
    this.showProgressSection();

    try {
      const { targetDir, overwrite } = this.config;
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

    // 隐藏当前文件进度条
    this.elements.currentFileProgressContainer.style.display = "none";

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
    if (this.elements.overallProgressContainer.style.display === 'none') {
        this.hideProgressSection();
    }
  }

  renderResults() {
    if (!this.scanResult) {
        this.elements.resultsPlaceholder.style.display = 'block';
        this.elements.resultsContent.style.display = 'none';
        return;
    }
    this.elements.resultsPlaceholder.style.display = 'none';
    this.elements.resultsContent.style.display = 'block';
    this.renderStats();
    this.renderFileList();
  }

  renderStats() {
    if (!this.scanResult || !this.scanResult.stats) return;
    const { upload, overwrite, skip, total } = this.scanResult.stats;
    const stats = [
      { label: "待上传", value: upload || 0, color: "blue" },
      { label: "待覆盖", value: overwrite || 0, color: "orange" },
      { label: "将跳过", value: skip || 0, color: "gray" },
      { label: "总计", value: total || 0, color: "green" },
    ];

    this.elements.statsGrid.innerHTML = stats
      .map(
        (stat) => `
            <div class="stat-card stat-card-${stat.color}">
                <div class="stat-value">${stat.value}</div>
                <div class="stat-label">${stat.label}</div>
            </div>
        `
      )
      .join("");
  }

  updateStats() {
    if (!this.scanResults || !this.scanResults.files) return;

    const stats = {
      total: this.scanResults.files.length,
      upload: 0,
      overwrite: 0,
      skip: 0,
      uploading: 0,
      success: 0,
      error: 0
    };

    this.scanResults.files.forEach(file => {
      switch (file.status) {
        case "将上传":
          stats.upload++;
          break;
        case "将覆盖":
          stats.overwrite++;
          break;
        case "将跳过":
          stats.skip++;
          break;
        case "上传中":
          stats.uploading++;
          break;
        case "已完成":
          stats.success++;
          break;
        case "失败":
          stats.error++;
          break;
      }
    });

    // 更新统计卡片
    const totalCard = document.querySelector('.stat-card.blue .stat-value');
    const uploadCard = document.querySelector('.stat-card.orange .stat-value');
    const skipCard = document.querySelector('.stat-card.gray .stat-value');
    const successCard = document.querySelector('.stat-card.green .stat-value');

    if (totalCard) totalCard.textContent = stats.total;
    if (uploadCard) uploadCard.textContent = stats.upload + stats.overwrite + stats.uploading;
    if (skipCard) skipCard.textContent = stats.skip;
    if (successCard) successCard.textContent = stats.success;
  }

  renderFileList() {
    const filter = this.elements.statusFilter.value;
    let filesToRender = [];

    if (!this.scanResult || !this.scanResult.files) {
      this.elements.fileList.innerHTML = '<div class="file-list-empty">没有文件可显示</div>';
      return;
    }

    const allFiles = this.scanResult.files;

    if (filter === "all") {
      filesToRender = allFiles;
    } else {
      filesToRender = allFiles.filter((f) => f.status === filter);
    }

    if (filesToRender.length === 0) {
      this.elements.fileList.innerHTML = '<div class="file-list-empty">没有符合条件的文件</div>';
      return;
    }

    const sourceDir = this.config.sourceDir || "";

    const fileListContainer = this.elements.fileList;
    fileListContainer.innerHTML = ""; // Clear existing list

    const header = document.createElement("div");
    header.classList.add("file-list-header", "file-list-item");
    header.innerHTML = `
        <div class="file-name">文件名</div>
        <div class="file-path">相对路径</div>
        <div class="file-size">大小</div>
        <div class="file-status">状态</div>
    `;
    fileListContainer.appendChild(header);

    filesToRender.forEach((file) => {
      const fileElement = document.createElement("div");
      fileElement.classList.add("file-list-item");
      fileElement.dataset.filePath = file.filePath;

      const relativePath = sourceDir ? file.filePath.replace(sourceDir, "") : file.filePath;
      const fileSizeMB = (file.fileSize / 1024 / 1024).toFixed(2);
      const statusClass = this.getStatusClass(file.status);

      fileElement.innerHTML = `
            <div class="file-name">${file.filename}</div>
            <div class="file-path">${relativePath}</div>
            <div class="file-size">${fileSizeMB} MB</div>
            <div class="file-status file-status-${statusClass}">${file.status}</div>
        `;
      fileListContainer.appendChild(fileElement);
    });
  }

  updateFileStatusInUI(file, success, message) {
    const fileRow = document.querySelector(`[data-file-path="${file.filePath}"]`);
    if (fileRow) {
      const statusEl = fileRow.querySelector(".file-status");
      if (statusEl) {
        statusEl.textContent = success ? "已完成" : "失败";
        statusEl.classList.remove("file-status-upload", "file-status-overwrite", "file-status-skip", "file-status-uploading");
        statusEl.classList.add(success ? "file-status-success" : "file-status-error");
      }
      
      // 移除上传中的样式
      fileRow.classList.remove("uploading");
      
      const progressEl = fileRow.querySelector(".file-progress-bar");
      if (progressEl) {
        progressEl.style.display = "none";
      }
    }

    // 更新文件状态
    if (this.scanResults && this.scanResults.files) {
      const fileIndex = this.scanResults.files.findIndex(f => f.filePath === file.filePath);
      if (fileIndex !== -1) {
        this.scanResults.files[fileIndex].status = success ? "已完成" : "失败";
      }
    }

    // 更新统计信息
    this.updateStats();
    
    this.log(success ? "success" : "error", `${file.filename}: ${message}`);
  }

  getStatusClass(status) {
    switch (status) {
      case "将上传":
        return "upload";
      case "将覆盖":
        return "overwrite";
      case "将跳过":
        return "skip";
      case "上传中":
        return "uploading";
      case "已完成":
        return "success";
      case "失败":
        return "error";
      default:
        return "unknown";
    }
  }

  // 新增方法：设置文件为上传中状态
  setFileUploading(file) {
    const fileRow = document.querySelector(`[data-file-path="${file.filePath}"]`);
    if (fileRow) {
      const statusEl = fileRow.querySelector(".file-status");
      if (statusEl) {
        statusEl.textContent = "上传中";
        statusEl.classList.remove("file-status-upload", "file-status-overwrite", "file-status-skip", "file-status-success", "file-status-error");
        statusEl.classList.add("file-status-uploading");
      }
      fileRow.classList.add("uploading");
    }

    // 更新文件状态
    if (this.scanResults && this.scanResults.files) {
      const fileIndex = this.scanResults.files.findIndex(f => f.filePath === file.filePath);
      if (fileIndex !== -1) {
        this.scanResults.files[fileIndex].status = "上传中";
      }
    }

    // 更新统计信息
    this.updateStats();
  }

  showProgressSection() {
    if (this.elements.progressSection) {
      this.elements.progressSection.style.display = "flex";
    }
  }

  hideProgressSection() {
    // Hide the section only if both scan and upload are not in progress
    const scanVisible = this.elements.scanProgressContainer.style.display !== 'none';
    const uploadVisible = this.elements.overallProgressContainer.style.display !== 'none';
    if (this.elements.progressSection && !scanVisible && !uploadVisible) {
      this.elements.progressSection.style.display = "none";
    }
  }

  switchTab(tabId) {
    this.elements.tabContents.forEach(content => {
        content.classList.remove('active');
    });
    this.elements.tabButtons.forEach(button => {
        button.classList.remove('active');
    });

    document.getElementById(tabId + 'Tab').classList.add('active');
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  }


}

document.addEventListener("DOMContentLoaded", () => {
  try {
    new MasCopierUI();
  } catch (error) {
    console.error("Failed to initialize MasCopierUI:", error);
  }
});
