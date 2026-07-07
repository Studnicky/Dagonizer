<script setup lang="ts">
/**
 * BackendPicker: backend selector + per-provider API-key/model form.
 *
 * Backend dropdown lists on-device web models first, then every other
 * backend alphabetically by displayName (fixed order, independent of which
 * keys are set).
 * Every backend gets a collapsible <details> section. Keyed providers show a
 * password input, and runnable providers with a discovered catalogue show a
 * model selector whose value is emitted as a preference via
 * `update:preferredModels`.
 *
 * On mobile, gemini-nano and web-llm rows show a "Desktop only" chip
 * and are disabled in the dropdown.
 */

import { computed, ref } from 'vue';

import { BackendMatrix } from '../../../../examples/the-archivist/providers/index.ts';

interface BackendOption {
  readonly id: string;
  readonly displayName: string;
  readonly models?: readonly { readonly name: string }[];
  readonly runnable: boolean;
  readonly resolvedModel?: string;
  readonly needsAction?: 'download' | 'api-key' | null;
  readonly hint?: string;
}

/** Backends that use a paste-in API key (need key input UI). */
const KEY_BACKENDS = new Set(['gemini-api', 'anthropic', 'groq', 'cerebras', 'mistral', 'openrouter']);

/** Backends only available on desktop (not mobile). */
const DESKTOP_ONLY = new Set(['gemini-nano', 'web-llm']);

/** On-device web models, pinned to the top of the dropdown. */
const WEB_MODELS = new Set(['gemini-nano', 'web-llm']);

/** Human-friendly labels and link text per backend. */
const KEY_META: Record<string, { label: string; placeholder: string; helpText: string; helpUrl: string }> = {
  'gemini-api': {
    'label': 'Gemini API key',
    'placeholder': 'AIzaSy…',
    'helpText': 'Free key from aistudio.google.com/apikey. Requests go straight from your browser to Google.',
    'helpUrl': 'https://aistudio.google.com/apikey',
  },
  'anthropic': {
    'label': 'Anthropic API key',
    'placeholder': 'sk-ant-…',
    'helpText': 'Key at console.anthropic.com/settings/keys. The model is discovered from your key. Requests go directly from your browser to Anthropic.',
    'helpUrl': 'https://console.anthropic.com/settings/keys',
  },
  'groq': {
    'label': 'Groq API key',
    'placeholder': 'gsk_…',
    'helpText': 'Free key at console.groq.com/keys. ~30 RPM on the free tier. The model is discovered from your key.',
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
    'helpText': 'Free key at console.mistral.ai/api-keys/. The model is discovered from your key.',
    'helpUrl': 'https://console.mistral.ai/api-keys/',
  },
  'openrouter': {
    'label': 'OpenRouter API key',
    'placeholder': 'sk-or-…',
    'helpText': 'Free key at openrouter.ai/keys. Routes to a free-tier model discovered from your key.',
    'helpUrl': 'https://openrouter.ai/keys',
  },
};

const props = defineProps<{
  backends: readonly BackendOption[];
  activeId: string;
  apiKeys: Partial<Record<string, string>>;
  preferredModels: Partial<Record<string, string>>;
  isMobile?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:activeId', value: string): void;
  (event: 'update:apiKeys', value: Partial<Record<string, string>>): void;
  (event: 'update:preferredModels', value: Partial<Record<string, string>>): void;
}>();

/** Per-backend reveal state for password inputs. */
const revealMap = ref<Record<string, boolean>>({});

/** Visible backend IDs for the current device context. */
const visibleIds = computed(() => new Set<string>(BackendMatrix.browserVisible(props.isMobile ?? false)));

