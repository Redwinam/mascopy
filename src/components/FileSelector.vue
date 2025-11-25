<template>
  <div class="file-selector glass-panel">
    <div class="selector-header">
      <div class="selector-info">
        <div class="icon-box">
          <slot name="icon"></slot>
        </div>
        <div class="text-content">
          <h3 class="selector-title">{{ title }}</h3>
          <p class="selector-path" :title="path || placeholder">
            {{ path || placeholder }}
          </p>
        </div>
      </div>
      <div class="selector-actions">
        <button @click="addFavorite" class="btn btn-secondary btn-sm">加入收藏</button>
        <button @click="selectPath" class="btn btn-secondary btn-sm">选择目录</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { open } from '@tauri-apps/plugin-dialog';

const props = defineProps({
  title: String,
  path: String,
  placeholder: {
    type: String,
    default: '未选择目录'
  }
});

const emit = defineEmits(['update:path', 'addFavorite']);

async function selectPath() {
  const selected = await open({
    directory: true,
    multiple: false,
  });
  
  if (selected) {
    emit('update:path', selected);
  }
}

function addFavorite() {
  emit('addFavorite');
}
</script>

<style scoped>
.file-selector {
  padding: var(--space-6);
  transition: transform var(--transition-fast);
}

.file-selector:hover {
  transform: translateY(-2px);
}

.selector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.selector-info {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex: 1;
  min-width: 0; /* Enable truncation */
}

.icon-box {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  background: var(--primary-100);
  color: var(--primary-600);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.text-content {
  flex: 1;
  min-width: 0;
}

.selector-title {
  font-weight: 600;
  font-size: 1.125rem;
  margin: 0 0 0.25rem 0;
  color: var(--color-text-main);
}

.selector-path {
  font-size: 0.875rem;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
}

.selector-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

@media (max-width: 640px) {
  .selector-header {
    flex-direction: column;
    align-items: flex-start;
  }
  
  .selector-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
