<template>
  <div class="flex flex-col gap-6">
    <!-- Mode Switching Tabs -->
    <TabView :tabs="modeTabs" v-model:activeTab="currentMode">
      <div class="mode-content">
        <!-- Configuration Section -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FileSelector 
            :title="`源目录 (${currentMode === 'sd' ? 'SD卡' : 'DJI'})`"
            :path="config[currentMode].source_dir" 
            @update:path="updateSource"
            @addFavorite="addSourceFavorite"
            placeholder="请选择包含照片/视频的文件夹"
          >
            <template #icon>
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
            </template>
          </FileSelector>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="glass-panel p-4 flex flex-col gap-3">
            <div class="font-semibold">来源收藏夹</div>
            <div class="fav-list">
              <div v-for="p in sourceFavorites" :key="p" class="fav-item">
                <div class="fav-path" @click="selectSource(p)">{{ dirname(p) }}/<span class="fav-basename">{{ basename(p) }}</span></div>
                <button class="btn btn-secondary" @click="removeSourceFavorite(p)">删除</button>
              </div>
            </div>
          </div>

          <div class="glass-panel p-4 flex flex-col gap-3">
            <div class="font-semibold">目标收藏夹</div>
            <div class="fav-list">
              <div v-for="p in targetFavorites" :key="p" class="fav-item">
                <div class="fav-path" @click="selectTarget(p)">{{ dirname(p) }}/<span class="fav-basename">{{ basename(p) }}</span></div>
                <button class="btn btn-secondary" @click="removeTargetFavorite(p)">删除</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Options -->
        <div class="glass-panel p-4 flex flex-col gap-3">
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" v-model="config[currentMode].overwrite_duplicates" class="w-5 h-5 text-blue-600 rounded border-gray-300">
            <span class="text-gray-700">覆盖重复文件</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" v-model="fastMode" class="w-5 h-5 text-blue-600 rounded border-gray-300">
            <span class="text-gray-700">快速扫描</span>
          </label>
          <p class="text-sm text-gray-500 ml-7">快速模式将跳过 EXIF/元数据解析，直接使用文件修改时间</p>
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-4" v-if="!isScanning && !isUploading">
          <button @click="startScan" class="btn btn-secondary px-6 py-2" :disabled="!canStart">
            预扫描
          </button>
          <button @click="startUpload" class="btn btn-primary px-8 py-3 text-lg shadow-lg shadow-blue-200" :disabled="!scanResult || scanResult.length === 0">
            开始上传
          </button>
        </div>

        <!-- Progress Bar during scan/upload -->
        <ProgressBar 
          v-if="isScanning || isUploading"
          :current="progress.current" 
          :total="progress.total" 
          :filename="progress.filename || (isScanning ? '正在扫描...' : '正在上传...')"
        />

        <!-- Upload controls -->
        <div v-if="isUploading" class="flex justify-end gap-2">
          <button @click="togglePause" class="btn btn-secondary text-sm">
            {{ isPaused ? '继续' : '暂停' }}
          </button>
          <button @click="cancel" class="btn btn-secondary text-sm text-red-500 hover:bg-red-50">
            取消
          </button>
        </div>
      </div>
    </TabView>

    <!-- Results & Logs Tabs -->
    <TabView :tabs="viewTabs" v-model:activeTab="activeView" v-if="scanResult || logs.length > 0">
      <div v-show="activeView === 'results'" class="tab-pane">
        <FileTable 
          v-if="scanResult && scanResult.length > 0"
          :files="scanResult" 
          v-model:filter="fileFilter"
        />
        <div v-else class="empty-state">
          尚未扫描，请先执行预扫描操作。
        </div>
      </div>
      <div v-show="activeView === 'logs'" class="tab-pane">
        <LogViewer :logs="logs" />
        <button @click="clearLogs" class="btn btn-secondary mt-4">
          清空日志
        </button>
      </div>
    </TabView>
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
      source_dir: modeConfig.source_dir,
      target_dir: modeConfig.target_dir,
      overwrite_duplicates: modeConfig.overwrite_duplicates,
      mode: currentMode.value,
      fast_mode: fastMode.value
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
.mode-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.tab-pane {
  min-height: 200px;
}

.empty-state {
  padding: 3rem;
  text-align: center;
  color: #9ca3af;
  background: white;
  border-radius: 0.75rem;
  border: 1px solid #e5e7eb;
}

.animate-fade-in {
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
