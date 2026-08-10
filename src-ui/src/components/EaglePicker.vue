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
        <div class="count-info">
          共 {{ list.length }} 张
          <template v-if="selectedCount > 0"> · 已选 <b>{{ selectedCount }}</b></template>
        </div>
      </div>

      <div class="toolbar-middle">
        <div :class="['eagle-chip', `eagle-${eagleState.status}`]" @click="showSettings = !showSettings" :title="eagleState.error || 'Eagle 连接设置'">
          <span class="chip-dot"></span>
          <span v-if="eagleState.status === 'ok'">Eagle {{ eagleState.version }}</span>
          <span v-else-if="eagleState.status === 'checking'">连接中…</span>
          <span v-else>未连接 Eagle</span>
          <svg xmlns="http://www.w3.org/2000/svg" class="chip-gear" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
          </svg>
        </div>

        <select v-model="folderId" class="folder-select" :disabled="eagleState.status !== 'ok'" title="导入到 Eagle 文件夹">
          <option value="">📁 不指定文件夹</option>
          <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.label }}</option>
        </select>

        <input v-model="tagsInput" class="tags-input" placeholder="标签（逗号分隔，可选）" />
      </div>

      <div class="toolbar-right">
        <button class="btn btn-secondary btn-sm" @click="selectAll" :disabled="list.length === 0">全选</button>
        <button class="btn btn-secondary btn-sm" @click="clearSelection" :disabled="selectedCount === 0">清除</button>
        <button class="btn btn-primary import-btn" @click="importSelected" :disabled="selectedCount === 0 || eagleState.status !== 'ok' || importing">
          <span v-if="importing" class="mini-spinner"></span>
          <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          {{ importing ? "导入中…" : `导入选中 (${selectedCount})` }}
        </button>
      </div>
    </div>

    <!-- Eagle 连接设置 -->
    <div v-if="showSettings" class="settings-panel glass-panel animate-fade-in">
      <div class="settings-field">
        <label>Eagle 地址</label>
        <input v-model="eagleCfg.base_url" placeholder="http://localhost:41595" @change="saveEagleConfig" />
      </div>
      <div class="settings-field">
        <label>API Token</label>
        <input v-model="eagleCfg.token" placeholder="Eagle → 偏好设置 → 开发者" @change="saveEagleConfig" />
      </div>
      <button class="btn btn-secondary btn-sm" @click="connectEagle" :disabled="eagleState.status === 'checking'">
        {{ eagleState.status === "checking" ? "连接中…" : "重新连接" }}
      </button>
      <span v-if="eagleState.status === 'fail'" class="settings-error" :title="eagleState.error">{{ eagleState.error }}</span>
    </div>

    <!-- 缩略图网格 -->
    <div class="grid-scroll" ref="gridScrollEl">
      <div v-if="list.length === 0" class="picker-empty">
        <div class="empty-icon">🫥</div>
        <p>没有可挑选的照片</p>
      </div>
      <div v-else class="pick-grid">
        <div
          v-for="(item, idx) in list"
          :key="item.key"
          class="cell"
          :class="{ selected: item.selected, imported: item.imported }"
          :ref="(el) => setCellRef(el, item)"
          @click="toggleSelect(item)"
          @dblclick.prevent="openViewer(idx)"
        >
          <img v-if="item.thumb" :src="item.thumb" class="cell-img" draggable="false" />
          <div v-else class="cell-placeholder">
            <span v-if="item.thumbState === 'loading'" class="mini-spinner dark"></span>
            <span v-else-if="item.thumbState === 'error'" class="thumb-error">⚠️</span>
            <span class="ext-tag">{{ extOf(item.filename).toUpperCase() }}</span>
          </div>

          <div class="sel-ring"></div>
          <div class="check-badge">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <div class="cell-badges">
            <span v-if="item.cropCount > 0" class="mini-badge badge-crop">✂ {{ item.cropCount }}</span>
            <span v-if="item.imported" class="mini-badge badge-done">已导入</span>
          </div>

          <button class="zoom-btn" @click.stop="openViewer(idx)" title="放大预览（双击也可）">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m-3-3h6" />
            </svg>
          </button>

          <div class="cell-name" :title="item.filename">{{ item.filename }}</div>
        </div>
      </div>
    </div>

    <!-- 灯箱预览 / 裁剪 -->
    <div v-if="viewerIndex !== null && current" class="viewer-overlay" @mousedown.self="closeViewer">
      <div class="viewer-top">
        <div class="viewer-info">
          <span class="viewer-filename">{{ current.filename }}</span>
          <span class="viewer-index">{{ viewerIndex + 1 }} / {{ list.length }}</span>
          <span v-if="current.imported" class="mini-badge badge-done">已导入</span>
          <span v-if="current.cropCount > 0" class="mini-badge badge-crop">✂ {{ current.cropCount }}</span>
        </div>
        <button class="viewer-close" @click="closeViewer" title="关闭 (Esc)">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="viewer-stage">
        <button v-if="!cropping" class="nav-btn nav-prev" @click.stop="nav(-1)" :disabled="viewerIndex === 0">‹</button>

        <div class="stage-center" @mousedown="onStageDown">
          <div v-if="previewLoading" class="preview-loading">
            <span class="mini-spinner"></span>
            <span>加载预览…</span>
          </div>
          <div v-else-if="previewError" class="preview-loading preview-failed">⚠️ {{ previewError }}</div>

          <div v-show="!previewLoading && !previewError" class="img-holder" ref="holderEl">
            <img ref="imgEl" :src="previewSrc" class="viewer-img" draggable="false" @load="onPreviewLoad" @error="onPreviewError" />
            <div v-if="cropping" class="crop-layer" ref="layerEl" @pointerdown.prevent="onLayerDown">
              <div class="crop-rect" :style="rectStyle" @pointerdown.prevent.stop="onRectDown">
                <div class="crop-grid-v"></div>
                <div class="crop-grid-h"></div>
                <div v-for="c in ['nw', 'ne', 'sw', 'se']" :key="c" :class="['crop-handle', `handle-${c}`]" @pointerdown.prevent.stop="onHandleDown($event, c)"></div>
                <div class="crop-size-label">{{ cropSizeLabel }}</div>
              </div>
            </div>
          </div>

          <div v-if="viewerToast.text" :class="['viewer-toast', `toast-${viewerToast.type}`]">{{ viewerToast.text }}</div>
        </div>

        <button v-if="!cropping" class="nav-btn nav-next" @click.stop="nav(1)" :disabled="viewerIndex >= list.length - 1">›</button>
      </div>

      <div class="viewer-bar" @mousedown.stop>
        <template v-if="!cropping">
          <button :class="['btn', current.selected ? 'btn-secondary' : 'btn-primary']" @click="toggleSelect(current)">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {{ current.selected ? "取消选择" : "选择此图（空格）" }}
          </button>
          <button class="btn btn-secondary" @click="startCrop" :disabled="previewLoading || !!previewError">✂️ 裁剪</button>
        </template>
        <template v-else>
          <div class="aspect-group">
            <button v-for="a in aspectOptions" :key="a.key" :class="['aspect-chip', { active: aspect === a.key }]" @click="setAspect(a.key)">{{ a.label }}</button>
          </div>
          <input v-model="cropName" class="crop-name-input" placeholder="导入名称" title="导入到 Eagle 的名称" />
          <button class="btn btn-secondary" @click="cancelCrop">取消</button>
          <button class="btn btn-primary" @click="confirmCrop" :disabled="cropBusy || eagleState.status !== 'ok'" :title="eagleState.status !== 'ok' ? '未连接 Eagle' : '内存裁剪后直接推送 Eagle，不写入磁盘'">
            <span v-if="cropBusy" class="mini-spinner"></span>
            {{ cropBusy ? "导入中…" : "✂️ 裁剪并导入 Eagle" }}
          </button>
        </template>
      </div>
    </div>

    <Modal v-if="resultModal.visible" @close="resultModal.visible = false">
      <template #title>{{ resultModal.title }}</template>
      <div class="result-content">
        <p class="result-message">{{ resultModal.message }}</p>
        <ul v-if="resultModal.failures.length > 0" class="failure-list">
          <li v-for="(f, i) in resultModal.failures" :key="i">
            <b>{{ f.name }}</b>
            <span>{{ f.error }}</span>
          </li>
        </ul>
      </div>
      <template #footer>
        <button class="btn btn-primary" @click="resultModal.visible = false">知道了</button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import Modal from "./Modal.vue";
