class MasCopierUI {
    constructor() {
        console.log('MasCopierUI: constructor start');
        this.elements = {};
        this.config = {};
        this.scanResult = null;
        this.isPaused = false;

        this.init();
        console.log('MasCopierUI: constructor end');
    }

    init() {
        this.selectDOMElements();
        this.loadConfig();
        this.setupEventListeners();
        this.setupIpcListeners();
    }

    selectDOMElements() {
        this.elements = {
            sourcePath: document.getElementById('sourcePath'),
            targetPath: document.getElementById('targetPath'),
            selectSourceBtn: document.getElementById('selectSourceBtn'),
            selectTargetBtn: document.getElementById('selectTargetBtn'),
            overwriteCheck: document.getElementById('overwriteCheck'),
            scanBtn: document.getElementById('scanBtn'),
            startBtn: document.getElementById('startBtn'),
            pauseBtn: document.getElementById('pauseBtn'),
            cancelBtn: document.getElementById('cancelBtn'),
            progressFill: document.getElementById('progressFill'),
            progressText: document.getElementById('progressText'),
            logContainer: document.getElementById('logContainer'),
            clearLogBtn: document.getElementById('clearLogBtn'),
            scanModal: document.getElementById('scanModal'),
            scanMessage: document.getElementById('scanMessage'),
            scanFile: document.getElementById('scanFile'),
            scanProgressFill: document.getElementById('scanProgressFill'),
            scanProgressText: document.getElementById('scanProgressText'),
            cancelScanBtn: document.getElementById('cancelScanBtn'),
            resultModal: document.getElementById('resultModal'),
            closeResultBtn: document.getElementById('closeResultBtn'),
            statsGrid: document.getElementById('statsGrid'),
            fileList: document.getElementById('fileList'),
            statusFilter: document.getElementById('statusFilter'),
            closeResultModalBtn: document.getElementById('closeResultModalBtn'),
            startUploadFromResultBtn: document.getElementById('startUploadFromResultBtn'),
            modalOverlay: document.getElementById('modalOverlay'),
        };
    }

    async loadConfig() {
        console.log('MasCopierUI: loadConfig start');
        this.config = await window.electronAPI.config.load();
        this.elements.sourcePath.textContent = this.config.sourceDir || '未选择';
        this.elements.targetPath.textContent = this.config.targetDir || '未选择';
        this.elements.overwriteCheck.checked = this.config.overwrite || false;
        this.updateActionButtons();
        console.log('MasCopierUI: loadConfig end');
    }

    async saveConfig() {
        await window.electronAPI.config.save(this.config);
    }

    setupEventListeners() {
        console.log('MasCopierUI: setupEventListeners start');
        this.elements.selectSourceBtn.addEventListener('click', () => this.selectFolder('source'));
        this.elements.selectTargetBtn.addEventListener('click', () => this.selectFolder('target'));
        this.elements.overwriteCheck.addEventListener('change', (e) => {
            this.config.overwrite = e.target.checked;
            this.saveConfig();
        });

        this.elements.scanBtn.addEventListener('click', () => this.startScan());
        this.elements.startBtn.addEventListener('click', () => this.startUpload());
        this.elements.pauseBtn.addEventListener('click', () => this.togglePause());
        this.elements.cancelBtn.addEventListener('click', () => this.cancelUpload());

        this.elements.clearLogBtn.addEventListener('click', () => this.clearLogs());

        // Modal listeners
        this.elements.cancelScanBtn.addEventListener('click', () => this.cancelScan());
        this.elements.closeResultBtn.addEventListener('click', () => this.closeResultModal());
        this.elements.closeResultModalBtn.addEventListener('click', () => this.closeResultModal());
        this.elements.startUploadFromResultBtn.addEventListener('click', () => {
            this.closeResultModal();
            this.startUpload();
        });
        this.elements.statusFilter.addEventListener('change', () => this.renderFileList());
        console.log('MasCopierUI: setupEventListeners end');
    }

