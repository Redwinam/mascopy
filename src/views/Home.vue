<template>
  <div class="dashboard">
    <!-- Mode Switching Tabs -->
    <TabView :tabs="modeTabs" v-model:activeTab="currentMode" class="mode-tabs">
      <div class="mode-content">
        <!-- Configuration Section -->
        <div class="config-grid">
          <FileSelector 
            :title="`源目录 (${currentMode === 'sd' ? 'SD卡' : 'DJI'})`"
            :path="config[currentMode].source_dir" 
            @update:path="updateSource"
            @addFavorite="addSourceFavorite"
            placeholder="请选择包含照片/视频的文件夹"
          >
            <template #icon>
              <svg xmlns="http://www.w3.org/2000/svg" class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </template>
          </FileSelector>

          <FileSelector 
            title="目标目录 (NAS)" 
            :path="config[currentMode].target_dir" 
            @update:path="updateTarget"
            @addFavorite="addTargetFavorite"
            placeholder="请选择备份目标文件夹"
          >
            <template #icon>
              <svg xmlns="http://www.w3.org/2000/svg" class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
            </template>
          </FileSelector>
        </div>

        <div class="favorites-grid">
          <div class="glass-panel p-4 flex flex-col gap-3">
            <div class="panel-header">来源收藏夹</div>
            <div class="fav-list">
              <div v-for="p in sourceFavorites" :key="p" class="fav-item" @click="selectSource(p)">
                <div class="fav-info">
                  <span class="fav-basename">{{ basename(p) }}</span>
                  <span class="fav-path">{{ dirname(p) }}</span>
                </div>
                <button class="btn-icon-danger" @click.stop="removeSourceFavorite(p)" title="删除">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div v-if="sourceFavorites.length === 0" class="empty-fav">暂无收藏</div>
            </div>
          </div>

          <div class="glass-panel p-4 flex flex-col gap-3">
            <div class="panel-header">目标收藏夹</div>
            <div class="fav-list">
              <div v-for="p in targetFavorites" :key="p" class="fav-item" @click="selectTarget(p)">
                <div class="fav-info">
                  <span class="fav-basename">{{ basename(p) }}</span>
                  <span class="fav-path">{{ dirname(p) }}</span>
                </div>
                <button class="btn-icon-danger" @click.stop="removeTargetFavorite(p)" title="删除">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div v-if="targetFavorites.length === 0" class="empty-fav">暂无收藏</div>
            </div>
          </div>
        </div>

        <!-- Options -->
        <div class="glass-panel p-4 options-panel">
          <div class="options-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="config[currentMode].overwrite_duplicates">
              <span class="checkbox-custom"></span>
              <span class="text">覆盖重复文件</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" v-model="fastMode">
              <span class="checkbox-custom"></span>
              <span class="text">快速扫描</span>
            </label>
          </div>
          <p class="options-hint">快速模式将跳过 EXIF/元数据解析，直接使用文件修改时间</p>
        </div>

        <!-- Actions -->
        <div class="action-bar" v-if="!isScanning && !isUploading">
          <button @click="startScan" class="btn btn-secondary" :disabled="!canStart">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            预扫描
          </button>
          <button @click="startUpload" class="btn btn-primary" :disabled="!scanResult || scanResult.length === 0">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            开始上传
          </button>
        </div>

        <!-- Progress Bar during scan/upload -->
        <div v-if="isScanning || isUploading" class="progress-section animate-fade-in">
          <ProgressBar 
            :current="progress.current" 
            :total="progress.total" 
            :filename="progress.filename || (isScanning ? '正在扫描...' : '正在上传...')"
          />
          
          <!-- Upload controls -->
          <div v-if="isUploading" class="upload-controls">
            <button @click="togglePause" class="btn btn-secondary btn-sm">
              {{ isPaused ? '继续' : '暂停' }}
            </button>
            <button @click="cancel" class="btn btn-danger btn-sm">
              取消
            </button>
          </div>
        </div>
      </div>
    </TabView>

    <!-- Results & Logs Tabs -->
    <div v-if="scanResult || logs.length > 0" class="results-section animate-fade-in">
      <TabView :tabs="viewTabs" v-model:activeTab="activeView">
        <div v-show="activeView === 'results'" class="tab-pane">
          <FileTable 
            v-if="scanResult && scanResult.length > 0"
            :files="scanResult" 
            v-model:filter="fileFilter"
          />
          <div v-else class="empty-state">
            <div class="empty-icon">🔍</div>
            <p>尚未扫描，请先执行预扫描操作。</p>
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

