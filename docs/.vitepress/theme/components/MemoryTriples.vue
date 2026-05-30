<script setup lang="ts">
/**
 * MemoryTriples: live view of the n3.js triple store.
 *
 * Re-reads `store.triples()` whenever the parent bumps the `tick`
 * prop (after every node end), then renders each quad as a compact
 * `subject / predicate / object` row. Subjects are truncated to the
 * IRI's local part (`urn:dagonizer:book:9780525536291` → `9780525536291`)
 * so the panel stays readable inside its column.
 */

import { computed } from 'vue';
import type { Quad } from 'n3';
import { MemoryStore } from '../../../../examples/the-archivist/memory/MemoryStore.ts';

const props = defineProps<{
  store: MemoryStore;
  tick: number;
}>();

interface Row {
  readonly subject:   string;
  readonly predicate: string;
  readonly object:    string;
  readonly key:       string;
}

const rows = computed<readonly Row[]>(() => {
  // `tick` is consumed only so this computed re-runs after writes.
  void props.tick;
  const out: Row[] = [];
  let i = 0;
  for (const q of props.store.triples()) {
    out.push({
      subject:   localPart(q.subject),
      predicate: localPart(q.predicate),
      object:    renderObject(q),
      key:       `${q.subject.value}|${q.predicate.value}|${q.object.value}|${String(i++)}`,
    });
  }
  return out;
});

function localPart(term: Quad['subject']): string {
  const v = term.value;
  const hashIdx = v.lastIndexOf('#');
  if (hashIdx >= 0) return v.slice(hashIdx + 1);
  const slashIdx = v.lastIndexOf('/');
  if (slashIdx >= 0) return v.slice(slashIdx + 1);
  const colonIdx = v.lastIndexOf(':');
  if (colonIdx >= 0) return v.slice(colonIdx + 1);
  return v;
}

function renderObject(q: Quad): string {
  if (q.object.termType === 'Literal') return `"${q.object.value}"`;
  return localPart(q.object);
}
</script>

<template>
  <section class="memory-triples">
    <header class="triples-header">
      <h4>RDF memory</h4>
      <span class="triples-count">{{ rows.length }} {{ rows.length === 1 ? 'triple' : 'triples' }}</span>
    </header>

    <ol v-if="rows.length > 0" class="triples-list">
      <li v-for="row in rows" :key="row.key" class="triple">
        <span class="t-subject">{{ row.subject }}</span>
        <span class="t-predicate">{{ row.predicate }}</span>
        <span class="t-object">{{ row.object }}</span>
      </li>
    </ol>

    <p v-else class="triples-empty">No triples written yet.</p>
  </section>
</template>

<style scoped>
.memory-triples {
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 0.7rem 0.85rem;
  display: flex;
  flex-direction: column;
  min-height: 220px;
}

.triples-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 0.55rem;
}

.triples-header h4 {
  margin: 0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--vp-c-text-3);
}

.triples-count {
  font-family: var(--vp-font-family-mono);
  font-size: 0.7rem;
  color: var(--dagonizer-brand2);
}

.triples-list {
  list-style: none;
  padding: 0;
  margin: 0;
  overflow-y: auto;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
}

.triple {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1.5fr);
  gap: 0.4rem;
  padding: 0.18rem 0.3rem;
  border-radius: 3px;
  animation: triple-in 0.22s ease-out;
}

.triple:nth-child(odd) { background: var(--vp-c-bg-alt); }

.t-subject   { color: var(--dagonizer-brand);  overflow-wrap: anywhere; }
.t-predicate { color: var(--vp-c-text-3); overflow-wrap: anywhere; }
.t-object    { color: var(--vp-c-text-1); overflow-wrap: anywhere; }

.triples-empty {
  margin: auto 0;
  text-align: center;
  color: var(--vp-c-text-3);
  font-style: italic;
  font-size: 0.78rem;
}

@keyframes triple-in {
  from { opacity: 0; transform: translateY(-2px); }
  to   { opacity: 1; transform: translateY(0); }
}
</style>
