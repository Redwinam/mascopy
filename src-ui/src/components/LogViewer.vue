<template>
  <div class="log-container">
    <div class="log-content" ref="logContent">
      <div v-for="(log, index) in logs" :key="index" :class="['log-entry', `log-${log.type}`]">
        <span class="log-time">{{ formatTime(log.time) }}</span>
        <span class="log-message">{{ log.message }}</span>
      </div>
      <div v-if="logs.length === 0" class="log-placeholder">
        <div class="placeholder-icon">📝</div>
        <p>准备就绪，请选择源目录和目标目录开始扫描...</p>
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
  background: #1e293b; /* Keep dark background for logs */
  border-radius: 16px;
  overflow: hidden;
  height: 400px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
}

.log-content {
  padding: 1rem;
  height: 100%;
  overflow-y: auto;
  font-family: 'JetBrains Mono', 'Fira Code', 'Monaco', monospace;
  font-size: 0.85rem;
  line-height: 1.6;
}

.log-entry {
  padding: 0.25rem 0;
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.log-time {
  color: #64748b;
  font-size: 0.75rem;
  min-width: 70px;
  padding-top: 2px;
  font-feature-settings: "tnum";
}

.log-message {
  color: #e2e8f0;
  word-break: break-all;
}

.log-info .log-message { color: #bfdbfe; }
.log-success .log-message { color: #86efac; }
.log-warning .log-message { color: #fde047; }
.log-error .log-message { color: #fca5a5; }

.log-placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #64748b;
  text-align: center;
}

.placeholder-icon {
  font-size: 2rem;
  margin-bottom: 0.5rem;
  opacity: 0.5;
}

/* Scrollbar */
.log-content::-webkit-scrollbar {
  width: 8px;
}

.log-content::-webkit-scrollbar-track {
  background: #0f172a;
}

.log-content::-webkit-scrollbar-thumb {
  background: #334155;
  border-radius: 4px;
}

.log-content::-webkit-scrollbar-thumb:hover {
  background: #475569;
}
</style>


