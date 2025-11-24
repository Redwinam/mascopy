<template>
  <div class="container mx-auto p-8 max-w-5xl">
    <header class="mb-8 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <h1 class="text-2xl font-bold text-gray-800">大师拷贝</h1>
          <p class="text-sm text-gray-500">照片/视频 NAS 上传工具</p>
        </div>
      </div>
      <div class="flex gap-2">
        <!-- Future: Settings button -->
      </div>
    </header>

    <main>
      <Home />
    </main>
  </div>
</template>

<script setup>
import Home from './views/Home.vue';
import './styles/main.css';
</script>
