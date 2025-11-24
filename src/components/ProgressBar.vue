<template>
  <div class="w-full">
    <div class="flex justify-between text-sm mb-2">
      <span class="font-medium text-gray-700 truncate max-w-[70%]">{{ filename }}</span>
      <span class="text-gray-500">{{ current }} / {{ total }}</span>
    </div>
    <div class="h-2 bg-gray-200 rounded-full overflow-hidden">
      <div 
        class="h-full bg-blue-500 transition-all duration-300 ease-out"
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
