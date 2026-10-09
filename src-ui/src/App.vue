<template>
  <div class="app-container">
    <header
      class="app-header animate-fade-in"
      :class="{ 'is-config': currentStep === 'config' }"
      data-tauri-drag-region
      @pointerdown="onHeaderPointerDown"
    >
      <!-- 左栏留空：占住 1fr 让中间页签保持居中，同时给红绿灯让位 -->
      <div data-tauri-drag-region></div>
      
      <div class="header-center" id="header-center-slot">
        <ModeSwitcher
          v-if="currentStep === 'config'"
          v-model="currentMode"
          :disabled="configLocked"
          :live="tetherActive"
          data-no-drag
          data-tauri-no-drag
        />
      </div>

      <div class="header-actions" id="header-right-slot">
        <AppUpdate />
        <ThemeToggle />
      </div>
    </header>

    <main class="app-content animate-fade-in" style="animation-delay: 0.1s">
      <Home />
    </main>
  </div>
</template>

<script setup>
import Home from './views/Home.vue';
import ModeSwitcher from './components/ModeSwitcher.vue';
import ThemeToggle from './components/ThemeToggle.vue';
import AppUpdate from './components/AppUpdate.vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAppState } from './composables/useAppState.js';
import './styles/main.css';

const isTauri =
  typeof window !== 'undefined' &&
  (window.__TAURI__ !== undefined ||
    window.__TAURI_INTERNALS__ !== undefined ||
    window.__TAURI_INTERNALS__?.invoke !== undefined);
const appWindow = isTauri ? getCurrentWindow() : null;

const { currentMode, currentStep, configLocked, tetherActive } = useAppState();

async function onHeaderPointerDown(event) {
  if (event.button !== 0) return;
  const target = event.target;
  if (target && target.closest && target.closest('button, a, input, select, textarea, [data-no-drag], [data-tauri-no-drag]')) return;
  if (!appWindow) return;
  await appWindow.startDragging();
}
</script>

<style scoped>
.app-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  position: relative;
  padding: 0 var(--space-6);
  /* 模式卡片带说明文字，比普通页签高；红绿灯位置在 tauri.conf.json 里跟着居中 */
  height: 76px;
  z-index: 100;
  background: linear-gradient(180deg, var(--surface-overlay-strong), var(--surface-overlay-soft));
  border-bottom: 1px solid var(--divider-color);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  user-select: none;
}

.header-center {
  display: flex;
  justify-content: center;
  position: relative;
  z-index: 10;
  justify-self: center;
}

.header-actions {
  position: relative;
  z-index: 10;
  justify-self: end;
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

/* 各视图 teleport 进来的按钮排在前面，「关于与更新」和主题开关始终贴右边缘，切步骤时位置不跳 */
.header-actions :deep(.update-entry) {
  order: 1;
}

.header-actions :deep(.theme-toggle) {
  order: 2;
}

.app-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
