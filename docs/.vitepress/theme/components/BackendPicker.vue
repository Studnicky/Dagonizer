<script setup lang="ts">
/**
 * BackendPicker — backend selector + API-key form (reveal-toggle).
 *
 * Backend dropdown is sorted (runnable first, then by displayName).
 * The API-key field renders only when `gemini-api` is the active
 * selection; uses a password-style input with a 👁 reveal toggle, and
 * pushes the value back to the parent so the adapter is rebuilt with it.
 */

import { computed, ref } from 'vue';

interface BackendOption {
  readonly id: string;
  readonly displayName: string;
  readonly runnable: boolean;
  readonly hint?: string;
}

const props = defineProps<{
  backends: readonly BackendOption[];
  activeId: string;
  apiKey: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:activeId', value: string): void;
  (event: 'update:apiKey', value: string): void;
}>();

const revealKey = ref(false);

/** Runnable backends first, then alphabetical by displayName. */
const sortedBackends = computed<readonly BackendOption[]>(() => {
  const list = [...props.backends];
  list.sort((a, b) => {
    if (a.runnable !== b.runnable) return a.runnable ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
  return list;
});

const activeIsGeminiApi = computed(() => props.activeId === 'gemini-api');

function onSelect(event: Event): void {
  emit('update:activeId', (event.target as HTMLSelectElement).value);
}
function onKey(event: Event): void {
  emit('update:apiKey', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="backend-picker">
    <header class="backend-banner">
      <label class="backend-field">
        <span class="backend-prefix">backend</span>
        <select
          class="backend-select"
          :value="activeId"
          :disabled="disabled === true"
          @change="onSelect"
        >
          <option
            v-for="entry in sortedBackends"
            :key="entry.id"
            :value="entry.id"
          >
            {{ entry.displayName }}{{ entry.runnable ? '' : ' — needs setup' }}
          </option>
        </select>
      </label>
    </header>

    <details v-if="activeIsGeminiApi" class="backend-key" open>
      <summary>Gemini API key</summary>
      <p>
        Free key from
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
          aistudio.google.com/apikey
        </a>.
        Stored in <code>localStorage</code>; requests go straight from your browser to Google.
      </p>
      <div class="key-row">
        <input
          class="key-input"
          :value="apiKey"
          :type="revealKey ? 'text' : 'password'"
          placeholder="AIzaSy…"
          autocomplete="off"
          spellcheck="false"
          @input="onKey"
        />
        <button
          type="button"
          class="key-toggle"
          :title="revealKey ? 'Hide key' : 'Reveal key'"
          :aria-pressed="revealKey"
          @click="revealKey = !revealKey"
        >{{ revealKey ? '🙈' : '👁' }}</button>
      </div>
    </details>
  </div>
</template>

<style scoped>
.backend-picker {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.backend-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding-bottom: 0.55rem;
  border-bottom: 1px dashed var(--vp-c-divider);
  flex-wrap: wrap;
}

.backend-field {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
}

.backend-prefix {
  color: var(--vp-c-text-3);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.backend-select {
  background: var(--vp-c-bg-elv);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  padding: 0.35rem 0.6rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.82rem;
  cursor: pointer;
  min-width: 260px;
}

.backend-select:disabled { opacity: 0.6; cursor: not-allowed; }

.backend-key {
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 0.65rem 0.85rem;
  font-size: 0.85rem;
}

.backend-key summary {
  cursor: pointer;
  color: var(--dagonizer-brand);
  font-weight: 700;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.backend-key p {
  margin: 0.55rem 0 0.7rem 0;
  color: var(--vp-c-text-2);
  font-size: 0.82rem;
  line-height: 1.45;
}

.key-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.45rem;
}

.key-input {
  width: 100%;
  padding: 0.5rem 0.6rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.82rem;
  letter-spacing: 0.05em;
}

.key-input:focus { outline: none; border-color: var(--dagonizer-brand); }

.key-toggle {
  width: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 1.05rem;
  transition: border-color 0.12s ease, color 0.12s ease;
}

.key-toggle:hover {
  border-color: var(--dagonizer-brand);
  color: var(--dagonizer-brand);
}
</style>