import { useAppState } from "../composables/useAppState.js";

const props = defineProps({
  items: { type: Array, default: () => [] },
});
defineEmits(["back"]);

const { config } = useAppState();

const NATIVE_EXTS = ["jpg", "jpeg", "png"];

const list = ref(
  props.items.map((it) => ({
    ...it,
    selected: false,
    imported: false,
    cropCount: 0,
    thumb: "",
    thumbState: "idle", // idle | loading | ok | error
    previewSrc: "",
  }))
);

const selectedCount = computed(() => list.value.filter((i) => i.selected).length);

function extOf(name) {
  const idx = (name || "").lastIndexOf(".");
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function stemOf(name) {
  const idx = (name || "").lastIndexOf(".");
  return idx > 0 ? name.slice(0, idx) : name || "";
}

function parseTags(input) {
  return Array.from(
    new Set(
      String(input || "")
        .split(/[,，、\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
    )
  );
}

/* ---------------- Eagle 连接 ---------------- */

const eagleCfg = computed(() => {
  if (!config.value.eagle) {
    config.value.eagle = { base_url: "http://localhost:41595", token: "", last_folder_id: "" };
  }
  return config.value.eagle;
});

const eagleState = ref({ status: "idle", version: "", error: "" });
const folders = ref([]);
const folderId = ref("");
const tagsInput = ref("");
const showSettings = ref(false);

function flattenFolders(nodes, depth = 0, out = []) {
  (nodes || []).forEach((n) => {
    out.push({ id: n.id, label: `${"　".repeat(depth)}${n.name}` });
    flattenFolders(n.children, depth + 1, out);
  });
  return out;
}

async function connectEagle() {
  eagleState.value = { status: "checking", version: "", error: "" };
  try {
    const auth = { baseUrl: eagleCfg.value.base_url, token: eagleCfg.value.token };
    const version = await invoke("eagle_ping", auth);
    const tree = await invoke("eagle_folders", auth);
    folders.value = flattenFolders(tree);
    const saved = eagleCfg.value.last_folder_id;
    if (saved && folders.value.some((f) => f.id === saved)) {
      folderId.value = saved;
    }
    eagleState.value = { status: "ok", version, error: "" };
  } catch (e) {
    eagleState.value = { status: "fail", version: "", error: String(e) };
    showSettings.value = true;
  }
}

async function saveEagleConfig() {
  try {
    await invoke("save_config", { config: config.value });
  } catch (e) {
    /* 保存失败不阻断挑图流程 */
  }
}

async function persistFolderChoice() {
  eagleCfg.value.last_folder_id = folderId.value;
  await saveEagleConfig();
}

/* ---------------- 缩略图懒加载 ---------------- */

const gridScrollEl = ref(null);
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

/* ---------------- 选择 ---------------- */

function toggleSelect(item) {
  if (!item) return;
  item.selected = !item.selected;
}

function selectAll() {
  list.value.forEach((i) => (i.selected = true));
}

function clearSelection() {
  list.value.forEach((i) => (i.selected = false));
}

/* ---------------- 灯箱预览 ---------------- */

const viewerIndex = ref(null);
const current = computed(() => (viewerIndex.value === null ? null : list.value[viewerIndex.value]));
const previewSrc = ref("");
const previewLoading = ref(false);
const previewError = ref("");
const imgEl = ref(null);
const holderEl = ref(null);
const dispSize = ref({ w: 0, h: 0 });
let resizeObserver = null;

async function openViewer(idx) {
  viewerIndex.value = idx;
  await loadPreview();
}

function closeViewer() {
  cancelCrop();
  viewerIndex.value = null;
  previewSrc.value = "";
  previewError.value = "";
}

async function nav(delta) {
  if (viewerIndex.value === null) return;
  const next = viewerIndex.value + delta;
  if (next < 0 || next >= list.value.length) return;
  viewerIndex.value = next;
  await loadPreview();
}

async function loadPreview() {
  const item = current.value;
  if (!item) return;
  cancelCrop();
  previewError.value = "";
  previewLoading.value = true;
  previewSrc.value = "";
  try {
    if (!item.previewSrc) {
      if (NATIVE_EXTS.includes(extOf(item.filename))) {
        item.previewSrc = convertFileSrc(item.path);
      } else {
        // RAW/HEIC：后端 sips 转成内存 data URL，不产生磁盘缓存
        item.previewSrc = await invoke("get_preview", { path: item.path, maxDim: 2560 });
      }
    }
    previewSrc.value = item.previewSrc;
  } catch (e) {
    previewLoading.value = false;
    previewError.value = String(e);
  }
}

function measureImg() {
  if (imgEl.value) {
    dispSize.value = { w: imgEl.value.clientWidth, h: imgEl.value.clientHeight };
  }
}

function onPreviewLoad() {
  previewLoading.value = false;
  nextTick(() => {
    measureImg();
    // 灯箱是 v-if 挂载的，图片元素每次打开都会重建，需要重新观察
    if (resizeObserver && imgEl.value) resizeObserver.observe(imgEl.value);
  });
}

function onStageDown(e) {
  if (!cropping.value && e.target === e.currentTarget) closeViewer();
}

function onPreviewError() {
  if (previewSrc.value) {
    previewLoading.value = false;
    previewError.value = "无法显示该图片";
  }
}

/* ---------------- 裁剪 ---------------- */

const cropping = ref(false);
const cropRect = ref({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }); // 归一化(0..1)，相对显示图像
const aspect = ref("1:1");
const cropName = ref("");
const cropBusy = ref(false);
const layerEl = ref(null);

const aspectOptions = [
  { key: "1:1", label: "1:1 方形", ratio: 1 },
  { key: "4:3", label: "4:3", ratio: 4 / 3 },
  { key: "3:2", label: "3:2", ratio: 3 / 2 },
  { key: "16:9", label: "16:9", ratio: 16 / 9 },
  { key: "free", label: "自由", ratio: null },
];

const currentRatio = computed(() => aspectOptions.find((a) => a.key === aspect.value)?.ratio ?? null);

const rectStyle = computed(() => {
  const { w, h } = dispSize.value;
  const r = cropRect.value;
  return {
    left: `${r.x * w}px`,
    top: `${r.y * h}px`,
    width: `${r.w * w}px`,
    height: `${r.h * h}px`,
  };
});

const cropSizeLabel = computed(() => {
  const img = imgEl.value;
  if (!img || !img.naturalWidth) return "";
  const w = Math.round(cropRect.value.w * img.naturalWidth);
  const h = Math.round(cropRect.value.h * img.naturalHeight);
  const raw = !NATIVE_EXTS.includes(extOf(current.value?.filename || ""));
  return `${raw ? "≈" : ""}${w}×${h}`;
});

function startCrop() {
  measureImg();
  const { w, h } = dispSize.value;
  if (!w || !h) return;
  cropName.value = stemOf(current.value.filename);
  applyDefaultRect();
  cropping.value = true;
}

function applyDefaultRect() {
  const { w, h } = dispSize.value;
  const ratio = currentRatio.value;
  if (ratio === null) {
    cropRect.value = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    return;
  }
  // 以显示像素为准生成符合比例的默认框（居中，尽量大）
  let pw = w * 0.85;
  let ph = pw / ratio;
  if (ph > h * 0.85) {
    ph = h * 0.85;
    pw = ph * ratio;
  }
  cropRect.value = {
    x: (1 - pw / w) / 2,
    y: (1 - ph / h) / 2,
    w: pw / w,
    h: ph / h,
  };
}

function setAspect(key) {
  aspect.value = key;
  const ratio = currentRatio.value;
  if (ratio === null) return;
  const { w, h } = dispSize.value;
  if (!w || !h) return;
  // 保持中心与宽度，按新比例调高度并收进边界
  const r = cropRect.value;
  let pw = r.w * w;
  let ph = pw / ratio;
  const maxH = h;
  if (ph > maxH) {
    ph = maxH;
    pw = ph * ratio;
  }
  let cx = (r.x + r.w / 2) * w;
  let cy = (r.y + r.h / 2) * h;
  let x = Math.min(Math.max(cx - pw / 2, 0), w - pw);
  let y = Math.min(Math.max(cy - ph / 2, 0), h - ph);
  cropRect.value = { x: x / w, y: y / h, w: pw / w, h: ph / h };
}

function cancelCrop() {
  cropping.value = false;
  cropBusy.value = false;
}

let drag = null; // { mode, startX, startY, orig, anchor }

function layerPoint(e) {
  const rect = layerEl.value.getBoundingClientRect();
  return {
    x: Math.min(Math.max(e.clientX - rect.left, 0), rect.width),
    y: Math.min(Math.max(e.clientY - rect.top, 0), rect.height),
  };
}

function pxRect() {
  const { w, h } = dispSize.value;
  const r = cropRect.value;
  return { x: r.x * w, y: r.y * h, w: r.w * w, h: r.h * h };
}

function storeRect(px) {
  const { w, h } = dispSize.value;
  if (!w || !h) return;
  cropRect.value = { x: px.x / w, y: px.y / h, w: px.w / w, h: px.h / h };
}

function beginDrag(state) {
  drag = state;
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", endDrag);
}

function onRectDown(e) {
  const p = layerPoint(e);
  beginDrag({ mode: "move", start: p, orig: pxRect() });
}

function onHandleDown(e, corner) {
  const r = pxRect();
  const anchor = {
    x: corner.includes("w") ? r.x + r.w : r.x,
    y: corner.includes("n") ? r.y + r.h : r.y,
  };
  beginDrag({ mode: "resize", anchor });
  onDragMove(e);
}

function onLayerDown(e) {
  const p = layerPoint(e);
  beginDrag({ mode: "resize", anchor: p });
  storeRect({ x: p.x, y: p.y, w: 0, h: 0 });
}

function onDragMove(e) {
  if (!drag || !layerEl.value) return;
  const { w: W, h: H } = dispSize.value;
  const p = layerPoint(e);

  if (drag.mode === "move") {
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const nx = Math.min(Math.max(drag.orig.x + dx, 0), W - drag.orig.w);
    const ny = Math.min(Math.max(drag.orig.y + dy, 0), H - drag.orig.h);
    storeRect({ x: nx, y: ny, w: drag.orig.w, h: drag.orig.h });
    return;
  }

  // resize / draw：以 anchor 为固定角
  const ratio = currentRatio.value;
  const dx = p.x - drag.anchor.x;
  const dy = p.y - drag.anchor.y;
  let w = Math.abs(dx);
  let h = Math.abs(dy);
  if (ratio !== null) {
    // 取拖拽两个方向中的较大者，保证跟手
    if (w / ratio >= h) {
      h = w / ratio;
    } else {
      w = h * ratio;
    }
  }
  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;
  // 越界时按比例收缩
  const maxW = sx > 0 ? W - drag.anchor.x : drag.anchor.x;
  const maxH = sy > 0 ? H - drag.anchor.y : drag.anchor.y;
  if (ratio !== null) {
    const fit = Math.min(maxW / w || 0, maxH / h || 0, 1);
    w *= fit;
    h *= fit;
  } else {
    w = Math.min(w, maxW);
    h = Math.min(h, maxH);
  }
  const x = sx > 0 ? drag.anchor.x : drag.anchor.x - w;
  const y = sy > 0 ? drag.anchor.y : drag.anchor.y - h;
  storeRect({ x, y, w, h });
}

function endDrag() {
  drag = null;
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", endDrag);
  // 防止缩得过小
  const px = pxRect();
  if (px.w < 24 || px.h < 24) {
    applyDefaultRect();
  }
}

/* ---------------- 导入 ---------------- */

const importing = ref(false);
const resultModal = ref({ visible: false, title: "", message: "", failures: [] });
const viewerToast = ref({ text: "", type: "success" });
let toastTimer = null;

function toast(text, type = "success") {
  viewerToast.value = { text, type };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (viewerToast.value = { text: "", type: "success" }), 2600);
}

async function confirmCrop() {
  const item = current.value;
  if (!item || cropBusy.value) return;
  cropBusy.value = true;
  try {
    const res = await invoke("eagle_import_crop", {
      path: item.path,
      rect: { ...cropRect.value },
      name: cropName.value.trim() || stemOf(item.filename),
      tags: parseTags(tagsInput.value),
      folderId: folderId.value || null,
      baseUrl: eagleCfg.value.base_url,
      token: eagleCfg.value.token,
    });
    item.cropCount += 1;
    cropping.value = false;
    toast(`已导入裁剪图 ${res.width}×${res.height}`);
    await persistFolderChoice();
  } catch (e) {
    toast(`导入失败: ${e}`, "error");
  } finally {
    cropBusy.value = false;
  }
}

async function importSelected() {
  const selected = list.value.filter((i) => i.selected);
  if (selected.length === 0 || importing.value) return;
  importing.value = true;
  try {
    const items = selected.map((i) => ({
      path: i.path,
      name: stemOf(i.filename),
      tags: parseTags(tagsInput.value),
      annotation: null,
    }));
    const res = await invoke("eagle_import", {
      baseUrl: eagleCfg.value.base_url,
      token: eagleCfg.value.token,
      items,
      folderId: folderId.value || null,
    });
    const failedPaths = new Set((res.failed || []).map((f) => f.path));
    selected.forEach((i) => {
      if (!failedPaths.has(i.path)) {
        i.imported = true;
        i.selected = false;
      }
    });
    await persistFolderChoice();
    resultModal.value = {
      visible: true,
      title: res.failed.length === 0 ? "🎉 导入完成" : "⚠️ 部分导入失败",
      message: `成功导入 ${res.succeeded} / ${res.total} 张到 Eagle${folderLabel()}。`,
      failures: res.failed || [],
    };
  } catch (e) {
    resultModal.value = {
      visible: true,
      title: "导入失败",
      message: String(e),
      failures: [],
    };
  } finally {
    importing.value = false;
  }
}

function folderLabel() {
  const f = folders.value.find((x) => x.id === folderId.value);
  return f ? `「${f.label.trim()}」` : "";
}

/* ---------------- 键盘 ---------------- */

function onKey(e) {
  if (viewerIndex.value === null) return;
  const tag = (e.target && e.target.tagName) || "";
  const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  if (e.key === "Escape") {
    if (cropping.value) cancelCrop();
    else closeViewer();
    return;
  }
  if (typing) return;
  if (cropping.value) {
    if (e.key === "Enter") confirmCrop();
    return;
  }
  if (e.key === "ArrowLeft") nav(-1);
  else if (e.key === "ArrowRight") nav(1);
  else if (e.key === " ") {
    e.preventDefault();
    toggleSelect(current.value);
  } else if (e.key === "Enter") {
    startCrop();
  }
}

/* ---------------- 生命周期 ---------------- */

onMounted(() => {
  io = new IntersectionObserver(onIntersect, { rootMargin: "300px" });
  cellEls.forEach((el) => io.observe(el));
  resizeObserver = new ResizeObserver(() => measureImg());
  window.addEventListener("keydown", onKey);
  connectEagle();
});

onBeforeUnmount(() => {
  if (io) io.disconnect();
  if (resizeObserver) resizeObserver.disconnect();
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", endDrag);
  if (toastTimer) clearTimeout(toastTimer);
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

.toolbar-middle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  justify-content: center;
  flex-wrap: wrap;
}

.eagle-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--surface-300);
  background: var(--surface-0);
  color: var(--color-text-muted);
  user-select: none;
  white-space: nowrap;
}

.chip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--surface-400);
  flex-shrink: 0;
}

