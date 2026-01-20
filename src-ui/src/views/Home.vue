<template>
  <div class="dashboard">


    <!-- Step 1: Configuration -->
    <div v-show="currentStep === 'config'" class="step-container config-step animate-fade-in">
      
      <div class="transfer-flow">
        <!-- Source Column -->
        <div class="config-card glass-panel source-card">
          <div class="card-header-row">
            <div class="header-badge source-badge">
              <span class="badge-icon">📂</span>
              <span class="badge-text">源目录</span>
            </div>
            <div class="mode-indicator">{{ currentMode === 'sd' ? 'SD卡模式' : 'DJI模式' }}</div>
          </div>
          
          <div class="card-body">
            <FileSelector 
              :title="`选择${currentMode === 'sd' ? 'SD卡' : 'DJI设备'}路径`"
              :path="config[currentMode].source_dir" 
              @update:path="updateSource"
              @addFavorite="addSourceFavorite"
              placeholder="请选择包含照片/视频的文件夹"
              class="main-selector"
            >
              <template #icon>
                <div class="icon-circle source-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </div>
              </template>
            </FileSelector>

            <div v-if="sourceFavorites.length > 0" class="favorites-area">
              <div class="fav-label">收藏夹</div>
              <div class="fav-list">
                <div v-for="p in sourceFavorites" :key="p" class="fav-item" @click="selectSource(p)" :title="p">
                  <span class="fav-path">{{ p }}</span>
                  <button class="fav-remove" @click.stop="removeSourceFavorite(p)">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Arrow Connector -->
        <div class="flow-connector">
          <div class="connector-line"></div>
          <div class="connector-icon-wrapper">
            <div class="connector-icon">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </div>
          </div>
        </div>

        <!-- Target Column -->
        <div class="config-card glass-panel target-card">
          <div class="card-header-row">
            <div class="header-badge target-badge">
              <span class="badge-icon">💾</span>
              <span class="badge-text">目标目录</span>
            </div>
            <div class="mode-indicator">NAS / 备份盘</div>
          </div>

          <div class="card-body">
            <FileSelector 
              title="选择备份位置" 
              :path="config[currentMode].target_dir" 
              @update:path="updateTarget"
              @addFavorite="addTargetFavorite"
              placeholder="请选择备份目标文件夹"
              class="main-selector"
            >
              <template #icon>
                <div class="icon-circle target-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </template>
            </FileSelector>

            <div v-if="targetFavorites.length > 0" class="favorites-area">
              <div class="fav-label">收藏夹</div>
              <div class="fav-list">
                <div v-for="p in targetFavorites" :key="p" class="fav-item" @click="selectTarget(p)" :title="p">
                  <span class="fav-path">{{ p }}</span>
                  <button class="fav-remove" @click.stop="removeTargetFavorite(p)">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Action Bar -->
      <div class="action-footer glass-panel">
        <div class="options-group">
          <label class="toggle-option" :class="{ active: config[currentMode].overwrite_duplicates }">
            <input type="checkbox" v-model="config[currentMode].overwrite_duplicates">
            <div class="toggle-box">
              <span class="check-mark" v-if="config[currentMode].overwrite_duplicates">✓</span>
            </div>
            <div class="option-text">
              <span class="option-title">覆盖重复文件</span>
              <span class="option-desc">相同文件名将被覆盖</span>
            </div>
          </label>
          
          <div class="divider-vertical"></div>

          <label class="toggle-option" :class="{ active: fastMode }">
            <input type="checkbox" v-model="fastMode">
            <div class="toggle-box">
              <span class="check-mark" v-if="fastMode">✓</span>
            </div>
            <div class="option-text">
              <span class="option-title">快速扫描模式</span>
              <span class="option-desc">仅对比修改时间 (跳过EXIF)</span>
            </div>
          </label>
        </div>

        <button @click="startScan" class="start-btn" :disabled="!canStart || isScanning">
          <span v-if="isScanning" class="spinner"></span>
          <span class="btn-text">{{ isScanning ? '扫描中...' : '开始扫描' }}</span>
          <div class="btn-icon-wrapper" v-if="!isScanning">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
        </button>
      </div>
    </div>

    <!-- Step 2: Results & Upload -->
    <div v-show="currentStep === 'results'" class="step-container results-step animate-fade-in">
      <div class="results-header">
        <button @click="goBack" class="btn btn-secondary btn-icon" :disabled="isUploading">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          返回配置
        </button>
        <div class="header-actions">
           <button @click="startUpload" class="btn btn-primary btn-lg" :disabled="!scanResult || scanResult.length === 0 || isUploading">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {{ isUploading ? '上传中...' : '开始上传' }}
          </button>
        </div>
      </div>

      <!-- Progress Section -->
      <div v-if="isUploading" class="progress-section glass-panel p-4 animate-fade-in">
        <ProgressBar 
          :current="progress.current" 
          :total="progress.total" 
          :filename="progress.filename || '正在上传...'"
        />
        <div class="upload-controls">
          <button @click="togglePause" class="btn btn-secondary btn-sm">
            {{ isPaused ? '继续' : '暂停' }}
          </button>
          <button @click="cancel" class="btn btn-danger btn-sm">
            取消
          </button>
        </div>
      </div>

      <!-- Results Table -->
      <div class="results-content">
        <TabView :tabs="viewTabs" v-model:activeTab="activeView">
          <div v-show="activeView === 'results'" class="tab-pane">
            <FileTable 
              v-if="scanResult && scanResult.length > 0"
              :files="scanResult" 
              v-model:filter="fileFilter"
            />
            <div v-else class="empty-state">
              <div class="empty-icon">🔍</div>
              <p>未找到符合条件的文件</p>
            </div>
          </div>
          <div v-show="activeView === 'logs'" class="tab-pane">
            <LogViewer :logs="logs" />
            <div class="log-actions">
              <button @click="clearLogs" class="btn btn-secondary btn-sm">
                清空日志
              </button>
            </div>
          </div>
        </TabView>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import FileSelector from '../components/FileSelector.vue';
