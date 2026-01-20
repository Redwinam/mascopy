<template>
  <div class="tabs-container">
    <div class="tab-list-wrapper">
      <div class="tab-side tab-side-left">
        <slot name="left"></slot>
      </div>
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
      <div class="tab-side tab-side-right">
        <slot name="right"></slot>
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
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: var(--space-4);
}

.tab-side {
  display: flex;
  align-items: center;
  min-width: 0;
}

.tab-side-left {
  justify-content: flex-start;
}

.tab-side-right {
  justify-content: flex-end;
}

.tab-list {
  display: inline-flex;
  padding: 3px;
  background: var(--surface-rail); /* Softer background */
  border-radius: 12px;
  position: relative;
}

.tab-btn {
  position: relative;
  padding: 0.45rem 1.1rem;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-weight: 500;
  font-size: 0.85rem;
  cursor: pointer;
  border-radius: 10px;
  transition: all 0.2s;
  z-index: 1;
  white-space: nowrap;
  -webkit-app-region: no-drag;
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
