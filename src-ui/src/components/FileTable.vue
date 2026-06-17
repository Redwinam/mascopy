<template>
  <div class="file-table-container">
    <div class="table-header-row" v-if="stats">
      <div class="filter-strip">
        <div 
          v-for="(stat, key) in stats" 
          :key="key"
          :class="['filter-item', { active: filter === key }]"
          @click="$emit('update:filter', key)"
        >
          <span class="filter-label">{{ getLabel(key) }}</span>
          <span class="filter-count" :class="`count-${key}`">{{ stat }}</span>
        </div>
      </div>
      <div class="table-actions">
        <slot name="actions"></slot>
      </div>
    </div>

    <div class="table-wrapper glass-panel">
      <table class="file-table">
        <thead>
          <tr>
            <th v-if="selectable" class="checkbox-col">
              <input
                type="checkbox"
                class="row-checkbox"
                :checked="allVisibleSelected"
                :indeterminate="someVisibleSelected"
                :disabled="selectableVisible.length === 0"
                title="全选 / 全不选"
                @change="toggleAll"
              />
            </th>
            <th>文件名 / 目标目录</th>
            <th>类型</th>
            <th>大小</th>
            <th>日期</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(file, index) in filteredFiles"
            :key="index"
            :class="{ 'row-selectable': selectable && isSelectable(file), 'row-selected': selectable && isSelected(file) }"
            @contextmenu="openContextMenu(file, $event)"
            @click="onRowClick(file)"
          >
            <td v-if="selectable" class="checkbox-col" @click.stop>
              <input
                type="checkbox"
                class="row-checkbox"
                :checked="isSelected(file)"
                :disabled="!isSelectable(file)"
                @change="toggleFile(file)"
              />
            </td>
            <td class="file-info-cell">
              <div class="file-path" :title="file.target_path">
                <span class="path-dir">{{ getTargetDir(file.target_path) }}</span>
                <span class="path-filename">{{ getTargetName(file.target_path, file.filename) }}</span>
              </div>
            </td>
            <td class="text-muted">{{ formatFileType(file.file_type) }}</td>
            <td class="text-muted">{{ formatSize(file.size) }}</td>
            <td class="text-muted date-cell">{{ formatDate(file.date) }}</td>
            <td class="status-cell">
              <template v-if="getProgress(file)">
                <div v-if="getProgress(file).status === 'uploading'" class="row-progress">
                  <div class="row-progress-track">
                    <div class="row-progress-fill" :style="{ width: filePercent(file) + '%' }"></div>
                  </div>
                  <span class="row-progress-label">{{ filePercent(file).toFixed(0) }}%</span>
                </div>
                <span v-else :class="['status-badge', resultClass(getProgress(file).status)]">
                  {{ resultLabel(getProgress(file).status) }}
                </span>
              </template>
              <span v-else :class="['status-badge', `status-${file.status}`]">
                {{ formatStatus(file.status) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="filteredFiles.length === 0" class="empty-state">
        {{ filter === 'all' ? '暂无文件' : '该状态下暂无文件' }}
      </div>
    </div>
    <teleport to="body">
      <div
        v-if="contextMenu.visible"
        ref="contextMenuRef"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <button class="context-menu-item" @click="revealInFinder">在 Finder 中显示</button>
        <button class="context-menu-item" @click="copyFilePath">复制路径</button>
      </div>
    </teleport>

    <Modal v-if="noticeModal.visible" @close="closeNotice">
      <template #title>{{ noticeModal.title }}</template>
      <div class="notice-content">
        <div class="notice-icon-wrapper">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 4h.01M12 5a7 7 0 11-.001 14.001A7 7 0 0112 5z" />
          </svg>
        </div>
        <p class="notice-message">{{ noticeModal.message }}</p>
      </div>
      <template #footer>
        <button class="btn btn-primary" @click="closeNotice">知道了</button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import Modal from './Modal.vue';

const props = defineProps({
  files: Array,
  filter: {
    type: String,
    default: 'all'
  },
  // 单文件上传进度，按源文件路径索引：{ [path]: { status, done, total } }
  progressMap: {
    type: Object,
    default: () => ({})
  },
  // 选择模式：开启后第一列显示勾选框
  selectable: {
    type: Boolean,
    default: false
  },
  // 已勾选文件的 key 列表（key = 源文件路径）
  selectedKeys: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['update:filter', 'update:selectedKeys']);

const stats = computed(() => {
  if (!props.files || props.files.length === 0) return null;
  return {
    all: props.files.length,
    upload: props.files.filter(f => f.status === 'upload').length,
    overwrite: props.files.filter(f => f.status === 'overwrite').length,
    skip: props.files.filter(f => f.status === 'skip').length,
  };
});

const filteredFiles = computed(() => {
  if (!props.files) return [];
  if (props.filter === 'all') return props.files;
  return props.files.filter(f => f.status === props.filter);
});

// ---- 选择模式 ----
const selectedSet = computed(() => new Set(props.selectedKeys));

function fileKey(file) {
  return normalizePath(file?.path);
}

// 仅「将上传 / 将覆盖」的文件可勾选，跳过的文件不会被拷贝
function isSelectable(file) {
  return !!file && (file.status === 'upload' || file.status === 'overwrite');
}

function isSelected(file) {
  return selectedSet.value.has(fileKey(file));
}

// 当前可见且可勾选的文件（受顶部状态过滤影响）
const selectableVisible = computed(() => filteredFiles.value.filter(isSelectable));

const allVisibleSelected = computed(
  () => selectableVisible.value.length > 0 && selectableVisible.value.every(f => selectedSet.value.has(fileKey(f)))
);

const someVisibleSelected = computed(
  () => !allVisibleSelected.value && selectableVisible.value.some(f => selectedSet.value.has(fileKey(f)))
);

function toggleFile(file) {
  if (!isSelectable(file)) return;
  const key = fileKey(file);
  const set = new Set(props.selectedKeys);
  if (set.has(key)) {
    set.delete(key);
  } else {
    set.add(key);
  }
  emit('update:selectedKeys', Array.from(set));
}

function toggleAll() {
  const set = new Set(props.selectedKeys);
  if (allVisibleSelected.value) {
    selectableVisible.value.forEach(f => set.delete(fileKey(f)));
  } else {
    selectableVisible.value.forEach(f => set.add(fileKey(f)));
  }
  emit('update:selectedKeys', Array.from(set));
}

function onRowClick(file) {
  if (!props.selectable) return;
  toggleFile(file);
}

const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  file: null
});
const contextMenuRef = ref(null);
const noticeModal = ref({
  visible: false,
  title: '',
  message: ''
});

function isTauriApp() {
  return (
    typeof window !== 'undefined' &&
    (window.__TAURI__ !== undefined ||
      window.__TAURI_INTERNALS__ !== undefined ||
      window.__TAURI_INTERNALS__?.invoke !== undefined)
  );
}

function openContextMenu(file, event) {
  event.preventDefault();
  const x = event.clientX;
  const y = event.clientY;
  contextMenu.value = {
    visible: true,
    x,
    y,
    file
  };
  nextTick(() => {
    const menu = contextMenuRef.value;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    let nextX = x;
    let nextY = y;
    if (rect.right > window.innerWidth) {
      nextX = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (rect.bottom > window.innerHeight) {
      nextY = Math.max(8, window.innerHeight - rect.height - 8);
    }
    if (nextX !== x || nextY !== y) {
      contextMenu.value = {
        ...contextMenu.value,
        x: nextX,
        y: nextY
      };
    }
  });
}

function closeContextMenu() {
  if (!contextMenu.value.visible) return;
  contextMenu.value = { visible: false, x: 0, y: 0, file: null };
}

async function revealInFinder() {
  const file = contextMenu.value.file;
  closeContextMenu();
  if (!file || !isTauriApp()) return;
  const rawPath = normalizePath(file.path) || normalizePath(file.target_path);
  if (!rawPath) return;
  try {
    await invoke('reveal_in_finder', { path: String(rawPath) });
  } catch (e) {
    openNotice('无法在 Finder 中显示文件', String(e));
  }
}

async function copyFilePath() {
  const file = contextMenu.value.file;
  closeContextMenu();
  if (!file) return;
  const rawPath = normalizePath(file.path) || normalizePath(file.target_path);
  if (!rawPath) return;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(String(rawPath));
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = String(rawPath);
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  } catch (e) {
    openNotice('复制路径失败', String(e));
  }
}

function onWindowBlur() {
  closeContextMenu();
}

function onWindowResize() {
  closeContextMenu();
}

function onWindowScroll() {
  closeContextMenu();
}

function onWindowClick(event) {
  const target = event.target;
  if (target && target.closest && target.closest('.context-menu')) return;
  closeContextMenu();
}

function onWindowContextMenu(event) {
  if (!contextMenu.value.visible) return;
  const target = event.target;
  if (target && target.closest && target.closest('.context-menu')) return;
  closeContextMenu();
}

onMounted(() => {
  window.addEventListener('click', onWindowClick, true);
  window.addEventListener('contextmenu', onWindowContextMenu, true);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('scroll', onWindowScroll, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('click', onWindowClick, true);
  window.removeEventListener('contextmenu', onWindowContextMenu, true);
  window.removeEventListener('blur', onWindowBlur);
  window.removeEventListener('resize', onWindowResize);
  window.removeEventListener('scroll', onWindowScroll, true);
});

function normalizePath(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.path === 'string') return value.path;
  return String(value);
}

function getTargetDir(path) {
  if (!path) return '';
  const rawPath = String(path);
  const separator = rawPath.includes('\\') ? '\\' : '/';
  const parts = rawPath.split(/[/\\]/);
  // target_path 始终是完整文件路径，去掉末段文件名即为目录
  parts.pop();
  const dir = parts.join(separator);
  return dir ? dir + separator : '';
}

// 实际写入磁盘的目标文件名（去重时可能被改成 _1/_2，与源文件名不同）
function getTargetName(path, fallback) {
  if (!path) return fallback || '';
  const parts = String(path).split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || fallback || '';
}

function getLabel(key) {
  const labels = {
    all: '全部',
    upload: '将上传',
    overwrite: '将覆盖',
    skip: '将跳过'
  };
  return labels[key] || key;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function formatDate(dateObj) {
  if (!dateObj) return '-';
  // Tauri returns SystemTime which gets serialized as { secs_since_epoch, nanos_since_epoch }
  let date;
  if (dateObj.secs_since_epoch !== undefined) {
    date = new Date(dateObj.secs_since_epoch * 1000);
  } else {
    date = new Date(dateObj);
  }
  return date.toLocaleString('zh-CN');
}

function formatStatus(status) {
  const statusMap = {
    upload: '将上传',
    overwrite: '将覆盖',
    skip: '将跳过',
    pending: '未处理'
  };
  return statusMap[status] || status;
}

function formatFileType(type) {
  const typeMap = {
    photo: '照片',
    video: '视频'
  };
  return typeMap[type] || type || '-';
}

function getProgress(file) {
  const key = normalizePath(file?.path);
  if (!key) return null;
  return props.progressMap?.[key] || null;
}

function filePercent(file) {
  const p = getProgress(file);
  if (!p || !p.total) return 0;
  return Math.min(100, Math.max(0, (p.done / p.total) * 100));
}

function resultClass(status) {
  const map = {
    done: 'status-done',
    skipped: 'status-skip',
    error: 'status-error'
  };
  return map[status] || 'status-skip';
}

function resultLabel(status) {
  const map = {
    done: '已完成',
    skipped: '已跳过',
    error: '失败'
  };
  return map[status] || status;
}

function openNotice(title, message) {
  noticeModal.value = {
    visible: true,
    title,
    message
  };
}

function closeNotice() {
  noticeModal.value = {
    visible: false,
    title: '',
    message: ''
  };
}
</script>

<style scoped>
.file-table-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
  flex: 1;
}

.notice-content {
  text-align: center;
  padding: var(--space-4) 0;
}

.notice-icon-wrapper {
  margin-bottom: var(--space-4);
  color: #f59e0b;
  display: flex;
  justify-content: center;
}

.notice-message {
  font-size: 1rem;
  font-weight: 500;
}

.table-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-4);
}