import ProgressBar from '../components/ProgressBar.vue';
import TabView from '../components/TabView.vue';
import FileTable from '../components/FileTable.vue';
import LogViewer from '../components/LogViewer.vue';
import { useAppState } from '../composables/useAppState.js';

const { currentMode, config, currentStep } = useAppState();
const fastMode = ref(true);

const isScanning = ref(false);
const isUploading = ref(false);
const isPaused = ref(false);
const scanResult = ref(null);
const progress = ref({ current: 0, total: 0, filename: '' });
const logs = ref([]);
const activeView = ref('results');
const fileFilter = ref('all');
const sourceFavorites = computed(() => {
  if (currentMode.value === 'sd') return config.value.favorites.sd_sources || [];
  const arr = config.value.favorites.dji_sources || [];
  return Array.isArray(arr) ? arr.map((x) => (typeof x === 'string' ? x : x.path)) : [];
});
const targetFavorites = computed(() => {
  if (currentMode.value === 'sd') return config.value.favorites.sd_targets || [];
  return config.value.favorites.dji_targets || [];
});

const viewTabs = [
  { id: 'results', label: '扫描结果' },
  { id: 'logs', label: '日志' }
];

const canStart = computed(() => {
  const modeConfig = config.value[currentMode.value];
  return modeConfig && modeConfig.source_dir && modeConfig.target_dir;
});

onMounted(async () => {
  try {
    const savedConfig = await invoke('get_config');
    // Merge saved config but preserve defaults if missing
    if (savedConfig) {
      if (savedConfig.sd) config.value.sd = { ...config.value.sd, ...savedConfig.sd };
      if (savedConfig.dji) config.value.dji = { ...config.value.dji, ...savedConfig.dji };
      if (savedConfig.favorites) {
        config.value.favorites = savedConfig.favorites;
      }
    }
  } catch (e) {
    addLog('warning', '无法加载配置: ' + e);
  }

  const isTauri =
    typeof window !== 'undefined' &&
    (window.__TAURI__ !== undefined ||
      window.__TAURI_INTERNALS__ !== undefined ||
      window.__TAURI_INTERNALS__?.invoke !== undefined);

  if (!isTauri) return;

  try {
    await listen('upload-progress', (event) => {
      progress.value = event.payload;
    });
  } catch (e) {
    addLog('warning', '无法监听上传进度事件: ' + e);
  }
});

async function updateSource(path) {
  config.value[currentMode.value].source_dir = path;
  await saveConfig();
}

