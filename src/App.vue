<template>
  <div class="app-container">
    <header class="app-header animate-fade-in" data-tauri-drag-region>
      <div class="brand">
        <!-- Brand hidden as per user request to avoid conflict with traffic lights -->
      </div>
      
      <div class="header-center">
        <TabView :tabs="modeTabs" v-model:activeTab="currentMode" class="header-tabs" />
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

const { currentMode } = useAppState();

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
  padding: var(--space-4) var(--space-6);
  padding-top: 2rem; /* Add padding for traffic lights */
  -webkit-app-region: drag;
  height: 80px; /* Increased height for traffic lights */
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
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

.brand-text h1 {
  font-size: 1.125rem;
  margin: 0;
  line-height: 1.2;
  font-weight: 700;
  color: var(--color-text-main);
}

.header-center {
  flex: 1;
  display: flex;
  justify-content: center;
  -webkit-app-region: no-drag;
}

.app-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