.table-actions {
  display: flex;
  align-items: center;
  flex: 1 1 360px;
  min-width: 0;
  justify-content: flex-end;
}

.filter-strip {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1);
  background: var(--surface-100);
  border-radius: var(--radius-lg);
  width: fit-content;
}

.filter-item {
  display: flex;
  align-items: top;
  gap: var(--space-2);
  padding: 0.35rem 0.75rem;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.filter-item:hover {
  background: var(--surface-overlay-faint);
  color: var(--color-text-main);
}

.filter-item.active {
  background: var(--surface-0);
  color: var(--primary-700);
  box-shadow: var(--shadow-sm);
  font-weight: 500;
}

.filter-count {
  font-size: 0.75rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: var(--surface-200);
  color: var(--color-text-muted);
}

.filter-item.active .filter-count {
  background: var(--primary-soft);
  color: var(--primary-700);
}

.count-upload { color: var(--primary-600); }
.count-overwrite { color: var(--color-warning); }
.count-skip { color: var(--color-text-light); }

.table-wrapper {
  overflow: auto;
  display: flex;
  flex-direction: column;
  padding: 0; /* Override glass-panel padding */
  flex: 1;
  min-height: 0;
}

.file-table {
  width: 100%;
  border-collapse: collapse;
}

.file-table th {
  background: var(--surface-50);
  padding: var(--space-3) var(--space-4);
  text-align: left;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-muted);
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 1px solid var(--surface-200);
  white-space: nowrap;
  /* Fix sticky header gap issue */
  box-shadow: 0 -1px 0 var(--surface-50);
}