const currentMode = ref('sd');
const fastMode = ref(false);
const config = ref({
  sd: {
    source_dir: '',
    target_dir: '',
    overwrite_duplicates: false
  },
  dji: {
    source_dir: '',
    target_dir: '',
    overwrite_duplicates: false
  },
  favorites: {
    sd_sources: [],
    sd_targets: [],
    dji_sources: [],
    dji_targets: []
  }
});

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

const modeTabs = [
  { id: 'sd', label: 'SD卡模式' },
  { id: 'dji', label: 'DJI模式' }
];

const viewTabs = [
  { id: 'results', label: '扫描结果' },
  { id: 'logs', label: '日志' }
];

const canStart = computed(() => {
  const modeConfig = config.value[currentMode.value];
  return modeConfig.source_dir && modeConfig.target_dir;
});

onMounted(async () => {
  try {
    const savedConfig = await invoke('get_config');
    config.value = { ...config.value, ...savedConfig };
    if (!config.value.favorites) {
      config.value.favorites = { sd_sources: [], sd_targets: [], dji_sources: [], dji_targets: [] };
    }
  } catch (e) {
    addLog('warning', '无法加载配置: ' + e);
  }

  await listen('upload-progress', (event) => {
    progress.value = event.payload;
  });
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
    activeView.value = 'results';
  } catch (e) {
    addLog('error', '扫描失败: ' + e);
    alert('扫描失败: ' + e);
  } finally {
    isScanning.value = false;
    progress.value = { current: 0, total: 0, filename: '' };
  }
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
  gap: var(--space-6);
}

.mode-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.config-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-6);
}

@media (min-width: 768px) {
  .config-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.favorites-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-6);
}

@media (min-width: 768px) {
  .favorites-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.panel-header {
  font-weight: 600;
  color: var(--color-text-main);
  margin-bottom: var(--space-2);
}

.fav-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 200px;
  overflow-y: auto;
}

.fav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface-50);
  border: 1px solid var(--surface-200);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.fav-item:hover {
  background: white;
  border-color: var(--primary-300);
  transform: translateX(2px);
}

.fav-info {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.fav-basename {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--color-text-main);
}

.fav-path {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
}

.btn-icon-danger:hover {
  color: var(--color-error);
  background: #fef2f2;
}

.empty-fav {
  text-align: center;
  color: var(--color-text-light);
  font-size: 0.875rem;
  padding: var(--space-2);
}

.options-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.options-group {
  display: flex;
  gap: var(--space-6);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
  user-select: none;
}

.checkbox-label input {
  display: none;
}

.checkbox-custom {
  width: 1.25rem;
  height: 1.25rem;
  border: 2px solid var(--surface-300);
  border-radius: var(--radius-sm);
  background: white;
  position: relative;
  transition: all var(--transition-fast);
}

.checkbox-label input:checked + .checkbox-custom {
  background: var(--primary-600);
  border-color: var(--primary-600);
}

.checkbox-label input:checked + .checkbox-custom::after {
  content: '';
  position: absolute;
  left: 6px;
  top: 2px;
  width: 5px;
  height: 10px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.options-hint {
  font-size: 0.875rem;
  color: var(--color-text-muted);
  margin-left: 2rem;
}

.action-bar {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-4);
  margin-top: var(--space-2);
}

.progress-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.upload-controls {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.results-section {
  margin-top: var(--space-8);
}

.tab-pane {
  min-height: 200px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-12);
  text-align: center;
  color: var(--color-text-muted);
  background: white;
  border-radius: var(--radius-lg);
  border: 1px dashed var(--surface-300);
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: var(--space-4);
  opacity: 0.5;
}

.log-actions {
  margin-top: var(--space-4);
  display: flex;
  justify-content: flex-end;
}
</style>
