<script setup lang="ts">
import { ref, watch } from 'vue';

export interface UiTabDef {
  readonly key: string;
  readonly label: string;
  readonly badge?: string;
  readonly tone?: 'default' | 'live' | 'warn' | 'accent';
}

const props = defineProps<{
  tabs: readonly UiTabDef[];
  defaultKey?: string;
  ariaLabel?: string;
}>();

const activeKey = ref<string>(props.defaultKey ?? props.tabs[0]?.key ?? '');

watch(() => props.defaultKey, (key) => {
  if (key !== undefined && key.length > 0) activeKey.value = key;
});

function activate(key: string): void {
  activeKey.value = key;
}

function onKey(event: KeyboardEvent, idx: number): void {
  const keys = props.tabs.map((t) => t.key);
  const max = keys.length - 1;
  let next = idx;
  if (event.key === 'ArrowRight') next = idx === max ? 0 : idx + 1;
  else if (event.key === 'ArrowLeft') next = idx === 0 ? max : idx - 1;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = max;
  else return;
  event.preventDefault();
  const target = keys[next];
  if (target !== undefined) activeKey.value = target;
}
</script>

<template>
  <section class="ui-tabs">
    <div
      role="tablist"
      :aria-label="ariaLabel ?? 'Tabs'"
      class="ui-tabs__row"
    >
      <button
        v-for="(tab, i) in tabs"
        :id="`tab-${tab.key}`"
        :key="tab.key"
        :class="['ui-tabs__button', { 'ui-tabs__button--active': activeKey === tab.key }]"
        role="tab"
        :aria-selected="activeKey === tab.key"
        :aria-controls="`pane-${tab.key}`"
        :tabindex="activeKey === tab.key ? 0 : -1"
        @click="activate(tab.key)"
        @keydown="onKey($event, i)"
      >
        <span class="ui-tabs__label">{{ tab.label }}</span>
        <span
          v-if="tab.badge !== undefined && tab.badge.length > 0"
          :class="['ui-tabs__badge', `ui-tabs__badge--${tab.tone ?? 'default'}`]"
        >{{ tab.badge }}</span>
      </button>
      <div v-if="$slots['tab-suffix']" class="ui-tabs__suffix">
        <slot name="tab-suffix" />
      </div>
    </div>

    <div
      v-for="tab in tabs"
      :id="`pane-${tab.key}`"
      :key="`pane-${tab.key}`"
      role="tabpanel"
      :aria-labelledby="`tab-${tab.key}`"
      :hidden="activeKey !== tab.key"
      class="ui-tabs__pane"
    >
      <slot :name="tab.key" />
    </div>
  </section>
</template>

<style scoped>
.ui-tabs {
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  overflow: hidden;
  min-height: 320px;
  display: flex;
  flex-direction: column;
}

.ui-tabs__row {
  display: flex;
  align-items: stretch;
  background: var(--vp-c-bg-alt);
  border-bottom: 1px solid var(--vp-c-divider);
  padding: 0.25rem 0.25rem 0;
  gap: 0.15rem;
  overflow-x: auto;
  flex-shrink: 0;
  scrollbar-width: none;
}

.ui-tabs__row::-webkit-scrollbar { display: none; }

.ui-tabs__suffix {
  margin-left: auto;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 0.35rem 0 0.25rem;
}

.ui-tabs__button {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 0.9rem;
  background: transparent;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 4px 4px 0 0;
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 0.74rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.ui-tabs__button:hover {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}

.ui-tabs__button--active {
  background: var(--vp-c-bg-elv);
  color: var(--dagonizer-brand);
  border-color: var(--vp-c-divider);
  position: relative;
}

.ui-tabs__button--active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: var(--vp-c-bg-elv);
}

.ui-tabs__button:focus-visible {
  outline: 2px solid var(--dagonizer-brand);
  outline-offset: 1px;
}

.ui-tabs__label { text-transform: uppercase; }

.ui-tabs__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  padding: 0 0.4rem;
  height: 16px;
  border-radius: 8px;
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  font-size: 0.62rem;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0;
}

.ui-tabs__badge--accent { background: rgba(34, 232, 255, 0.14); color: var(--dagonizer-brand); }
.ui-tabs__badge--warn { background: rgba(212, 166, 73, 0.18); color: var(--dagonizer-brand3); }
.ui-tabs__badge--live {
  background: var(--dagonizer-brand);
  color: var(--vp-c-bg);
  animation: ui-tabs-badge-pulse 1.4s ease-in-out infinite;
}

.ui-tabs__pane {
  flex: 1 1 auto;
  padding: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.ui-tabs__pane[hidden] { display: none; }

.ui-tabs__pane > :deep(*) {
  border: 0;
  border-radius: 0;
  background: transparent;
  height: 100%;
  min-height: 0;
  width: 100%;
  flex: 1 1 auto;
}

@keyframes ui-tabs-badge-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34, 232, 255, 0.55); }
  50% { box-shadow: 0 0 0 4px rgba(34, 232, 255, 0); }
}
</style>
