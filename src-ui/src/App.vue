<template>
  <div class="app-container">
    <header
      class="app-header animate-fade-in"
      :class="{ 'is-config': currentStep === 'config' }"
      data-tauri-drag-region
      @mousedown="onHeaderMouseDown"
    >
      <div class="app-drag-layer" data-tauri-drag-region></div>
      <div class="drag-strip" data-tauri-drag-region></div>
      <div class="brand" id="header-left-slot" data-tauri-drag-region></div>
      
      <div class="header-center" id="header-center-slot">
        <TabView
          v-if="currentStep === 'config'"
          :tabs="modeTabs"
          v-model:activeTab="currentMode"
          class="header-tabs"
          data-no-drag
        />
      </div>

      <div class="header-actions" id="header-right-slot">
        <!-- Window controls are handled by OS with titleBarStyle: Overlay -->
      </div>
    </header>

    <main class="app-content animate-fade-in" style="animation-delay: 0.1s">
      <Home />
    </main>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted } from 'vue';
import Home from './views/Home.vue';
import TabView from './components/TabView.vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAppState } from './composables/useAppState.js';
import './styles/main.css';

const isTauri =
  typeof window !== 'undefined' &&
  (window.__TAURI__ !== undefined ||
    window.__TAURI_INTERNALS__ !== undefined ||
    window.__TAURI_INTERNALS__?.invoke !== undefined);
const appWindow = isTauri ? getCurrentWindow() : null;

const { currentMode, currentStep } = useAppState();

const modeTabs = [
  { id: 'sd', label: 'SD卡模式' },
  { id: 'dji', label: 'DJI模式' }
];

function onHeaderMouseDown(event) {
  if (event.button !== 0) return;
  const target = event.target;
  if (target && target.closest && target.closest('button, a, input, select, textarea, [data-no-drag]')) return;
  if (!appWindow) return;
  appWindow.startDragging();
}

const headerHeight = 56;

function onGlobalMouseDown(event) {
  if (event.button !== 0) return;
  if (event.clientY > headerHeight) return;
  const target = event.target;
  if (target && target.closest && target.closest('button, a, input, select, textarea, [data-no-drag]')) return;
  if (!appWindow) return;
  appWindow.startDragging();
}

onMounted(() => {
  if (!isTauri) return;
  window.addEventListener('mousedown', onGlobalMouseDown, true);
});

onBeforeUnmount(() => {
  if (!isTauri) return;
  window.removeEventListener('mousedown', onGlobalMouseDown, true);
});
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  padding: var(--space-4) var(--space-6);
  padding-top: 1.25rem;
  -webkit-app-region: drag;
  height: 56px;
}

.app-drag-layer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 56px;
  -webkit-app-region: drag;
  z-index: 0;
}

.drag-strip {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 32px;
  -webkit-app-region: drag;
  z-index: 1;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  -webkit-app-region: drag;
  position: relative;
  z-index: 2;
}

.logo-box {
  width: 2.5rem;
  height: 2.5rem;
  background: linear-gradient(135deg, var(--primary-600), var(--primary-500));
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-md);
  color: white;
}

.logo-icon {
  width: 1.25rem;
  height: 1.25rem;
}

.header-center {
  flex: 1;
  display: flex;
  justify-content: center;
  -webkit-app-region: drag;
  position: relative;
  z-index: 2;
}

.header-actions {
  -webkit-app-region: no-drag;
  position: relative;
  z-index: 2;
}

.app-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
