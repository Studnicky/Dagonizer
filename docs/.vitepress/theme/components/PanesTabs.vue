<script setup lang="ts">
/**
 * PanesTabs: tabbed container that lets Conversation / Memory / Trace
 * / Logger each occupy the full center-column width when active.
 *
 * Pure presentation: the parent declares the tab labels + slot names;
 * this component owns the active-tab state and keyboard handling
 * (Left / Right / Home / End per WAI-ARIA tablist pattern). Tab content
 * is provided via named slots so each pane re-uses its existing SFC.
 *
 * Each tab carries a small `badge` (count, status dot) the parent may
 * compute reactively; useful to surface "the trace has new entries"
 * even when the visitor is looking at another tab.
 */

import { ref } from 'vue';

interface TabDef {
  readonly key: string;
  readonly label: string;
  /** Optional count badge ('5', 'live'). Empty string hides the badge. */
  readonly badge?: string;
  /** Optional tone for the badge: 'live' pulses, 'warn' uses brand3. */
  readonly tone?: 'default' | 'live' | 'warn' | 'accent';
}

const props = defineProps<{
  tabs: readonly TabDef[];
  /** Initial active tab key. Defaults to the first tab. */
  defaultKey?: string;
}>();

const activeKey = ref<string>(props.defaultKey ?? props.tabs[0]?.key ?? '');

function activate(key: string): void { activeKey.value = key; }

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
  <section class="panes-tabs">
    <div
      role="tablist"
      aria-label="Runner panes"
      class="tabs-row"
    >
      <button
        v-for="(tab, i) in tabs"
        :key="tab.key"
        :id="`tab-${tab.key}`"
        :class="['tab-btn', { 'tab-active': activeKey === tab.key }]"
        role="tab"
        :aria-selected="activeKey === tab.key"
        :aria-controls="`pane-${tab.key}`"
        :tabindex="activeKey === tab.key ? 0 : -1"
        @click="activate(tab.key)"
        @keydown="onKey($event, i)"
      >
        <span class="tab-label">{{ tab.label }}</span>
        <span
          v-if="tab.badge !== undefined && tab.badge.length > 0"
          :class="['tab-badge', `tab-badge-${tab.tone ?? 'default'}`]"
        >{{ tab.badge }}</span>
      </button>
      <div v-if="$slots['tab-suffix']" class="tab-suffix">
        <slot name="tab-suffix" />
      </div>
    </div>

    <div
      v-for="tab in tabs"
      :key="`pane-${tab.key}`"
      :id="`pane-${tab.key}`"
      role="tabpanel"
      :aria-labelledby="`tab-${tab.key}`"
      :hidden="activeKey !== tab.key"
      class="tab-pane"
    >
      <slot :name="tab.key" />
    </div>
  </section>
</template>

<style scoped>
.panes-tabs {
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  overflow: hidden;
  min-height: 320px;
  display: flex;
  flex-direction: column;
}

.tabs-row {
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

.tabs-row::-webkit-scrollbar { display: none; }

.tab-suffix {
  margin-left: auto;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 0.35rem 0 0.25rem;
}

.tab-btn {
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

.tab-btn:hover {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}

.tab-active {
  background: var(--vp-c-bg-elv);
  color: var(--dagonizer-brand);
  border-color: var(--vp-c-divider);
  position: relative;
}

.tab-active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: var(--vp-c-bg-elv);
}

.tab-btn:focus-visible {
  outline: 2px solid var(--dagonizer-brand);
  outline-offset: 1px;
}

.tab-label { text-transform: uppercase; }

.tab-badge {
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

.tab-badge-accent { background: rgba(34, 232, 255, 0.14);  color: var(--dagonizer-brand); }
.tab-badge-warn   { background: rgba(212, 166, 73, 0.18); color: var(--dagonizer-brand3); }

.tab-badge-live {
  background: var(--dagonizer-brand);
  color: var(--vp-c-bg);
  animation: badge-pulse 1.4s ease-in-out infinite;
}

.tab-pane {
  flex: 1 1 auto;
  padding: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.tab-pane[hidden] { display: none; }

/* Children fill the pane; they bring their own borders/padding. */
.tab-pane > :deep(*) {
  border: 0;
  border-radius: 0;
  background: transparent;
  height: 100%;
  min-height: 0;
  width: 100%;
  flex: 1 1 auto;
}

@keyframes badge-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34, 232, 255, 0.55); }
  50%      { box-shadow: 0 0 0 4px rgba(34, 232, 255, 0); }
}
</style>
