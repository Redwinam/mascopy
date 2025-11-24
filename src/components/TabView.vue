<template>
  <div class="tabs">
    <div class="tab-buttons">
      <button 
        v-for="tab in tabs" 
        :key="tab.id"
        :class="['tab-btn', { active: activeTab === tab.id }]"
        @click="$emit('update:activeTab', tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div class="tab-content">
      <slot></slot>
    </div>
  </div>
</template>

<script setup>
defineProps({
  tabs: Array,
  activeTab: String
});

defineEmits(['update:activeTab']);
</script>

<style scoped>
.tabs {
  width: 100%;
}

.tab-buttons {
  display: flex;
  gap: 0.5rem;
  border-bottom: 2px solid #e5e7eb;
  margin-bottom: 1.5rem;
}

.tab-btn {
  padding: 0.75rem 1.5rem;
  border: none;
  background: transparent;
  color: #6b7280;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all 0.2s;
}

.tab-btn:hover {
  color: #2563eb;
}

.tab-btn.active {
  color: #2563eb;
  border-bottom-color: #2563eb;
}
</style>