.eagle-ok .chip-dot {
  background: var(--color-success);
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.7);
}

.eagle-fail .chip-dot {
  background: var(--color-error);
}

.eagle-checking .chip-dot {
  background: var(--color-warning);
  animation: pulse 1s infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}

.chip-gear {
  width: 13px;
  height: 13px;
  opacity: 0.6;
}

.folder-select {
  max-width: 240px;
  min-width: 150px;
  padding: 0.35rem 0.5rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--surface-300);
  background: var(--surface-0);
  color: var(--color-text-main);
  font-size: 0.85rem;
}

.tags-input {
  width: 190px;
  padding: 0.35rem 0.6rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--surface-300);
  background: var(--surface-0);
  color: var(--color-text-main);
  font-size: 0.85rem;
}

.tags-input:focus,
.folder-select:focus,
.crop-name-input:focus {
  outline: 2px solid var(--primary-soft-strong);
  border-color: var(--primary-400);
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.import-btn {
  gap: var(--space-2);
  font-weight: 600;
}

/* ---------- 设置面板 ---------- */
.settings-panel {
  display: flex;
  align-items: flex-end;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  flex-wrap: wrap;
}

.settings-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-field label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-muted);
}

.settings-field input {
  width: 260px;
  padding: 0.35rem 0.6rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--surface-300);
  background: var(--surface-0);
  color: var(--color-text-main);
  font-size: 0.85rem;
  font-family: "SF Mono", ui-monospace, Menlo, monospace;
}

