<script setup lang="ts">
/**
 * PersistenceBadge: status chip for the RDF memory store persistence mode.
 *
 * Shows "memory: N triples · persisted" when the store is persisting to
 * localStorage, or "memory: N triples · in-memory" otherwise. Clicking the
 * chip toggles between modes. When toggling to in-memory, the stored dump is
 * removed (MemoryStore.disablePersistence handles the removeItem).
 */

const props = defineProps<{
  tripleCount: number;
  isPersisted: boolean;
}>();

const emit = defineEmits<{
  (event: 'toggle'): void;
}>();
</script>

<template>
  <button
    type="button"
    :class="['persistence-badge', props.isPersisted ? 'is-persisted' : 'is-transient']"
    :title="props.isPersisted ? 'Click to switch to in-memory (drops localStorage dump)' : 'Click to enable localStorage persistence'"
    @click="emit('toggle')"
  >
    <span class="badge-count">{{ props.tripleCount }}</span>
    <span class="badge-sep">triples</span>
    <span class="badge-mode">{{ props.isPersisted ? 'persisted' : 'in-memory' }}</span>
  </button>
</template>

<style scoped>
.persistence-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.55rem;
  border-radius: 20px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-elv);
  font-family: var(--vp-font-family-mono);
  font-size: 0.68rem;
  cursor: pointer;
  transition: border-color 0.14s ease, background 0.14s ease;
  white-space: nowrap;
}

.persistence-badge:hover { border-color: var(--dagonizer-brand); }

.badge-count {
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.badge-sep {
  color: var(--vp-c-text-3);
}

.badge-mode {
  text-transform: uppercase;
  letter-spacing: 0.07em;
  font-size: 0.62rem;
}

.is-persisted .badge-mode { color: var(--dagonizer-brand2); }
.is-transient .badge-mode { color: var(--vp-c-text-3); }
</style>
