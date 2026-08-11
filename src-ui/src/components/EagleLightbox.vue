<template>
  <!-- Teleport 到 body：祖先容器的入场动画残留 transform 会把 fixed 定位圈进容器内，挂到 body 才是真全屏 -->
  <Teleport to="body">
  <div v-if="current" class="viewer-overlay" @mousedown.self="close">
    <div class="viewer-top">
      <div class="viewer-info">
        <span class="viewer-filename">{{ current.filename }}</span>
        <span class="viewer-index">{{ idx + 1 }} / {{ items.length }}</span>
        <span v-if="mark.imported" class="mini-badge badge-done"><Check :size="12" :stroke-width="3" />已导入</span>
        <span v-if="mark.cropCount > 0" class="mini-badge badge-crop"><Scissors :size="12" :stroke-width="2.5" />{{ mark.cropCount }}</span>
      </div>
      <button class="icon-btn viewer-close" @click="close" title="关闭 (Esc)"><X :size="18" /></button>
    </div>

    <div class="viewer-stage">
      <button v-if="!cropping" class="icon-btn nav-btn" @click.stop="nav(-1)" :disabled="idx <= 0" title="上一张 (←)"><ChevronLeft :size="22" /></button>

      <div class="stage-center" @mousedown="onStageDown">
        <div v-if="previewLoading" class="preview-loading">
          <LoaderCircle class="ico-spin" :size="16" />
          <span>加载预览…</span>
        </div>
        <div v-else-if="previewError" class="preview-loading preview-failed"><TriangleAlert :size="16" />{{ previewError }}</div>

        <div v-show="!previewLoading && !previewError" class="img-holder" ref="holderEl">
          <img ref="imgEl" :src="previewSrc" class="viewer-img" draggable="false" @load="onPreviewLoad" @error="onPreviewError" />
          <div v-if="cropping" class="crop-layer" ref="layerEl" @pointerdown.prevent="onLayerDown">
            <div class="crop-rect" :style="rectStyle" @pointerdown.prevent.stop="onRectDown">
              <div class="crop-grid-v"></div>
              <div class="crop-grid-h"></div>
              <div v-for="c in ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w']" :key="c" :class="['crop-handle', `handle-${c}`]" @pointerdown.prevent.stop="onHandleDown($event, c)"></div>
              <div class="crop-size-label">{{ cropSizeLabel }}</div>
            </div>
          </div>
        </div>

        <div v-if="viewerToast.text" :class="['viewer-toast', `toast-${viewerToast.type}`]">{{ viewerToast.text }}</div>
      </div>

      <button v-if="!cropping" class="icon-btn nav-btn" @click.stop="nav(1)" :disabled="idx >= items.length - 1" title="下一张 (→)"><ChevronRight :size="22" /></button>
    </div>

    <div v-if="showSettings && !cropping" class="viewer-settings" @mousedown.stop>
      <div class="dock">
        <label class="dock-field field-url" title="Eagle API 地址">
          <Link2 class="field-icon" :size="15" />
          <input v-model="eagleCfg.base_url" class="dock-input mono" placeholder="http://localhost:41595" @change="saveEagleConfig" />
        </label>
        <label class="dock-field field-token" title="Eagle → 偏好设置 → 开发者">
          <KeyRound class="field-icon" :size="15" />
          <input v-model="eagleCfg.token" class="dock-input mono" placeholder="API Token" @change="saveEagleConfig" />
        </label>
        <button class="dock-btn" @click="connectEagle" :disabled="eagleState.status === 'checking'">
          <LoaderCircle v-if="eagleState.status === 'checking'" class="ico-spin" :size="15" />
          <RotateCw v-else :size="15" />
          {{ eagleState.status === "checking" ? "连接中…" : "重新连接" }}
        </button>
      </div>
      <span v-if="eagleState.status === 'fail'" class="settings-error" :title="eagleState.error">{{ eagleState.error }}</span>
    </div>

    <div class="viewer-bar" @mousedown.stop>
      <div v-if="!cropping" class="dock">
        <button :class="['dock-btn', 'status-btn', `eagle-${eagleState.status}`]" @click="showSettings = !showSettings" :title="eagleState.error || 'Eagle 连接设置'">
          <span class="chip-dot"></span>
          <span v-if="eagleState.status === 'ok'">Eagle {{ eagleState.version }}</span>
          <span v-else-if="eagleState.status === 'checking'">连接中…</span>
          <span v-else>未连接 Eagle</span>
          <Settings2 class="status-gear" :size="14" />
        </button>

        <span class="dock-sep"></span>

        <label class="dock-field field-folder" :class="{ 'is-disabled': eagleState.status !== 'ok' }" title="导入到 Eagle 的哪个文件夹">
          <FolderOpen class="field-icon" :size="15" />
          <select v-model="folderId" class="dock-select" :disabled="eagleState.status !== 'ok'">
            <option value="">不指定文件夹</option>
            <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.label }}</option>
          </select>
          <ChevronDown class="field-caret" :size="14" />
        </label>

        <label class="dock-field field-tags" title="导入时附加的标签，逗号分隔">
          <Tag class="field-icon" :size="15" />
          <input v-model="tagsInput" class="dock-input" placeholder="标签，逗号分隔" />
        </label>

        <span class="dock-sep"></span>

        <button class="dock-btn" @click="startCrop" :disabled="previewLoading || !!previewError" title="框选后导入 Eagle (Enter)">
          <Crop :size="15" />
          裁剪
        </button>
        <button class="dock-btn dock-primary" @click="importCurrent" :disabled="eagleState.status !== 'ok' || singleImporting || mark.imported" :title="eagleState.status !== 'ok' ? '未连接 Eagle' : '把这张原图直接导入 Eagle'">
          <LoaderCircle v-if="singleImporting" class="ico-spin" :size="15" />
          <Check v-else-if="mark.imported" :size="15" />
          <Upload v-else :size="15" />
          {{ mark.imported ? "已导入" : singleImporting ? "导入中…" : "导入 Eagle" }}
        </button>
      </div>

      <div v-else class="dock">
        <div class="seg">
          <button v-for="a in aspectOptions" :key="a.key" :class="['seg-btn', { active: aspect === a.key }]" @click="setAspect(a.key)">{{ a.label }}</button>
        </div>

        <span class="dock-sep"></span>

        <label class="dock-field field-name" title="导入到 Eagle 的名称">
          <Type class="field-icon" :size="15" />
          <input v-model="cropName" class="dock-input" placeholder="导入名称" />
        </label>

        <span class="dock-sep"></span>

        <button class="dock-btn" @click="cancelCrop" title="取消裁剪 (Esc)">取消</button>
        <button class="dock-btn dock-primary" @click="confirmCrop" :disabled="cropBusy || eagleState.status !== 'ok'" :title="eagleState.status !== 'ok' ? '未连接 Eagle' : '内存裁剪后直接推送 Eagle，不写入磁盘'">
          <LoaderCircle v-if="cropBusy" class="ico-spin" :size="15" />
          <Crop v-else :size="15" />
          {{ cropBusy ? "导入中…" : "裁剪并导入" }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Crop, FolderOpen, KeyRound, Link2, LoaderCircle, RotateCw, Scissors, Settings2, Tag, TriangleAlert, Type, Upload, X } from "lucide-vue-next";