.file-table td {
  padding: var(--space-3) var(--space-4);
  font-size: 0.875rem;
  color: var(--color-text-main);
  /* 后面几列默认不换行；第一列在下方单独放开 */
  white-space: nowrap;
  vertical-align: middle;
}

.file-table tr {
  border-bottom: 1px solid var(--surface-100);
}

.file-table tr:last-child {
  border-bottom: none;
}

.file-table tr:hover td {
  background: var(--surface-50);
}

.file-table tr:hover {
  background: var(--surface-50);
}

/* 选择模式 */
.checkbox-col {
  width: 44px;
  text-align: center;
  padding-left: var(--space-3);
  padding-right: 0;
}

.row-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--primary-500);
  vertical-align: middle;
}

.row-checkbox:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.row-selectable {
  cursor: pointer;
  user-select: none;
}

/* 选中行：用更高的选择器权重压过通用的 tr:hover，避免悬停时被 hover 底色盖掉，
   只有移开鼠标才显示着重色的矛盾 */
.file-table tr.row-selected td {
  background: var(--primary-soft);
}

.file-table tr.row-selected:hover td {
  background: var(--primary-soft-strong);
}

/* 第一列：放开换行，文字超长时在列内折行而不是被省略号截断 */
.file-table td.file-info-cell {
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  min-width: 220px;
}

