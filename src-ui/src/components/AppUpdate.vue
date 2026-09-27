<template>
  <button
    type="button"
    :class="['update-entry', { attention: attention }]"
    :title="entryTitle"
    :aria-label="entryTitle"
    data-no-drag
    data-tauri-no-drag
    @click="open = true"
  >
    <LoaderCircle v-if="phase === 'downloading' || phase === 'installing'" class="entry-spin" :size="15" :stroke-width="2" />
    <RotateCw v-else-if="phase === 'ready' || phase === 'restarting'" :size="15" :stroke-width="2" />
    <CircleArrowUp v-else-if="phase === 'available'" :size="15" :stroke-width="2" />
    <Info v-else :size="15" :stroke-width="2" />
    <span v-if="entryLabel" class="entry-label">{{ entryLabel }}</span>
  </button>

  <Modal v-if="open" @close="open = false">
    <template #title>关于与更新</template>
    <div class="about-head">
      <img :src="appIcon" alt="" width="56" height="56" />
      <div>
        <div class="about-name">大师拷贝</div>
        <div class="about-version">版本 {{ currentVersion || "—" }}</div>
      </div>
    </div>

    <div class="update-status" role="status" aria-live="polite">
      <p class="status-line">{{ statusText }}</p>
      <div v-if="phase === 'downloading' || phase === 'installing'" class="update-progress">
        <div class="update-progress-fill" :class="{ indeterminate: percent === null }" :style="percent === null ? null : { width: percent + '%' }"></div>
      </div>
    </div>

    <div v-if="update && showNotes" class="update-notes">
      <div class="notes-head">
        <span>v{{ update.version }} 更新内容</span>
        <span v-if="releaseDate" class="notes-date">{{ releaseDate }}</span>
      </div>
      <ul v-if="noteLines.length" class="notes-body">
        <li v-for="(line, i) in noteLines" :key="i" :class="{ bullet: line.bullet }">{{ line.text }}</li>
      </ul>
      <p v-else class="notes-body">没有附带说明。</p>
    </div>

    <p v-if="error" class="update-error">{{ error }}</p>

    <label class="auto-check">
      <input type="checkbox" :checked="autoCheck" :disabled="!supported" @change="setAutoCheck($event.target.checked)" />
      <span>自动检查更新<span class="auto-check-hint">启动 20 秒后查一次，之后每 6 小时</span></span>
    </label>

    <template #footer>
      <button v-if="phase === 'available'" type="button" class="btn btn-primary btn-sm" @click="install">
        <Download :size="15" :stroke-width="2" />下载并安装
      </button>
      <button v-else-if="phase === 'ready' || phase === 'restarting'" type="button" class="btn btn-primary btn-sm" :disabled="restartBlocked || phase === 'restarting'" @click="restart">
        <RotateCw :size="15" :stroke-width="2" />{{ phase === "restarting" ? "正在重启…" : "立即重启" }}
      </button>
      <button v-else type="button" class="btn btn-secondary btn-sm" :disabled="!supported || phase === 'checking' || phase === 'downloading' || phase === 'installing'" @click="check">
        <RefreshCw :size="15" :stroke-width="2" :class="{ 'entry-spin': phase === 'checking' }" />{{ phase === "checking" ? "检查中…" : "检查更新" }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { computed, ref } from "vue";
import { CircleArrowUp, Download, Info, LoaderCircle, RefreshCw, RotateCw } from "lucide-vue-next";
import Modal from "./Modal.vue";
import appIcon from "../assets/app-icon.png";
import { useAppUpdater } from "../composables/useAppUpdater.js";
import { formatBytes, formatReleaseDate, progressPercent } from "../utils/appUpdate.js";

const { supported, currentVersion, phase, update, progress, error, checkedAt, autoCheck, restartBlocked, setAutoCheck, check, install, restart } = useAppUpdater();
const open = ref(false);

const percent = computed(() => progressPercent(progress.value));
const releaseDate = computed(() => formatReleaseDate(update.value?.date));
// 更新说明是发布时写的 Markdown 文本，这里只认「- 」开头的列表行，其余按普通段落原样显示（不解析 HTML）
const noteLines = computed(() => String(update.value?.notes || "").split("\n").map(line => line.trim()).filter(Boolean)
  .map(line => (/^[-*] /.test(line) ? { bullet: true, text: line.slice(2) } : { bullet: false, text: line })));
const showNotes = computed(() => ["available", "downloading", "installing", "ready", "restarting"].includes(phase.value));
// 有新版、在下载、待重启时，标题栏入口亮起并带上文字，不用打开弹窗也看得到
const attention = computed(() => ["available", "downloading", "installing", "ready", "restarting"].includes(phase.value));

const entryLabel = computed(() => {
  if (phase.value === "available") return "新版本";
  if (phase.value === "downloading") return percent.value === null ? "下载中" : `${percent.value}%`;
  if (phase.value === "installing") return "安装中";
  if (phase.value === "ready" || phase.value === "restarting") return "重启更新";
  return "";
});

const entryTitle = computed(() => (update.value && attention.value ? `关于与更新 · 新版本 v${update.value.version}` : "关于与更新"));

function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const statusText = computed(() => {
  if (supported.value === null) return "正在读取版本信息…";
  if (!supported.value) return "开发构建不检查更新。";
  const version = update.value ? `v${update.value.version}` : "";
  switch (phase.value) {
    case "checking":
      return "正在检查更新…";
    case "latest":
      return `已是最新版本${checkedAt.value ? ` · ${clock(checkedAt.value)} 检查` : ""}。`;
    case "available":
      return `发现新版本 ${version}。`;
    case "downloading": {
      const { downloaded, total } = progress.value;
      return `正在下载 ${version} · ${formatBytes(downloaded)}${total ? ` / ${formatBytes(total)}` : ""}`;
    }
    case "installing":
      return `正在安装 ${version}…`;
    case "ready":
      return restartBlocked.value ? `${version} 已装好。拷贝或联机会话结束后再重启。` : `${version} 已装好，重启后生效。`;
    case "restarting":
      return "正在重启…";
    default:
      return "还没有检查过更新。";
  }
});
</script>

<style scoped>
.update-entry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  min-width: 32px;
  padding: 0 9px;
  border: none;
  border-radius: 10px;
  background: var(--surface-rail);
  color: var(--color-text-muted);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: color var(--transition-fast), background var(--transition-fast);
}

