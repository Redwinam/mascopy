<template>
  <div class="tabs-container">
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
.tabs-container {
  width: 100%;
}

.tab-list {
  display: inline-flex;
  padding: 4px;
  background: var(--surface-200);
  border-radius: var(--radius-lg);
  margin-bottom: var(--space-6);
  position: relative;
}

.tab-btn {
  position: relative;
  padding: 0.5rem 1.5rem;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-weight: 500;
  font-size: 0.95rem;
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: color 0.2s;
  z-index: 1;
}

.tab-btn:hover {
  color: var(--color-text-main);
}

.tab-btn.active {
  color: var(--primary-700);
  font-weight: 600;
  background: white;
  box-shadow: var(--shadow-sm);
}

/* Optional: Smooth transition for active state background if using a shared background element */
/* For simplicity, we are just styling the button itself for now */

.tab-content {
  position: relative;
}
</style>
