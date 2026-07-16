<script setup lang="ts">
/**
 * ToolExplainPanel: right-side slide-in panel that shows an LLM-generated
 * plain-English explanation of any tool or DAG node the visitor clicks.
 *
 * Placement: absolute overlay inside `.graph-pane`, matching the
 * TripleInspector pattern. The runner supplies `selectedTool` and
 * `llm`; the panel fetches on first open and caches thereafter.
 *
 * Cache: bounded by tool name; concurrent opens for the same name share one
 * explanation request.
 */

import { LruCache } from '@studnicky/cache';
import { Coalesce } from '@studnicky/concurrency/coalesce';
import { ref, watch } from 'vue';
import type { LlmClientInterface } from '../../../../examples/the-archivist/services.ts';
import InspectorShell from './graph/InspectorShell.vue';
import StateSurface from './ui/StateSurface.vue';

const props = defineProps<{
  selectedTool: string | null;
  llm: LlmClientInterface | null;
  toolContextMap: Record<string, string>;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();

const explanation = ref<string | null>(null);
const loading     = ref(false);

const EXPLANATION_CACHE_CAPACITY = 64;
const cache = LruCache.create<string, string>({ 'capacity': EXPLANATION_CACHE_CAPACITY });
const explanationRequests = Coalesce.create<string>();

watch(() => props.selectedTool, async (name) => {
  if (name === null) {
    explanation.value = null;
    loading.value     = false;
    return;
  }

  // Cache hit; no network call.
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
    const text = await explanationRequests.run(name, async () => {
      const coalescedCached = cache.get(name);
      if (coalescedCached !== undefined) return coalescedCached;
      const generated = await llm.explainTool(name, context);
      cache.set(name, generated);
      return generated;
    });
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
  <InspectorShell
    v-if="selectedTool !== null"
    :title="selectedTool"
    :ariaLabel="`Explanation for ${selectedTool}`"
    accent="var(--dagonizer-brand2)"
    width="320px"
    @close="emit('close')"
  >
    <StateSurface v-if="loading" kind="loading">Generating explanation…</StateSurface>

    <p v-else-if="explanation !== null" class="tep-body">{{ explanation }}</p>

    <StateSurface v-else kind="empty">No explanation available.</StateSurface>
  </InspectorShell>
</template>

<style scoped>
.tep-body {
  margin: 0;
  color: var(--vp-c-text-1);
  line-height: 1.6;
}
</style>
