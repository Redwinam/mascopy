<template>
  <div class="tether-root">
    <!-- 未开始：配置区 -->
    <div v-if="!tetherActive" class="tether-config glass-panel animate-fade-in">
      <div class="mode-row">
        <div :class="['src-chip', { active: cfg.mode === 'ftp' }]" @click="setMode('ftp')">
          <div class="chip-title">📶 相机 WiFi 直传</div>
          <div class="chip-sub">R5 Mark II 机身 FTP 直连本软件，无需其他软件</div>
        </div>
        <div :class="['src-chip', { active: cfg.mode === 'watch' }]" @click="setMode('watch')">
          <div class="chip-title">🔌 监听文件夹</div>
          <div class="chip-sub">配合 EOS Utility 联机拍摄（USB 或 WiFi 均可）</div>
        </div>
      </div>

      <template v-if="cfg.mode === 'watch'">
        <FileSelector title="监听目录" :path="cfg.watch_dir" @update:path="(p) => setField('watch_dir', p)" placeholder="选择 EOS Utility 的「保存目标文件夹」">
          <template #icon>
            <div class="icon-circle tether-icon">👀</div>
          </template>
        </FileSelector>
        <label class="del-toggle">
          <input type="checkbox" :checked="cfg.delete_source" @change="setField('delete_source', $event.target.checked)" />
          入库后删除监听目录中的原文件（避免磁盘留双份）
        </label>
      </template>

      <template v-else>
        <div class="ftp-fields">
          <div class="ftp-field">
            <label>端口</label>
            <input type="number" :value="cfg.ftp_port" @change="setField('ftp_port', Number($event.target.value) || 2121)" />
          </div>
          <div class="ftp-field">
            <label>用户名</label>
            <input :value="cfg.ftp_user" @change="setField('ftp_user', $event.target.value)" />
          </div>
          <div class="ftp-field">
            <label>密码</label>
            <input :value="cfg.ftp_pass" @change="setField('ftp_pass', $event.target.value)" />
          </div>
        </div>
      </template>

      <FileSelector title="备份目标目录" :path="cfg.target_dir" @update:path="(p) => setField('target_dir', p)" @addFavorite="addTargetFavorite" placeholder="接收的照片将按日期（YYYY-MM-DD）整理到这里">
        <template #icon>
          <div class="icon-circle tether-icon">💾</div>
        </template>
      </FileSelector>

      <div v-if="targetFavorites.length > 0" class="fav-row">
        <span class="fav-label">收藏夹</span>
        <div class="fav-chips">
          <button v-for="p in targetFavorites" :key="p" :class="['fav-chip', { active: cfg.target_dir === p }]" :title="p" @click="setField('target_dir', p)">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="fav-chip-icon">
              <path
                d="M19.5 21a3 3 0 003-3v-4.5a3 3 0 00-3-3h-15a3 3 0 00-3 3V18a3 3 0 003 3h15zM1.5 10.146V6a3 3 0 013-3h5.379a2.25 2.25 0 011.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 013 3v1.146A4.483 4.483 0 0019.5 9h-15a4.483 4.483 0 00-3 1.146z" />
            </svg>
            {{ shortPath(p) }}
          </button>
        </div>
      </div>

      <div class="start-row">
        <span v-if="errorMsg" class="tether-error">{{ errorMsg }}</span>
        <button class="btn btn-primary start-session-btn" @click="start" :disabled="!canStart || starting">
          <span v-if="starting" class="spinner-sm"></span>
          {{ starting ? "启动中…" : "开始联机会话" }}
        </button>
      </div>
    </div>

    <!-- 会话中：状态条 -->
    <div v-else class="session-bar glass-panel animate-fade-in">
      <div class="session-left">
        <span class="live-dot"></span>
        <span class="session-title">联机会话进行中</span>
        <span class="session-count">已接收 {{ doneCount }} 张</span>
        <span v-if="cfg.mode === 'ftp'" class="ftp-addr" title="相机 FTP 服务器地址">FTP {{ tetherInfo.lan_ip }}:{{ tetherInfo.ftp_port }} · 用户 {{ cfg.ftp_user }}</span>
      </div>
      <div class="session-actions">
        <button class="btn btn-secondary btn-sm" @click="clearList" :disabled="tetherFiles.length === 0">清空记录</button>
        <button class="btn btn-danger btn-sm" @click="stop">结束会话</button>
      </div>
    </div>

    <!-- FTP 相机端设置提示 -->
    <div v-if="cfg.mode === 'ftp'" class="ftp-hint glass-panel">
      <div class="hint-title">📷 相机端设置（R5 Mark II · 只需配置一次并保存为预设）</div>
      <div class="hint-steps">
        菜单 → <b>网络</b> → 连接/网络设置 → <b>FTP 传输</b>：协议选 <b>FTP</b>（非 FTPS/SFTP）；服务器地址
        <code>{{ displayIp }}</code>，端口 <code>{{ cfg.ftp_port }}</code>；用户名 <code>{{ cfg.ftp_user }}</code>，密码 <code>{{ cfg.ftp_pass }}</code>；<b>被动模式：启用</b>；<b>自动传输：启用</b>（传输类型可选「仅
        JPEG」，RAW 留在卡里走 SD 备份）。相机与 Mac 需在同一局域网（建议 5GHz）。首次启动若 macOS 弹出防火墙提示，请选择「允许」。
      </div>
      <div v-if="altIps.length > 0" class="hint-alt">
        已自动过滤代理/虚拟网卡地址；若相机连不上，可尝试备选 IP：<code v-for="ip in altIps" :key="ip">{{ ip }}</code>
      </div>
    </div>

    <!-- 会话文件流 -->
    <div class="session-scroll">
      <div v-if="displayFiles.length === 0" class="session-empty">
        <div class="empty-icon">{{ tetherActive ? "📡" : "🔌" }}</div>
        <p>{{ tetherActive ? "等待相机拍摄…按下快门后照片会自动出现在这里" : "开始会话后，本次联机拍摄的照片会实时显示在这里" }}</p>
      </div>
      <div v-else class="session-grid">
        <div
          v-for="item in displayFiles"
          :key="item.key"
          :class="['t-cell', `t-${item.status}`, { 't-clickable': isPickable(item) }]"
          :ref="(el) => setCellRef(el, item)"
          :title="item.error || (isPickable(item) ? `${item.filename}（点击放大 / 导入 Eagle）` : item.filename)"
          @click="openInViewer(item)"
        >
          <img v-if="item.thumb" :src="item.thumb" class="t-img" draggable="false" />
          <div v-else class="t-placeholder">
            <span v-if="item.status === 'receiving'" class="spinner-sm dark"></span>
            <span v-else-if="item.status === 'error'" class="t-error-icon">⚠️</span>
            <span v-else class="ext-tag">{{ extOf(item.filename).toUpperCase() }}</span>
          </div>
          <div class="t-status">
            <span v-if="item.status === 'receiving'" class="t-chip chip-receiving">接收中{{ item.size > 0 ? " · " + formatBytes(item.size) : "" }}</span>
            <span v-else-if="item.status === 'done'" class="t-chip chip-done">已入库</span>
            <span v-else-if="item.status === 'skipped'" class="t-chip chip-skipped">已存在</span>
            <span v-else-if="item.status === 'error'" class="t-chip chip-error">失败</span>
            <span v-if="markOf(item.target_path).cropCount > 0" class="t-chip chip-crop">✂ {{ markOf(item.target_path).cropCount }}</span>
            <span v-if="markOf(item.target_path).imported" class="t-chip chip-eagle">✓ Eagle</span>
          </div>
          <div class="t-name">{{ item.filename }}</div>
        </div>
      </div>
    </div>

    <!-- 灯箱：点击照片直接放大 / 裁剪 / 导入 Eagle，列表实时跟随会话 -->
    <EagleLightbox :items="lightboxItems" v-model="lightboxKey" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { invoke } from "@tauri-apps/api/core";
