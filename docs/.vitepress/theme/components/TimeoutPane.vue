<script setup lang="ts">
/**
 * TimeoutPane: per-phase timeout controls as a proper tab pane.
 *
 * Replaces the old floating TimeoutDrawer. Same sliders + numeric inputs,
 * same localStorage persistence, but rendered as an open panel instead of
 * a collapsible <details> drawer.
 *
 * Emits `update:settings` whenever any value changes so ArchivistRunner
 * can pass the values through to `execute()`.
 */

import { onMounted, ref, watch } from 'vue';
import PanelHeader from './ui/PanelHeader.vue';
import UiButton from './ui/UiButton.vue';
import UiPaneSurface from './ui/UiPaneSurface.vue';
import UiRangeField from './ui/UiRangeField.vue';

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
  } catch { /* corrupted; leave defaults */ }
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
  <UiPaneSurface class="timeout-pane" fill-height padding="lg">
    <PanelHeader
      title="Timeouts"
      hint="per-phase budgets, applied to the next run"
    />

    <div class="tp-body">
      <UiRangeField label="compose" :value="composeMs" :min="5000" :max="120000" :step="1000" unit="ms" @update:value="composeMs = clamp($event, 5_000, 120_000); save()" />
      <UiRangeField label="web-search" :value="webSearchMs" :min="5000" :max="120000" :step="1000" unit="ms" @update:value="webSearchMs = clamp($event, 5_000, 120_000); save()" />
      <UiRangeField label="rank" :value="rankMs" :min="5000" :max="120000" :step="1000" unit="ms" @update:value="rankMs = clamp($event, 5_000, 120_000); save()" />

      <div class="tp-footer">
        <UiButton class="tp-reset" variant="ghost" size="sm" @click="reset">reset defaults</UiButton>
      </div>
    </div>
  </UiPaneSurface>
</template>

<style scoped>
.tp-body {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  max-width: 560px;
}

.tp-footer {
  margin-top: 0.4rem;
  display: flex;
  justify-content: flex-end;
}
</style>
