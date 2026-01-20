<template>
  <div class="tabs-container">
    <div class="tab-list-wrapper">
      <div class="tab-list">
        <button 
          v-for="tab in tabs" 
          :key="tab.id"
          :class="['tab-btn', { active: activeTab === tab.id }]"
          @click="$emit('update:activeTab', tab.id)"
        >
          {{ tab.label }}
          <div v-if="activeTab === tab.id" class="active-indicator" layoutId="activeTab"></div>
        </button>
      </div>
    </div>
    <div class="tab-content" v-if="$slots.default">
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
.tabs-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.tab-list-wrapper {
  display: flex;
  justify-content: center;
}

.tab-list {
  display: inline-flex;
  padding: 4px;
  background: var(--surface-rail); /* Softer background */
  border-radius: 12px;
  position: relative;
}

.tab-btn {
  position: relative;
  padding: 0.5rem 1.25rem;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-weight: 500;
  font-size: 0.9rem;
  cursor: pointer;
  border-radius: 10px;
  transition: all 0.2s;
  z-index: 1;
  white-space: nowrap;
}

.tab-btn:hover {
  color: var(--text-color);
}

.tab-btn.active {
  color: var(--primary-color);
  font-weight: 600;
  background: var(--surface-0);
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.tab-content {
  margin-top: 1.5rem;
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