import FileSelector from "./FileSelector.vue";
import EagleLightbox from "./EagleLightbox.vue";
import { useAppState } from "../composables/useAppState.js";
import { useEagle } from "../composables/useEagle.js";

const { config, tetherActive, tetherInfo, tetherFiles } = useAppState();
const { markOf } = useEagle();

const cfg = computed(() => {
  if (!config.value.tether) {
    config.value.tether = {
      mode: "ftp",
      watch_dir: "",
      target_dir: "",
      ftp_port: 2121,
      ftp_user: "eos",
      ftp_pass: "eos",
      delete_source: false,
    };
  }
  return config.value.tether;
});

const starting = ref(false);
const errorMsg = ref("");
const lanIps = ref([]);

const displayIp = computed(() => (tetherActive.value && tetherInfo.value.lan_ip ? tetherInfo.value.lan_ip : lanIps.value[0] || "（本机局域网 IP）"));

const altIps = computed(() => lanIps.value.filter((ip) => ip !== displayIp.value));

// 复用 SD/DJI 模式已收藏的目标目录
const targetFavorites = computed(() => {
  const f = config.value.favorites || {};
  return Array.from(new Set([...(f.sd_targets || []), ...(f.dji_targets || [])]));
});

function shortPath(p) {
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts.slice(-3).join("/") || p;
}

