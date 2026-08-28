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
 * On mobile, browser-local and loopback-only backends are omitted.
 */

import { computed, ref } from 'vue';
import UiBadge from './ui/UiBadge.vue';
import UiButton from './ui/UiButton.vue';
import UiDisclosureCard from './ui/UiDisclosureCard.vue';
import UiFormRow from './ui/UiFormRow.vue';
import UiInput from './ui/UiInput.vue';
import UiSelect from './ui/UiSelect.vue';

import type { BackendAvailability, ProviderId } from '../../../../examples/the-archivist/providers/index.ts';

/** Backends that use a paste-in API key (need key input UI). */
const KEY_BACKENDS = new Set(['gemini-api', 'anthropic', 'groq', 'cerebras', 'mistral', 'openrouter']);

/** Backends only available on desktop (not mobile). */
const DESKTOP_ONLY = new Set(['gemini-nano', 'web-llm', 'ollama']);

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
  backends: readonly BackendAvailability[];
  activeId: ProviderId | null | '';
  apiKeys: Partial<Record<ProviderId, string>>;
  preferredModels: Partial<Record<ProviderId, string>>;
  isMobile?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:activeId', value: ProviderId): void;
  (event: 'update:apiKeys', value: Partial<Record<ProviderId, string>>): void;
  (event: 'update:preferredModels', value: Partial<Record<ProviderId, string>>): void;
}>();

/** Per-backend reveal state for password inputs. */
const revealMap = ref<Record<string, boolean>>({});

/** Visible backend IDs for the current device context. */
const visibleIds = computed(() => new Set(
  props.backends
    .filter((backend) => props.isMobile !== true || !DESKTOP_ONLY.has(backend.id))
    .map((backend) => backend.id),
));

/** On-device web models first, then every other backend alphabetical by displayName. */
const sortedBackends = computed<readonly BackendAvailability[]>(() => {
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

function isDesktopOnly(id: ProviderId): boolean {
  return props.isMobile === true && DESKTOP_ONLY.has(id);
}

function onSelect(value: string): void {
  const selected = sortedBackends.value.find((backend) => backend.id === value)?.id;
  if (selected !== undefined) emit('update:activeId', selected);
}

function onKey(id: ProviderId, value: string): void {
  emit('update:apiKeys', { ...props.apiKeys, [id]: value });
}

function onModelSelect(id: ProviderId, value: string): void {
  updatePreferredModel(id, value);
}

function onModelInput(id: ProviderId, value: string): void {
  updatePreferredModel(id, value);
}

function updatePreferredModel(id: ProviderId, value: string): void {
  const next: Partial<Record<ProviderId, string>> = { ...props.preferredModels };
  delete next[id];
  if (value.trim().length > 0) next[id] = value.trim();
  emit('update:preferredModels', next);
}

function toggleReveal(id: ProviderId): void {
  revealMap.value = { ...revealMap.value, [id]: !(revealMap.value[id] ?? false) };
}

function keyFor(id: ProviderId): string {
  return props.apiKeys[id] ?? '';
}

function preferredModelFor(id: ProviderId): string {
  return props.preferredModels[id] ?? '';
}

function modelHelp(backend: BackendAvailability): string {
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
        <UiSelect
          :model-value="activeId ?? ''"
          :disabled="disabled === true"
          select-class="backend-select"
          @update:model-value="onSelect"
        >
          <option
            v-for="entry in sortedBackends"
            :key="entry.id"
            :value="entry.id"
            :disabled="isDesktopOnly(entry.id)"
          >
            {{ entry.displayName }}{{ isDesktopOnly(entry.id) ? ' (desktop only)' : entry.runnable ? '' : ' (needs setup)' }}
          </option>
        </UiSelect>
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
    <UiDisclosureCard
      v-for="backend in sortedBackends"
      :key="backend.id"
      class="backend-key"
      :open="activeId === backend.id || backend.runnable"
    >
      <template #summary>
        {{ KEY_META[backend.id]?.label ?? backend.displayName }}
        <UiBadge v-if="isDesktopOnly(backend.id)" tone="warning">Desktop only</UiBadge>
        <UiBadge v-else-if="backend.runnable" tone="info">set</UiBadge>
        <UiBadge v-else tone="warning">not set</UiBadge>
      </template>
      <UiFormRow class="backend-row" label="Use this backend" data-as="div">
        <UiButton
          class="backend-use"
          :variant="activeId === backend.id ? 'primary' : 'secondary'"
          :disabled="disabled === true || !backend.runnable"
          @click="emit('update:activeId', backend.id)"
        >{{ activeId === backend.id ? 'Active' : 'Use' }}</UiButton>
      </UiFormRow>
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
        <UiInput
          :model-value="keyFor(backend.id)"
          :type="revealMap[backend.id] ? 'text' : 'password'"
          :placeholder="KEY_META[backend.id]?.placeholder ?? '…'"
          :disabled="disabled === true"
          input-class="key-input"
          @update:model-value="onKey(backend.id, $event)"
        />
        <UiButton
          class="key-toggle"
          variant="ghost"
          size="sm"
          @click="toggleReveal(backend.id)"
        >{{ revealMap[backend.id] ? '🙈' : '👁' }}</UiButton>
      </div>
      <UiFormRow v-if="backend.models !== undefined && backend.models.length > 0" class="model-row" label="Model">
        <UiSelect
          :model-value="preferredModelFor(backend.id)"
          :disabled="disabled === true"
          select-class="model-select"
          @update:model-value="onModelSelect(backend.id, $event)"
        >
          <option value="">{{ modelHelp(backend) }}</option>
          <option
            v-for="model in backend.models"
            :key="model.name"
            :value="model.name"
          >{{ model.name }}</option>
        </UiSelect>
      </UiFormRow>
      <div v-else-if="backend.id === 'ollama'" class="key-row model-text-row">
        <UiInput
          :model-value="preferredModelFor('ollama')"
          type="text"
          placeholder="optional preferred installed model"
          :disabled="disabled === true"
          input-class="key-input"
          @update:model-value="onModelInput('ollama', $event)"
        />
      </div>
    </UiDisclosureCard>

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
  min-width: 260px;
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


.key-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.45rem;
}

.backend-row,
.model-row {
  margin-top: 0.65rem;
}

.backend-use {
  justify-self: start;
}

.model-select {
  min-width: 0;
  width: 100%;
}

.model-text-row {
  margin-top: 0.65rem;
}

.key-input {
  width: 100%;
  letter-spacing: 0.05em;
}

.key-toggle {
  width: 38px;
  font-size: 1.05rem;
}

</style>
