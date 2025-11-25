<template>
  <div class="file-table-container">
    <div class="stats-cards" v-if="stats">
      <div 
        v-for="(stat, key) in stats" 
        :key="key"
        :class="['stat-card', { active: filter === key }]"
        @click="$emit('update:filter', key)"
      >
        <div class="stat-label">{{ getLabel(key) }}</div>
        <div class="stat-value" :class="`stat-${key}`">{{ stat }}</div>
      </div>
    </div>

    <div class="table-wrapper glass-panel">
      <table class="file-table">
        <thead>
          <tr>
            <th>文件名</th>
            <th>类型</th>
            <th>大小</th>
            <th>日期</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(file, index) in filteredFiles" :key="index">
            <td class="filename" :title="file.filename">{{ file.filename }}</td>
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

.stats-cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-4);
}

@media (min-width: 768px) {
  .stats-cards {
    grid-template-columns: repeat(4, 1fr);
  }
}

.stat-card {
  background: var(--surface-0);
  border: 1px solid var(--surface-200);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  text-align: center;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.stat-card:hover {
  border-color: var(--primary-300);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.stat-card.active {
  border-color: var(--primary-500);
  background: var(--primary-50);
  box-shadow: 0 0 0 2px var(--primary-100);
}

.stat-label {
  font-size: 0.875rem;
  color: var(--color-text-muted);
  margin-bottom: var(--space-2);
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
}

.stat-all { color: var(--color-text-main); }
.stat-upload { color: var(--primary-600); }
.stat-overwrite { color: var(--color-warning); }
.stat-skip { color: var(--color-text-light); }

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

.file-table .filename {
  font-family: monospace;
  font-weight: 500;
  max-width: 200px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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


