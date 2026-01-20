<template>
  <div class="app-container">
    <header
      class="app-header animate-fade-in"
      :class="{ 'is-config': currentStep === 'config' }"
      data-tauri-drag-region
    >
      <div class="app-drag-layer" data-tauri-drag-region></div>
      <div class="drag-strip" data-tauri-drag-region></div>
      <div class="brand" data-tauri-drag-region></div>
      
      <div class="header-center">
        <TabView
          v-if="currentStep === 'config'"
          :tabs="modeTabs"
          v-model:activeTab="currentMode"
          class="header-tabs"
        />
      </div>

      <div class="header-actions">
        <!-- Window controls are handled by OS with titleBarStyle: Overlay -->
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
import { useAppState } from './composables/useAppState.js';
import './styles/main.css';

const { currentMode, currentStep } = useAppState();

const modeTabs = [
  { id: 'sd', label: 'SD卡模式' },
  { id: 'dji', label: 'DJI模式' }
];
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

.app-header.is-config {
  padding-top: 2rem;
  height: 80px;
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

.app-header.is-config .app-drag-layer {
  height: 80px;
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
