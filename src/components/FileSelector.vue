<template>
  <div class="glass-panel p-6 flex flex-col gap-4">
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
      <button @click="selectPath" class="btn btn-secondary">
        选择目录
      </button>
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

const emit = defineEmits(['update:path']);

async function selectPath() {
  const selected = await open({
    directory: true,
    multiple: false,
  });
  
  if (selected) {
    emit('update:path', selected);
  }
}
</script>