async function addTargetFavorite() {
  const p = cfg.value.target_dir;
  if (!p) return;
  const arr = config.value.favorites.sd_targets || [];
  if (!arr.includes(p)) arr.unshift(p);
  config.value.favorites.sd_targets = arr.slice(0, 8);
  await save();
}

const canStart = computed(() => {
  if (!cfg.value.target_dir) return false;
  if (cfg.value.mode === "watch" && !cfg.value.watch_dir) return false;
  return true;
});

const displayFiles = computed(() => [...tetherFiles.value].reverse());
const doneCount = computed(() => tetherFiles.value.filter((f) => f.status === "done" || f.status === "skipped").length);

function extOf(name) {
  const idx = (name || "").lastIndexOf(".");
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function setMode(m) {
  cfg.value.mode = m;
  save();
}

function setField(key, value) {
  cfg.value[key] = value;
  save();
}

async function save() {
  try {
    await invoke("save_config", { config: config.value });
  } catch (e) {
    /* 配置保存失败不阻断会话 */
  }
}

async function start() {
  if (starting.value) return;
  errorMsg.value = "";
  starting.value = true;
  try {
    const info = await invoke("start_tether", {
      args: {
        mode: cfg.value.mode,
        watchDir: cfg.value.watch_dir || null,
        targetDir: cfg.value.target_dir,
        ftpPort: cfg.value.ftp_port,
        ftpUser: cfg.value.ftp_user,
        ftpPass: cfg.value.ftp_pass,
        deleteSource: cfg.value.delete_source,
      },
    });
    tetherInfo.value = info;
    tetherActive.value = true;
  } catch (e) {
    errorMsg.value = String(e);
  } finally {
    starting.value = false;
  }
}

async function stop() {
  try {
    await invoke("stop_tether");
  } catch (e) {
    /* 即使后端报错也回到未激活状态 */
  }
  tetherActive.value = false;
}

function clearList() {
  tetherFiles.value = [];
}

function isPickable(f) {
  return (f.status === "done" || f.status === "skipped") && f.file_type === "photo" && !!f.target_path;
}

// 灯箱数据实时来自会话列表：拍摄中新入库的照片会即时计入张数与左右翻页。
// 顺序跟随网格展示顺序（displayFiles，最新在前），否则左右翻页与序号会和眼前的列表相反
const lightboxKey = ref(null);
const lightboxItems = computed(() =>
  displayFiles.value.filter(isPickable).map((f) => ({
    key: f.key,
    path: f.target_path,
    filename: f.filename,
    size: f.size,
  }))
);

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return "0 B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// 点击单元格：直接打开灯箱放大这张，可裁剪/导入 Eagle
function openInViewer(item) {
  if (!isPickable(item)) return;
  lightboxKey.value = item.key;
}

/* ---------- 缩略图懒加载 ---------- */

let io = null;
const cellEls = new Map();

function setCellRef(el, item) {
  const prev = cellEls.get(item.key);
  if (el) {
    if (prev !== el) {
      el.dataset.key = item.key;
      cellEls.set(item.key, el);
      if (io) io.observe(el);
    }
  } else if (prev) {
    if (io) io.unobserve(prev);
    cellEls.delete(item.key);
  }
}

function onIntersect(entries) {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const item = tetherFiles.value.find((f) => f.key === en.target.dataset.key);
    if (!item) continue;
    if ((item.status === "done" || item.status === "skipped") && item.target_path && !item.thumb && item.thumbState !== "loading" && item.thumbState !== "error") {
      io.unobserve(en.target);
      loadThumb(item);
    }
  }
}

