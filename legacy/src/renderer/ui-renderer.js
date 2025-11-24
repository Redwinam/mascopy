(function() {
  class UIRenderer {
    constructor(ui) {
      this.ui = ui;
    }

    // 统计卡片渲染
    renderStats() {
      const ui = this.ui;
      if (!ui.scanResult || !ui.scanResult.stats) return;
      if (!ui.elements.statsFilterGrid) return;

      const dynamicCounts = this._computeDynamicCounts();
      const baseStats = ui.scanResult.stats || { total: 0, upload: 0, overwrite: 0, skip: 0 };

      const stats = [
        { label: "全部", value: baseStats.total || 0, color: "blue", filter: "all" },
        { label: "待上传", value: baseStats.upload || 0, color: "blue", filter: "将上传" },
        { label: "待覆盖", value: baseStats.overwrite || 0, color: "orange", filter: "将覆盖" },
        { label: "将跳过", value: baseStats.skip || 0, color: "gray", filter: "将跳过" },
        { label: "上传中", value: dynamicCounts.uploading, color: "purple", filter: "上传中" },
        { label: "已完成", value: dynamicCounts.success, color: "green", filter: "已完成" },
        { label: "失败", value: dynamicCounts.error, color: "red", filter: "失败" }
      ];

      ui.elements.statsFilterGrid.innerHTML = stats.map(stat => `
        <div class="stats-filter-card stats-filter-card-${stat.color} ${ui.currentFilter === stat.filter ? "active" : ""}" data-filter="${stat.filter}">
          <div class="stats-filter-value">${stat.value}</div>
          <div class="stats-filter-label">${stat.label}</div>
        </div>
      `).join("");

      ui.elements.statsFilterGrid.querySelectorAll(".stats-filter-card").forEach(card => {
        card.addEventListener("click", () => {
          const filter = card.dataset.filter;
          this.setFilter(filter);
        });
      });

      ui.elements.statsFilterGrid.style.display = "flex";
    }

    _computeDynamicCounts() {
      const ui = this.ui;
      const counts = { uploading: 0, success: 0, error: 0 };
      if (!ui.scanResult || !Array.isArray(ui.scanResult.files)) return counts;
      for (const f of ui.scanResult.files) {
        switch (f.status) {
          case "上传中": counts.uploading++; break;
          case "已完成": counts.success++; break;
          case "失败": counts.error++; break;
          default: break;
        }
      }
      return counts;
    }

    updateStats() {
      const ui = this.ui;
      if (!ui.scanResult || !Array.isArray(ui.scanResult.files)) return;
      const baseStats = {
        total: ui.scanResult.files.length,
        upload: 0,
        overwrite: 0,
        skip: 0
      };
      const dynamicCounts = { uploading: 0, success: 0, error: 0 };

      for (const file of ui.scanResult.files) {
        switch (file.status) {
          case "将上传": baseStats.upload++; break;
          case "将覆盖": baseStats.overwrite++; break;
          case "将跳过": baseStats.skip++; break;
          case "上传中": dynamicCounts.uploading++; break;
          case "已完成": dynamicCounts.success++; break;
          case "失败": dynamicCounts.error++; break;
        }
      }

      const setVal = (selector, val) => {
        const el = document.querySelector(selector);
        if (el) el.textContent = val;
      };

      setVal('.stats-filter-card[data-filter="all"] .stats-filter-value', baseStats.total);
      setVal('.stats-filter-card[data-filter="将上传"] .stats-filter-value', baseStats.upload);
      setVal('.stats-filter-card[data-filter="将覆盖"] .stats-filter-value', baseStats.overwrite);
      setVal('.stats-filter-card[data-filter="将跳过"] .stats-filter-value', baseStats.skip);
      setVal('.stats-filter-card[data-filter="上传中"] .stats-filter-value', dynamicCounts.uploading);
      setVal('.stats-filter-card[data-filter="已完成"] .stats-filter-value', dynamicCounts.success);
      setVal('.stats-filter-card[data-filter="失败"] .stats-filter-value', dynamicCounts.error);
    }

    setFilter(filter) {
      const ui = this.ui;
      ui.currentFilter = filter;
      // 激活状态切换
      if (ui.elements.statsFilterGrid) {
        ui.elements.statsFilterGrid.querySelectorAll('.stats-filter-card').forEach(card => {
          card.classList.toggle('active', card.dataset.filter === filter);
        });
      }
      this.renderFileList();
    }

    renderResults() {
      const ui = this.ui;
      if (!ui.scanResult) {
        ui.elements.resultsPlaceholder.style.display = "flex";
        ui.elements.resultsContent.style.display = "none";
        return;
      }
      ui.elements.resultsPlaceholder.style.display = "none";
      ui.elements.resultsContent.style.display = "block";
      this.renderStats();
      this.renderFileList();
    }

    getStatusClass(status) {
      switch (status) {
        case "将上传": return "upload";
        case "将覆盖": return "overwrite";
        case "将跳过": return "skip";
        case "上传中": return "uploading";
        case "已完成": return "success";
        case "失败": return "error";
        default: return "unknown";
      }
    }

    renderFileList() {
      const ui = this.ui;
      const filter = ui.currentFilter;
      if (!ui.scanResult || !Array.isArray(ui.scanResult.files)) {
        ui.elements.fileList.innerHTML = '<div class="file-list-empty">没有文件可显示</div>';
        return;
      }

      const allFiles = ui.scanResult.files;
      const filesToRender = (filter === 'all') ? allFiles : allFiles.filter(f => f.status === filter);

      if (filesToRender.length === 0) {
        ui.elements.fileList.innerHTML = '<div class="file-list-empty">没有符合条件的文件</div>';
        return;
      }

      const sourceDir = (ui.config[ui.currentMode + 'Mode'] || {}).sourceDir || ui.config.sourceDir || '';
      const targetDir = (ui.config[ui.currentMode + 'Mode'] || {}).targetDir || ui.config.targetDir || '';

      const container = ui.elements.fileList;
      container.innerHTML = '';

      for (const file of filesToRender) {
        const row = document.createElement('div');
        row.className = 'file-list-item';
        row.dataset.filePath = file.filePath;

        // 相对源路径与文件名
        const relativePath = sourceDir ? file.filePath.replace(sourceDir, '') : file.filePath;
        const parts = relativePath.split('/');
        const fileName = parts.pop();
        const dirPath = parts.length > 0 ? parts.join('/') + '/' : '';

        // 目标目录（不含文件名）；若文件名有变化则在目录后追加新文件名
        let targetPathHTML = '';
        if (file.targetPath && targetDir) {
          const relativeTarget = file.targetPath.replace(targetDir, '');
          const tp = relativeTarget.split('/');
          const targetFileName = tp.length > 0 ? tp[tp.length - 1] : '';
          tp.pop();
          const onlyDir = tp.length > 0 ? tp.join('/') + '/' : '/';
          const showNewName = targetFileName && targetFileName !== fileName;
          targetPathHTML = `<span class="path-arrow">→</span><span class="path-directory">${onlyDir}</span>` + (showNewName ? `<span class=\"path-filename\">${targetFileName}</span>` : '');
        } else {
          targetPathHTML = '<span class="path-arrow">→</span><span class="path-directory">未设置</span>';
        }

        const sizeMB = (file.fileSize / 1024 / 1024).toFixed(2);
        const statusClass = this.getStatusClass(file.status);

        row.innerHTML = `
          <div class="file-path-combined">
            <span class="path-directory">${dirPath}</span><span class="path-filename">${fileName}</span>
          </div>
          <div class="file-path-combined">${targetPathHTML}</div>
          <div class="file-size">${sizeMB} MB</div>
          <div class="file-status file-status-${statusClass}">${file.status}</div>
          <div class="file-progress-bar" style="display:none">
            <div class="file-progress-fill" style="width:0%"></div>
            <div class="file-progress-text">0%</div>
          </div>
        `;

        container.appendChild(row);
      }
    }

    setFileUploading(file) {
      const row = document.querySelector(`[data-file-path="${file.filePath}"]`);
      if (row) {
        const statusEl = row.querySelector('.file-status');
        if (statusEl) {
          statusEl.textContent = '上传中';
          statusEl.classList.remove('file-status-upload','file-status-overwrite','file-status-skip','file-status-success','file-status-error');
          statusEl.classList.add('file-status-uploading');
        }
        row.classList.add('uploading');
        const bar = row.querySelector('.file-progress-bar');
        if (bar) bar.style.display = 'flex';
      }
      if (this.ui.scanResult && Array.isArray(this.ui.scanResult.files)) {
        const idx = this.ui.scanResult.files.findIndex(f => f.filePath === file.filePath);
        if (idx !== -1) this.ui.scanResult.files[idx].status = '上传中';
      }
      this.updateStats();
    }

    updateFileStatusInUI(file, success, message) {
      const row = document.querySelector(`[data-file-path="${file.filePath}"]`);
      if (row) {
        const statusEl = row.querySelector('.file-status');
        if (statusEl) {
          statusEl.textContent = success ? '已完成' : '失败';
          statusEl.classList.remove('file-status-upload','file-status-overwrite','file-status-skip','file-status-uploading');
          statusEl.classList.add(success ? 'file-status-success' : 'file-status-error');
        }
        row.classList.remove('uploading');
        const bar = row.querySelector('.file-progress-bar');
        if (bar) bar.style.display = 'none';
      }

      if (this.ui.scanResult && Array.isArray(this.ui.scanResult.files)) {
        const idx = this.ui.scanResult.files.findIndex(f => f.filePath === file.filePath);
        if (idx !== -1) this.ui.scanResult.files[idx].status = success ? '已完成' : '失败';
      }

      this.updateStats();
      this.log(success ? 'success' : 'error', `${file.filename}: ${message}`);
    }

    // 进度区域显示
    showProgressSection() {
      const ui = this.ui;
      if (ui.elements.progressSection) ui.elements.progressSection.style.display = 'flex';
    }
    hideProgressSection() {
      const ui = this.ui;
      const scanVisible = ui.elements.scanProgressContainer.style.display !== 'none';
      const uploadVisible = ui.elements.overallProgressContainer.style.display !== 'none';
      if (ui.elements.progressSection && !scanVisible && !uploadVisible) {
        ui.elements.progressSection.style.display = 'none';
      }
    }
    showScanProgress() {
      const ui = this.ui;
      ui.elements.scanProgressContainer.style.display = 'flex';
      this.showProgressSection();
    }
    hideScanProgress() {
      const ui = this.ui;
      ui.elements.scanProgressContainer.style.display = 'none';
      if (ui.elements.uploadProgressSection.style.display === 'none') {
        this.hideProgressSection();
      }
    }

    // Tab 切换（信息区）
    switchTab(tabId) {
      const ui = this.ui;
      ui.elements.resultsTabContents.forEach((content) => content.classList.remove('active'));
      ui.elements.resultsTabButtons.forEach((button) => button.classList.remove('active'));
      document.getElementById(tabId + 'Tab').classList.add('active');
      const btn = document.querySelector(`.info-section .tab-buttons .tab-btn[data-tab="${tabId}"]`);
      if (btn) btn.classList.add('active');
      const statsFilterGrid = document.getElementById('statsFilterGrid');
      const clearLogBtn = document.getElementById('clearLogBtn');
      if (tabId === 'results') {
        if (statsFilterGrid) statsFilterGrid.style.display = 'flex';
        if (clearLogBtn) clearLogBtn.style.display = 'none';
      } else if (tabId === 'logs') {
        if (statsFilterGrid) statsFilterGrid.style.display = 'none';
        if (clearLogBtn) clearLogBtn.style.display = 'flex';
      }
    }

    // 日志
    log(type, message) {
      const ui = this.ui;
      const logPlaceholder = ui.elements.logContainer.querySelector('.log-placeholder');
      if (logPlaceholder) logPlaceholder.remove();
      const logEntry = document.createElement('div');
      logEntry.className = `log-entry log-${type}`;
      const timestamp = new Date().toLocaleTimeString();
      logEntry.innerHTML = `<span class="log-timestamp">${timestamp}</span><span class="log-message">${message}</span>`;
      ui.elements.logContainer.appendChild(logEntry);
      ui.elements.logContainer.scrollTop = ui.elements.logContainer.scrollHeight;
    }

    clearLogs() {
      const ui = this.ui;
      ui.elements.logContainer.innerHTML = '<div class="log-placeholder">日志已清空</div>';
    }
  }

  window.UIRenderer = UIRenderer;
})();