import { useEagle } from "../composables/useEagle.js";

const props = defineProps({
  // 实时列表：{ key, path, filename, size? }。父级列表增长（联机新照片入库）会直接反映到计数与翻页
  items: { type: Array, default: () => [] },
  // 当前打开照片的 key；null = 灯箱关闭。用 key 而非索引，列表中途插入新照片也不会串图
  modelValue: { type: String, default: null },
});
const emit = defineEmits(["update:modelValue"]);

const { eagleCfg, eagleState, folders, folderId, tagsInput, markOf, markImported, addCropMark, connectEagle, saveEagleConfig, persistFolderChoice } = useEagle();

const NATIVE_EXTS = ["jpg", "jpeg", "png"];

const idx = computed(() => (props.modelValue == null ? -1 : props.items.findIndex((i) => i.key === props.modelValue)));
const current = computed(() => (idx.value >= 0 ? props.items[idx.value] : null));
const mark = computed(() => (current.value ? markOf(current.value.path) : {}));
const showSettings = ref(false);

function extOf(name) {
  const i = (name || "").lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function stemOf(name) {
  const i = (name || "").lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name || "";
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

function close() {
  cancelCrop();
  emit("update:modelValue", null);
}

function nav(delta) {
  const target = props.items[idx.value + delta];
  if (target) emit("update:modelValue", target.key);
}

/* ---------------- 预览 ---------------- */

const previewCache = new Map(); // path → src；RAW 转出的 data URL 只存内存
const previewSrc = ref("");
const previewLoading = ref(false);
const previewError = ref("");
const imgEl = ref(null);
const holderEl = ref(null);
const dispSize = ref({ w: 0, h: 0 });
let resizeObserver = null;

async function loadPreview() {
  const item = current.value;
  if (!item) return;
  cancelCrop();
  previewError.value = "";
  previewLoading.value = true;
  previewSrc.value = "";
  const path = item.path;
  try {
    let src = previewCache.get(path);
    if (!src) {
      if (NATIVE_EXTS.includes(extOf(item.filename))) {
        src = convertFileSrc(path);
      } else {
        // RAW/HEIC：后端 sips 转成内存 data URL，不产生磁盘缓存
        src = await invoke("get_preview", { path, maxDim: 2560 });
      }
      previewCache.set(path, src);
    }
    // 慢速转换期间用户可能已翻页，只有仍停留在这张时才上屏
    if (current.value && current.value.path === path) previewSrc.value = src;
  } catch (e) {
    if (current.value && current.value.path === path) {
      previewLoading.value = false;
      previewError.value = String(e);
    }
  }
}

watch(
  () => current.value?.path,
  (p) => {
    if (p) {
      loadPreview();
    } else {
      previewSrc.value = "";
      previewError.value = "";
      previewLoading.value = false;
      cancelCrop();
    }
  }
);

// 首次打开灯箱时才连接 Eagle，避免应用启动就探测
watch(
  () => current.value?.key,
  (k) => {
    if (k != null && eagleState.value.status === "idle") connectEagle();
  }
);

watch(
  () => eagleState.value.status,
  (s) => {
    if (s === "fail") showSettings.value = true;
  }
);

// 列表实时变化（如清空记录）后当前 key 不存在时自动关闭
watch(
  () => props.items,
  () => {
    if (props.modelValue != null && idx.value === -1) emit("update:modelValue", null);
  }
);

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
  if (!cropping.value && e.target === e.currentTarget) close();
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
const aspect = ref("free");
const cropName = ref("");
const cropBusy = ref(false);
const layerEl = ref(null);

// 标签保持等长，分段控件才不会宽窄参差
const aspectOptions = [
  { key: "free", label: "自由", ratio: null },
  { key: "1:1", label: "1:1", ratio: 1 },
  { key: "4:3", label: "4:3", ratio: 4 / 3 },
  { key: "3:2", label: "3:2", ratio: 3 / 2 },
  { key: "16:9", label: "16:9", ratio: 16 / 9 },
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
  aspect.value = "free"; // 初始为自由模式，默认给出 1:1 最大选区
  applyDefaultRect();
  cropping.value = true;
}

// 指定比例在整图内的最大居中选区（归一化）；ratio 为 null 时为整图
function maxRectFor(ratio) {
  const { w, h } = dispSize.value;
  if (!w || !h || ratio === null) return { x: 0, y: 0, w: 1, h: 1 };
  let pw = w;
  let ph = pw / ratio;
  if (ph > h) {
    ph = h;
    pw = ph * ratio;
  }
  return {
    x: (1 - pw / w) / 2,
    y: (1 - ph / h) / 2,
    w: pw / w,
    h: ph / h,
  };
}

function applyDefaultRect() {
  // 自由模式下的默认选区也是 1:1 最大框
  cropRect.value = maxRectFor(currentRatio.value ?? 1);
}

function setAspect(key) {
  aspect.value = key;
  // 切换比例后按原图拉满新比例（自由 = 整图）
  cropRect.value = maxRectFor(currentRatio.value);
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

function onHandleDown(e, handle) {
  const r = pxRect();
  // 角点：对角为锚点；边中点：对边为锚点，只沿单轴缩放
  const axis = handle === "e" || handle === "w" ? "x" : handle === "n" || handle === "s" ? "y" : null;
  const anchor = {
    x: handle.includes("w") ? r.x + r.w : r.x,
    y: handle.includes("n") ? r.y + r.h : r.y,
  };
  // 自由模式下角点也等比缩放：锁定拖动开始时的选区比例
  const lockRatio = axis === null && r.w > 0 && r.h > 0 ? r.w / r.h : null;
  beginDrag({ mode: "resize", axis, anchor, orig: r, lockRatio });
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

  // resize / draw：角点与画框以对角为锚点，边中点以对边为锚点
  // 固定比例模式用模式比例；自由模式下角点拖拽用锁定的选区比例（画框、边中点不锁）
  const ratio = currentRatio.value ?? drag.lockRatio ?? null;
  const axis = drag.axis || null;
  const dx = p.x - drag.anchor.x;
  const dy = p.y - drag.anchor.y;
  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;
  const maxW = sx > 0 ? W - drag.anchor.x : drag.anchor.x;
  const maxH = sy > 0 ? H - drag.anchor.y : drag.anchor.y;
  let w, h, x, y;

  if (axis === "x") {
    // 左右边中点：宽度跟随指针；固定比例时联动高度并沿原中心垂直居中
    w = Math.min(Math.abs(dx), maxW);
    if (ratio !== null) {
      w = Math.min(w, H * ratio);
      h = w / ratio;
      const cy = drag.orig.y + drag.orig.h / 2;
      y = Math.min(Math.max(cy - h / 2, 0), H - h);
    } else {
      h = drag.orig.h;
      y = drag.orig.y;
    }
    x = sx > 0 ? drag.anchor.x : drag.anchor.x - w;
  } else if (axis === "y") {
    // 上下边中点：高度跟随指针；固定比例时联动宽度并沿原中心水平居中
    h = Math.min(Math.abs(dy), maxH);
    if (ratio !== null) {
      h = Math.min(h, W / ratio);
      w = h * ratio;
      const cx = drag.orig.x + drag.orig.w / 2;
      x = Math.min(Math.max(cx - w / 2, 0), W - w);
    } else {
      w = drag.orig.w;
      x = drag.orig.x;
    }
    y = sy > 0 ? drag.anchor.y : drag.anchor.y - h;
  } else {
    w = Math.abs(dx);
    h = Math.abs(dy);
    if (ratio !== null) {
      // 取拖拽两个方向中的较大者，保证跟手
      if (w / ratio >= h) {
        h = w / ratio;
      } else {
        w = h * ratio;
      }
      // 越界时按比例收缩
      const fit = Math.min(maxW / w || 0, maxH / h || 0, 1);
      w *= fit;
      h *= fit;
    } else {
      w = Math.min(w, maxW);
      h = Math.min(h, maxH);
    }
    x = sx > 0 ? drag.anchor.x : drag.anchor.x - w;
    y = sy > 0 ? drag.anchor.y : drag.anchor.y - h;
  }
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

const singleImporting = ref(false);
const viewerToast = ref({ text: "", type: "success" });
let toastTimer = null;

function toast(text, type = "success") {
  viewerToast.value = { text, type };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (viewerToast.value = { text: "", type: "success" }), 2600);
}

async function importCurrent() {
  const item = current.value;
  if (!item || singleImporting.value || mark.value.imported) return;
  singleImporting.value = true;
  try {
    const res = await invoke("eagle_import", {
      baseUrl: eagleCfg.value.base_url,
      token: eagleCfg.value.token,
      items: [{ path: item.path, name: stemOf(item.filename), tags: parseTags(tagsInput.value), annotation: null }],
      folderId: folderId.value || null,
    });
    if (res.failed && res.failed.length > 0) {
      toast(`导入失败: ${res.failed[0].error}`, "error");
    } else {
      markImported(item.path);
      toast(`已导入到 Eagle${folderLabel()}`);
      await persistFolderChoice();
    }
  } catch (e) {
    toast(`导入失败: ${e}`, "error");
  } finally {
    singleImporting.value = false;
  }
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
    addCropMark(item.path);
    cropping.value = false;
    toast(`已导入裁剪图 ${res.width}×${res.height}`);
    await persistFolderChoice();
  } catch (e) {
    toast(`导入失败: ${e}`, "error");
  } finally {
    cropBusy.value = false;
  }
}

function folderLabel() {
  const f = folders.value.find((x) => x.id === folderId.value);
  return f ? `「${f.label.trim()}」` : "";
}

/* ---------------- 键盘 ---------------- */

function onKey(e) {
  if (!current.value) return;
  const tag = (e.target && e.target.tagName) || "";
  const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  if (e.key === "Escape") {
    if (cropping.value) cancelCrop();
    else close();
    return;
  }
  if (typing) return;
  if (cropping.value) {
    if (e.key === "Enter") confirmCrop();
    return;
  }
  if (e.key === "ArrowLeft") nav(-1);
  else if (e.key === "ArrowRight") nav(1);
  else if (e.key === "Enter") startCrop();
}

/* ---------------- 生命周期 ---------------- */

onMounted(() => {
  resizeObserver = new ResizeObserver(() => measureImg());
  window.addEventListener("keydown", onKey);
});

onBeforeUnmount(() => {
  if (resizeObserver) resizeObserver.disconnect();
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", endDrag);
  if (toastTimer) clearTimeout(toastTimer);
});
</script>

<style scoped>
.viewer-overlay {
  /* 灯箱内所有控件共用一套尺寸令牌：一行里的按钮/输入框/下拉高度必须完全一致 */
  --ctl-h: 34px;
  --ctl-r: 9px;
  --ctl-font: 0.82rem;
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

/* 圆形图标按钮：关闭 + 左右翻页共用 */
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  color: #e2e8f0;
  cursor: pointer;
  flex-shrink: 0;
  transition: background var(--transition-fast);
}

.icon-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.22);
}