async function loadThumb(item) {
  item.thumbState = "loading";
  try {
    item.thumb = await invoke("get_thumbnail", { path: item.target_path, size: 384 });
    item.thumbState = "ok";
  } catch (e) {
    item.thumbState = "error";
  }
}

// IntersectionObserver 只在可见性变化时回调：格子以 receiving 状态出现在视口内时
// 不满足加载条件，之后翻成 done 也不会再有回调，缩略图就一直不出来。
// 状态变化后对就绪项重新 observe，强制按当前可见性补发一次回调（视口外仍保持懒加载）。
watch(
  tetherFiles,
  () => {
    if (!io) return;
    for (const f of tetherFiles.value) {
      if ((f.status === "done" || f.status === "skipped") && f.target_path && !f.thumb && f.thumbState !== "loading" && f.thumbState !== "error") {
        const el = cellEls.get(f.key);
        if (el) {
          io.unobserve(el);
          io.observe(el);
        }
      }
    }
  },
  { deep: true, flush: "post" }
);

onMounted(async () => {
  io = new IntersectionObserver(onIntersect, { rootMargin: "250px" });
  cellEls.forEach((el) => io.observe(el));
  try {
    const ips = await invoke("get_lan_ip");
    lanIps.value = Array.isArray(ips) ? ips : [ips].filter(Boolean);
  } catch (e) {
    lanIps.value = [];
  }
});

onBeforeUnmount(() => {
  if (io) io.disconnect();
});
</script>

<style scoped>
.tether-root {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  flex: 1;
  min-height: 0;
}

/* ---------- 配置区 ---------- */
.tether-config {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);
  border-radius: var(--radius-xl);
  border: 1px solid var(--glass-border);
}

.mode-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.src-chip {
  border: 2px solid var(--surface-200);
  border-radius: var(--radius-lg);
  padding: var(--space-3) var(--space-4);
  cursor: pointer;
  transition: all var(--transition-fast);
  user-select: none;
  background: var(--surface-overlay-faint);
}

.src-chip:hover {
  border-color: var(--primary-300);
}

.src-chip.active {
  border-color: var(--primary-500);
  background: var(--primary-soft);
}

.chip-title {
  font-weight: 700;
  font-size: 0.95rem;
  margin-bottom: 2px;
}

.chip-sub {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.icon-circle.tether-icon {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  background: var(--primary-soft);
}

.del-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 0.82rem;
  color: var(--color-text-muted);
  cursor: pointer;
  user-select: none;
}

.ftp-fields {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.ftp-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ftp-field label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-muted);
}

.ftp-field input {
  width: 140px;
  padding: 0.4rem 0.6rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--surface-300);
  background: var(--surface-0);
  color: var(--color-text-main);
  font-size: 0.88rem;
  font-family: "SF Mono", ui-monospace, Menlo, monospace;
}

.ftp-field input:focus {
  outline: 2px solid var(--primary-soft-strong);
  border-color: var(--primary-400);
}

.fav-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  margin-top: calc(var(--space-2) * -1);
}

.fav-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding-top: 0.35rem;
  flex-shrink: 0;
}

