<template>
  <div class="bg-white/50 rounded-xl p-4 flex flex-col items-center justify-center border border-white/60">
    <span class="text-sm text-gray-500 mb-1">{{ label }}</span>
    <span class="text-2xl font-bold" :class="colorClass">{{ value }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  label: String,
  value: Number,
  color: String
});

const colorClass = computed(() => {
  switch (props.color) {
    case 'blue': return 'text-blue-600';
    case 'yellow': return 'text-amber-500';
    case 'gray': return 'text-gray-400';
    default: return 'text-gray-800';
  }
});
</script>
