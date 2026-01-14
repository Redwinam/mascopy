<template>
  <div class="file-table-container">
    <div class="filter-strip" v-if="stats">
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
          <tr v-for="(file, index) in filteredFiles" :key="index">
            <td class="file-info-cell">
              <div class="filename" :title="file.filename">{{ file.filename }}</div>
              <div class="target-path" :title="file.target_path">{{ getParentDir(file.target_path) }}</div>
            </td>
            <td>
              <span class="type-badge">{{ file.file_type === 'photo' ? '照片' : '视频' }}</span>
            </td>
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
  </div>
</template>

<script setup>
import { computed } from 'vue';

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

function getParentDir(path) {
  if (!path) return '-';
  // Handle both Windows and Unix separators
   const parts = path.split(/[/\\]/);
   // Return the full path for tooltip context, but for display we want to show
   // enough context. The user asked for "full target directory" but in a small font.
   // Let's try to show the relative part from the target root if possible, 
   // but since we don't have the target root here easily, let's show the last 2-3 segments.
   
   if (parts.length > 3) {
      return '.../' + parts.slice(-3).join('/');
   }
   return path;
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
</script>

<style scoped>
.file-table-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
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
  align-items: center;
  gap: var(--space-2);
  padding: 0.35rem 0.75rem;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.filter-item:hover {
  background: rgba(255,255,255,0.5);
  color: var(--color-text-main);
}

.filter-item.active {
  background: white;
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
  background: var(--primary-100);
  color: var(--primary-700);
}

.count-upload { color: var(--primary-600); }
.count-overwrite { color: var(--color-warning); }
.count-skip { color: var(--color-text-light); }

.table-wrapper {
  overflow: hidden;
  max-height: 500px;
  display: flex;
  flex-direction: column;
  padding: 0; /* Override glass-panel padding */
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
  z-index: 1;
  border-bottom: 1px solid var(--surface-200);
}

.file-table td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--surface-100);
  font-size: 0.875rem;
  color: var(--color-text-main);
}

.file-table tr:last-child td {
  border-bottom: none;
}

.file-table tr:hover td {
  background: var(--surface-50);
}

.file-info-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 300px;
}

.file-table .filename {
  font-family: monospace;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 0.9rem;
}

.file-table .target-path {
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--primary-600);
  font-size: 0.75rem;
  opacity: 0.8;
}

.type-badge {
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--surface-100);
  color: var(--color-text-muted);
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
  background: var(--primary-100);
  color: var(--primary-700);
}

.status-overwrite {
  background: #fef3c7;
  color: #92400e;
}

.status-skip {
  background: var(--surface-100);
  color: var(--color-text-muted);
}
</style>


