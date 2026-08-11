<template>
  <div class="picker-root">
    <Teleport to="#header-right-slot">
      <button class="btn btn-weak btn-icon" @click="$emit('back')" data-no-drag>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        返回
      </button>
    </Teleport>

    <!-- 工具栏 -->
    <div class="picker-toolbar glass-panel">
      <div class="toolbar-left">
        <div class="picker-title">
          <span class="picker-icon">🖼️</span>
          <span>挑图导入 Eagle</span>
        </div>
        <div class="count-info">共 {{ list.length }} 张 · 点击照片放大后可导入或裁剪导入</div>
      </div>
    </div>

    <!-- 缩略图网格 -->
    <div class="grid-scroll">
      <div v-if="list.length === 0" class="picker-empty">
        <div class="empty-icon">🫥</div>
        <p>没有可挑选的照片</p>
      </div>
      <div v-else class="pick-grid">
        <div v-for="item in list" :key="item.key" class="cell" :ref="(el) => setCellRef(el, item)" :title="`${item.filename}（点击放大 / 导入 Eagle）`" @click="lightboxKey = item.key">
          <img v-if="item.thumb" :src="item.thumb" class="cell-img" draggable="false" />
          <div v-else class="cell-placeholder">
            <span v-if="item.thumbState === 'loading'" class="mini-spinner dark"></span>
            <span v-else-if="item.thumbState === 'error'" class="thumb-error">⚠️</span>
            <span class="ext-tag">{{ extOf(item.filename).toUpperCase() }}</span>
          </div>

          <div class="cell-badges">
            <span v-if="markOf(item.path).cropCount > 0" class="mini-badge badge-crop">✂ {{ markOf(item.path).cropCount }}</span>
            <span v-if="markOf(item.path).imported" class="mini-badge badge-done">已导入</span>
          </div>

          <div class="cell-name" :title="item.filename">{{ item.filename }}</div>
        </div>
      </div>
    </div>

    <!-- 灯箱：预览 / 裁剪 / 导入 Eagle -->
    <EagleLightbox :items="list" v-model="lightboxKey" />
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue";
import { invoke } from "@tauri-apps/api/core";
import EagleLightbox from "./EagleLightbox.vue";
import { useEagle } from "../composables/useEagle.js";

const props = defineProps({
  items: { type: Array, default: () => [] },
});
defineEmits(["back"]);

const { markOf } = useEagle();

const list = ref(
  props.items.map((it) => ({
    ...it,
    thumb: "",
    thumbState: "idle", // idle | loading | ok | error
  }))
);

const lightboxKey = ref(null);

function extOf(name) {
  const idx = (name || "").lastIndexOf(".");
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : "";
}

/* ---------------- 缩略图懒加载 ---------------- */

let io = null;
const cellEls = new Map();

function setCellRef(el, item) {
  const prev = cellEls.get(item.key);
  if (el) {
    if (prev !== el) {
      el.dataset.key = item.key;
      cellEls.set(item.key, el);
      if (io && item.thumbState === "idle") io.observe(el);
    }
  } else if (prev) {
    if (io) io.unobserve(prev);
    cellEls.delete(item.key);
  }
}

function onIntersect(entries) {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    io.unobserve(en.target);
    const item = list.value.find((i) => i.key === en.target.dataset.key);
    if (item) loadThumb(item);
  }
}

async function loadThumb(item) {
  if (item.thumbState !== "idle") return;
  item.thumbState = "loading";
  try {
    item.thumb = await invoke("get_thumbnail", { path: item.path, size: 512 });
    item.thumbState = "ok";
  } catch (e) {
    item.thumbState = "error";
  }
}

onMounted(() => {
  io = new IntersectionObserver(onIntersect, { rootMargin: "300px" });
  cellEls.forEach((el) => io.observe(el));
});

onBeforeUnmount(() => {
  if (io) io.disconnect();
});
</script>

<style scoped>
.picker-root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: var(--space-4);
}

/* ---------- 工具栏 ---------- */
.picker-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-xl);
  flex-wrap: wrap;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.picker-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 700;
  font-size: 1rem;
  white-space: nowrap;
}

.count-info {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  white-space: nowrap;
}

/* ---------- 网格 ---------- */
.grid-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-radius: var(--radius-xl);
  padding-bottom: var(--space-4);
}

.pick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: var(--space-3);
}

.cell {
  position: relative;
  aspect-ratio: 1 / 1;
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: pointer;
  background: var(--surface-100);
  user-select: none;
  transition: transform var(--transition-fast);
}

.cell:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.cell:active {
  transform: scale(0.985);
}

.cell-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cell-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  color: var(--color-text-light);
}

.ext-tag {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-200);
  color: var(--color-text-muted);
}

.thumb-error {
  font-size: 1.2rem;
}

.cell-badges {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  pointer-events: none;
}

.mini-badge {
  font-size: 0.66rem;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
  color: #fff;
  white-space: nowrap;
}

.badge-done {
  background: var(--color-success);
}

.badge-crop {
  background: var(--accent-500);
}

.cell-name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 14px 8px 5px;
  font-size: 0.68rem;
  color: #fff;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.6));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

.picker-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-12);
  color: var(--color-text-muted);
  gap: var(--space-3);
}

.picker-empty .empty-icon {
  font-size: 2.4rem;
}

/* ---------- 通用 ---------- */
.mini-spinner {
  width: 0.9rem;
  height: 0.9rem;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
  flex-shrink: 0;
}

.mini-spinner.dark {
  border-color: var(--surface-300);
  border-top-color: var(--primary-500);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.btn-weak {
  background: transparent;
  border: 1px solid transparent;
  color: var(--color-text-muted);
  box-shadow: none;
  padding: 0.35rem 0.6rem;
  font-size: 0.85rem;
  opacity: 0.8;
}

.btn-weak:hover:not(:disabled) {
  background: var(--surface-overlay-soft);
  color: var(--color-text-main);
  box-shadow: none;
  opacity: 1;
}
</style>