.update-entry:hover {
  color: var(--color-text-main);
}

.update-entry.attention {
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
}

:root[data-theme='dark'] .update-entry.attention {
  color: var(--primary-400);
  background: color-mix(in srgb, var(--primary-400) 16%, transparent);
}

.entry-label {
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.entry-spin {
  animation: update-spin 0.9s linear infinite;
}

@keyframes update-spin {
  to {
    transform: rotate(360deg);
  }
}

.about-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.about-head img {
  width: 56px;
  height: 56px;
  border-radius: 13px;
}

.about-name {
  font-size: 1.05rem;
  font-weight: 700;
}

.about-version {
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.update-status {
  margin-top: var(--space-6);
}

.status-line {
  margin: 0;
  font-size: 0.92rem;
}

.update-progress {
  margin-top: var(--space-3);
  height: 6px;
  border-radius: 999px;
  background: var(--surface-rail);
  overflow: hidden;
}

.update-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
  transition: width 0.25s ease;
}

.update-progress-fill.indeterminate {
  width: 35%;
  animation: update-slide 1.2s ease-in-out infinite;
}

@keyframes update-slide {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(290%);
  }
}

.update-notes {
  margin-top: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--divider-color);
  border-radius: var(--radius-md);
  background: var(--surface-overlay-soft);
}

.notes-head {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-muted);
}

.notes-date {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.notes-body {
  margin: var(--space-2) 0 0;
  padding: 0;
  list-style: none;
  max-height: 180px;
  overflow-y: auto;
  font-size: 0.86rem;
  line-height: 1.6;
}

.notes-body li + li {
  margin-top: 2px;
}

.notes-body li.bullet {
  position: relative;
  padding-left: 14px;
}

.notes-body li.bullet::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 0.68em;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-text-muted);
}

.update-error {
  margin: var(--space-3) 0 0;
  color: var(--color-error);
  font-size: 0.85rem;
  line-height: 1.5;
}

.auto-check {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin-top: var(--space-6);
  font-size: 0.88rem;
  cursor: pointer;
}

.auto-check input {
  margin-top: 3px;
}

.auto-check-hint {
  display: block;
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: 0.78rem;
}

@media (prefers-reduced-motion: reduce) {
  .entry-spin,
  .update-progress-fill.indeterminate {
    animation: none;
  }
}
</style>
