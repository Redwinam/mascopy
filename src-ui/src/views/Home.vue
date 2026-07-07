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
            <div class="mode-indicator">{{ currentMode === "sd" ? "SD卡模式" : "DJI模式" }}</div>
          </div>

          <div class="card-body">
            <FileSelector
              :title="`选择${currentMode === 'sd' ? 'SD卡' : 'DJI设备'}路径`"
              :path="config[currentMode].source_dir"
              @update:path="updateSource"
              @addFavorite="addSourceFavorite"
              placeholder="请选择包含照片/视频的文件夹"
              class="main-selector">
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
                  <div class="fav-icon-box">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="fav-folder-icon">
                      <path
                        d="M19.5 21a3 3 0 003-3v-4.5a3 3 0 00-3-3h-15a3 3 0 00-3 3V18a3 3 0 003 3h15zM1.5 10.146V6a3 3 0 013-3h5.379a2.25 2.25 0 011.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 013 3v1.146A4.483 4.483 0 0019.5 9h-15a4.483 4.483 0 00-3 1.146z" />
                    </svg>
                  </div>
                  <span class="fav-path">{{ p }}</span>
                  <button class="fav-remove" @click.stop="removeSourceFavorite(p)">
                    <svg xmlns="http://www.w3.org/2000/svg" style="width: 14px; height: 14px" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            <FileSelector title="选择备份位置" :path="config[currentMode].target_dir" @update:path="updateTarget" @addFavorite="addTargetFavorite" placeholder="请选择备份目标文件夹" class="main-selector">
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
                  <div class="fav-icon-box">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="fav-folder-icon">
                      <path
                        d="M19.5 21a3 3 0 003-3v-4.5a3 3 0 00-3-3h-15a3 3 0 00-3 3V18a3 3 0 003 3h15zM1.5 10.146V6a3 3 0 013-3h5.379a2.25 2.25 0 011.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 013 3v1.146A4.483 4.483 0 0019.5 9h-15a4.483 4.483 0 00-3 1.146z" />
                    </svg>
                  </div>
                  <span class="fav-path">{{ p }}</span>
                  <button class="fav-remove" @click.stop="removeTargetFavorite(p)">
                    <svg xmlns="http://www.w3.org/2000/svg" style="width: 14px; height: 14px" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            <input type="checkbox" v-model="config[currentMode].overwrite_duplicates" />
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
            <input type="checkbox" v-model="fastMode" />
            <div class="toggle-box">
              <span class="check-mark" v-if="fastMode">✓</span>
            </div>
            <div class="option-text">
              <span class="option-title">快速扫描模式</span>
              <span class="option-desc">仅对比修改时间 (跳过EXIF)</span>
            </div>
          </label>

          <div class="divider-vertical"></div>

          <label class="toggle-option" :class="{ active: ignoreThumbnails }">
            <input type="checkbox" v-model="ignoreThumbnails" />
            <div class="toggle-box">
              <span class="check-mark" v-if="ignoreThumbnails">✓</span>
            </div>
            <div class="option-text">
              <span class="option-title">忽略缩略图文件夹</span>
              <span class="option-desc">自动跳过 THMBNL 等缩略图目录</span>
            </div>
          </label>
        </div>

        <button @click="startScan" class="start-btn" :disabled="!canStart || isScanning">
          <span v-if="isScanning" class="spinner"></span>
          <span>{{ isScanning ? "扫描中..." : "开始扫描" }}</span>
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
      <Teleport to="#header-right-slot" v-if="currentStep === 'results'">
        <button @click="goBack" class="btn btn-weak btn-icon" :disabled="isUploading" data-no-drag>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          返回配置
        </button>
      </Teleport>
      <Teleport to="#header-center-slot" v-if="currentStep === 'results'">
        <TabView :tabs="viewTabs" v-model:activeTab="activeView" class="header-tabs" :showContent="false" data-no-drag />
      </Teleport>

      <div class="results-content">
        <div v-show="activeView === 'results'" class="tab-pane">
          <div class="filter-row" v-if="availableDates.length > 0 || availableExtensions.length > 0">
            <div class="date-filter-section" v-if="availableDates.length > 0">
              <div class="date-filter-header">
                <span class="section-label">日期筛选</span>
                <div class="date-actions">
                  <button @click="selectAllDates" class="filter-action">全部</button>
                  <button @click="deselectAllDates" class="filter-action">清除</button>
                </div>
              </div>
              <div class="date-list">
                <div v-for="item in availableDates" :key="item.date" :class="['date-chip', { active: selectedDates.includes(item.date) }]" @click="toggleDate(item.date)">
                  <span class="date-text">{{ item.date }}</span>
                  <span class="date-count">{{ item.count }}</span>
                </div>
              </div>
            </div>

            <div class="ext-filter-section" v-if="availableExtensions.length > 0">
              <div class="date-filter-header">
                <span class="section-label">后缀筛选</span>
                <div class="date-actions">
                  <button @click="selectAllExtensions" class="filter-action">全部</button>
                  <button @click="deselectAllExtensions" class="filter-action">清除</button>
                </div>
              </div>
              <div class="date-list">
                <div v-for="item in availableExtensions" :key="item.key" :class="['date-chip', { active: selectedExtensions.includes(item.key) }]" @click="toggleExtension(item.key)">
                  <span class="date-text">{{ item.label }}</span>
                  <span class="date-count">{{ item.count }}</span>
                </div>
              </div>
            </div>
          </div>

          <FileTable v-if="filesToDisplay && filesToDisplay.length > 0" :files="filesToDisplay" :progress-map="fileProgress" v-model:filter="fileFilter" :selectable="selectionMode" v-model:selectedKeys="selectedKeys">
            <template #actions>
              <div v-if="isUploading" class="upload-status-bar animate-fade-in">
                <div class="inline-progress">
                  <div class="progress-text">
                    <span class="progress-filename" :title="progress.filename">{{ progress.filename || "准备中..." }}</span>
                    <span class="progress-percent">{{ progressPercentage.toFixed(1) }}%</span>
                  </div>
                  <div class="progress-track-mini">
                    <div class="progress-fill-mini" :style="{ width: progressPercentage + '%' }"></div>
                  </div>
                  <div class="progress-meta">
                    <span>{{ formatBytes(progress.overall_done) }} / {{ formatBytes(progress.overall_total) }}</span>
                    <span class="progress-dot">·</span>
                    <span>{{ progress.current }}/{{ progress.total }}文件</span>
                    <span class="progress-dot">·</span>
                    <span>{{ formatSpeed(progress.speed) }}</span>
                    <template v-if="etaText">
                      <span class="progress-dot">·</span>
                      <span>{{ etaText }}</span>
                    </template>
                  </div>
                </div>
                <div class="inline-controls">
                  <button @click="togglePause" class="btn-icon-only" :title="isPaused ? '继续' : '暂停'">
                    <svg v-if="isPaused" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                  <button @click="cancel" class="btn-icon-only text-danger" title="取消">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                </div>
              </div>
              <div v-else class="action-buttons">
                <template v-if="selectionMode">
                  <button @click="exitSelectionMode" class="btn btn-secondary">退出选择</button>
                  <button @click="startUpload(selectedUploadFiles)" class="btn btn-primary btn-action-upload" :disabled="selectedCount === 0">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    上传选中 ({{ selectedCount }})
                  </button>
                </template>
                <template v-else>
                  <button @click="enterSelectionMode" class="btn btn-secondary" :disabled="!filesToDisplay || filesToDisplay.length === 0">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7l-2 2-1-1" />
                    </svg>
                    选择文件
                  </button>
                  <button @click="startUpload(filesToDisplay)" class="btn btn-primary btn-action-upload" :disabled="!filesToDisplay || filesToDisplay.length === 0">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    开始上传
                  </button>
                </template>
              </div>
            </template>
          </FileTable>
          <div v-else-if="scanResult && scanResult.length > 0" class="empty-state">
            <div class="empty-icon">📅</div>
            <p>请选择至少一个日期和后缀以查看文件</p>
          </div>
          <div v-else class="empty-state">
            <div class="empty-icon">🔍</div>
            <p>未找到符合条件的文件</p>
          </div>
        </div>
        <div v-show="activeView === 'logs'" class="tab-pane">
          <LogViewer :logs="logs" />
          <div class="log-actions">
            <button @click="clearLogs" class="btn btn-secondary btn-sm">清空日志</button>
          </div>
        </div>
      </div>
    </div>

    <Modal v-if="showSuccessModal" @close="showSuccessModal = false">
      <template #title>🎉 备份完成</template>
      <div class="success-content">
        <div class="success-icon-wrapper">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-16 h-16 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p class="success-message">所有选中的文件已成功备份到目标目录。</p>
        <p class="success-submessage">现在您可以安全地移除源设备。</p>
      </div>
      <template #footer>
        <button class="btn btn-secondary" @click="showSuccessModal = false">关闭</button>
        <button class="btn btn-primary" @click="ejectVolume">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          推出设备
        </button>
      </template>
    </Modal>

    <Modal v-if="noticeModal.visible" @close="closeNotice">
      <template #title>{{ noticeModal.title }}</template>
      <div class="notice-content">
        <div class="notice-icon-wrapper" :class="`notice-${noticeModal.type}`">
          <svg v-if="noticeModal.type === 'success'" xmlns="http://www.w3.org/2000/svg" class="w-14 h-14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <svg v-else-if="noticeModal.type === 'warning'" xmlns="http://www.w3.org/2000/svg" class="w-14 h-14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 4h.01M10.29 3.86l-8.5 14.69A1 1 0 002.64 20h16.72a1 1 0 00.86-1.45l-8.5-14.69a1 1 0 00-1.73 0z" />
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" class="w-14 h-14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 4h.01M12 5a7 7 0 11-.001 14.001A7 7 0 0112 5z" />
          </svg>
        </div>
        <p class="notice-message">{{ noticeModal.message }}</p>
        <p v-if="noticeModal.submessage" class="notice-submessage">{{ noticeModal.submessage }}</p>
      </div>
      <template #footer>
        <button class="btn btn-primary" @click="closeNotice">知道了</button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import FileSelector from "../components/FileSelector.vue";
