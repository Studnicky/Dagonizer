<script setup lang="ts">
/**
 * TraceList — chronological list of node start/end/error events.
 *
 * Each entry fades in from the bottom so the user perceives the live
 * stream of node transitions even if the cytoscape view is fully zoomed.
 */

interface TraceEntry {
  readonly node: string;
  readonly output?: string;
  readonly ts: number;
  readonly kind: 'start' | 'end' | 'error';
}

defineProps<{
  entries: readonly TraceEntry[];
}>();
</script>

<template>
  <aside class="trace">
    <header class="trace-header">
      <h4>Trace</h4>
      <span class="trace-count">{{ entries.length }}</span>
    </header>

    <ol v-if="entries.length > 0" class="trace-list">
      <li
        v-for="(entry, i) in entries"
        :key="`${entry.ts}-${i}`"
        :class="['trace-entry', `trace-${entry.kind}`]"
      >
        <span class="trace-kind">{{ entry.kind }}</span>
        <code class="trace-node">{{ entry.node }}</code>
        <span v-if="entry.output !== undefined" class="trace-output">→ {{ entry.output }}</span>
      </li>
    </ol>

    <p v-else class="trace-empty">No nodes have executed yet.</p>
  </aside>
</template>

<style scoped>
.trace {
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 0.7rem 0.85rem;
}

.trace-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 0.5rem;
}

.trace h4 {
  margin: 0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--vp-c-text-3);
}

.trace-count {
  font-family: var(--vp-font-family-mono);
  font-size: 0.7rem;
  color: var(--vp-c-text-3);
}

.trace-list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 160px;
  overflow-y: auto;
  font-family: var(--vp-font-family-mono);
  font-size: 0.74rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.trace-entry {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.18rem 0.3rem;
  border-radius: 3px;
  animation: trace-in 0.2s ease-out;
}

.trace-kind {
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.05rem 0.35rem;
  border-radius: 2px;
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-3);
  min-width: 38px;
  text-align: center;
}

.trace-start .trace-kind { background: rgba(34, 232, 255, 0.14); color: var(--dagonizer-brand); }
.trace-end   .trace-kind { background: rgba(155, 81, 224, 0.14); color: var(--dagonizer-brand2); }
.trace-error .trace-kind { background: rgba(212, 166, 73, 0.18); color: var(--dagonizer-brand3); }

.trace-node { color: var(--vp-c-text-1); }
.trace-output { color: var(--vp-c-text-3); }

.trace-empty {
  margin: 0;
  color: var(--vp-c-text-3);
  font-style: italic;
  font-size: 0.78rem;
}

@keyframes trace-in {
  from { opacity: 0; transform: translateX(-4px); }
  to   { opacity: 1; transform: translateX(0); }
}
</style>
