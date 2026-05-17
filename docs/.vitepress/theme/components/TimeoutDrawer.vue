<script setup lang="ts">
/**
 * TimeoutDrawer — settings drawer for per-phase timeouts.
 *
 * Exposed as a collapsible <details> block. Emits updated timeout values
 * whenever the visitor changes a slider or input. The parent is responsible
 * for passing the values to `execute()` as `{ deadlineMs }` (the dispatcher
 * composes them via AbortSignal.any).
 *
 * Values are persisted to localStorage under `dagonizer-archivist-settings`
 * so the visitor's preferences survive page reloads.
 */

import { onMounted, ref, watch } from 'vue';

export interface TimeoutSettings {
  readonly composeMs: number;
  readonly webSearchMs: number;
  readonly rankMs: number;
}

const STORAGE_KEY = 'dagonizer-archivist-settings';

const DEFAULTS: TimeoutSettings = {
  'composeMs':   30_000,
  'webSearchMs': 20_000,
  'rankMs':      15_000,
};

const emit = defineEmits<{
  (event: 'update:settings', value: TimeoutSettings): void;
}>();

const composeMs   = ref(DEFAULTS.composeMs);
const webSearchMs = ref(DEFAULTS.webSearchMs);
const rankMs      = ref(DEFAULTS.rankMs);

function load(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return;
    const parsed = JSON.parse(raw) as Partial<TimeoutSettings>;
    if (typeof parsed.composeMs   === 'number') composeMs.value   = parsed.composeMs;
    if (typeof parsed.webSearchMs === 'number') webSearchMs.value = parsed.webSearchMs;
    if (typeof parsed.rankMs      === 'number') rankMs.value      = parsed.rankMs;
  } catch { /* corrupted — leave defaults */ }
}

function save(): void {
  if (typeof localStorage === 'undefined') return;
  const settings: TimeoutSettings = {
    'composeMs':   composeMs.value,
    'webSearchMs': webSearchMs.value,
    'rankMs':      rankMs.value,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  emit('update:settings', settings);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function onComposeInput(event: Event): void {
  composeMs.value = clamp(Number((event.target as HTMLInputElement).value), 5_000, 120_000);
  save();
}

function onWebSearchInput(event: Event): void {
  webSearchMs.value = clamp(Number((event.target as HTMLInputElement).value), 5_000, 120_000);
  save();
}

function onRankInput(event: Event): void {
  rankMs.value = clamp(Number((event.target as HTMLInputElement).value), 5_000, 120_000);
  save();
}

function reset(): void {
  composeMs.value   = DEFAULTS.composeMs;
  webSearchMs.value = DEFAULTS.webSearchMs;
  rankMs.value      = DEFAULTS.rankMs;
  save();
}

watch([composeMs, webSearchMs, rankMs], save);

onMounted(() => {
  load();
  emit('update:settings', {
    'composeMs':   composeMs.value,
    'webSearchMs': webSearchMs.value,
    'rankMs':      rankMs.value,
  });
});
</script>

<template>
  <details class="timeout-drawer">
    <summary class="timeout-summary">
      <span class="timeout-icon" aria-hidden="true">⚙</span>
      <span class="timeout-label">timeouts</span>
    </summary>

    <div class="timeout-body">
      <div class="timeout-row">
        <label class="timeout-field-label" for="td-compose">compose</label>
        <input
          id="td-compose"
          type="range"
          class="timeout-slider"
          :value="composeMs"
          min="5000"
          max="120000"
          step="1000"
          @input="onComposeInput"
        />
        <input
          type="number"
          class="timeout-num"
          :value="composeMs"
          min="5000"
          max="120000"
          step="1000"
          @change="onComposeInput"
        />
        <span class="timeout-unit">ms</span>
      </div>

      <div class="timeout-row">
        <label class="timeout-field-label" for="td-websearch">web-search</label>
        <input
          id="td-websearch"
          type="range"
          class="timeout-slider"
          :value="webSearchMs"
          min="5000"
          max="120000"
          step="1000"
          @input="onWebSearchInput"
        />
        <input
          type="number"
          class="timeout-num"
          :value="webSearchMs"
          min="5000"
          max="120000"
          step="1000"
          @change="onWebSearchInput"
        />
        <span class="timeout-unit">ms</span>
      </div>

      <div class="timeout-row">
        <label class="timeout-field-label" for="td-rank">rank</label>
        <input
          id="td-rank"
          type="range"
          class="timeout-slider"
          :value="rankMs"
          min="5000"
          max="120000"
          step="1000"
          @input="onRankInput"
        />
        <input
          type="number"
          class="timeout-num"
          :value="rankMs"
          min="5000"
          max="120000"
          step="1000"
          @change="onRankInput"
        />
        <span class="timeout-unit">ms</span>
      </div>

      <button class="timeout-reset" type="button" @click="reset">reset defaults</button>
    </div>
  </details>
</template>

<style scoped>
.timeout-drawer {
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-elv);
  font-size: 0.8rem;
}

.timeout-summary {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.75rem;
  cursor: pointer;
  user-select: none;
  color: var(--vp-c-text-3);
  list-style: none;
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.timeout-summary::-webkit-details-marker { display: none; }
.timeout-summary::marker { display: none; }

.timeout-icon { font-size: 0.85rem; }

.timeout-body {
  padding: 0.6rem 0.75rem 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border-top: 1px solid var(--vp-c-divider);
}

.timeout-row {
  display: grid;
  grid-template-columns: 72px 1fr 70px 22px;
  gap: 0.5rem;
  align-items: center;
}

.timeout-field-label {
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
  color: var(--vp-c-text-2);
  white-space: nowrap;
}

.timeout-slider {
  width: 100%;
  accent-color: var(--dagonizer-brand);
  cursor: pointer;
}

.timeout-num {
  width: 100%;
  padding: 0.2rem 0.35rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
  border-radius: 3px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
  text-align: right;
}

.timeout-num:focus { outline: none; border-color: var(--dagonizer-brand); }

.timeout-unit {
  font-family: var(--vp-font-family-mono);
  font-size: 0.68rem;
  color: var(--vp-c-text-3);
}

.timeout-reset {
  margin-top: 0.2rem;
  align-self: flex-end;
  background: transparent;
  color: var(--vp-c-text-3);
  border: 0;
  padding: 0.15rem 0.3rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 0.12s ease;
}

.timeout-reset:hover { color: var(--dagonizer-brand3); }
</style>