.settings-error {
  font-size: 0.78rem;
  color: var(--color-error);
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
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

.sel-ring {
  position: absolute;
  inset: 0;
  border-radius: var(--radius-lg);
  pointer-events: none;
  border: 3px solid transparent;
  transition: border-color var(--transition-fast);
}

.cell.selected .sel-ring {
  border-color: var(--primary-500);
}

.check-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid rgba(255, 255, 255, 0.9);
  background: rgba(0, 0, 0, 0.25);
  color: transparent;
  opacity: 0;
  transition: all var(--transition-fast);
  pointer-events: none;
}

.cell:hover .check-badge {
  opacity: 1;
}

.cell.selected .check-badge {
  opacity: 1;
  background: var(--primary-500);
  border-color: var(--primary-500);
  color: #fff;
}

.check-badge svg {
  width: 13px;
  height: 13px;
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

.zoom-btn {
  position: absolute;
  right: 8px;
  bottom: 30px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.cell:hover .zoom-btn {
  opacity: 1;
}

.zoom-btn:hover {
  background: rgba(0, 0, 0, 0.7);
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

/* ---------- 灯箱 ---------- */
.viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(10, 14, 24, 0.88);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: flex;
  flex-direction: column;
  animation: fadeIn 0.16s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
}

.viewer-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-6);
  color: #e2e8f0;
}