.viewer-close {
  width: 32px;
  height: 32px;
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
  max-width: 70%;
  text-align: center;
}

.preview-failed {
  color: #fca5a5;
}

.nav-btn {
  width: 44px;
  height: 44px;
}

.nav-btn:disabled {
  opacity: 0.2;
  cursor: default;
}

.viewer-settings {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-6) 0;
  flex-wrap: wrap;
}

.settings-error {
  font-size: 0.78rem;
  color: #fca5a5;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewer-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4) var(--space-6);
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

/* ---------- 控件坞：一条底栏里的所有控件同高、同圆角、同字号 ---------- */
.dock {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px;
  border-radius: calc(var(--ctl-r) + 5px);
  background: rgba(15, 20, 32, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.34);
  max-width: 100%;
}

.dock-sep {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.14);
  flex-shrink: 0;
}

.dock-btn,
.dock-field,
.seg {
  height: var(--ctl-h);
  box-sizing: border-box;
  border-radius: var(--ctl-r);
  flex-shrink: 0;
}

.dock-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 0.72rem;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.08);
  color: #e2e8f0;
  font-family: inherit;
  font-size: var(--ctl-font);
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast), filter var(--transition-fast), opacity var(--transition-fast);
}

.dock-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.17);
}

.dock-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dock-primary {
  background: linear-gradient(135deg, var(--primary-600), var(--accent-500));
  color: #fff;
  padding: 0 0.95rem;
}

