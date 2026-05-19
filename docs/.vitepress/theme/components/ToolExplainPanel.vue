<script setup lang="ts">
/**
 * ToolExplainPanel — right-side slide-in panel that shows an LLM-generated
 * plain-English explanation of any tool or DAG node the visitor clicks.
 *
 * Placement: absolute overlay inside `.graph-pane`, matching the
 * TripleInspector pattern. The runner supplies `selectedTool` and
 * `llm`; the panel fetches on first open and caches thereafter.
 *
 * Cache: `Map<string, string>` keyed by tool name — once fetched, the
 * cached text is reused on subsequent opens; no second network call.
 */

import { ref, watch } from 'vue';
import type { LlmClient } from '../../../../examples/the-archivist/services.ts';

const props = defineProps<{
  selectedTool: string | null;
  llm: LlmClient | null;
  toolContextMap: Record<string, string>;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();

const explanation = ref<string | null>(null);
const loading     = ref(false);

/** Session-scoped cache — never fires two requests for the same name. */
const cache = new Map<string, string>();

watch(() => props.selectedTool, async (name) => {
  if (name === null) {
    explanation.value = null;
    loading.value     = false;
    return;
  }

  // Cache hit — no network call.
  const cached = cache.get(name);
  if (cached !== undefined) {
    explanation.value = cached;
    loading.value     = false;
    return;
  }

  explanation.value = null;
  loading.value     = true;

  try {
    const context = props.toolContextMap[name] ?? `A node or tool in the Archivist pipeline named "${name}".`;
    const llm = props.llm;
    if (llm === null) {
      explanation.value = 'No LLM available to generate an explanation.';
      loading.value     = false;
      return;
    }
    const text = await llm.explainTool(name, context);
    cache.set(name, text);
    // Only apply if the tool hasn't changed while we were waiting.
    if (props.selectedTool === name) {
      explanation.value = text;
    }
  } catch {
    if (props.selectedTool === name) {
      explanation.value = 'Could not generate an explanation. Try again or check your backend.';
    }
  } finally {
    if (props.selectedTool === name) {
      loading.value = false;
    }
  }
});
</script>

<template>
  <aside
    v-if="selectedTool !== null"
    class="tool-explain-panel"
    role="dialog"
    :aria-label="`Explanation for ${selectedTool}`"
  >
    <header class="tep-header">
      <span class="tep-name">{{ selectedTool }}</span>
      <button class="tep-close" title="Close" @click="emit('close')">✕</button>
    </header>

    <p v-if="loading" class="tep-loading">Generating explanation…</p>

    <p v-else-if="explanation !== null" class="tep-body">{{ explanation }}</p>

    <p v-else class="tep-empty">No explanation available.</p>
  </aside>
</template>

<style scoped>
.tool-explain-panel {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 320px;
  max-width: 88%;
  max-height: calc(100% - 20px);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--dagonizer-brand2);
  border-radius: 6px;
  padding: 0.75rem 0.9rem;
  box-shadow: 0 8px 32px -8px rgba(0, 0, 0, 0.45);
  z-index: 6;
  overflow-y: auto;
  font-family: var(--vp-font-family-base);
  font-size: 0.82rem;
  animation: tep-in 0.18s ease-out;
}

.tep-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  flex-shrink: 0;
}

.tep-name {
  color: var(--dagonizer-brand2);
  font-weight: 700;
  font-size: 0.9rem;
  font-family: var(--vp-font-family-mono);
  overflow-wrap: anywhere;
}

.tep-close {
  background: transparent;
  border: 0;
  color: var(--vp-c-text-3);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0 0.3rem;
  flex-shrink: 0;
}
.tep-close:hover { color: var(--dagonizer-brand3); }

.tep-loading {
  margin: 0;
  color: var(--vp-c-text-3);
  font-style: italic;
  animation: tep-pulse 1.4s ease-in-out infinite;
}

.tep-body {
  margin: 0;
  color: var(--vp-c-text-1);
  line-height: 1.6;
}

.tep-empty {
  margin: 0;
  color: var(--vp-c-text-3);
  font-style: italic;
}

@keyframes tep-in {
  from { opacity: 0; transform: translateX(8px); }
  to   { opacity: 1; transform: translateX(0); }
}

@keyframes tep-pulse {
  0%, 100% { opacity: 0.5; }
  50%       { opacity: 1; }
}
</style>