import ProgressBar from "../components/ProgressBar.vue";
import TabView from "../components/TabView.vue";
import FileTable from "../components/FileTable.vue";
import LogViewer from "../components/LogViewer.vue";
import Modal from "../components/Modal.vue";
import { useAppState } from "../composables/useAppState.js";

const { currentMode, config, currentStep } = useAppState();
const fastMode = ref(true);
const ignoreThumbnails = ref(true);

const isScanning = ref(false);
const isUploading = ref(false);
const isPaused = ref(false);
const showSuccessModal = ref(false);
const noticeModal = ref({
  visible: false,
  title: "",
  message: "",
  submessage: "",
  type: "info",
});
const scanResult = ref(null);
const progress = ref({
  current: 0,
  total: 0,
  filename: "",
  overall_done: 0,
  overall_total: 0,
  speed: 0,
});
// 单文件进度，按源文件路径索引：{ [path]: { status, done, total } }
const fileProgress = ref({});
const logs = ref([]);
const activeView = ref("results");
const fileFilter = ref("all");
const selectedDates = ref([]);
const selectedExtensions = ref([]);
// 选择模式：用户手动勾选要上传的文件（key = 源文件路径）
const selectionMode = ref(false);
const selectedKeys = ref([]);

// 整体进度按已传字节 / 总字节计算，避免大小悬殊文件造成跳变
const progressPercentage = computed(() => {
  const total = progress.value.overall_total;
  if (!total) return 0;
  return Math.min(100, Math.max(0, (progress.value.overall_done / total) * 100));
});

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec) return "--";
  return formatBytes(bytesPerSec) + "/s";
}