.dock-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, var(--primary-600), var(--accent-500));
  filter: brightness(1.1);
}

/* 输入/下拉：图标在左，外壳负责高度与边框，内部控件裸装 */
.dock-field {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 0.6rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: background var(--transition-fast), border-color var(--transition-fast), opacity var(--transition-fast);
}

.dock-field:focus-within {
  background: rgba(255, 255, 255, 0.12);
  border-color: var(--primary-400);
}

.dock-field.is-disabled {
  opacity: 0.4;
}

.field-icon {
  color: #94a3b8;
  flex-shrink: 0;
}

.dock-input,
.dock-select {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  color: #f1f5f9;
  font-family: inherit;
  font-size: var(--ctl-font);
  outline: none;
}

.dock-input::placeholder {
  color: rgba(226, 232, 240, 0.36);
}

.dock-input.mono {
  font-family: "SF Mono", ui-monospace, Menlo, monospace;
  font-size: 0.78rem;
}

.dock-select {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 14px;
  cursor: pointer;
}

.dock-select:disabled {
  cursor: default;
}

.dock-select option {
  color: var(--color-text-main);
  background: var(--surface-0);
}

.field-caret {
  position: absolute;
  right: 7px;
  color: #94a3b8;
  pointer-events: none;
}

.field-folder {
  width: 190px;
}

