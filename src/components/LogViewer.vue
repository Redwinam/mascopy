<template>
  <div class="log-container">
    <div class="log-content" ref="logContent">
      <div v-for="(log, index) in logs" :key="index" :class="['log-entry', `log-${log.type}`]">
        <span class="log-time">{{ formatTime(log.time) }}</span>
        <span class="log-message">{{ log.message }}</span>
      </div>
      <div v-if="logs.length === 0" class="log-placeholder">
        准备就绪，请选择源目录和目标目录开始扫描...
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';

const props = defineProps({
  logs: {
    type: Array,
    default: () => []
  }
});

const logContent = ref(null);

watch(() => props.logs.length, async () => {
  await nextTick();
  if (logContent.value) {
    logContent.value.scrollTop = logContent.value.scrollHeight;
  }
});

function formatTime(time) {
  const date = new Date(time);
  return date.toLocaleTimeString('zh-CN');
}
</script>

<style scoped>
.log-container {
  background: #1f2937;
  border-radius: 0.75rem;
  overflow: hidden;
  height: 400px;
}

.log-content {
  padding: 1rem;
  height: 100%;
  overflow-y: auto;
  font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
  font-size: 0.875rem;
}

.log-entry {
  padding: 0.25rem 0;
  color: #e5e7eb;
}

.log-time {
  color: #9ca3af;
  margin-right: 0.5rem;
}

.log-message {
  color: #f3f4f6;
}

.log-info {
  color: #93c5fd;
}

.log-success {
  color: #86efac;
}

.log-warning {
  color: #fde047;
}

.log-error {
  color: #fca5a5;
}

.log-placeholder {
  color: #6b7280;
  text-align: center;
  padding: 3rem;
}

/* Scrollbar */
.log-content::-webkit-scrollbar {
  width: 8px;
}

.log-content::-webkit-scrollbar-track {
  background: #374151;
}

.log-content::-webkit-scrollbar-thumb {
  background: #6b7280;
  border-radius: 4px;
}

.log-content::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}
</style>
