<template>
  <div class="app-container">
    <header
      class="app-header animate-fade-in"
      :class="{ 'is-config': currentStep === 'config' }"
      data-tauri-drag-region
      @pointerdown="onHeaderPointerDown"
    >
      <div class="brand" id="header-left-slot" data-tauri-drag-region>
      </div>
      
      <div class="header-center" id="header-center-slot">
        <TabView
          v-if="currentStep === 'config'"
          :tabs="modeTabs"
          v-model:activeTab="currentMode"
          class="header-tabs"
          data-no-drag
          data-tauri-no-drag
        />
      </div>

      <div class="header-actions" id="header-right-slot">
      </div>
    </header>

    <main class="app-content animate-fade-in" style="animation-delay: 0.1s">
      <Home />
    </main>
  </div>
</template>

<script setup>
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
  height: 64px;
  z-index: 100;
  background: linear-gradient(180deg, var(--surface-overlay-strong), var(--surface-overlay-soft));
  border-bottom: 1px solid var(--divider-color);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  user-select: none;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  position: relative;
  z-index: 10;
  justify-self: start;
  padding-left: 5rem;
  height: 100%;
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
}

.app-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
