<script setup lang="ts">
/**
 * TripleInspector: side panel showing every triple in/out of a selected node.
 *
 * The visitor clicks a node on the MemoryGraph cosmos canvas; the
 * runner sets `selection` and this panel resolves the full subject+
 * object triple set from `MemoryStore`. The header identifies the node
 * three ways — human label, CURIE, and full IRI — so prefixed terms
 * that share a local name (e.g. `dag:Activity` vs `prov:Activity`) are
 * never confused. Each row shows the predicate and the other end of the
 * triple, rendered as a CURIE, grouped by named-graph layer.
 *
 * Two selection kinds are supported:
 *   - 'iri': named node; show outbound (subject) and inbound (object) triples.
 *   - 'literal': literal value; show inbound triples (?s ?p "value"). Literals
 *     are matched by their lexical value regardless of datatype or language
 *     tag, so a language-tagged label like `"Activity"@en` still resolves.
 */

import { computed } from 'vue';

import { MemoryStore } from '../../../../examples/the-archivist/memory/MemoryStore.ts';
import type { MemorySelection } from './MemoryGraph.vue';

const props = defineProps<{
  store: MemoryStore;
  tick: number;
  selection: MemorySelection | null;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';

/**
 * Namespace → CURIE-prefix table. Longest matching namespace wins, so the
 * `urn:dagonizer:book:` prefix is preferred over a hypothetical shorter one.
 */
const PREFIXES: readonly (readonly [string, string])[] = [
  ['https://noocodex.dev/ontology/dagonizer/',  'dag'],
  ['http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'rdf'],
  ['http://www.w3.org/2000/01/rdf-schema#',      'rdfs'],
  ['http://www.w3.org/2002/07/owl#',             'owl'],
  ['http://www.w3.org/2001/XMLSchema#',          'xsd'],
  ['http://www.w3.org/ns/prov#',                 'prov'],
  ['urn:dagonizer:book:',                        'book'],
  ['urn:dagonizer:run:',                         'run'],
];

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
  const sel = props.selection;
  if (sel === null) return [];
  const out: Row[] = [];

  if (sel.variant === 'iri') {
    // Outbound: IRI is the subject.
    for (const q of props.store.select({ 'subject': MemoryStore.iri(sel.iri), 'predicate': '?p', 'object': '?o', 'graph': '?g' })) {
      const graph = q['g'];
      const obj = q['o'];
      if (graph === undefined || obj === undefined) continue;
      out.push(rowFrom('subject', sel.iri, q['p']?.value ?? '?', formatTerm(obj), graph.value));
    }
    // Inbound: IRI is the object.
    for (const q of props.store.select({ 'subject': '?s', 'predicate': '?p', 'object': MemoryStore.iri(sel.iri), 'graph': '?g' })) {
      const graph = q['g'];
      if (graph === undefined) continue;
      out.push(rowFrom('object', q['s']?.value ?? '?', q['p']?.value ?? '?', displayTerm(sel.iri), graph.value));
    }
  } else {
    // Literal: match by lexical value across every quad, regardless of the
    // literal's datatype or language tag. A concrete-term query would miss
    // `"Activity"@en` when searching for a plain `"Activity"`.
    for (const q of props.store.triples()) {
      if (q.object.termType !== 'Literal' || q.object.value !== sel.value) continue;
      out.push(rowFrom('object', q.subject.value, q.predicate.value, `"${sel.value}"`, q.graph.value));
    }
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

/** Whether the current selection is an IRI node (vs a literal value). */
const isIri = computed<boolean>(() => props.selection?.variant === 'iri');

/** Human label: rdfs:label of the IRI when present, else its local name; literal value verbatim. */
const nodeLabel = computed<string>(() => {
  const sel = props.selection;
  if (sel === null) return '';
  if (sel.variant === 'literal') return sel.value;
  const labelRows = props.store.select({ 'subject': MemoryStore.iri(sel.iri), 'predicate': MemoryStore.iri(RDFS_LABEL), 'object': '?o' });
  const labelTerm = labelRows.map((r) => r['o']).find((o) => o !== undefined && o.termType === 'Literal');
  return labelTerm?.value ?? localPart(sel.iri);
});

/** CURIE for an IRI selection (empty when no namespace matches or for literals). */
const nodeCurie = computed<string>(() => {
  const sel = props.selection;
  if (sel === null || sel.variant !== 'iri') return '';
  return toCurie(sel.iri) ?? '';
});

/** Full IRI for an IRI selection; empty for literals. */
const nodeIri = computed<string>(() => {
  const sel = props.selection;
  return sel !== null && sel.variant === 'iri' ? sel.iri : '';
});

/** Datatype/language descriptor for a literal selection (e.g. `@en`, `xsd:integer`). */
const literalKind = computed<string>(() => {
  const sel = props.selection;
  if (sel === null || sel.variant !== 'literal') return '';
  for (const q of props.store.triples()) {
    if (q.object.termType !== 'Literal' || q.object.value !== sel.value) continue;
    if (q.object.language.length > 0) return `@${q.object.language}`;
    const dt = q.object.datatype.value;
    return toCurie(dt) ?? localPart(dt);
  }
  return 'literal';
});

function rowFrom(direction: 'subject' | 'object', s: string, p: string, o: string, graph: string): Row {
  return {
    'key': `${direction}|${s}|${p}|${o}|${graph}`,
    direction,
    'subject':   displayTerm(s),
    'predicate': displayTerm(p),
    'object':    o,
    'layer':     graphLayer(graph),
  };
}

/** Render a term for a row target: quoted lexical value for literals, CURIE for IRIs. */
function formatTerm(term: { readonly termType: string; readonly value: string }): string {
  return term.termType === 'Literal' ? `"${term.value}"` : displayTerm(term.value);
}

/** CURIE when a namespace matches, else the bare local name. */
function displayTerm(iri: string): string {
  return toCurie(iri) ?? localPart(iri);
}

/** Compute a prefixed CURIE for an IRI, or null when no known namespace matches. */
function toCurie(iri: string): string | null {
  let best: readonly [string, string] | null = null;
  for (const entry of PREFIXES) {
    if (iri.startsWith(entry[0]) && (best === null || entry[0].length > best[0].length)) best = entry;
  }
  if (best === null) return null;
  const local = iri.slice(best[0].length);
  if (local.length === 0 || local.includes('/') || local.includes('#')) return null;
  return `${best[1]}:${local}`;
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
  <aside v-if="selection !== null" class="triple-inspector" role="dialog" :aria-label="`Triples for ${nodeLabel}`">
    <header class="ti-header">
      <span class="ti-local" :title="nodeLabel">{{ nodeLabel.length > 42 ? nodeLabel.slice(0, 40) + '…' : nodeLabel }}</span>
      <button class="ti-close" title="Close (Esc)" @click="emit('close')">✕</button>
    </header>

    <!-- IRI: show CURIE then full IRI. Literal: show the datatype/language. -->
    <p v-if="isIri && nodeCurie.length > 0" class="ti-curie">{{ nodeCurie }}</p>
    <p v-if="isIri" class="ti-iri" :title="nodeIri">{{ nodeIri }}</p>
    <p v-else class="ti-iri">Literal value · {{ literalKind }}</p>

    <p v-if="rows.length === 0" class="ti-empty">No triples mention this node.</p>

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
  margin-bottom: 0.3rem;
}

.ti-local {
  color: var(--dagonizer-brand);
  font-weight: 700;
  font-size: 0.92rem;
  overflow-wrap: anywhere;
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

.ti-curie {
  margin: 0 0 0.15rem 0;
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--dagonizer-brand2);
  overflow-wrap: anywhere;
}

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