async function updateTarget(path) {
  config.value[currentMode.value].target_dir = path;
  await saveConfig();
}

async function saveConfig() {
  try {
    await invoke('save_config', { config: config.value });
  } catch (e) {
    addLog('error', '保存配置失败: ' + e);
  }
}

function basename(p) {
  if (!p) return '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function dirname(p) {
  if (!p) return '';
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (idx <= 0) return '';
  return p.slice(0, idx);
}

async function addSourceFavorite() {
  const p = config.value[currentMode.value].source_dir;
  if (!p) return;
  if (currentMode.value === 'sd') {
    const arr = config.value.favorites.sd_sources;
    if (!arr.includes(p)) arr.unshift(p);
    config.value.favorites.sd_sources = arr.slice(0, 8);
  } else {
    const arr = config.value.favorites.dji_sources || [];
    const exists = Array.isArray(arr) && arr.some(x => (typeof x === 'string' ? x === p : x.path === p));
    if (!exists) {
      const item = { path: p };
      arr.unshift(item);
    }
    config.value.favorites.dji_sources = arr.slice(0, 8);
  }
  await saveConfig();
}

async function removeSourceFavorite(item) {
  if (currentMode.value === 'sd') {
    config.value.favorites.sd_sources = (config.value.favorites.sd_sources || []).filter(x => x !== item);
  } else {
    config.value.favorites.dji_sources = (config.value.favorites.dji_sources || []).filter(x => (typeof x === 'string' ? x !== item : x.path !== item));
  }
  await saveConfig();
}

async function selectSource(p) {
  config.value[currentMode.value].source_dir = p;
  await saveConfig();
}

async function addTargetFavorite() {
  const p = config.value[currentMode.value].target_dir;
  if (!p) return;
  if (currentMode.value === 'sd') {
    const arr = config.value.favorites.sd_targets || [];
    if (!arr.includes(p)) arr.unshift(p);
    config.value.favorites.sd_targets = arr.slice(0, 8);
  } else {
    const arr = config.value.favorites.dji_targets || [];
    if (!arr.includes(p)) arr.unshift(p);
    config.value.favorites.dji_targets = arr.slice(0, 8);
  }
  await saveConfig();
}

async function removeTargetFavorite(p) {
  if (currentMode.value === 'sd') {
    config.value.favorites.sd_targets = (config.value.favorites.sd_targets || []).filter(x => x !== p);
  } else {
    config.value.favorites.dji_targets = (config.value.favorites.dji_targets || []).filter(x => x !== p);
  }
  await saveConfig();
}

async function selectTarget(p) {
  config.value[currentMode.value].target_dir = p;
  await saveConfig();
}

async function startScan() {
  isScanning.value = true;
  scanResult.value = null;
  progress.value = { current: 0, total: 0, filename: '正在扫描...' };
  addLog('info', '开始扫描...');

  try {
    const modeConfig = config.value[currentMode.value];
    const files = await invoke('scan_files', {
      args: {
        sourceDir: modeConfig.source_dir,
        targetDir: modeConfig.target_dir,
        overwriteDuplicates: modeConfig.overwrite_duplicates,
        mode: currentMode.value,
        fastMode: fastMode.value
      }
    });
    
    scanResult.value = files;
    addLog('success', `扫描完成，共找到 ${files.length} 个文件`);
    currentStep.value = 'results'; // Switch to results view
    activeView.value = 'results';
  } catch (e) {
    addLog('error', '扫描失败: ' + e);
    alert('扫描失败: ' + e);
  } finally {
    isScanning.value = false;
    progress.value = { current: 0, total: 0, filename: '' };
  }
}

function goBack() {
  currentStep.value = 'config';
}

async function startUpload() {
  if (!scanResult.value) return;
  isUploading.value = true;
  isPaused.value = false;
  addLog('info', '开始上传...');
  
  try {
    await invoke('upload_files', { files: scanResult.value });
    addLog('success', '上传完成!');
    alert('上传完成!');
    scanResult.value = null;
    currentStep.value = 'config'; // Return to config after success
  } catch (e) {
    addLog('error', '上传失败: ' + e);
    alert('上传失败: ' + e);
  } finally {
    isUploading.value = false;
  }
}

