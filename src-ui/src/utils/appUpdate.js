// 应用内自动更新的纯逻辑：检查节奏、错误与进度文案。状态与副作用在 composables/useAppUpdater.js，
// 界面在 components/AppUpdate.vue（标题栏右侧的「关于与更新」）。

export const UPDATE_FIRST_CHECK_DELAY_MS = 20 * 1000; // 启动 20 秒后第一次检查
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 之后每 6 小时一次
// 用短间隔轮询「距上次检查是否满 6 小时」，而不是一个 6 小时的定时器：睡眠或窗口隐藏时 WebView 会
// 推迟或冻结长定时器，醒来后下一轮就能补上。
export const UPDATE_CHECK_TICK_MS = 10 * 60 * 1000;
export const UPDATE_AUTO_CHECK_KEY = "mascopy-update-auto-check";

// 自动检查是否到点：从没查过，或距上次满一个间隔。
export function isAutoCheckDue(lastCheckedAt, now = Date.now(), interval = UPDATE_CHECK_INTERVAL_MS) {
  return !lastCheckedAt || now - lastCheckedAt >= interval;
}

// 插件报错多是英文原文：常见的几种换成能看懂的说法，其余原样附上。
export function describeUpdateError(error) {
  const text = String(error?.message || error || "").trim();
  if (!text) return "操作失败";
  if (/valid release JSON/i.test(text)) return "下载服务上还没有可用的版本信息（尚未发布过，或服务暂时不可用）";
  if (/signature/i.test(text)) return `更新包签名校验失败，已停止安装：${text}`;
  if (/read-only|permission denied|operation not permitted/i.test(text)) {
    return `大师拷贝所在的位置不能写入（比如直接从 .dmg 里打开的）：先把它拖进「应用程序」，从那里打开后再更新。${text}`;
  }
  if (/error sending request|dns|connect|timed? ?out|network/i.test(text)) return `连不上下载服务：${text}`;
  return text;
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024 * 1024) return `${Math.max(0, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

// 下载进度百分比（0–100 的整数）；总大小未知时为 null。
export function progressPercent({ downloaded = 0, total = 0 } = {}) {
  return total > 0 ? Math.max(0, Math.min(100, Math.floor((downloaded / total) * 100))) : null;
}

// 发布日期只取年月日；插件给的是 RFC 3339 字符串，格式不对就不显示。
export function formatReleaseDate(date) {
  const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}