.field-tags {
  width: 170px;
}

.field-name {
  width: 200px;
}

.field-url {
  width: 232px;
}

.field-token {
  width: 250px;
}

/* 分段控件：裁剪比例 */
.seg {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.seg-btn {
  height: 100%;
  min-width: 44px;
  padding: 0 0.5rem;
  border: none;
  border-radius: calc(var(--ctl-r) - 4px);
  background: transparent;
  color: #cbd5e1;
  font-family: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.seg-btn:hover:not(.active) {
  background: rgba(255, 255, 255, 0.1);
}

.seg-btn.active {
  background: var(--primary-500);
  color: #fff;
}

/* Eagle 连接状态：兼作设置开关 */
.status-btn {
  padding-right: 0.5rem;
}

.status-gear {
  color: #94a3b8;
  flex-shrink: 0;
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

/* ---------- 徽标 ---------- */
.mini-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.68rem;
  font-weight: 700;
  line-height: 1;
  padding: 4px 8px;
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

/* 边中点手柄：短条形 */
.handle-n,
.handle-s {
  left: 50%;
  transform: translateX(-50%);
  width: 22px;
  height: 8px;
  border-radius: 999px;
  cursor: ns-resize;
}

.handle-n {
  top: -4px;
}

.handle-s {
  bottom: -4px;
}

.handle-e,
.handle-w {
  top: 50%;
  transform: translateY(-50%);
  width: 8px;
  height: 22px;
  border-radius: 999px;
  cursor: ew-resize;
}

.handle-e {
  right: -4px;
}

.handle-w {
  left: -4px;
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

/* ---------- 通用 ---------- */
.ico-spin {
  animation: spin 0.9s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
