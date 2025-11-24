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

    <div class="table-wrapper">
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
            <td class="filename">{{ file.filename }}</td>
            <td>{{ file.file_type === 'photo' ? '照片' : '视频' }}</td>
            <td>{{ formatSize(file.size) }}</td>
            <td>{{ formatDate(file.date) }}</td>
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
}

.stats-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.stat-card {
  background: white;
  border: 2px solid #e5e7eb;
  border-radius: 0.75rem;
  padding: 1rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
}

.stat-card:hover {
  border-color: #3b82f6;
  transform: translateY(-2px);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.stat-card.active {
  border-color: #3b82f6;
  background: #eff6ff;
}

.stat-label {
  font-size: 0.875rem;
  color: #6b7280;
  margin-bottom: 0.5rem;
}

.stat-value {
  font-size: 1.875rem;
  font-weight: 700;
}

.stat-all { color: #374151; }
.stat-upload { color: #2563eb; }
.stat-overwrite { color: #f59e0b; }
.stat-skip { color: #9ca3af; }

.table-wrapper {
  background: white;
  border-radius: 0.75rem;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  max-height: 400px;
  overflow-y: auto;
}

.file-table {
  width: 100%;
  border-collapse: collapse;
}

.file-table th {
  background: #f9fafb;
  padding: 0.75rem 1rem;
  text-align: left;
  font-size: 0.875rem;
  font-weight: 600;
  color: #374151;
  position: sticky;
  top: 0;
  z-index: 1;
}

.file-table td {
  padding: 0.75rem 1rem;
  border-top: 1px solid #e5e7eb;
  font-size: 0.875rem;
}

.file-table .filename {
  font-family: monospace;
  color: #1f2937;
}

.empty-state {
  padding: 3rem;
  text-align: center;
  color: #9ca3af;
}

.status-badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.status-upload {
  background: #dbeafe;
  color: #1e40af;
}

.status-overwrite {
  background: #fef3c7;
  color: #92400e;
}

.status-skip {
  background: #f3f4f6;
  color: #6b7280;
}
</style>