.viewer-info {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.viewer-filename {
  font-weight: 600;
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewer-index {
  font-size: 0.8rem;
  opacity: 0.6;
  font-family: monospace;
}

.viewer-close {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: #e2e8f0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--transition-fast);
}

.viewer-close:hover {
  background: rgba(255, 255, 255, 0.22);
}

.viewer-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: 0 var(--space-4);
}

.stage-center {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.img-holder {
  position: relative;
  max-width: 100%;
  max-height: 100%;
  display: flex;
}

.viewer-img {
  max-width: calc(100vw - 200px);
  max-height: calc(100vh - 190px);
  object-fit: contain;
  display: block;
  border-radius: var(--radius-md);
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
}

.preview-loading {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: #cbd5e1;
  font-size: 0.9rem;
}

.preview-failed {
  color: #fca5a5;
}

.nav-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: #e2e8f0;
  font-size: 1.6rem;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  transition: background var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
  padding-bottom: 4px;
}

.nav-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.25);
}

.nav-btn:disabled {
  opacity: 0.25;
  cursor: default;
}

.viewer-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-6);
  flex-wrap: wrap;
}

.viewer-toast {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.5rem 1.1rem;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  color: #fff;
  background: rgba(16, 185, 129, 0.92);
  box-shadow: var(--shadow-lg);
  animation: fadeIn 0.2s ease;
  white-space: nowrap;
  z-index: 5;
}

