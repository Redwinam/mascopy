<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal-container glass-panel animate-scale-in">
      <div class="modal-header">
        <h3 class="modal-title">
          <slot name="title">提示</slot>
        </h3>
        <button class="close-btn" @click="$emit('close')">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      
      <div class="modal-body">
        <slot></slot>
      </div>
      
      <div class="modal-footer" v-if="$slots.footer">
        <slot name="footer"></slot>
      </div>
    </div>
  </div>
</template>

<script setup>
defineEmits(['close']);
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
}

.modal-container {
  width: 100%;
  max-width: 480px;
  background: var(--surface-0);
  border: 1px solid var(--surface-200);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-2xl);
}

.animate-scale-in {
  animation: scaleIn 0.2s ease-out both;
}

@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.modal-header {
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--surface-200);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text-main);
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: var(--radius-md);
  transition: all 0.2s;
}

.close-btn:hover {
  background: var(--surface-200);
  color: var(--color-text-main);
}

.modal-body {
  padding: var(--space-6);
  color: var(--color-text-main);
}

.modal-footer {
  padding: var(--space-4) var(--space-6);
  background: var(--surface-50);
  border-top: 1px solid var(--surface-200);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  border-bottom-left-radius: var(--radius-2xl);
  border-bottom-right-radius: var(--radius-2xl);
}
</style>
