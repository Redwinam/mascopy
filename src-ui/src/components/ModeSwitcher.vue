<template>
  <div class="mode-switcher" role="group" aria-label="工作模式">
    <template v-for="mode in modes" :key="mode.id">
      <!-- 存储卡、大疆都是导入；联机拍摄是另一类事，用虚线隔开 -->
      <span v-if="mode.id === 'tether'" class="mode-sep" aria-hidden="true"></span>
      <button
        type="button"
        :class="['mode-card', `mode-${mode.id}`, { active: modelValue === mode.id }]"
        :disabled="disabled"
        :aria-pressed="modelValue === mode.id"
        @click="$emit('update:modelValue', mode.id)"
      >
        <span class="mode-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <template v-if="mode.id === 'sd'">
              <path d="M6 2h9.17a2 2 0 0 1 1.42.59l2.82 2.82A2 2 0 0 1 20 6.83V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
              <path d="M8 6v3" /><path d="M11 6v3" /><path d="M14 6v3" />
            </template>
            <template v-else-if="mode.id === 'dji'">
              <!-- 手持云台相机（Osmo Pocket 一类） -->
              <rect x="8.5" y="2" width="9" height="7.5" rx="2" />
              <circle cx="13" cy="5.75" r="1.75" />
              <path d="M8.5 5.75H7a1 1 0 0 0-1 1V11a1 1 0 0 0 1 1h2" />
              <rect x="9" y="12" width="7" height="10" rx="2" />
              <path d="M12.5 15v3" />
            </template>
            <template v-else>
              <path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" />
              <circle cx="12" cy="13" r="3" />
            </template>
          </svg>
        </span>
        <span class="mode-text">
          <span class="mode-title">{{ mode.label }}</span>
          <span class="mode-hint">{{ mode.hint }}</span>
        </span>
        <!-- 会话在后台运行时切到导入页也能看到它没停 -->
        <span v-if="mode.id === 'tether' && live" class="live-dot" title="联机会话进行中"></span>
      </button>
    </template>
  </div>
</template>

<script setup>
defineProps({
  modelValue: String,
  disabled: Boolean,
  live: Boolean
});

defineEmits(['update:modelValue']);

const modes = [
  { id: 'sd', label: '存储卡导入', hint: 'SD · CFexpress' },
  { id: 'dji', label: '大疆导入', hint: 'Osmo 360 · Nano · Pocket' },
  { id: 'tether', label: '联机拍摄', hint: '边拍边归档' }
];
</script>

<style scoped>
/* 三张卡等宽（按最宽那张），虚线占自己的一列 */
.mode-switcher {
  display: grid;
  grid-template-columns: 1fr 1fr auto 1fr;
  align-items: center;
  gap: 10px;
}

.mode-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 16px 7px 7px;
  border: 1px solid var(--divider-color);
  border-radius: 13px;
  background: var(--surface-overlay-faint);
  color: var(--color-text-main);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast);
  -webkit-app-region: no-drag;
}

.mode-card:hover:not(:disabled):not(.active) {
  border-color: var(--surface-300);
  background: var(--surface-overlay);
}

.mode-card:focus-visible {
  outline: 2px solid var(--primary-400);
  outline-offset: 2px;
}

.mode-card:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.mode-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 10px;
  background: var(--surface-rail);
  color: var(--color-text-muted);
  transition: background var(--transition-fast), color var(--transition-fast);
}

.mode-icon svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.mode-text {
  display: grid;
  gap: 1px;
  white-space: nowrap;
}

.mode-title {
  font-size: 0.85rem;
  font-weight: 600;
  line-height: 1.3;
}

.mode-hint {
  font-size: 0.7rem;
  line-height: 1.3;
  color: var(--color-text-muted);
}

.mode-card.active {
  border-color: var(--primary-soft-strong);
  background: var(--primary-soft);
}

.mode-card.active .mode-icon {
  background: var(--color-primary);
  color: #fff;
}

/* 联机拍摄常驻紫色，和蓝色的导入区分开 */
.mode-tether .mode-icon {
  background: var(--accent-soft);
  color: var(--accent-600);
}

.mode-tether.active {
  border-color: color-mix(in srgb, var(--accent-500) 45%, transparent);
  background: var(--accent-soft);
}

.mode-tether.active .mode-icon {
  background: var(--accent-500);
  color: #fff;
}

:root[data-theme='dark'] .mode-tether:not(.active) .mode-icon {
  color: #a78bfa;
}

.mode-sep {
  width: 1px;
  height: 40px;
  margin: 0 6px;
  background: repeating-linear-gradient(180deg, var(--surface-300) 0 3px, transparent 3px 6px);
}

.live-dot {
  position: absolute;
  top: 8px;
  right: 9px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-error);
}

.live-dot::after {
  content: "";
  position: absolute;
  inset: -3px;
  border: 1.5px solid var(--color-error);
  border-radius: 50%;
  opacity: 0;
  animation: live-ping 1.6s ease-out infinite;
}

@keyframes live-ping {
  0% { transform: scale(0.6); opacity: 0.9; }
  100% { transform: scale(1.6); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .live-dot::after { animation: none; }
}
</style>