.toast-error {
  background: rgba(239, 68, 68, 0.92);
  max-width: 80%;
  white-space: normal;
  text-align: center;
}

/* ---------- 裁剪 ---------- */
.crop-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  cursor: crosshair;
  border-radius: var(--radius-md);
  touch-action: none;
}

.crop-rect {
  position: absolute;
  box-shadow: 0 0 0 9999px rgba(8, 10, 16, 0.62);
  border: 1.5px solid rgba(255, 255, 255, 0.95);
  cursor: move;
  box-sizing: border-box;
}

.crop-grid-v,
.crop-grid-h {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.45;
}

.crop-grid-v {
  border-left: 1px solid rgba(255, 255, 255, 0.7);
  border-right: 1px solid rgba(255, 255, 255, 0.7);
  left: 33.33%;
  right: 33.33%;
}

.crop-grid-h {
  border-top: 1px solid rgba(255, 255, 255, 0.7);
  border-bottom: 1px solid rgba(255, 255, 255, 0.7);
  top: 33.33%;
  bottom: 33.33%;
}

.crop-handle {
  position: absolute;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}

.handle-nw {
  left: -8px;
  top: -8px;
  cursor: nwse-resize;
}

.handle-ne {
  right: -8px;
  top: -8px;
  cursor: nesw-resize;
}

