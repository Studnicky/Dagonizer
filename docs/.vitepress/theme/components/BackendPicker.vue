<script setup lang="ts">
/**
 * BackendPicker — backend selector + per-provider API-key form.
 *
 * Backend dropdown is sorted (runnable first, then by displayName).
 * Cloud backends that require a key each get a collapsible <details>
 * section with a password-style input + reveal toggle. The key map
 * is emitted back to the parent via `update:apiKeys`.
 *
 * On mobile, gemini-nano and web-llm rows show a "Desktop only" chip
 * and are disabled in the dropdown.
 */

import { computed, ref } from 'vue';

import { browserVisibleBackends } from '../../../../examples/the-archivist/providers/index.ts';

interface BackendOption {
  readonly id: string;
  readonly displayName: string;
  readonly runnable: boolean;
  readonly needsAction?: 'download' | 'api-key' | null;
  readonly hint?: string;
}

/** Backends that use a paste-in API key (need key input UI). */
const KEY_BACKENDS = new Set(['gemini-api', 'groq', 'cerebras', 'mistral', 'openrouter']);

/** Backends only available on desktop (not mobile). */
const DESKTOP_ONLY = new Set(['gemini-nano', 'web-llm']);

/** Human-friendly labels and link text per backend. */
const KEY_META: Record<string, { label: string; placeholder: string; helpText: string; helpUrl: string }> = {
  'gemini-api': {
    'label': 'Gemini API key',
    'placeholder': 'AIzaSy…',
    'helpText': 'Free key from aistudio.google.com/apikey. Requests go straight from your browser to Google.',
    'helpUrl': 'https://aistudio.google.com/apikey',
  },
  'groq': {
    'label': 'Groq API key',
    'placeholder': 'gsk_…',
    'helpText': 'Free key at console.groq.com/keys. ~30 RPM on llama-3.3-70b-versatile.',
    'helpUrl': 'https://console.groq.com/keys',
  },
  'cerebras': {
    'label': 'Cerebras API key',
    'placeholder': 'csk-…',
    'helpText': 'Free key at cloud.cerebras.ai. Ultra-fast Wafer-Scale Engine inference.',
    'helpUrl': 'https://cloud.cerebras.ai/?utm=arch',
  },
  'mistral': {
    'label': 'Mistral API key',
    'placeholder': '…',
    'helpText': 'Free key at console.mistral.ai/api-keys/. mistral-small-latest.',
    'helpUrl': 'https://console.mistral.ai/api-keys/',
  },
  'openrouter': {
    'label': 'OpenRouter API key',
    'placeholder': 'sk-or-…',
    'helpText': 'Free key at openrouter.ai/keys. Routes to llama-3.3-70b-instruct:free.',
    'helpUrl': 'https://openrouter.ai/keys',
  },
};

const props = defineProps<{
  backends: readonly BackendOption[];
  activeId: string;
  apiKeys: Partial<Record<string, string>>;
  isMobile?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:activeId', value: string): void;
  (event: 'update:apiKeys', value: Partial<Record<string, string>>): void;
}>();

/** Per-backend reveal state for password inputs. */
const revealMap = ref<Record<string, boolean>>({});

/** Visible backend IDs for the current device context. */
const visibleIds = computed(() => new Set(browserVisibleBackends(props.isMobile ?? false)));

/** Runnable non-stub backends first, then alphabetical by displayName.
 *  Stub is excluded from the dropdown — it has its own flat row on mobile. */
