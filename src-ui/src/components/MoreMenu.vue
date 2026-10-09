<template>
  <div ref="rootEl" class="more-menu">
    <button
      ref="triggerEl"
      type="button"
      :id="triggerId"
      :class="['more-trigger', { open }]"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      :aria-label="label"
      :title="label"
      @click="toggle"
      @keydown.down.prevent="openMenu(true)"
      @keydown.up.prevent="openMenu(true)"
    >
      <Ellipsis :size="18" :stroke-width="2.25" />
    </button>

    <Transition name="menu-pop">
      <div v-if="open" ref="menuEl" :id="menuId" role="menu" tabindex="-1" :aria-labelledby="triggerId" :class="['menu-panel', `place-${placement}`]" @keydown="onMenuKey">
        <button
          v-for="item in items"
          :key="item.key"
          type="button"
          role="menuitem"
          tabindex="-1"
          :aria-disabled="item.disabled || undefined"
          :class="['menu-item', { disabled: item.disabled }]"
          @click="choose(item)"
        >
          <span class="item-icon"><component :is="item.icon" :size="16" :stroke-width="2" /></span>
          <span class="item-text">
            <span class="item-label">{{ item.label }}</span>
            <span v-if="item.disabled ? item.disabledHint || item.description : item.description" class="item-desc">
              {{ item.disabled ? item.disabledHint || item.description : item.description }}
            </span>
          </span>
          <span v-if="item.badge" class="item-badge">{{ item.badge }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, nextTick, onBeforeUnmount, useId } from "vue";
import { Ellipsis } from "lucide-vue-next";

// 次要操作的「⋯」下拉菜单。items: [{ key, label, description?, disabledHint?, icon, badge?, disabled? }]
// placement 只在触发按钮四角里选，面板绝对定位在按钮旁，不 Teleport，弹窗里也能留在焦点陷阱内。
defineProps({
  items: { type: Array, required: true },
  label: { type: String, default: "更多操作" },
  placement: { type: String, default: "bottom-end" },
});
const emit = defineEmits(["select"]);

const open = ref(false);
const rootEl = ref(null);
const triggerEl = ref(null);
const menuEl = ref(null);
const triggerId = useId();
const menuId = useId();

function enabledItems() {
  return [...(menuEl.value?.querySelectorAll('[role="menuitem"]:not([aria-disabled])') || [])];
}

// 键盘打开时聚焦第一项；鼠标打开只聚焦面板，方向键照样可用，又不会凭空出现焦点框
async function openMenu(viaKeyboard) {
  if (open.value) return;
  open.value = true;
  // 捕获阶段挂在 window 上：先于弹窗的 Escape 处理，Esc 只收起菜单而不关闭整个弹窗
  window.addEventListener("keydown", onWindowKey, true);
  document.addEventListener("pointerdown", onOutside, true);
  await nextTick();
  ((viaKeyboard && enabledItems()[0]) || menuEl.value)?.focus();
}

function close(refocus = false) {
  if (!open.value) return;
  open.value = false;
  window.removeEventListener("keydown", onWindowKey, true);
  document.removeEventListener("pointerdown", onOutside, true);
  if (refocus) triggerEl.value?.focus();
}

function toggle(event) {
  if (open.value) close();
  else openMenu(event.detail === 0);
}

function choose(item) {
  if (item.disabled) return;
  close();
  emit("select", item.key);
}

function onWindowKey(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
    close(true);
  } else if (event.key === "Tab") {
    close();
  }
}

function onOutside(event) {
  if (!rootEl.value?.contains(event.target)) close();
}

function onMenuKey(event) {
  const nodes = enabledItems();
  if (!nodes.length) return;
  const at = nodes.indexOf(document.activeElement);
  let next = null;
  if (event.key === "ArrowDown") next = nodes[(at + 1) % nodes.length];
  else if (event.key === "ArrowUp") next = at < 0 ? nodes.at(-1) : nodes[(at - 1 + nodes.length) % nodes.length];
  else if (event.key === "Home") next = nodes[0];
  else if (event.key === "End") next = nodes.at(-1);
  if (!next) return;
  event.preventDefault();
  next.focus();
}

onBeforeUnmount(() => close());
</script>

<style scoped>
.more-menu {
  position: relative;
  display: inline-flex;
}

.more-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  border-radius: var(--radius-lg);
  border: 1px solid var(--divider-color);
  background: var(--surface-overlay-soft);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.more-trigger:hover {
  background: var(--surface-overlay-strong);
  color: var(--color-text-main);
  box-shadow: var(--shadow-sm);
}

.more-trigger.open {
  background: var(--primary-soft);
  border-color: var(--primary-soft-strong);
  color: var(--primary-600);
  box-shadow: none;
}

.more-trigger:focus-visible {
  outline: 2px solid var(--primary-500);
  outline-offset: 2px;
}

.menu-panel {
  position: absolute;
  z-index: 30;
  width: max-content;
  min-width: 15rem;
  max-width: min(22rem, calc(100vw - 2rem));
  padding: 0.375rem;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--surface-0);
  border: 1px solid var(--surface-200);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl), 0 0 0 1px rgba(15, 23, 42, 0.02);
  outline: none;
}

.place-bottom-end { top: calc(100% + 6px); right: 0; transform-origin: top right; }
.place-bottom-start { top: calc(100% + 6px); left: 0; transform-origin: top left; }
.place-top-end { bottom: calc(100% + 6px); right: 0; transform-origin: bottom right; }
.place-top-start { bottom: calc(100% + 6px); left: 0; transform-origin: bottom left; }

.menu-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.5rem 0.625rem;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-main);
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.menu-item:hover:not(.disabled),
.menu-item:focus-visible {
  background: var(--surface-100);
}

.menu-item:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1.5px var(--primary-soft-strong);
}

.menu-item.disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.item-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--primary-soft), var(--accent-soft));
  color: var(--accent-600);
}

.item-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item-label {
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.3;
}

.item-desc {
  font-size: 0.75rem;
  line-height: 1.35;
  color: var(--color-text-muted);
}

.item-badge {
  flex: none;
  min-width: 1.5rem;
  padding: 0.125rem 0.45rem;
  border-radius: 999px;
  background: var(--surface-100);
  border: 1px solid var(--surface-200);
  font-size: 0.7rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: var(--color-text-muted);
}

.menu-pop-enter-active,
.menu-pop-leave-active {
  transition: opacity 120ms ease, transform 140ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

.menu-pop-enter-from,
.menu-pop-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

:root[data-theme='dark'] .more-trigger.open {
  color: var(--primary-300);
}

:root[data-theme='dark'] .menu-panel {
  background: var(--surface-100);
  border-color: var(--surface-300);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.45);
}

:root[data-theme='dark'] .menu-item:hover:not(.disabled),
:root[data-theme='dark'] .menu-item:focus-visible {
  background: var(--surface-200);
}

:root[data-theme='dark'] .item-icon {
  color: #c4b5fd;
}

:root[data-theme='dark'] .item-badge {
  background: var(--surface-200);
  border-color: var(--surface-300);
}
</style>