    setupIpcListeners() {
        window.electronAPI.on('scan:progress', (progress) => {
            this.elements.scanMessage.textContent = `正在扫描第 ${progress.processed} / ${progress.total} 个文件`;
            this.elements.scanFile.textContent = progress.currentFile;
            const percentage = progress.total > 0 ? (progress.processed / progress.total) * 100 : 0;
            this.elements.scanProgressFill.style.width = `${percentage}%`;
            this.elements.scanProgressText.textContent = `${Math.round(percentage)}%`;
        });

        window.electronAPI.on('upload:progress', (progress) => {
            const percentage = progress.totalFiles > 0 ? (progress.processedFiles / progress.totalFiles) * 100 : 0;
            this.elements.progressFill.style.width = `${percentage}%`;
            this.elements.progressText.textContent = `${Math.round(percentage)}%`;
            this.log('info', `总进度: ${progress.processedFiles}/${progress.totalFiles} | 当前文件: ${progress.currentFile} (${Math.round(progress.fileProgress)}%)`);
        });

        window.electronAPI.on('upload:fileProcessed', ({ filePath, status, error }) => {
            if (status === 'uploaded') {
                this.log('success', `上传成功: ${filePath}`);
            } else if (status === 'skipped') {
                this.log('warn', `跳过文件: ${filePath}`);
            } else if (status === 'error') {
                this.log('error', `上传失败: ${filePath} - ${error}`);
            }
        });
    }

