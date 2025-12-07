<template>
  <div class="progress-container">
    <div class="progress-info">
      <span class="filename" :title="filename">{{ filename }}</span>
      <span class="count">{{ current }} / {{ total }}</span>
    </div>
    <div class="progress-track">
      <div 
        class="progress-fill"
        :style="{ width: percentage + '%' }"
      ></div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  current: Number,
  total: Number,
  filename: String
});

const percentage = computed(() => {
  if (props.total === 0) return 0;
  return Math.min(100, Math.max(0, (props.current / props.total) * 100));
});
</script>

<style scoped>
.progress-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 0.875rem;
}

.filename {
  font-weight: 500;
  color: var(--color-text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 70%;
}

.count {
  color: var(--color-text-muted);
  font-family: monospace;
}

.progress-track {
  height: 0.5rem;
  background: var(--surface-200);
  border-radius: 9999px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary-500), var(--primary-400));
  border-radius: 9999px;
  transition: width 0.3s ease-out;
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
}
</style>
