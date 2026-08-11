<template>
  <div class="theme-toggle" role="group" aria-label="外观主题" data-no-drag data-tauri-no-drag>
    <button
      v-for="opt in options"
      :key="opt.mode"
      type="button"
      class="theme-btn"
      :class="{ active: themeMode === opt.mode }"
      :title="opt.label"
      :aria-label="opt.label"
      :aria-pressed="themeMode === opt.mode"
      @click="setThemeMode(opt.mode)"
    >
      <component :is="opt.icon" :size="15" :stroke-width="2" />
    </button>
  </div>
</template>

<script setup>
import { Sun, Moon, Monitor } from 'lucide-vue-next';
import { useTheme } from '../composables/useTheme.js';

const { themeMode, setThemeMode } = useTheme();

const options = [
  { mode: 'light', label: '浅色', icon: Sun },
  { mode: 'dark', label: '深色', icon: Moon },
  { mode: 'system', label: '跟随系统', icon: Monitor }
];
</script>

<style scoped>
.theme-toggle {
  display: inline-flex;
  align-items: center;
  padding: 3px;
  gap: 2px;
  background: var(--surface-rail);
  border-radius: 10px;
}

.theme-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 8px;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: color var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast);
}

.theme-btn:hover {
  color: var(--color-text-main);
}

.theme-btn.active {
  background: var(--surface-0);
  color: var(--color-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
</style>