    async selectFolder(type) {
        const result = await window.electronAPI.dialog.selectFolder();
        if (result.canceled || result.filePaths.length === 0) return;

        const path = result.filePaths[0];
        if (type === 'source') {
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
        this.elements.startBtn.disabled = !this.scanResult || this.scanResult.toUpload.length === 0;
    }

    async startScan() {
        this.log('info', '开始预扫描...');
        this.showScanModal();
        try {
            const { sourceDir, targetDir, overwrite } = this.config;
            const result = await window.electronAPI.media.scan(sourceDir, targetDir, overwrite);
            this.hideScanModal();
            if (result.success) {
                this.scanResult = result.data;
                const { total, toUpload, toOverwrite, toSkip } = result.data;
                this.log('success', `扫描完成: 发现 ${total} 个文件, ${toUpload.length} 个待上传, ${toOverwrite.length} 个待覆盖, ${toSkip.length} 个将跳过.`);
                this.showResultModal();
                this.updateActionButtons();
            } else {
                this.log('error', `扫描出错: ${result.error}`);
            }
        } catch (error) {
            this.hideScanModal();
            this.log('error', `扫描时发生未知错误: ${error.message}`);
        }
    }

    cancelScan() {
        // window.electronAPI.media.cancelScan(); // Not implemented in backend
        this.hideScanModal();
        this.log('warn', '扫描已取消');
    }

    async startUpload() {
        if (!this.scanResult) {
            this.log('error', '请先执行预扫描');
            return;
        }
        const filesToUpload = [...this.scanResult.toUpload, ...this.scanResult.toOverwrite];
        if (filesToUpload.length === 0) {
            this.log('info', '没有需要上传的文件。');
            return;
        }
        this.log('info', '开始上传...');
        this.isPaused = false;
        this.elements.startBtn.disabled = true;
        this.elements.scanBtn.disabled = true;
        this.elements.pauseBtn.disabled = false;
        this.elements.cancelBtn.disabled = false;
        try {
            const { targetDir, overwrite } = this.config;
            const result = await window.electronAPI.media.upload(filesToUpload, targetDir, overwrite);
            if (result.success) {
                this.log('success', '所有文件处理完毕!');
            } else {
                this.log('error', `上传出错: ${result.error}`);
            }
        } catch (error) {
            this.log('error', `上传时发生未知错误: ${error.message}`);
        } finally {
            this.resetUploadState();
        }
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        if (this.isPaused) {
            window.electronAPI.upload.pause();
            this.elements.pauseBtn.textContent = '继续';
            this.log('info', '上传已暂停');
        } else {
            window.electronAPI.upload.resume();
            this.elements.pauseBtn.textContent = '暂停';
            this.log('info', '上传已恢复');
        }
    }

    cancelUpload() {
        window.electronAPI.upload.cancel();
        this.log('warn', '上传已取消');
        this.resetUploadState();
    }

    resetUploadState() {
        this.isPaused = false;
        this.elements.startBtn.disabled = false;
        this.elements.scanBtn.disabled = false;
        this.elements.pauseBtn.disabled = true;
        this.elements.pauseBtn.textContent = '暂停';
        this.elements.cancelBtn.disabled = true;
        this.elements.progressFill.style.width = '0%';
        this.elements.progressText.textContent = '0%';
    }

    log(type, message) {
        const logPlaceholder = this.elements.logContainer.querySelector('.log-placeholder');
        if (logPlaceholder) {
            logPlaceholder.remove();
        }

        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;
        
        const timestamp = new Date().toLocaleTimeString();
        logEntry.innerHTML = `<span class="log-timestamp">${timestamp}</span><span class="log-message">${message}</span>`;
        
        this.elements.logContainer.appendChild(logEntry);
        this.elements.logContainer.scrollTop = this.elements.logContainer.scrollHeight;
    }

    clearLogs() {
        this.elements.logContainer.innerHTML = '<div class="log-placeholder">日志已清空</div>';
    }

    showScanModal() {
        this.elements.scanProgressFill.style.width = '0%';
        this.elements.scanProgressText.textContent = '0%';
        this.elements.scanMessage.textContent = '正在准备扫描...';
        this.elements.scanFile.textContent = '';
        this.elements.scanModal.style.display = 'block';
        this.elements.modalOverlay.style.display = 'block';
    }

    hideScanModal() {
        this.elements.scanModal.style.display = 'none';
        this.elements.modalOverlay.style.display = 'none';
    }

    showResultModal() {
        this.renderStats();
        this.renderFileList();
        this.elements.resultModal.style.display = 'block';
        this.elements.modalOverlay.style.display = 'block';
    }

    closeResultModal() {
        this.elements.resultModal.style.display = 'none';
        this.elements.modalOverlay.style.display = 'none';
    }

    renderStats() {
        const stats = [
            { label: '待上传', value: this.scanResult.toUpload.length, color: 'blue' },
            { label: '待覆盖', value: this.scanResult.toOverwrite.length, color: 'orange' },
            { label: '将跳过', value: this.scanResult.toSkip.length, color: 'gray' },
            { label: '总计', value: this.scanResult.total, color: 'green' },
        ];

        this.elements.statsGrid.innerHTML = stats.map(stat => `
            <div class="stat-card stat-card-${stat.color}">
                <div class="stat-value">${stat.value}</div>
                <div class="stat-label">${stat.label}</div>
            </div>
        `).join('');
    }

    renderFileList() {
        const filter = this.elements.statusFilter.value;
        let filesToRender = [];

        const allFiles = [
            ...this.scanResult.toUpload.map(f => ({ ...f, status: '将上传' })),
            ...this.scanResult.toOverwrite.map(f => ({ ...f, status: '将覆盖' })),
            ...this.scanResult.toSkip.map(f => ({ ...f, status: '将跳过' }))
        ];

        if (filter === 'all') {
            filesToRender = allFiles;
        } else {
            filesToRender = allFiles.filter(f => f.status === filter);
        }

        if (filesToRender.length === 0) {
            this.elements.fileList.innerHTML = '<div class="file-list-empty">没有符合条件的文件</div>';
            return;
        }

        this.elements.fileList.innerHTML = filesToRender.map(file => `
            <div class="file-list-item">
                <div class="file-name">${file.name}</div>
                <div class="file-path">${file.relativePath}</div>
                <div class="file-size">${(file.size / 1024 / 1024).toFixed(2)} MB</div>
                <div class="file-status file-status-${this.getStatusClass(file.status)}">${file.status}</div>
            </div>
        `).join('');
    }

    getStatusClass(status) {
        switch (status) {
            case '将上传': return 'upload';
            case '将覆盖': return 'overwrite';
            case '将跳过': return 'skip';
            default: return 'unknown';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        window.masCopierUI = new MasCopierUI();
    } catch (error) {
        console.error('Failed to initialize MasCopierUI:', error);
    }
});