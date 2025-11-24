<template>
  <div class="flex flex-col gap-6">
    <!-- Configuration Section -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <FileSelector 
        title="源目录 (SD卡)" 
        :path="config.source_dir" 
        @update:path="updateSource"
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
        :path="config.target_dir" 
        @update:path="updateTarget"
        placeholder="请选择备份目标文件夹"
      >
        <template #icon>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
          </svg>
        </template>
      </FileSelector>
    </div>

    <!-- Options -->
    <div class="glass-panel p-4 flex items-center gap-4">
      <label class="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" v-model="config.overwrite_duplicates" class="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500">
        <span class="text-gray-700">覆盖重复文件</span>
      </label>
    </div>

    <!-- Actions -->
    <div class="flex justify-end gap-4" v-if="!isScanning && !isUploading">
      <button @click="startScan" class="btn btn-primary px-8 py-3 text-lg shadow-lg shadow-blue-200" :disabled="!canStart">
        开始扫描
      </button>
    </div>

    <!-- Progress Section -->
    <div v-if="isScanning || isUploading || scanResult" class="glass-panel p-6 animate-fade-in">
      <div class="flex justify-between items-center mb-4">
        <h3 class="font-semibold text-lg">
          {{ statusMessage }}
        </h3>
        <div class="flex gap-2" v-if="isUploading">
          <button @click="togglePause" class="btn btn-secondary text-sm">
            {{ isPaused ? '继续' : '暂停' }}
          </button>
          <button @click="cancel" class="btn btn-secondary text-sm text-red-500 hover:bg-red-50">
            取消
          </button>
        </div>
      </div>

      <!-- Stats Grid -->
      <div v-if="scanResult" class="grid grid-cols-3 gap-4 mb-6">
        <StatusCard label="将上传" :value="stats.upload" color="blue" />
        <StatusCard label="将覆盖" :value="stats.overwrite" color="yellow" />
        <StatusCard label="将跳过" :value="stats.skip" color="gray" />
      </div>

      <!-- Progress Bar -->
      <ProgressBar 
        v-if="isUploading"
        :current="progress.current" 
        :total="progress.total" 
        :filename="progress.filename"
      />

      <!-- Action after scan -->
      <div v-if="scanResult && !isUploading && !isScanning" class="flex justify-end mt-4">
        <button @click="startUpload" class="btn btn-primary">
          确认上传 ({{ stats.upload + stats.overwrite }} 个文件)
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import FileSelector from '../components/FileSelector.vue';
import StatusCard from '../components/StatusCard.vue';
import ProgressBar from '../components/ProgressBar.vue';

const config = ref({
  source_dir: '',
  target_dir: '',
  overwrite_duplicates: false
});

const isScanning = ref(false);
const isUploading = ref(false);
const isPaused = ref(false);
const scanResult = ref(null);
const progress = ref({ current: 0, total: 0, filename: '' });

const canStart = computed(() => config.value.source_dir && config.value.target_dir);

const stats = computed(() => {
  if (!scanResult.value) return { upload: 0, overwrite: 0, skip: 0 };
  return scanResult.value.reduce((acc, file) => {
    if (file.status === 'upload') acc.upload++;
    else if (file.status === 'overwrite') acc.overwrite++;
    else if (file.status === 'skip') acc.skip++;
    return acc;
  }, { upload: 0, overwrite: 0, skip: 0 });
});

const statusMessage = computed(() => {
  if (isScanning.value) return '正在扫描文件...';
  if (isUploading.value) return isPaused.value ? '上传已暂停' : '正在上传文件...';
  if (scanResult.value) return '扫描完成';
  return '';
});

onMounted(async () => {
  try {
    const savedConfig = await invoke('get_config');
    config.value = { ...config.value, ...savedConfig };
  } catch (e) {
    console.error('Failed to load config', e);
  }

  await listen('upload-progress', (event) => {
    progress.value = event.payload;
  });
});

async function updateSource(path) {
  config.value.source_dir = path;
  await saveConfig();
}

async function updateTarget(path) {
  config.value.target_dir = path;
  await saveConfig();
}

async function saveConfig() {
  try {
    await invoke('save_config', { config: config.value });
  } catch (e) {
    console.error('Failed to save config', e);
  }
}

async function startScan() {
  isScanning.value = true;
  scanResult.value = null;
  try {
    const files = await invoke('scan_files', {
      sourceDir: config.value.source_dir,
      targetDir: config.value.target_dir,
      overwriteDuplicates: config.value.overwrite_duplicates
    });
    scanResult.value = files;
  } catch (e) {
    console.error('Scan failed', e);
    alert('扫描失败: ' + e);
  } finally {
    isScanning.value = false;
  }
}

async function startUpload() {
  if (!scanResult.value) return;
  isUploading.value = true;
  isPaused.value = false;
  try {
    await invoke('upload_files', { files: scanResult.value });
    alert('上传完成!');
    scanResult.value = null; // Reset after success
  } catch (e) {
    console.error('Upload failed', e);
    alert('上传失败: ' + e);
  } finally {
    isUploading.value = false;
  }
}

async function togglePause() {
  if (isPaused.value) {
    await invoke('resume_upload');
    isPaused.value = false;
  } else {
    await invoke('pause_upload');
    isPaused.value = true;
  }
}

async function cancel() {
  await invoke('cancel_upload');
  isUploading.value = false;
  isPaused.value = false;
}
</script>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
