<script setup lang="ts">
/**
 * TimeoutPane — per-phase timeout controls as a proper tab pane.
 *
 * Replaces the old floating TimeoutDrawer. Same sliders + numeric inputs,
 * same localStorage persistence, but rendered as an open panel instead of
 * a collapsible <details> drawer.
 *
 * Emits `update:settings` whenever any value changes so ArchivistRunner
 * can pass the values through to `execute()`.
 */

import { onMounted, ref, watch } from 'vue';

export interface TimeoutSettings {
  readonly composeMs: number;
  readonly webSearchMs: number;
  readonly rankMs: number;
}

const STORAGE_KEY = 'dagonizer-archivist-settings';

const DEFAULTS: TimeoutSettings = {
  'composeMs':   60_000,
  'webSearchMs': 60_000,
  'rankMs':      30_000,
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
  <section class="timeout-pane">
    <header class="tp-header">
      <h4>Timeouts</h4>
      <span class="tp-hint">per-phase budgets — applied to the next run</span>
    </header>

    <div class="tp-body">
      <div class="tp-row">
        <label class="tp-label" for="tp-compose">compose</label>
        <input
          id="tp-compose"
          type="range"
          class="tp-slider"
          :value="composeMs"
          min="5000"
          max="120000"
          step="1000"
          @input="onComposeInput"
        />
        <input
          type="number"
          class="tp-num"
          :value="composeMs"
          min="5000"
          max="120000"
          step="1000"
          @change="onComposeInput"
        />
        <span class="tp-unit">ms</span>
      </div>

      <div class="tp-row">
        <label class="tp-label" for="tp-websearch">web-search</label>
        <input
          id="tp-websearch"
          type="range"
          class="tp-slider"
          :value="webSearchMs"
          min="5000"
          max="120000"
          step="1000"
          @input="onWebSearchInput"
        />
        <input
          type="number"
          class="tp-num"
          :value="webSearchMs"
          min="5000"
          max="120000"
          step="1000"
          @change="onWebSearchInput"
        />
        <span class="tp-unit">ms</span>
      </div>

      <div class="tp-row">
        <label class="tp-label" for="tp-rank">rank</label>
        <input
          id="tp-rank"
          type="range"
          class="tp-slider"
          :value="rankMs"
          min="5000"
          max="120000"
          step="1000"
          @input="onRankInput"
        />
        <input
          type="number"
          class="tp-num"
          :value="rankMs"
          min="5000"
          max="120000"
          step="1000"
          @change="onRankInput"
        />
        <span class="tp-unit">ms</span>
      </div>

      <div class="tp-footer">
        <button class="tp-reset" type="button" @click="reset">reset defaults</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.timeout-pane {
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 0.8rem 0.9rem;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.tp-header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 1.1rem;
}

.tp-header h4 {
  margin: 0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--vp-c-text-3);
  flex-shrink: 0;
}

.tp-hint {
  font-family: var(--vp-font-family-mono);
  font-size: 0.68rem;
  color: var(--vp-c-text-3);
  font-style: italic;
}

.tp-body {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  max-width: 560px;
}

.tp-row {
  display: grid;
  grid-template-columns: 80px 1fr 76px 26px;
  gap: 0.65rem;
  align-items: center;
}

.tp-label {
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  color: var(--vp-c-text-2);
  white-space: nowrap;
}

.tp-slider {
  width: 100%;
  accent-color: var(--dagonizer-brand);
  cursor: pointer;
}

.tp-num {
  width: 100%;
  padding: 0.25rem 0.4rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
  border-radius: 3px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  text-align: right;
}

.tp-num:focus { outline: none; border-color: var(--dagonizer-brand); }

.tp-unit {
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
  color: var(--vp-c-text-3);
}

.tp-footer {
  margin-top: 0.4rem;
  display: flex;
  justify-content: flex-end;
}

.tp-reset {
  background: transparent;
  color: var(--vp-c-text-3);
  border: 0;
  padding: 0.15rem 0.3rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 0.12s ease;
}

.tp-reset:hover { color: var(--dagonizer-brand3); }
</style>
