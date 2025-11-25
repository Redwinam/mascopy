<template>
  <div class="app-container">
    <header class="app-header animate-fade-in">
      <div class="brand">
        <div class="logo-box">
          <svg xmlns="http://www.w3.org/2000/svg" class="logo-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <div class="brand-text">
          <h1>大师拷贝</h1>
          <p>照片/视频 NAS 上传工具</p>
        </div>
      </div>
      <div class="header-actions">
        <!-- Future: Settings button -->
      </div>
    </header>

    <main class="app-content animate-fade-in" style="animation-delay: 0.1s">
      <Home />
    </main>
  </div>
</template>

<script setup>
import Home from './views/Home.vue';
import './styles/main.css';
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-8);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--surface-200);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.logo-box {
  width: 3.5rem;
  height: 3.5rem;
  background: linear-gradient(135deg, var(--primary-600), var(--primary-500));
  border-radius: var(--radius-xl);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-lg);
  color: white;
}

.logo-icon {
  width: 1.75rem;
  height: 1.75rem;
}

.brand-text h1 {
  font-size: 1.5rem;
  margin: 0;
  line-height: 1.2;
  background: linear-gradient(to right, var(--primary-700), var(--primary-500));
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.brand-text p {
  font-size: 0.875rem;
  color: var(--color-text-muted);
  margin: 0;
}

.app-content {
  flex: 1;
  display: flex;
  flex-direction: column;
}
</style>
