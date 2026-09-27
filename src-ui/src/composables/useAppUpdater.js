import { computed, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { useAppState } from "./useAppState.js";
import {
  UPDATE_AUTO_CHECK_KEY,
  UPDATE_CHECK_TICK_MS,
  UPDATE_FIRST_CHECK_DELAY_MS,
  describeUpdateError,
  isAutoCheckDue,
} from "../utils/appUpdate.js";

const CHECK_TIMEOUT_MS = 30 * 1000;
const PROGRESS_FLUSH_MS = 250;
// 这几个阶段里不再检查：会换掉正在下载或已装好的那个更新。
const BUSY_PHASES = new Set(["downloading", "installing", "ready", "restarting"]);

function readAutoCheck() {
  try { return localStorage.getItem(UPDATE_AUTO_CHECK_KEY) !== "off"; } catch { return true; }
}

// 模块级单例：标题栏按钮与弹窗看的是同一份状态，自动检查也只排一次。
// phase：idle 未检查 · checking 检查中 · latest 已是最新 · available 有新版 · downloading 下载中 ·
//        installing 安装中 · ready 已装好待重启 · restarting 正在重启；error 是最近一次手动操作的失败原因。
const supported = ref(null);
const currentVersion = ref("");
const phase = ref("idle");
const update = ref(null); // { version, date, notes }
const progress = ref({ downloaded: 0, total: 0 });
const error = ref("");
const checkedAt = ref(null);
const autoCheck = ref(readAutoCheck());
let handle = null; // 插件返回的 Update 资源，下载安装要用它；换新时释放
let checking = false;
let lastCheck = 0;
let started = false;
let firstTimer = null;
let tickTimer = null;

async function runCheck({ silent = false } = {}) {
  if (!supported.value || BUSY_PHASES.has(phase.value)) return;
  if (!silent) {
    error.value = "";
    phase.value = "checking";
  }
  // 正在进行的（自动）检查结束时会落到 latest / available，手动点的这次就交给它，不再并发一次。
  if (checking) return;
  checking = true;
  lastCheck = Date.now();
  try {
    const found = await check({ timeout: CHECK_TIMEOUT_MS });
    const previous = handle;
    handle = found;
    if (previous && previous !== found) previous.close().catch(() => {});
    checkedAt.value = Date.now();
    if (found) {
      update.value = { version: found.version, date: found.date || "", notes: found.body || "" };
      phase.value = "available";
    } else {
      update.value = null;
      phase.value = "latest";
    }
  } catch (err) {
    // 静默检查失败不打扰；手动检查（或自动检查途中又点了一次）才显示原因，并退回检查前能用的状态。
    if (phase.value === "checking") {
      error.value = describeUpdateError(err);
      phase.value = handle ? "available" : "idle";
    }
  } finally {
    checking = false;
  }
}

function scheduleAutoCheck() {
  clearTimeout(firstTimer);
  clearInterval(tickTimer);
  firstTimer = tickTimer = null;
  if (!supported.value || !autoCheck.value) return;
  const tick = () => {
    if (isAutoCheckDue(lastCheck)) runCheck({ silent: true });
  };
  // 启动 20 秒后先查一次，之后每隔一小段看一眼是否已满 6 小时（睡眠唤醒后也能补上）
  firstTimer = setTimeout(() => {
    tick();
    tickTimer = setInterval(tick, UPDATE_CHECK_TICK_MS);
  }, UPDATE_FIRST_CHECK_DELAY_MS);
}

function start() {
  if (started) return;
  started = true;
  getVersion().then(version => { currentVersion.value = version; }).catch(() => {});
  // 是否开发构建由 Rust 侧判定（debug_assertions / tauri dev），前端不另猜
  invoke("app_update_supported")
    .then(value => { supported.value = Boolean(value); })
    .catch(() => { supported.value = false; })
    .finally(scheduleAutoCheck);
}

function setAutoCheck(value) {
  autoCheck.value = Boolean(value);
  try { localStorage.setItem(UPDATE_AUTO_CHECK_KEY, autoCheck.value ? "on" : "off"); } catch { /* 存不下就只在本次生效 */ }
  scheduleAutoCheck();
}

async function install() {
  if (!handle || checking || phase.value !== "available") return;
  error.value = "";
  progress.value = { downloaded: 0, total: 0 };
  phase.value = "downloading";
  // 下载进度事件以数据块为单位，一次更新可能上千个：先记在这里，最多每 250ms 刷一次界面。
  const live = { downloaded: 0, total: 0 };
  let flushAt = 0;
  const flush = (force = false) => {
    const now = Date.now();
    if (!force && now - flushAt < PROGRESS_FLUSH_MS) return;
    flushAt = now;
    progress.value = { ...live };
  };
  try {
    await handle.downloadAndInstall(event => {
      if (event?.event === "Started") {
        live.total = Number(event.data?.contentLength) || 0;
        flush(true);
      } else if (event?.event === "Progress") {
        live.downloaded += Number(event.data?.chunkLength) || 0;
        flush();
      } else if (event?.event === "Finished") {
        flush(true);
        phase.value = "installing";
      }
    });
    flush(true);
    phase.value = "ready";
  } catch (err) {
    error.value = describeUpdateError(err);
    phase.value = "available";
  }
}

export function useAppUpdater() {
  const { uploading, tetherActive } = useAppState();
  // 拷贝或联机会话进行中不能重启：重启会中断它们
  const restartBlocked = computed(() => uploading.value || tetherActive.value);

  async function restart() {
    if (phase.value !== "ready" || restartBlocked.value) return;
    error.value = "";
    phase.value = "restarting";
    try {
      await invoke("relaunch_after_update");
    } catch (err) {
      error.value = describeUpdateError(err);
      phase.value = "ready";
    }
  }

  start();
  return {
    supported, currentVersion, phase, update, progress, error, checkedAt, autoCheck, restartBlocked,
    setAutoCheck, check: () => runCheck(), install, restart,
  };
}