const sortedBackends = computed<readonly BackendOption[]>(() => {
  const list = props.backends.filter((b) => visibleIds.value.has(b.id) && b.id !== 'stub');
  list.sort((a, b) => {
    if (a.runnable !== b.runnable) return a.runnable ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
  return list;
});

/** Stub row — only present on mobile. */
const stubBackend = computed<BackendOption | null>(() => {
  if (props.isMobile !== true) return null;
  return props.backends.find((b) => b.id === 'stub') ?? null;
});

/** Cloud key backends that are currently visible in the picker. */
const keyBackends = computed(() =>
  props.backends.filter((b) => KEY_BACKENDS.has(b.id) && visibleIds.value.has(b.id))
);

function isDesktopOnly(id: string): boolean {
  return props.isMobile === true && DESKTOP_ONLY.has(id);
}

function onSelect(event: Event): void {
  emit('update:activeId', (event.target as HTMLSelectElement).value);
}

function onKey(id: string, event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  emit('update:apiKeys', { ...props.apiKeys, [id]: value });
}

function toggleReveal(id: string): void {
  revealMap.value = { ...revealMap.value, [id]: !(revealMap.value[id] ?? false) };
}

function keyFor(id: string): string {
  return props.apiKeys[id] ?? '';
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
            :disabled="isDesktopOnly(entry.id)"
          >
            {{ entry.displayName }}{{ isDesktopOnly(entry.id) ? ' — desktop only' : entry.runnable ? '' : ' — needs setup' }}
          </option>
        </select>
      </label>
    </header>

    <!-- Per-backend key inputs — one collapsible <details> each -->
    <details
      v-for="backend in keyBackends"
      :key="backend.id"
      class="backend-key"
      :open="activeId === backend.id || backend.runnable"
    >
      <summary class="backend-key-summary">
        {{ KEY_META[backend.id]?.label ?? backend.displayName }}
        <span v-if="isDesktopOnly(backend.id)" class="desktop-chip">Desktop only</span>
        <span v-else-if="backend.runnable" class="key-status key-status--set">set</span>
        <span v-else class="key-status key-status--missing">not set</span>
      </summary>
      <p class="backend-key-help">
        {{ KEY_META[backend.id]?.helpText ?? '' }}
        <a
          v-if="KEY_META[backend.id]?.helpUrl"
          :href="KEY_META[backend.id]?.helpUrl"
          target="_blank"
          rel="noreferrer"
        >Get a free key.</a>
      </p>
      <div class="key-row">
        <input
          class="key-input"
          :value="keyFor(backend.id)"
          :type="revealMap[backend.id] ? 'text' : 'password'"
          :placeholder="KEY_META[backend.id]?.placeholder ?? '…'"
          autocomplete="off"
          spellcheck="false"
          :disabled="disabled === true"
          @input="onKey(backend.id, $event)"
        />
        <button
          type="button"
          class="key-toggle"
          :title="revealMap[backend.id] ? 'Hide key' : 'Reveal key'"
          :aria-pressed="revealMap[backend.id] ?? false"
          @click="toggleReveal(backend.id)"
        >{{ revealMap[backend.id] ? '🙈' : '👁' }}</button>
      </div>
    </details>

    <!-- Stub flat row — mobile only, no API-key input, always runnable -->
    <div
      v-if="stubBackend !== null"
      class="stub-row"
      :class="{ 'stub-row--active': activeId === 'stub' }"
    >
      <div class="stub-row-info">
        <span class="stub-row-name">{{ stubBackend.displayName }}</span>
        <span class="stub-row-hint">{{ stubBackend.hint }}</span>
      </div>
      <button
        type="button"
        class="stub-row-btn"
        :class="{ 'stub-row-btn--active': activeId === 'stub' }"
        :disabled="disabled === true"
        @click="emit('update:activeId', 'stub')"
      >{{ activeId === 'stub' ? 'Active' : 'Use canned responses' }}</button>
    </div>
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

.backend-key-summary {
  cursor: pointer;
  color: var(--dagonizer-brand);
  font-weight: 700;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.backend-key-help {
  margin: 0.55rem 0 0.7rem 0;
  color: var(--vp-c-text-2);
  font-size: 0.82rem;
  line-height: 1.45;
}

.key-status {
  font-size: 0.68rem;
  font-weight: 600;
  border-radius: 3px;
  padding: 0.1rem 0.35rem;
  letter-spacing: 0.04em;
}

.key-status--set {
  background: rgba(74, 222, 128, 0.15);
  color: var(--dagonizer-brand2);
  border: 1px solid var(--dagonizer-brand2);
}

.key-status--missing {
  background: rgba(212, 166, 73, 0.12);
  color: var(--dagonizer-brand3);
  border: 1px solid var(--dagonizer-brand3);
}

.desktop-chip {
  font-size: 0.68rem;
  font-weight: 600;
  border-radius: 3px;
  padding: 0.1rem 0.35rem;
  background: rgba(148, 163, 184, 0.15);
  color: var(--vp-c-text-3);
  border: 1px solid var(--vp-c-divider);
  letter-spacing: 0.04em;
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
.key-input:disabled { opacity: 0.6; cursor: not-allowed; }

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

/* ── Stub flat row (mobile only) ──────────────────────────────────────── */
.stub-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 0.85rem;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  font-size: 0.85rem;
}

.stub-row--active {
  border-color: var(--dagonizer-brand3);
  background: rgba(212, 166, 73, 0.06);
}

.stub-row-info {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  flex: 1 1 auto;
  min-width: 0;
}

.stub-row-name {
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--dagonizer-brand3);
}

.stub-row-hint {
  font-size: 0.78rem;
  color: var(--vp-c-text-2);
  line-height: 1.4;
}

.stub-row-btn {
  flex-shrink: 0;
  padding: 0.35rem 0.7rem;
  background: transparent;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  color: var(--vp-c-text-2);
  white-space: nowrap;
  transition: border-color 0.12s ease, color 0.12s ease;
}

.stub-row-btn--active {
  border-color: var(--dagonizer-brand3);
  color: var(--dagonizer-brand3);
}

.stub-row-btn:hover:not(:disabled) {
  border-color: var(--dagonizer-brand);
  color: var(--dagonizer-brand);
}

.stub-row-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
