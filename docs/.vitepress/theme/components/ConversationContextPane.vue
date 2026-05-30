<script setup lang="ts">
/**
 * ConversationContextPane — conversation context window control.
 *
 * Exposes a slider for "Conversation context window" — the number of
 * prior turns (visitor + archivist) threaded into each LLM prompt.
 * Setting it to 0 disables history threading entirely.
 *
 * Emits `update:windowSize` whenever the value changes so ArchivistRunner
 * can assign the window before constructing each ArchivistState.
 *
 * Mirrors the TimeoutPane pattern: localStorage-persisted, slider +
 * numeric input, reset-to-default button.
 */

import { onMounted, ref, watch } from 'vue';

const STORAGE_KEY = 'dagonizer-archivist-conv-window';
const DEFAULT_WINDOW = 6;
const MIN_WINDOW = 0;
const MAX_WINDOW = 20;

const emit = defineEmits<{
  (event: 'update:windowSize', value: number): void;
}>();

const windowSize = ref(DEFAULT_WINDOW);

function load(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'number' && Number.isFinite(parsed)) {
      windowSize.value = clamp(parsed, MIN_WINDOW, MAX_WINDOW);
    }
  } catch { /* corrupted — leave default */ }
}

function save(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(windowSize.value));
  emit('update:windowSize', windowSize.value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function onWindowInput(event: Event): void {
  windowSize.value = clamp(Number((event.target as HTMLInputElement).value), MIN_WINDOW, MAX_WINDOW);
  save();
}

function reset(): void {
  windowSize.value = DEFAULT_WINDOW;
  save();
}

watch(windowSize, save);

onMounted(() => {
  load();
  emit('update:windowSize', windowSize.value);
});
</script>

<template>
  <section class="ccp-pane">
    <header class="ccp-header">
      <h4>Conversation context</h4>
      <span class="ccp-hint">prior turns threaded into each LLM call</span>
    </header>

    <div class="ccp-body">
      <div class="ccp-row">
        <label class="ccp-label" for="ccp-window">window</label>
        <input
          id="ccp-window"
          type="range"
          class="ccp-slider"
          :value="windowSize"
          :min="0"
          :max="20"
          step="1"
          @input="onWindowInput"
        />
        <input
          type="number"
          class="ccp-num"
          :value="windowSize"
          :min="0"
          :max="20"
          step="1"
          @change="onWindowInput"
        />
        <span class="ccp-unit">turns</span>
      </div>

      <div class="ccp-footer">
        <span class="ccp-desc">{{ windowSize === 0 ? 'history disabled; each turn is a cold start' : `last ${windowSize} turn${windowSize === 1 ? '' : 's'} injected into prompts` }}</span>
        <button class="ccp-reset" type="button" @click="reset">reset</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ccp-pane {
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 0.8rem 0.9rem;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.ccp-header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 1.1rem;
}

.ccp-header h4 {
  margin: 0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--vp-c-text-3);
  flex-shrink: 0;
}

.ccp-hint {
  font-family: var(--vp-font-family-mono);
  font-size: 0.68rem;
  color: var(--vp-c-text-3);
  font-style: italic;
}

.ccp-body {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  max-width: 560px;
}

.ccp-row {
  display: grid;
  grid-template-columns: 80px 1fr 76px 40px;
  gap: 0.65rem;
  align-items: center;
}

.ccp-label {
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  color: var(--vp-c-text-2);
  white-space: nowrap;
}

.ccp-slider {
  width: 100%;
  accent-color: var(--dagonizer-brand);
  cursor: pointer;
}

.ccp-num {
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

.ccp-num:focus { outline: none; border-color: var(--dagonizer-brand); }

.ccp-unit {
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
  color: var(--vp-c-text-3);
}

.ccp-footer {
  margin-top: 0.4rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.ccp-desc {
  font-family: var(--vp-font-family-mono);
  font-size: 0.68rem;
  color: var(--vp-c-text-3);
  font-style: italic;
  flex: 1;
}

.ccp-reset {
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

.ccp-reset:hover { color: var(--dagonizer-brand3); }
</style>
