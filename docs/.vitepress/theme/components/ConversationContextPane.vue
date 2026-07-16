<script setup lang="ts">
/**
 * ConversationContextPane: conversation context window control.
 *
 * Exposes a slider for "Conversation context window": the number of
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
import PanelHeader from './ui/PanelHeader.vue';
import UiButton from './ui/UiButton.vue';
import UiPaneSurface from './ui/UiPaneSurface.vue';
import UiRangeField from './ui/UiRangeField.vue';

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
  } catch { /* corrupted; leave default */ }
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
  <UiPaneSurface class="ccp-pane" fill-height padding="lg">
    <PanelHeader
      title="Conversation context"
      hint="prior turns threaded into each LLM call"
    />

    <div class="ccp-body">
      <UiRangeField
        label="window"
        :value="windowSize"
        :min="0"
        :max="20"
        :step="1"
        unit="turns"
        @update:value="windowSize = clamp($event, MIN_WINDOW, MAX_WINDOW); save()"
      />

      <div class="ccp-footer">
        <span class="ccp-desc">{{ windowSize === 0 ? 'history disabled; each turn is a cold start' : `last ${windowSize} turn${windowSize === 1 ? '' : 's'} injected into prompts` }}</span>
        <UiButton class="ccp-reset" variant="ghost" size="sm" @click="reset">reset</UiButton>
      </div>
    </div>
  </UiPaneSurface>
</template>

<style scoped>
.ccp-body {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  max-width: 560px;
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

.ccp-reset { margin-left: auto; }
</style>
