// MediaFile IPC 的路径和时间合同由此处统一解释；展示精度留给各视图。
export function normalizePath(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.path === 'string') return value.path;
  return String(value);
}

export function basename(value) {
  const path = normalizePath(value);
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function extensionOf(name) {
  const text = String(name || '');
  const i = text.lastIndexOf('.');
  return i > 0 && i < text.length - 1 ? text.slice(i + 1).toLowerCase() : '';
}

export function stemOf(name) {
  const text = String(name || '');
  const i = text.lastIndexOf('.');
  return i > 0 ? text.slice(0, i) : text;
}

export function extensionInfo(name) {
  const ext = extensionOf(name);
  return ext ? { key: ext, label: ext.toUpperCase() } : { key: 'noext', label: '无后缀' };
}

export function parseMediaDate(value) {
  return new Date(value?.secs_since_epoch !== undefined ? value.secs_since_epoch * 1000 : value);
}

export function mediaDayKey(value) {
  return parseMediaDate(value).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
}

export function createLruCache(capacity = 12) {
  const entries = new Map();
  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > capacity) entries.delete(entries.keys().next().value);
    },
    clear: () => entries.clear(),
    get size() { return entries.size; },
  };
}

// 事件模型不携带缩略图；新接收轮次和目标路径变化必须使显示缓存失效。
export function mergeTetherFile(previous, payload) {
  const fresh = !previous || (payload.status === 'receiving' && previous.status !== 'receiving') ||
    (!!payload.target_path && payload.target_path !== previous.target_path);
  const next = { ...previous, ...payload };
  if (fresh) {
    next.thumb = '';
    next.thumbState = 'idle';
    next.thumbVersion = (previous?.thumbVersion || 0) + 1;
  }
  return next;
}
