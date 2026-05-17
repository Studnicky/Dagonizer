<script setup lang="ts">
/**
 * MemoryPane — read-only snapshot of the current `ArchivistState`.
 *
 * Renders monospace key/value rows that mirror the state's narrow fields.
 * Optional `running` flag pulses the panel border while the run is active.
 */

interface MemorySnapshot {
  readonly intent: string;
  readonly terms: readonly string[];
  readonly candidateCount: number;
  readonly shortlistCount: number;
  readonly composeAttempts: number;
  readonly approved: boolean | null;
}

defineProps<{
  snapshot: MemorySnapshot | null;
  running?: boolean;
}>();
</script>

<template>
  <section :class="['memory', { 'memory-running': running === true }]">
    <header class="memory-header">
      <h4>Memory</h4>
      <span v-if="running" class="memory-live">live</span>
    </header>

    <dl v-if="snapshot !== null" class="memory-grid">
      <dt>intent</dt>           <dd>{{ snapshot.intent }}</dd>
      <dt>terms</dt>            <dd>{{ snapshot.terms.length > 0 ? snapshot.terms.join(', ') : '—' }}</dd>
      <dt>candidates</dt>       <dd>{{ snapshot.candidateCount }}</dd>
      <dt>shortlist</dt>        <dd>{{ snapshot.shortlistCount }}</dd>
      <dt>compose attempts</dt> <dd>{{ snapshot.composeAttempts }}</dd>
      <dt>approved</dt>         <dd>{{ snapshot.approved === null ? '—' : String(snapshot.approved) }}</dd>
    </dl>

    <p v-else class="memory-empty">No run yet.</p>
  </section>
</template>

<style scoped>
.memory {
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 0.8rem 0.9rem;
  height: 100%;
  min-height: 220px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.memory-running {
  border-color: var(--dagonizer-brand);
  box-shadow: 0 0 0 1px var(--dagonizer-brand), 0 0 16px -8px var(--dagonizer-brand);
  animation: memory-pulse 1.6s ease-in-out infinite;
}

.memory-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 0.6rem;
}

.memory h4 {
  margin: 0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--vp-c-text-3);
}

.memory-live {
  font-family: var(--vp-font-family-mono);
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  padding: 0.15rem 0.45rem;
  border-radius: 3px;
  color: var(--dagonizer-brand);
  background: rgba(34, 232, 255, 0.08);
}

.memory-grid {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: 0.85rem;
  row-gap: 0.35rem;
  margin: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
}

.memory-grid dt {
  color: var(--vp-c-text-3);
  white-space: nowrap;
}

.memory-grid dd {
  margin: 0;
  min-width: 0;
  color: var(--vp-c-text-1);
  overflow-wrap: anywhere;
}

.memory-empty {
  margin: auto 0;
  text-align: center;
  color: var(--vp-c-text-3);
  font-style: italic;
}

@keyframes memory-pulse {
  0%, 100% { box-shadow: 0 0 0 1px var(--dagonizer-brand), 0 0 16px -8px var(--dagonizer-brand); }
  50%      { box-shadow: 0 0 0 1px var(--dagonizer-brand), 0 0 24px -4px var(--dagonizer-brand); }
}
</style>
