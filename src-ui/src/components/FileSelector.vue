<template>
  <div class="file-selector">
    <div class="selector-container">
      <div class="selector-main">
        <div class="icon-wrapper">
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
        <button @click="selectPath" class="btn btn-secondary btn-sm action-btn">
          选择目录
        </button>
        <button @click="addFavorite" class="btn-icon-only" title="加入收藏">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
        </button>
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
  width: 100%;
}

.selector-container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.selector-main {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex: 1;
  min-width: 0;
}

.icon-wrapper {
  flex-shrink: 0;
}

.text-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.selector-title {
  font-weight: 600;
  font-size: 1rem;
  margin: 0;
  color: var(--text-color);
}

.selector-path {
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.85rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
  background: rgba(0,0,0,0.03);
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
}

.selector-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.action-btn {
  white-space: nowrap;
}

.btn-icon-only {
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-icon-only:hover {
  background: rgba(0,0,0,0.05);
  color: #ef4444; /* Heart color on hover */
}
</style>
