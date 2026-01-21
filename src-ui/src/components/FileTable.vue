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
            <th>文件名 / 目标目录</th>
            <th>类型</th>
            <th>大小</th>
            <th>日期</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(file, index) in filteredFiles" :key="index" @contextmenu="openContextMenu(file, $event)">
            <td class="file-info-cell">
              <div class="file-path" :title="file.target_path">
                <span class="path-dir">{{ getTargetDir(file.target_path, file.filename) }}</span>
                <span class="path-filename">{{ file.filename }}</span>
              </div>
            </td>
            <td class="text-muted">{{ formatFileType(file.file_type) }}</td>
            <td class="text-muted">{{ formatSize(file.size) }}</td>
            <td class="text-muted">{{ formatDate(file.date) }}</td>
            <td>
              <span :class="['status-badge', `status-${file.status}`]">
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
  }
});

defineEmits(['update:filter']);

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

function getTargetDir(path, filename) {
  if (!path) return '-';
  const rawPath = String(path);
  const separator = rawPath.includes('\\') ? '\\' : '/';
  const parts = rawPath.split(/[/\\]/);
  if (parts.length === 0) return rawPath;
  const last = parts[parts.length - 1];
  if (filename && last === filename) {
    parts.pop();
  }
  const dir = parts.join(separator);
  return dir ? dir + separator : '';
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
  gap: var(--space-4);
}

.table-actions {
  display: flex;
  align-items: center;
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
  /* Fix sticky header gap issue */
  box-shadow: 0 -1px 0 var(--surface-50); 
}

.file-table td {
  padding: var(--space-3) var(--space-4);
  font-size: 0.875rem;
  color: var(--color-text-main);
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

.file-info-cell {
  display: flex;
  align-items: center;
  min-width: 0;
}

.file-path {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
}

.file-table .path-dir {
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--primary-600);
  font-size: 0.8rem;
  opacity: 0.8;
  min-width: 0;
  flex: 1 1 auto;
}

.file-table .path-filename {
  font-family: monospace;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
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
