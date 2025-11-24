<template>
  <div class="path-selector-container">
    <div class="glass-panel p-6 flex flex-col gap-4">
      <!-- Header with icon and title -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
            <slot name="icon"></slot>
          </div>
          <div>
            <h3 class="font-semibold text-lg">{{ title }}</h3>
            <p class="text-sm text-gray-500 truncate max-w-[300px]" :title="path || placeholder">
              {{ path || placeholder }}
            </p>
          </div>
        </div>
        <div class="flex gap-2">
          <!-- Add to favorites button -->
          <button 
            v-if="path && !isFavorited"
            @click="addToFavorites" 
            class="btn btn-secondary text-sm"
            title="添加到收藏"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </button>
          <!-- Browse button -->
          <button @click="selectPath" class="btn btn-secondary">
            选择目录
          </button>
        </div>
      </div>

      <!-- Favorites list -->
      <div v-if="favorites && favorites.length > 0" class="favorites-list">
        <div class="text-xs text-gray-500 mb-2">快速选择：</div>
        <div class="flex flex-wrap gap-2">
          <div 
            v-for="(fav, index) in favorites" 
            :key="index"
            :class="['favorite-tag', { active: path === fav }]"
            @click="selectFavorite(fav)"
          >
            <span class="favorite-path">{{ getBasename(fav) }}</span>
            <button 
              @click.stop="removeFavorite(fav)" 
              class="remove-btn"
              title="删除收藏"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

const props = defineProps({
  title: String,
  path: String,
  category: String, // 'sd_source', 'dji_source', or 'target'
  favorites: Array,
  placeholder: {
    type: String,
    default: '未选择目录'
  }
});

const emit = defineEmits(['update:path', 'favorites-changed']);

const isFavorited = computed(() => {
  return props.favorites && props.path && props.favorites.includes(props.path);
});

async function selectPath() {
  const selected = await open({
    directory: true,
    multiple: false,
  });
  
  if (selected) {
    emit('update:path', selected);
  }
}

function selectFavorite(fav) {
  emit('update:path', fav);
}

async function addToFavorites() {
  if (!props.path) return;
  try {
    await invoke('add_favorite', {
      category: props.category,
      path: props.path
    });
    emit('favorites-changed');
  } catch (e) {
    console.error('Failed to add favorite:', e);
  }
}

async function removeFavorite(fav) {
  try {
    await invoke('remove_favorite', {
      category: props.category,
      path: fav
    });
    emit('favorites-changed');
  } catch (e) {
    console.error('Failed to remove favorite:', e);
  }
}

function getBasename(path) {
  if (!path) return '';
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}
</script>

<style scoped>
.path-selector-container {
  width: 100%;
}

.favorites-list {
  padding-top: 0.75rem;
  border-top: 1px solid #e5e7eb;
}

.favorite-tag {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: white;
  border: 2px solid #e5e7eb;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s;
}

.favorite-tag:hover {
  border-color: #3b82f6;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.favorite-tag.active {
  border-color: #3b82f6;
  background: #eff6ff;
}

.favorite-path {
  font-size: 0.875rem;
  font-family: monospace;
  color: #374151;
}

.remove-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  border: none;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  transition: color 0.2s;
}

.remove-btn:hover {
  color: #ef4444;
}
</style>
