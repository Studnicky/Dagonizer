<script setup lang="ts">
/**
 * TripleInspector — side panel showing every triple in/out of a selected IRI.
 *
 * The visitor clicks a node on the MemoryGraph cosmos canvas; the
 * runner sets `selectedIri` and this panel resolves the full subject+
 * object triple set from `MemoryStore`, grouped by named graph layer
 * (memory / state / prov / default). Each row shows
 *   subject — predicate → object   [graph chip]
 * so the viewer can see how this IRI participates across layers.
 */

import { computed } from 'vue';
import type { Quad } from 'n3';

import { MemoryStore } from '../../../../examples/the-archivist/memory/MemoryStore.ts';

const props = defineProps<{
  store: MemoryStore;
  tick: number;
  selectedIri: string | null;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();

interface Row {
  readonly key:       string;
  readonly direction: 'subject' | 'object';
  readonly subject:   string;
  readonly predicate: string;
  readonly object:    string;
  readonly layer:     'memory' | 'state' | 'prov' | 'default';
}

const rows = computed<readonly Row[]>(() => {
  void props.tick;
  if (props.selectedIri === null) return [];
  const out: Row[] = [];
  // Outbound — IRI is the subject.
  for (const q of props.store.select({ 'subject': MemoryStore.iri(props.selectedIri), 'predicate': '?p', 'object': '?o', 'graph': '?g' })) {
    const graph = q['g'];
    if (graph === undefined) continue;
    out.push(rowFrom('subject', props.selectedIri, q['p']?.value ?? '?', q['o'] !== undefined ? formatObject(q['o']) : '?', graph.value));
  }
  // Inbound — IRI is the object.
  for (const q of props.store.select({ 'subject': '?s', 'predicate': '?p', 'object': MemoryStore.iri(props.selectedIri), 'graph': '?g' })) {
    const graph = q['g'];
    if (graph === undefined) continue;
    out.push(rowFrom('object', q['s']?.value ?? '?', q['p']?.value ?? '?', props.selectedIri, graph.value));
  }
  return out;
});

const grouped = computed<readonly { layer: Row['layer']; rows: readonly Row[] }[]>(() => {
  const groups = new Map<Row['layer'], Row[]>();
  for (const row of rows.value) {
    const arr = groups.get(row.layer) ?? [];
    arr.push(row);
    groups.set(row.layer, arr);
  }
  return [...groups.entries()].map(([layer, list]) => ({ layer, 'rows': list }));
});

const localIri = computed(() =>
  props.selectedIri === null ? '' : localPart(props.selectedIri),
);

function rowFrom(direction: 'subject' | 'object', s: string, p: string, o: string, graph: string): Row {
  const layer = graphLayer(graph);
  return {
    'key': `${direction}|${s}|${p}|${o}|${graph}`,
    direction,
    'subject':   localPart(s),
    'predicate': localPart(p),
    'object':    o,
    layer,
  };
}

function formatObject(term: Quad['object']): string {
  return term.termType === 'Literal' ? `"${term.value}"` : localPart(term.value);
}

function localPart(iri: string): string {
  const hash = iri.lastIndexOf('#');
  if (hash >= 0) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf('/');
  if (slash >= 0) return iri.slice(slash + 1);
  const colon = iri.lastIndexOf(':');
  if (colon >= 0) return iri.slice(colon + 1);
  return iri;
}

function graphLayer(graph: string): Row['layer'] {
  if (graph === 'urn:dagonizer:memory')         return 'memory';
  if (graph.startsWith('urn:dagonizer:state:'))  return 'state';
  if (graph.startsWith('urn:dagonizer:prov:'))   return 'prov';
  return 'default';
}
</script>

<template>
  <aside v-if="selectedIri !== null" class="triple-inspector" role="dialog" :aria-label="`Triples for ${localIri}`">
    <header class="ti-header">
      <span class="ti-local">{{ localIri }}</span>
      <button class="ti-close" title="Close (Esc)" @click="emit('close')">✕</button>
    </header>
    <p class="ti-iri" :title="selectedIri ?? ''">{{ selectedIri }}</p>

    <p v-if="rows.length === 0" class="ti-empty">No triples mention this IRI.</p>

    <section v-for="group in grouped" :key="group.layer" :class="['ti-group', `ti-group-${group.layer}`]">
      <header class="ti-group-header">
        <span class="ti-group-name">{{ group.layer }}</span>
        <span class="ti-group-count">{{ group.rows.length }}</span>
      </header>
      <ol class="ti-rows">
        <li v-for="row in group.rows" :key="row.key" :class="['ti-row', `ti-row-${row.direction}`]">
          <span class="ti-arrow">{{ row.direction === 'subject' ? '→' : '←' }}</span>
          <span class="ti-predicate">{{ row.predicate }}</span>
          <span class="ti-target">{{ row.direction === 'subject' ? row.object : row.subject }}</span>
        </li>
      </ol>
    </section>
  </aside>
</template>

<style scoped>
.triple-inspector {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 360px;
  max-width: 88%;
  max-height: calc(100% - 20px);
  display: flex;
  flex-direction: column;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--dagonizer-brand);
  border-radius: 6px;
  padding: 0.7rem 0.85rem;
  box-shadow: 0 8px 32px -8px rgba(0, 0, 0, 0.45);
  z-index: 6;
  overflow-y: auto;
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  animation: ti-in 0.18s ease-out;
}

.ti-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.35rem;
}

.ti-local {
  color: var(--dagonizer-brand);
  font-weight: 700;
  font-size: 0.92rem;
}

.ti-close {
  background: transparent;
  border: 0;
  color: var(--vp-c-text-3);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0 0.3rem;
}
.ti-close:hover { color: var(--dagonizer-brand3); }

.ti-iri {
  margin: 0 0 0.7rem 0;
  font-size: 0.66rem;
  color: var(--vp-c-text-3);
  overflow-wrap: anywhere;
}

.ti-empty {
  margin: 0;
  color: var(--vp-c-text-3);
  font-style: italic;
}

.ti-group {
  border-top: 1px dashed var(--vp-c-divider);
  padding-top: 0.5rem;
  margin-top: 0.5rem;
}

.ti-group-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.3rem;
}

.ti-group-name {
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: 0.62rem;
  font-weight: 700;
}

.ti-group-memory .ti-group-name { color: var(--dagonizer-brand);  }
.ti-group-state  .ti-group-name { color: var(--dagonizer-brand3); }
.ti-group-prov   .ti-group-name { color: var(--dagonizer-brand2); }
.ti-group-default .ti-group-name { color: var(--vp-c-text-2); }

.ti-group-count {
  font-size: 0.62rem;
  color: var(--vp-c-text-3);
}

.ti-rows {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
}

.ti-row {
  display: grid;
  grid-template-columns: 14px max-content minmax(0, 1fr);
  gap: 0.4rem;
  padding: 0.15rem 0.25rem;
  border-radius: 3px;
  font-size: 0.72rem;
}

.ti-row:nth-child(odd) { background: rgba(255, 255, 255, 0.025); }

.ti-arrow {
  color: var(--vp-c-text-3);
  text-align: center;
}

.ti-row-subject .ti-arrow { color: var(--dagonizer-brand);  }
.ti-row-object  .ti-arrow { color: var(--dagonizer-brand2); }

.ti-predicate { color: var(--vp-c-text-3); }
.ti-target    { color: var(--vp-c-text-1); overflow-wrap: anywhere; }

@keyframes ti-in {
  from { opacity: 0; transform: translateX(8px); }
  to   { opacity: 1; transform: translateX(0); }
}
</style>