const etaText = computed(() => {
  const { overall_done, overall_total, speed } = progress.value;
  if (!speed || !overall_total || overall_done >= overall_total) return "";
  const remaining = overall_total - overall_done;
  const seconds = Math.round(remaining / speed);
  if (seconds < 60) return `约${seconds}秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `约${m}分${s}秒`;
  const h = Math.floor(m / 60);
  return `约${h}时${m % 60}分`;
});

const availableDates = computed(() => {
  if (!scanResult.value) return [];
  const dates = {};
  scanResult.value.forEach((file) => {
    let date;
    if (file.date.secs_since_epoch !== undefined) {
      date = new Date(file.date.secs_since_epoch * 1000);
    } else {
      date = new Date(file.date);
    }
    const dateStr = date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-");
    if (!dates[dateStr]) {
      dates[dateStr] = { date: dateStr, count: 0 };
    }
    dates[dateStr].count++;
  });
  return Object.values(dates).sort((a, b) => b.date.localeCompare(a.date));
});

const availableExtensions = computed(() => {
  if (!scanResult.value) return [];
  const extensions = {};
  scanResult.value.forEach((file) => {
    const info = getFileExtensionInfo(file.filename);
    if (!extensions[info.key]) {
      extensions[info.key] = { key: info.key, label: info.label, count: 0 };
    }
    extensions[info.key].count++;
  });
  return Object.values(extensions).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.label.localeCompare(b.label);
  });
});

const filesToDisplay = computed(() => {
  if (!scanResult.value) return [];
  if (selectedDates.value.length === 0) return [];
  if (selectedExtensions.value.length === 0) return [];

  return scanResult.value.filter((file) => {
    let date;
    if (file.date.secs_since_epoch !== undefined) {
      date = new Date(file.date.secs_since_epoch * 1000);
    } else {
      date = new Date(file.date);
    }
    const dateStr = date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-");
    const info = getFileExtensionInfo(file.filename);
    return selectedDates.value.includes(dateStr) && selectedExtensions.value.includes(info.key);
  });
});

function normalizePath(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof value.path === "string") return value.path;
  return String(value);
}

// 选择模式下实际会上传的文件：当前显示、可上传(将上传/将覆盖)且被勾选
const selectedUploadFiles = computed(() => {
  if (!selectionMode.value) return [];
  const set = new Set(selectedKeys.value);
  return filesToDisplay.value.filter((f) => (f.status === "upload" || f.status === "overwrite") && set.has(normalizePath(f.path)));
});

const selectedCount = computed(() => selectedUploadFiles.value.length);

function enterSelectionMode() {
  selectionMode.value = true;
  selectedKeys.value = [];
}

function exitSelectionMode() {
  selectionMode.value = false;
  selectedKeys.value = [];
}

function toggleDate(date) {
  if (selectedDates.value.includes(date)) {
    selectedDates.value = selectedDates.value.filter((d) => d !== date);
  } else {
    selectedDates.value.push(date);
  }
}

function selectAllDates() {
  selectedDates.value = availableDates.value.map((d) => d.date);
}

function deselectAllDates() {
  selectedDates.value = [];
}

function toggleExtension(key) {
  if (selectedExtensions.value.includes(key)) {
    selectedExtensions.value = selectedExtensions.value.filter((e) => e !== key);
  } else {
    selectedExtensions.value.push(key);
  }
}

function selectAllExtensions() {
  selectedExtensions.value = availableExtensions.value.map((e) => e.key);
}

function deselectAllExtensions() {
  selectedExtensions.value = [];
}

function getFileExtensionInfo(filename) {
  if (!filename) return { key: "noext", label: "无后缀" };
  const text = String(filename);
  const lastDot = text.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === text.length - 1) return { key: "noext", label: "无后缀" };
  const label = text.slice(lastDot + 1);
  return { key: label.toLowerCase(), label: label.toUpperCase() };
}

const sourceFavorites = computed(() => {
  if (currentMode.value === "sd") return config.value.favorites.sd_sources || [];
  const arr = config.value.favorites.dji_sources || [];
  return Array.isArray(arr) ? arr.map((x) => (typeof x === "string" ? x : x.path)) : [];
});
const targetFavorites = computed(() => {
  if (currentMode.value === "sd") return config.value.favorites.sd_targets || [];
  return config.value.favorites.dji_targets || [];
});

const viewTabs = [
  { id: "results", label: "扫描结果" },
  { id: "logs", label: "日志" },
];

const canStart = computed(() => {
  const modeConfig = config.value[currentMode.value];
  return modeConfig && modeConfig.source_dir && modeConfig.target_dir;
});

onMounted(async () => {
  try {
    const savedConfig = await invoke("get_config");
    // Merge saved config but preserve defaults if missing
    if (savedConfig) {
      if (savedConfig.sd) config.value.sd = { ...config.value.sd, ...savedConfig.sd };
      if (savedConfig.dji) config.value.dji = { ...config.value.dji, ...savedConfig.dji };
      if (savedConfig.favorites) {
        config.value.favorites = savedConfig.favorites;
      }
    }
  } catch (e) {
    addLog("warning", "无法加载配置: " + e);
  }

  const isTauri = typeof window !== "undefined" && (window.__TAURI__ !== undefined || window.__TAURI_INTERNALS__ !== undefined || window.__TAURI_INTERNALS__?.invoke !== undefined);

  if (!isTauri) return;

  try {
    await listen("upload-progress", (event) => {
      const p = event.payload;
      progress.value = p;
      if (p.path) {
        fileProgress.value = {
          ...fileProgress.value,
          [p.path]: {
            status: p.status,
            done: p.file_done,
            total: p.file_total,
          },
        };
      }
    });
  } catch (e) {
    addLog("warning", "无法监听上传进度事件: " + e);
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
    await invoke("save_config", { config: config.value });
  } catch (e) {
    addLog("error", "保存配置失败: " + e);
  }
}

function basename(p) {
  if (!p) return "";
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function dirname(p) {
  if (!p) return "";
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (idx <= 0) return "";
  return p.slice(0, idx);
}

async function addSourceFavorite() {
  const p = config.value[currentMode.value].source_dir;
  if (!p) return;
  if (currentMode.value === "sd") {
    const arr = config.value.favorites.sd_sources;
    if (!arr.includes(p)) arr.unshift(p);
    config.value.favorites.sd_sources = arr.slice(0, 8);
  } else {
    const arr = config.value.favorites.dji_sources || [];
    const exists = Array.isArray(arr) && arr.some((x) => (typeof x === "string" ? x === p : x.path === p));
    if (!exists) {
      const item = { path: p };
      arr.unshift(item);
    }
    config.value.favorites.dji_sources = arr.slice(0, 8);
  }
  await saveConfig();
}

async function removeSourceFavorite(item) {
  if (currentMode.value === "sd") {
    config.value.favorites.sd_sources = (config.value.favorites.sd_sources || []).filter((x) => x !== item);
  } else {
    config.value.favorites.dji_sources = (config.value.favorites.dji_sources || []).filter((x) => (typeof x === "string" ? x !== item : x.path !== item));
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
  if (currentMode.value === "sd") {
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
  if (currentMode.value === "sd") {
    config.value.favorites.sd_targets = (config.value.favorites.sd_targets || []).filter((x) => x !== p);
  } else {
    config.value.favorites.dji_targets = (config.value.favorites.dji_targets || []).filter((x) => x !== p);
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
  selectedDates.value = [];
  selectedExtensions.value = [];
  selectionMode.value = false;
  selectedKeys.value = [];
  // 清空上一轮上传的逐文件进度，否则改目标目录后重新扫描时
  // 残留的 skipped/done 记录会按源路径命中，覆盖新的扫描状态
  fileProgress.value = {};
  progress.value = { current: 0, total: 0, filename: "正在扫描..." };
  addLog("info", "开始扫描...");

  try {
    const modeConfig = config.value[currentMode.value];
    const files = await invoke("scan_files", {
      args: {
        sourceDir: modeConfig.source_dir,
        targetDir: modeConfig.target_dir,
        overwriteDuplicates: modeConfig.overwrite_duplicates,
        mode: currentMode.value,
        fastMode: fastMode.value,
        ignoreThumbnails: ignoreThumbnails.value,
      },
    });

    scanResult.value = files;

    // Initialize selectedDates with all found dates
    const dates = new Set();
    const extensions = new Set();
    files.forEach((file) => {
      let date;
      if (file.date.secs_since_epoch !== undefined) {
        date = new Date(file.date.secs_since_epoch * 1000);
      } else {
        date = new Date(file.date);
      }
      const dateStr = date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-");
      dates.add(dateStr);
      extensions.add(getFileExtensionInfo(file.filename).key);
    });
    selectedDates.value = Array.from(dates);
    selectedExtensions.value = Array.from(extensions);

    addLog("success", `扫描完成，共找到 ${files.length} 个文件`);
    currentStep.value = "results"; // Switch to results view
    activeView.value = "results";
  } catch (e) {
    const errorText = String(e);
    addLog("error", "扫描失败: " + errorText);
    if (errorText.includes("源路径不存在")) {
      openNotice({
        title: "源路径不可用",
        message: "未检测到源设备，请确认已挂载并重新选择目录。",
        type: "warning",
      });
    } else if (errorText.includes("目标路径不存在")) {
      openNotice({
        title: "目标路径不可用",
        message: "目标磁盘可能未挂载或目录已被移动，请确认后重新选择备份位置。",
        type: "warning",
      });
    } else {
      openNotice({
        title: "扫描失败",
        message: errorText,
        type: "error",
      });
    }
  } finally {
    isScanning.value = false;
    progress.value = { current: 0, total: 0, filename: "" };
  }
}

function goBack() {
  currentStep.value = "config";
}

async function startUpload(files) {
  const uploadList = Array.isArray(files) ? files : filesToDisplay.value;
  if (!uploadList || uploadList.length === 0) return;
  isUploading.value = true;
  isPaused.value = false;
  fileProgress.value = {};
  const totalBytes = uploadList.filter((f) => f.status === "upload" || f.status === "overwrite").reduce((sum, f) => sum + (f.size || 0), 0);
  progress.value = {
    current: 0,
    total: uploadList.length,
    filename: "准备中...",
    overall_done: 0,
    overall_total: totalBytes,
    speed: 0,
  };
  addLog("info", `开始上传 (${uploadList.length} 个文件)...`);

  try {
    await invoke("upload_files", { files: uploadList });
    addLog("success", "上传完成!");
    showSuccessModal.value = true;
    scanResult.value = null;
    selectionMode.value = false;
    selectedKeys.value = [];
    currentStep.value = "config"; // Return to config after success
  } catch (e) {
    const errorText = String(e);
    addLog("error", "上传失败: " + errorText);
    openNotice({
      title: "上传失败",
      message: errorText,
      type: "error",
    });
  } finally {
    isUploading.value = false;
  }
}

async function ejectVolume() {
  const modeConfig = config.value[currentMode.value];
  if (!modeConfig || !modeConfig.source_dir) return;

  try {
    addLog("info", "正在推出设备...");
    await invoke("eject_volume", { path: modeConfig.source_dir });
    addLog("success", "设备已推出");
    showSuccessModal.value = false;
    openNotice({
      title: "设备已安全推出",
      message: "现在可以安全移除源设备。",
      type: "success",
    });
  } catch (e) {
    const errorText = String(e);
    addLog("error", "推出失败: " + errorText);
    openNotice({
      title: "推出失败",
      message: errorText,
      type: "error",
    });
  }
}

async function togglePause() {
  if (isPaused.value) {
    await invoke("resume_upload");
    isPaused.value = false;
    addLog("info", "继续上传");
  } else {
    await invoke("pause_upload");
    isPaused.value = true;
    addLog("warning", "上传已暂停");
  }
}

async function cancel() {
  await invoke("cancel_upload");
  isUploading.value = false;
  isPaused.value = false;
  addLog("warning", "上传已取消");
}

function addLog(type, message) {
  logs.value.push({
    type,
    message,
    time: new Date(),
  });
}

function clearLogs() {
  logs.value = [];
}

function openNotice({ title, message, submessage = "", type = "info" }) {
  noticeModal.value = {
    visible: true,
    title,
    message,
    submessage,
    type,
  };
}

function closeNotice() {
  noticeModal.value = {
    visible: false,
    title: "",
    message: "",
    submessage: "",
    type: "info",
  };
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
  padding: var(--space-4) var(--space-6);
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
  gap: 0.35rem;
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
  background: var(--surface-overlay-faint);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  padding: 0.4rem 0.6rem;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.85rem;
  color: var(--color-text-main);
  gap: var(--space-3);
  position: relative;
  margin-bottom: 2px;
}

.fav-item:hover {
  background: var(--surface-overlay-soft);
  border-color: var(--surface-200);
  transform: translateX(2px);
  box-shadow: var(--shadow-sm);
}

.fav-icon-box {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-400);
  flex-shrink: 0;
}

.fav-folder-icon {
  width: 16px;
  height: 16px;
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
  color: var(--color-text-muted);
  font-family: "SF Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  opacity: 0.9;
  line-height: 1.4;
}

.fav-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  color: var(--color-text-light);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all var(--transition-fast);
  opacity: 0;
  flex-shrink: 0;
}

.fav-item:hover .fav-remove {
  opacity: 1;
}

.fav-remove:hover {
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
  to {
    transform: rotate(360deg);
  }
}

.btn-icon {
  gap: var(--space-2);
  padding: 0.5rem 0.85rem;
}

/* Results View */
.results-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: var(--space-4);
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

/* Date Filter */
.filter-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

@media (max-width: 900px) {
  .filter-row {
    grid-template-columns: 1fr;
  }
}

.date-filter-section,
.ext-filter-section {
  background: var(--surface-overlay-faint);
  border-radius: var(--radius-lg);
  padding: var(--space-3);
  border: 1px solid var(--surface-200);
}

.date-filter-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}

.section-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.date-actions {
  display: flex;
  gap: var(--space-1);
}

.filter-action {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  padding: 0.1rem 0.5rem;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}

.filter-action:hover {
  background: var(--surface-100);
  color: var(--primary-600);
}

.date-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  max-height: 120px;
  overflow-y: auto;
}

.date-chip {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0.35rem 0.75rem;
  border-radius: var(--radius-md);
  background: var(--surface-0);
  border: 1px solid var(--surface-300);
  cursor: pointer;
  transition: all var(--transition-fast);
  user-select: none;
}

.date-chip:hover {
  border-color: var(--primary-300);
  background: var(--surface-50);
}

.date-chip.active {
  background: var(--primary-soft);
  border-color: var(--primary-300);
  color: var(--primary-800);
}

.date-text {
  font-size: 0.875rem;
  font-weight: 500;
}

.date-count {
  font-size: 0.75rem;
  background: var(--surface-200);
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  color: var(--color-text-muted);
}

.date-chip.active .date-count {
  background: var(--surface-100);
  color: var(--primary-800);
}

@media (prefers-color-scheme: dark) {
  .date-filter-section,
  .ext-filter-section {
    background: var(--surface-100);
    border-color: var(--surface-300);
  }

  .filter-action {
    background: var(--surface-50);
    border-color: var(--surface-300);
    color: var(--primary-200);
  }

  .filter-action:hover {
    background: var(--surface-100);
    border-color: var(--primary-400);
    color: var(--primary-100);
  }

  .date-chip {
    background: var(--surface-50);
    border-color: var(--surface-300);
  }

  .date-chip:hover {
    background: var(--surface-100);
    border-color: var(--primary-400);
  }

  .date-chip.active {
    border-color: var(--primary-400);
    color: var(--primary-200);
  }

  .date-count {
    background: var(--surface-300);
    color: var(--surface-600);
  }

  .date-chip.active .date-count {
    background: var(--surface-200);
    color: var(--primary-200);
  }
}

.success-content {
  text-align: center;
  padding: var(--space-4) 0;
}

.success-icon-wrapper {
  margin-bottom: var(--space-4);
  color: #10b981; /* Success Green */
  display: flex;
  justify-content: center;
}

.success-message {
  font-size: 1.1rem;
  font-weight: 500;
  margin-bottom: var(--space-2);
}

.success-submessage {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.text-success {
  color: #10b981;
}

.notice-content {
  text-align: center;
  padding: var(--space-4) 0;
}

.notice-icon-wrapper {
  margin-bottom: var(--space-4);
  display: flex;
  justify-content: center;
}

.notice-message {
  font-size: 1.05rem;
  font-weight: 500;
  margin-bottom: var(--space-2);
}

.notice-submessage {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.notice-success {
  color: #10b981;
}

.notice-warning {
  color: #f59e0b;
}

.notice-error {
  color: #ef4444;
}

.notice-info {
  color: #38bdf8;
}

.btn-weak {
  background: transparent;
  border: 1px solid transparent;
  color: var(--color-text-muted);
  box-shadow: none;
  padding: 0.35rem 0.6rem;
  font-size: 0.85rem;
  opacity: 0.8;
}
.btn-weak:hover:not(:disabled) {
  background: var(--surface-overlay-soft);
  color: var(--color-text-main);
  box-shadow: none;
  opacity: 1;
}

.action-buttons {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.btn-action-upload {
  border-radius: var(--radius-md);
  border: none;
  padding: 0.5rem 1.5rem;
  font-size: 0.95rem;
  height: auto;
  min-height: 2.4rem;
  box-shadow: var(--shadow-sm);
  font-weight: 600;
}

.upload-status-bar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  background: var(--surface-overlay-faint);
  padding: 0.4rem 0.85rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--surface-200);
  flex: 1;
  min-width: 0;
}

.inline-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.progress-text {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--color-text-muted);
}

.progress-filename {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-main);
  font-weight: 500;
}

.progress-percent {
  font-family: monospace;
  font-weight: 600;
  color: var(--primary-600);
  flex-shrink: 0;
}

.progress-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px var(--space-1);
  font-size: 0.7rem;
  line-height: 1.3;
  color: var(--color-text-light);
  font-family: monospace;
  text-autospace: normal;
}

.progress-dot {
  opacity: 0.5;
}

.progress-track-mini {
  height: 4px;
  background: var(--surface-200);
  border-radius: 999px;
  overflow: hidden;
}

.progress-fill-mini {
  height: 100%;
  background: var(--primary-500);
  border-radius: 999px;
  transition: width 0.3s ease;
}

.inline-controls {
  display: flex;
  gap: var(--space-2);
  border-left: 1px solid var(--surface-300);
  padding-left: var(--space-3);
}

.btn-icon-only {
  background: transparent;
  border: none;
  padding: 4px;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.btn-icon-only:hover {
  background: var(--surface-200);
  color: var(--color-text-main);
}

.text-danger:hover {
  background: var(--danger-soft);
  color: var(--color-error);
}

.btn-action-upload:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
</style>