async function togglePause() {
  if (isPaused.value) {
    await invoke('resume_upload');
    isPaused.value = false;
    addLog('info', '继续上传');
  } else {
    await invoke('pause_upload');
    isPaused.value = true;
    addLog('warning', '上传已暂停');
  }
}

async function cancel() {
  await invoke('cancel_upload');
  isUploading.value = false;
  isPaused.value = false;
  addLog('warning', '上传已取消');
}

function addLog(type, message) {
  logs.value.push({
    type,
    message,
    time: new Date()
  });
}

function clearLogs() {
  logs.value = [];
}
</script>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.step-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-6);
  overflow: hidden;
}

.config-step {
  overflow-y: auto;
}

.results-step {
  overflow: hidden;
  min-height: 0;
}

/* Config Grid */
.config-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-6);
  flex: 1;
  min-height: 0; /* Allow scrolling inside if needed */
}

@media (min-width: 900px) {
  .config-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.config-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--glass-border);
  background: linear-gradient(to bottom, var(--surface-overlay-strong), var(--surface-overlay-soft));
}

.card-header {
  padding: var(--space-4) var(--space-6) 0;
}

.header-tag {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  background: var(--primary-soft);
  color: var(--primary-700);
  font-size: 0.75rem;
  font-weight: 700;
  border-radius: 9999px;
  letter-spacing: 0.05em;
}

.tag-blue {
  background: var(--primary-soft);
  color: var(--primary-700);
}

.divider {
  height: 1px;
  background: var(--surface-200);
  margin: 0 var(--space-6);
}

.favorites-section {
  padding: var(--space-4) var(--space-6) var(--space-6);
  background: var(--surface-overlay-faint);
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-muted);
  margin-bottom: var(--space-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.fav-list {
  display: flex;
  flex-direction: column;
  gap: 1px; /* Minimal gap for list look */
  overflow-y: auto;
  padding-right: var(--space-2);
  flex: 1;
}

/* Custom scrollbar for fav list */
.fav-list::-webkit-scrollbar {
  width: 4px;
}
.fav-list::-webkit-scrollbar-thumb {
  background: var(--surface-300);
  border-radius: 2px;
}

.fav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-size: 0.875rem;
  color: var(--color-text-main);
}

.fav-item:hover {
  background: var(--surface-100);
  color: var(--primary-700);
}

.fav-info {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  overflow: hidden;
  flex: 1;
}

.fav-basename {
  font-weight: 500;
  white-space: nowrap;
}

.fav-path {
  font-size: 0.75rem;
  color: var(--color-text-light);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  opacity: 0.7;
}

.btn-icon-danger {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  border-radius: var(--radius-sm);
  color: var(--color-text-light);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all var(--transition-fast);
  opacity: 0; /* Hidden by default */
}

.fav-item:hover .btn-icon-danger {
  opacity: 1; /* Show on hover */
}

.btn-icon-danger:hover {
  color: var(--color-error);
  background: var(--danger-soft);
}

.empty-fav {
  text-align: center;
  color: var(--color-text-light);
  font-size: 0.8rem;
  padding: var(--space-4);
  border: 1px dashed var(--surface-200);
  border-radius: var(--radius-md);
}

/* Options Bar */
.options-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-6);
  border-radius: var(--radius-xl);
  background: var(--surface-0);
  box-shadow: var(--shadow-lg);
}

.options-left {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.option-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0.5rem 1rem;
  border-radius: 9999px;
  background: var(--surface-100);
  color: var(--color-text-muted);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  user-select: none;
}

.option-chip input {
  display: none;
}

.option-chip.active {
  background: var(--primary-soft);
  color: var(--primary-700);
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.35);
}

.check-icon {
  font-size: 0.8rem;
  font-weight: bold;
}

.option-group {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.option-hint {
  font-size: 0.8rem;
  color: var(--color-text-light);
}

.btn-lg {
  padding: 0.75rem 2rem;
  font-size: 1.1rem;
}

.spinner {
  width: 1rem;
  height: 1rem;
  border: 2px solid var(--surface-rail);
  border-top-color: var(--surface-0);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Results View */
.results-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
}

.btn-icon {
  gap: var(--space-2);
  padding-left: var(--space-3);
}

.results-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.progress-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.upload-controls {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.log-actions {
  margin-top: var(--space-4);
  display: flex;
  justify-content: flex-end;
}
</style>