.handle-sw {
  left: -8px;
  bottom: -8px;
  cursor: nesw-resize;
}

.handle-se {
  right: -8px;
  bottom: -8px;
  cursor: nwse-resize;
}

.crop-size-label {
  position: absolute;
  bottom: -26px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.72rem;
  font-family: monospace;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
  pointer-events: none;
}

.aspect-group {
  display: flex;
  gap: 4px;
  background: rgba(255, 255, 255, 0.08);
  padding: 4px;
  border-radius: var(--radius-lg);
}

.aspect-chip {
  border: none;
  background: transparent;
  color: #cbd5e1;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 0.32rem 0.7rem;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.aspect-chip:hover {
  background: rgba(255, 255, 255, 0.12);
}

.aspect-chip.active {
  background: var(--primary-500);
  color: #fff;
}

.crop-name-input {
  width: 220px;
  padding: 0.42rem 0.7rem;
  border-radius: var(--radius-md);
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font-size: 0.85rem;
}

.crop-name-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

/* ---------- 结果弹窗 ---------- */
.result-content {
  padding: var(--space-2) 0;
}

.result-message {
  font-size: 1rem;
  margin-bottom: var(--space-3);
}

.failure-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.failure-list li {
  background: var(--danger-soft);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  font-size: 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.failure-list li span {
  color: var(--color-text-muted);
  word-break: break-all;
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