/* 日期时间列：允许在日期与时间之间换行 */
.file-table td.date-cell {
  white-space: normal;
}

.file-path {
  min-width: 0;
  line-height: 1.45;
}

.file-table .path-dir {
  font-family: monospace;
  color: var(--primary-600);
  font-size: 0.8rem;
  opacity: 0.8;
}

.file-table .path-filename {
  font-family: monospace;
  font-weight: 600;
  font-size: 0.95rem;
}

.empty-state {
  padding: var(--space-8);
  text-align: center;
  color: var(--color-text-muted);
  font-style: italic;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.status-upload {
  background: var(--primary-soft);
  color: var(--primary-700);
}

.status-overwrite {
  background: var(--warning-soft);
  color: var(--color-warning);
}

.status-skip {
  background: var(--surface-100);
  color: var(--color-text-muted);
}

.status-done {
  background: var(--success-soft, rgba(16, 185, 129, 0.15));
  color: #10b981;
}

.status-error {
  background: var(--danger-soft, rgba(239, 68, 68, 0.15));
  color: #ef4444;
}

.status-cell {
  min-width: 140px;
}

.row-progress {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 120px;
}

.row-progress-track {
  flex: 1;
  height: 6px;
  background: var(--surface-200);
  border-radius: 999px;
  overflow: hidden;
  min-width: 64px;
}

.row-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary-500), var(--primary-400));
  border-radius: 999px;
  transition: width 0.2s ease-out;
}

.row-progress-label {
  font-size: 0.72rem;
  font-family: monospace;
  font-weight: 600;
  color: var(--primary-600);
  flex-shrink: 0;
  width: 34px;
  text-align: right;
}

.context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 160px;
  background: var(--surface-0);
  border: 1px solid var(--surface-200);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: 0.35rem;
}

.context-menu-item {
  width: 100%;
  text-align: left;
  padding: 0.4rem 0.6rem;
  border: none;
  background: transparent;
  color: var(--color-text-main);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 0.85rem;
}

.context-menu-item:hover {
  background: var(--surface-100);
}
</style>
