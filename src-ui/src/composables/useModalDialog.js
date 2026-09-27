import { nextTick, onBeforeUnmount, watch } from 'vue';

const stack = [];
const savedInert = new Map();
const selector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function focusables(element) {
  return [...element.querySelectorAll(selector)].filter(el => !el.closest('[inert]') && el.getClientRects().length);
}

function initialTarget(entry) {
  return entry.focusContainer ? entry.element : (focusables(entry.element)[0] || entry.element);
}

function syncBackground() {
  for (const [element, inert] of savedInert) element.inert = inert;
  savedInert.clear();
  const top = stack.at(-1);
  if (!top) return;
  for (const child of document.body.children) {
    if (child.contains(top.element) || ['SCRIPT', 'STYLE'].includes(child.tagName)) continue;
    savedInert.set(child, child.inert);
    child.inert = true;
  }
}

function onKey(event) {
  const top = stack.at(-1);
  if (!top) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    top.onEscape();
  } else if (event.key === 'Tab') {
    const nodes = focusables(top.element);
    const first = nodes[0] || top.element;
    const last = nodes.at(-1) || top.element;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === top.element || !top.element.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !top.element.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }
}

function onFocus(event) {
  const top = stack.at(-1);
  if (top && !top.element.contains(event.target)) initialTarget(top).focus();
}

// 模态外观各自保留，焦点、背景隔离和恢复在一个生命周期内管理。
// focusContainer：打开时聚焦对话框本身而不是第一个按钮，给自带方向键 / 回车快捷键的全屏查看器用。
export function useModalDialog(elementRef, active, onEscape, { focusContainer = false } = {}) {
  let entry = null;
  let generation = 0;
  function release() {
    generation++;
    if (!entry) return;
    const removed = entry;
    entry = null;
    const index = stack.indexOf(removed);
    if (index >= 0) stack.splice(index, 1);
    syncBackground();
    if (!stack.length) {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus, true);
    }
    const top = stack.at(-1);
    if (removed.previous?.isConnected && !removed.previous.closest('[inert]')) removed.previous.focus();
    else if (top) initialTarget(top).focus();
  }
  watch(active, async visible => {
    release();
    if (!visible) return;
    const previous = document.activeElement;
    const request = generation;
    await nextTick();
    if (request !== generation || !elementRef.value) return;
    entry = { element: elementRef.value, previous, onEscape, focusContainer };
    stack.push(entry);
    syncBackground();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus, true);
    initialTarget(entry).focus();
  }, { immediate: true, flush: 'post' });
  onBeforeUnmount(release);
}
