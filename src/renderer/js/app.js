class MasCopierUI {
    constructor() {
        this.config = null;
        this.scanResults = null;
        this.isScanning = false;
        this.isUploading = false;
        this.isPaused = false;
        
        this.initializeElements();
        this.setupEventListeners();
        this.loadConfig();
    }

    initializeElements() {
        // 路径显示元素
        this.sourcePathEl = document.getElementById('sourcePath');
        this.targetPathEl = document.getElementById('targetPath');
        
        // 按钮元素
        this.selectSourceBtn = document.getElementById('selectSourceBtn');
        this.selectTargetBtn = document.getElementById('selectTargetBtn');
        this.scanBtn = document.getElementById('scanBtn');
        this.startBtn = document.getElementById('startBtn');
        this.pauseBtn = document.getElementById('pauseBtn');
        this.cancelBtn = document.getElementById('cancelBtn');
        this.clearLogBtn = document.getElementById('clearLogBtn');
        
        // 选项元素
        this.overwriteCheck = document.getElementById('overwriteCheck');
        
        // 进度元素
        this.progressFill = document.getElementById('progressFill');
        this.progressText = document.getElementById('progressText');
        
        // 日志元素
        this.logContainer = document.getElementById('logContainer');
        
        // 模态框元素
        this.scanModal = document.getElementById('scanModal');
        this.resultModal = document.getElementById('resultModal');
        this.modalOverlay = document.getElementById('modalOverlay');
        
        // 扫描进度元素
        this.scanMessage = document.getElementById('scanMessage');
        this.scanFile = document.getElementById('scanFile');
        this.scanProgressFill = document.getElementById('scanProgressFill');
        this.scanProgressText = document.getElementById('scanProgressText');
        this.cancelScanBtn = document.getElementById('cancelScanBtn');
        
        // 结果模态框元素
        this.statsGrid = document.getElementById('statsGrid');
        this.fileList = document.getElementById('fileList');
        this.statusFilter = document.getElementById('statusFilter');
        this.closeResultBtn = document.getElementById('closeResultBtn');
        this.closeResultModalBtn = document.getElementById('closeResultModalBtn');
        this.startUploadFromResultBtn = document.getElementById('startUploadFromResultBtn');
    }

    setupEventListeners() {
        // 文件夹选择
        this.selectSourceBtn.addEventListener('click', () => this.selectFolder('source'));
        this.selectTargetBtn.addEventListener('click', () => this.selectFolder('target'));
        
        // 主要操作按钮
        this.scanBtn.addEventListener('click', () => this.startScan());
        this.startBtn.addEventListener('click', () => this.startUpload());
        this.pauseBtn.addEventListener('click', () => this.togglePause());
        this.cancelBtn.addEventListener('click', () => this.cancelUpload());
        
        // 其他按钮
        this.clearLogBtn.addEventListener('click', () => this.clearLog());
        this.overwriteCheck.addEventListener('change', () => this.saveConfig());
        
        // 扫描模态框
        this.cancelScanBtn.addEventListener('click', () => this.cancelScan());
        
        // 结果模态框
        this.closeResultBtn.addEventListener('click', () => this.hideModal(this.resultModal));
        this.closeResultModalBtn.addEventListener('click', () => this.hideModal(this.resultModal));
        this.startUploadFromResultBtn.addEventListener('click', () => this.startUploadFromResult());
        this.statusFilter.addEventListener('change', () => this.filterFileList());
        
        // 模态框遮罩
        this.modalOverlay.addEventListener('click', () => this.hideAllModals());
        
        // Electron IPC 事件监听
        this.setupIpcListeners();
    }

    setupIpcListeners() {
        // 扫描进度
        window.electronAPI.on('scan:progress', (event, data) => {
            this.updateScanProgress(data);
        });
        
        // 上传进度
        window.electronAPI.on('upload:progress', (event, data) => {
            this.updateUploadProgress(data);
        });
        
        // 文件处理完成
        window.electronAPI.on('upload:fileProcessed', (event, data) => {
            this.onFileProcessed(data);
        });
    }

    async loadConfig() {
        try {
            this.config = await window.electronAPI.config.load();
            this.updateUI();
        } catch (error) {
            console.error('加载配置失败:', error);
            this.addLog('加载配置失败: ' + error.message, 'error');
        }
    }

    async saveConfig() {
        if (!this.config) return;
        
        this.config.sourceDir = this.sourcePathEl.textContent === '未选择' ? '' : this.sourcePathEl.textContent;
        this.config.targetDir = this.targetPathEl.textContent === '未选择' ? '' : this.targetPathEl.textContent;
        this.config.overwriteDuplicates = this.overwriteCheck.checked;
        
        try {
            await window.electronAPI.config.save(this.config);
        } catch (error) {
            console.error('保存配置失败:', error);
        }
    }

    updateUI() {
        if (!this.config) return;
        
        // 更新路径显示
        this.sourcePathEl.textContent = this.config.sourceDir || '未选择';
        this.targetPathEl.textContent = this.config.targetDir || '未选择';
        this.overwriteCheck.checked = this.config.overwriteDuplicates || false;
        
        // 更新路径样式
        this.sourcePathEl.classList.toggle('selected', !!this.config.sourceDir);
        this.targetPathEl.classList.toggle('selected', !!this.config.targetDir);
        
        // 检查按钮状态
        this.checkButtonStates();
    }

    checkButtonStates() {
        const hasSource = this.sourcePathEl.textContent !== '未选择';
        const hasTarget = this.targetPathEl.textContent !== '未选择';
        const canOperate = hasSource && hasTarget && !this.isScanning && !this.isUploading;
        
        this.scanBtn.disabled = !canOperate;
        this.startBtn.disabled = !canOperate;
    }

    async selectFolder(type) {
        try {
            const title = type === 'source' ? '选择源目录' : '选择目标目录 (NAS)';
            const defaultPath = type === 'source' ? this.config?.sourceDir : this.config?.targetDir;
            
            const folderPath = await window.electronAPI.dialog.selectFolder(title, defaultPath);
            
            if (folderPath) {
                if (type === 'source') {
                    this.sourcePathEl.textContent = folderPath;
                    this.sourcePathEl.classList.add('selected');
                } else {
                    this.targetPathEl.textContent = folderPath;
                    this.targetPathEl.classList.add('selected');
                }
                
                await this.saveConfig();
                this.checkButtonStates();
            }
        } catch (error) {
            console.error('选择文件夹失败:', error);
            this.addLog('选择文件夹失败: ' + error.message, 'error');
        }
    }

    async startScan() {
        if (this.isScanning) return;
        
        const sourceDir = this.sourcePathEl.textContent;
        const targetDir = this.targetPathEl.textContent;
        const overwriteDuplicates = this.overwriteCheck.checked;
        
        if (sourceDir === '未选择' || targetDir === '未选择') {
            this.addLog('请先选择源目录和目标目录', 'error');
            return;
        }
        
        this.isScanning = true;
        this.checkButtonStates();
        this.showModal(this.scanModal);
        
        try {
            const result = await window.electronAPI.media.scan(sourceDir, targetDir, overwriteDuplicates);
            
            if (result.success) {
                this.scanResults = result.data;
                this.hideModal(this.scanModal);
                this.showScanResults();
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('扫描失败:', error);
            this.addLog('扫描失败: ' + error.message, 'error');
            this.hideModal(this.scanModal);
        } finally {
            this.isScanning = false;
            this.checkButtonStates();
        }
    }

    cancelScan() {
        // 这里可以添加取消扫描的逻辑
        this.hideModal(this.scanModal);
        this.isScanning = false;
        this.checkButtonStates();
        this.addLog('扫描已取消', 'warning');
    }

    updateScanProgress(data) {
        const { phase, current, total, message } = data;
        
        let percentage = 0;
        if (total > 0) {
            percentage = Math.round((current / total) * 100);
        }
        
        this.scanProgressFill.style.width = `${percentage}%`;
        this.scanProgressText.textContent = `${percentage}%`;
        this.scanMessage.textContent = this.getPhaseMessage(phase);
        this.scanFile.textContent = message;
    }

    getPhaseMessage(phase) {
        const messages = {
            collecting: '正在收集文件列表...',
            processing: '正在处理媒体文件...',
            analyzing: '正在分析文件状态...',
            completed: '扫描完成',
            error: '扫描出错'
        };
        return messages[phase] || '正在扫描...';
    }

    showScanResults() {
        if (!this.scanResults) return;
        
        // 生成统计卡片
        this.generateStatsCards();
        
        // 生成文件列表
        this.generateFileList();
        
        // 显示结果模态框
        this.showModal(this.resultModal);
    }

    generateStatsCards() {
        const stats = this.scanResults.stats;
        const cards = [
            { label: '总文件数', value: stats.total, type: 'primary' },
            { label: '将上传', value: stats.upload, type: 'success' },
            { label: '将覆盖', value: stats.overwrite, type: 'warning' },
            { label: '将跳过', value: stats.skip, type: 'secondary' }
        ];
        
        this.statsGrid.innerHTML = cards.map(card => `
            <div class="stat-card ${card.type}">
                <div class="stat-value ${card.type}">${card.value}</div>
                <div class="stat-label">${card.label}</div>
            </div>
        `).join('');
    }

    generateFileList() {
        const files = this.scanResults.files;
        this.fileList.innerHTML = files.map(file => this.createFileItem(file)).join('');
    }

    createFileItem(file) {
        const iconSvg = file.fileType === '照片' ? 
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" stroke-width="2"/><path d="M21 15L16 10L5 21" stroke="currentColor" stroke-width="2"/></svg>' :
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="23 7 16 12 23 17 23 7" stroke="currentColor" stroke-width="2"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2" stroke="currentColor" stroke-width="2"/></svg>';
        
        const statusClass = {
            '将上传': 'upload',
            '将覆盖': 'overwrite',
            '将跳过': 'skip'
        }[file.status] || 'skip';
        
        const fileSize = this.formatFileSize(file.fileSize);
        const fileDate = new Date(file.date).toLocaleString('zh-CN');
        
        return `
            <div class="file-item" data-status="${file.status}">
                <div class="file-icon">${iconSvg}</div>
                <div class="file-info">
                    <div class="file-name">${file.filename}</div>
                    <div class="file-details">${file.fileType} • ${fileSize} • ${fileDate}</div>
                </div>
                <div class="file-status ${statusClass}">${file.status}</div>
            </div>
        `;
    }

    filterFileList() {
        const filterValue = this.statusFilter.value;
        const fileItems = this.fileList.querySelectorAll('.file-item');
        
        fileItems.forEach(item => {
            const status = item.dataset.status;
            const shouldShow = filterValue === 'all' || status === filterValue;
            item.style.display = shouldShow ? 'flex' : 'none';
        });
    }

    async startUploadFromResult() {
        this.hideModal(this.resultModal);
        await this.startUpload();
    }

    async startUpload() {
        if (this.isUploading) return;
        
        let files = this.scanResults?.files;
        
        // 如果没有扫描结果，先进行扫描
        if (!files) {
            await this.startScan();
            return;
        }
        
        this.isUploading = true;
        this.isPaused = false;
        this.checkButtonStates();
        this.pauseBtn.disabled = false;
        this.cancelBtn.disabled = false;
        
        this.clearLog();
        this.addLog('开始上传媒体文件...', 'info');
        
        try {
            const targetDir = this.targetPathEl.textContent;
            const overwriteDuplicates = this.overwriteCheck.checked;
            
            const result = await window.electronAPI.media.upload(files, targetDir, overwriteDuplicates);
            
            if (result.success) {
                this.addLog('上传完成!', 'success');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('上传失败:', error);
            this.addLog('上传失败: ' + error.message, 'error');
        } finally {
            this.isUploading = false;
            this.isPaused = false;
            this.checkButtonStates();
            this.pauseBtn.disabled = true;
            this.cancelBtn.disabled = true;
            this.pauseBtn.textContent = '暂停';
            
            // 清空扫描结果，下次需要重新扫描
            this.scanResults = null;
        }
    }

    async togglePause() {
        if (!this.isUploading) return;
        
        try {
            if (this.isPaused) {
                await window.electronAPI.upload.resume();
                this.isPaused = false;
                this.pauseBtn.textContent = '暂停';
                this.addLog('继续上传...', 'info');
            } else {
                await window.electronAPI.upload.pause();
                this.isPaused = true;
                this.pauseBtn.textContent = '继续';
                this.addLog('上传已暂停', 'warning');
            }
        } catch (error) {
            console.error('暂停/继续操作失败:', error);
        }
    }

    async cancelUpload() {
        if (!this.isUploading) return;
        
        const confirmed = confirm('确定要取消上传吗？');
        if (!confirmed) return;
        
        try {
            await window.electronAPI.upload.cancel();
            this.addLog('正在取消上传...', 'warning');
        } catch (error) {
            console.error('取消上传失败:', error);
        }
    }

    updateUploadProgress(data) {
        const { current, total, message } = data;
        
        let percentage = 0;
        if (total > 0) {
            percentage = Math.round((current / total) * 100);
        }
        
        this.progressFill.style.width = `${percentage}%`;
        this.progressText.textContent = `${percentage}%`;
        
        if (message) {
            this.addLog(message, 'info');
        }
    }

    onFileProcessed(data) {
        const { file, success, message } = data;
        const logType = success ? 'success' : 'error';
        this.addLog(message, logType);
    }

    addLog(message, type = 'info') {
        // 移除占位符
        const placeholder = this.logContainer.querySelector('.log-placeholder');
        if (placeholder) {
            placeholder.remove();
        }
        
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        
        this.logContainer.appendChild(logEntry);
        this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }

    clearLog() {
        this.logContainer.innerHTML = '<div class="log-placeholder">日志已清空</div>';
    }

    showModal(modal) {
        this.modalOverlay.classList.add('show');
        modal.classList.add('show');
    }

    hideModal(modal) {
        modal.classList.remove('show');
        this.modalOverlay.classList.remove('show');
    }

    hideAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('show');
        });
        this.modalOverlay.classList.remove('show');
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
}

// 初始化应用
class MasCopyApp {
    constructor() {
        this.config = null;
        this.scanResults = null;
        this.isScanning = false;
        this.isUploading = false;
        this.isPaused = false;
        
        this.initializeElements();
        this.setupEventListeners();
        this.loadConfig();
    }

    // ... (所有其他方法)
}

document.addEventListener('DOMContentLoaded', () => {
    window.masCopierUI = new MasCopierUI();
});