/** On-device web models first, then every other backend alphabetical by displayName. */
const sortedBackends = computed<readonly BackendOption[]>(() => {
  const list = props.backends.filter((b) => visibleIds.value.has(b.id));
  list.sort((a, b) => {
    const aWeb = WEB_MODELS.has(a.id);
    const bWeb = WEB_MODELS.has(b.id);
    if (aWeb !== bWeb) return aWeb ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
  return list;
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

function onModelSelect(id: string, event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  updatePreferredModel(id, value);
}

function onModelInput(id: string, event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  updatePreferredModel(id, value);
}

function updatePreferredModel(id: string, value: string): void {
  const next: Partial<Record<string, string>> = {};
  for (const [key, current] of Object.entries(props.preferredModels)) {
    if (key !== id && typeof current === 'string' && current.trim().length > 0) {
      next[key] = current.trim();
    }
  }
  if (value.trim().length > 0) next[id] = value.trim();
  emit('update:preferredModels', next);
}

function toggleReveal(id: string): void {
  revealMap.value = { ...revealMap.value, [id]: !(revealMap.value[id] ?? false) };
}

function keyFor(id: string): string {
  return props.apiKeys[id] ?? '';
}

function preferredModelFor(id: string): string {
  return props.preferredModels[id] ?? '';
}

function modelHelp(backend: BackendOption): string {
  if (backend.resolvedModel !== undefined && backend.resolvedModel.length > 0) {
    return `Auto selects ${backend.resolvedModel}`;
  }
  return 'Auto selects the first usable chat model returned by the provider.';
}
</script>

<template>
  <div class="backend-picker">
    <header class="backend-banner">
      <label class="backend-field">
        <span class="backend-prefix">backend</span>
        <select
          id="backend-picker-select"
          name="backend-picker-select"
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
            {{ entry.displayName }}{{ isDesktopOnly(entry.id) ? ' (desktop only)' : entry.runnable ? '' : ' (needs setup)' }}
          </option>
        </select>
      </label>
    </header>

    <!-- Privacy notice: keys are local-only -->
    <p v-if="keyBackends.length > 0" class="key-privacy-note">
      Keys are stored in your browser's localStorage and used only to call
      the provider's API directly from your browser; they never reach any
      Dagonizer server (there isn't one). See
      <a
        href="https://github.com/Studnicky/Dagonizer/blob/main/examples/the-archivist/providers/index.ts"
        target="_blank"
        rel="noreferrer"
      ><code>providers/index.ts</code></a>
      (<code>ApiKeyStore.load</code> / <code>ApiKeyStore.save</code>) for the source.
    </p>

    <!-- Per-backend config rows: active toggle, key input, and discovered model selector. -->
    <details
      v-for="backend in sortedBackends"
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
      <div class="backend-row">
        <span class="backend-row-label">Use this backend</span>
        <button
          type="button"
          class="backend-use"
          :class="{ 'backend-use--active': activeId === backend.id }"
          :disabled="disabled === true || !backend.runnable"
          @click="emit('update:activeId', backend.id)"
        >{{ activeId === backend.id ? 'Active' : 'Use' }}</button>
      </div>
      <p class="backend-key-help">
        {{ KEY_META[backend.id]?.helpText ?? backend.hint ?? '' }}
        <a
          v-if="KEY_META[backend.id]?.helpUrl"
          :href="KEY_META[backend.id]?.helpUrl"
          target="_blank"
          rel="noreferrer"
        >Get a free key.</a>
      </p>
      <div v-if="KEY_BACKENDS.has(backend.id)" class="key-row">
        <input
          :id="`backend-key-${backend.id}`"
          :name="`backend-key-${backend.id}`"
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
      <label v-if="backend.models !== undefined && backend.models.length > 0" class="model-row">
        <span class="backend-row-label">Model</span>
        <select
          class="model-select"
          :value="preferredModelFor(backend.id)"
          :disabled="disabled === true"
          @change="onModelSelect(backend.id, $event)"
        >
          <option value="">{{ modelHelp(backend) }}</option>
          <option
            v-for="model in backend.models"
            :key="model.name"
            :value="model.name"
          >{{ model.name }}</option>
        </select>
      </label>
      <div v-else-if="backend.id === 'ollama'" class="key-row model-text-row">
        <input
          id="backend-key-ollama-model"
          name="backend-key-ollama-model"
          class="key-input"
          type="text"
          :value="preferredModelFor('ollama')"
          placeholder="optional preferred installed model"
          autocomplete="off"
          spellcheck="false"
          :disabled="disabled === true"
          @input="onModelInput('ollama', $event)"
        />
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

.key-privacy-note {
  margin: 0.4rem 0 0.85rem 0;
  padding: 0.55rem 0.7rem;
  background: rgba(34, 232, 255, 0.06);
  border: 1px solid var(--vp-c-divider);
  border-left: 2px solid var(--dagonizer-brand2);
  border-radius: 4px;
  color: var(--vp-c-text-2);
  font-size: 0.78rem;
  line-height: 1.5;
}

.key-privacy-note code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.74rem;
  padding: 0.05rem 0.3rem;
  background: var(--vp-c-bg-elv);
  border-radius: 3px;
}

.key-privacy-note a {
  color: var(--dagonizer-brand2);
  text-decoration: none;
  border-bottom: 1px dotted var(--dagonizer-brand2);
}

.key-privacy-note a:hover {
  border-bottom-style: solid;
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

.backend-row,
.model-row {
  display: grid;
  grid-template-columns: minmax(7rem, auto) 1fr;
  align-items: center;
  gap: 0.55rem;
  margin-top: 0.65rem;
}

.backend-row-label {
  color: var(--vp-c-text-3);
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.backend-use {
  justify-self: start;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: transparent;
  color: var(--vp-c-text-2);
  padding: 0.18rem 0.65rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.backend-use--active {
  border-color: var(--dagonizer-brand2);
  color: var(--dagonizer-brand2);
  background: rgba(34, 232, 255, 0.08);
}

.backend-use:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.model-select {
  min-width: 0;
  width: 100%;
  padding: 0.42rem 0.55rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
}

.model-select:focus { outline: none; border-color: var(--dagonizer-brand); }
.model-select:disabled { opacity: 0.6; cursor: not-allowed; }

.model-text-row {
  margin-top: 0.65rem;
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


</style>