.fav-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.fav-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0.3rem 0.7rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--surface-300);
  background: var(--surface-0);
  color: var(--color-text-main);
  font-size: 0.78rem;
  cursor: pointer;
  transition: all var(--transition-fast);
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fav-chip:hover {
  border-color: var(--primary-300);
  background: var(--surface-50);
}

.fav-chip.active {
  border-color: var(--primary-400);
  background: var(--primary-soft);
  color: var(--primary-700);
  font-weight: 600;
}

.fav-chip-icon {
  width: 13px;
  height: 13px;
  color: var(--primary-400);
  flex-shrink: 0;
}

.hint-alt {
  margin-top: var(--space-1);
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

.hint-alt code {
  font-family: "SF Mono", ui-monospace, Menlo, monospace;
  background: var(--surface-0);
  padding: 1px 6px;
  border-radius: 4px;
  margin-right: 4px;
}

.start-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-4);
}

.tether-error {
  color: var(--color-error);
  font-size: 0.82rem;
  flex: 1;
  min-width: 0;
}

.start-session-btn {
  padding: 0.6rem 1.8rem;
  font-weight: 600;
  gap: var(--space-2);
}

/* ---------- 会话状态条 ---------- */
.session-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-xl);
  flex-wrap: wrap;
}

.session-left {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.live-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-success);
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.8);
  animation: livePulse 1.6s ease infinite;
}

@keyframes livePulse {
  50% {
    opacity: 0.35;
  }
}

.session-title {
  font-weight: 700;
}

.session-count {
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.ftp-addr {
  font-family: "SF Mono", ui-monospace, Menlo, monospace;
  font-size: 0.78rem;
  background: var(--surface-100);
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  color: var(--color-text-muted);
}

.session-actions {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

/* ---------- FTP 提示 ---------- */
.ftp-hint {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  border: 1px dashed var(--primary-300);
  background: var(--primary-soft);
}

.hint-title {
  font-weight: 700;
  font-size: 0.82rem;
  margin-bottom: var(--space-1);
}

.hint-steps {
  font-size: 0.78rem;
  line-height: 1.7;
  color: var(--color-text-muted);
}

.hint-steps code {
  font-family: "SF Mono", ui-monospace, Menlo, monospace;
  background: var(--surface-0);
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--primary-700);
  font-weight: 600;
}

/* ---------- 会话网格 ---------- */
.session-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: var(--space-4);
}

.session-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(136px, 1fr));
  gap: var(--space-3);
}

.t-cell {
  position: relative;
  aspect-ratio: 1 / 1;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--surface-100);
  animation: cellIn 0.25s ease;
}

.t-clickable {
  cursor: pointer;
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}

.t-clickable:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

@keyframes cellIn {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
}

.t-receiving {
  outline: 2px dashed var(--primary-400);
  outline-offset: -2px;
}

.t-error {
  outline: 2px solid var(--color-error);
  outline-offset: -2px;
}

.t-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.t-placeholder {
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
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-200);
  color: var(--color-text-muted);
}

.t-error-icon {
  font-size: 1.1rem;
}

.t-status {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}

.t-chip {
  font-size: 0.62rem;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
  color: #fff;
}

.chip-receiving {
  background: var(--primary-500);
}

.chip-done {
  background: var(--color-success);
}

.chip-skipped {
  background: var(--surface-400);
}

.chip-error {
  background: var(--color-error);
}

.chip-crop {
  background: var(--accent-500);
}

.chip-eagle {
  background: rgba(15, 23, 42, 0.72);
}

.t-name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12px 7px 4px;
  font-size: 0.64rem;
  color: #fff;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.62));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-12);
  color: var(--color-text-muted);
  gap: var(--space-3);
  text-align: center;
}

.session-empty .empty-icon {
  font-size: 2.4rem;
}

/* ---------- 通用 ---------- */
.spinner-sm {
  width: 0.9rem;
  height: 0.9rem;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
}

.spinner-sm.dark {
  border-color: var(--surface-300);
  border-top-color: var(--primary-500);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
