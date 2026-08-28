<script setup lang="ts">
import Badge from './ui/Badge.vue';
import UiMetaText from './ui/UiMetaText.vue';
import { boolBadgeTone } from './ui/theme';
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
    class="persistence-badge"
    :title="props.isPersisted ? 'Click to switch to in-memory (drops localStorage dump)' : 'Click to enable localStorage persistence'"
    @click="emit('toggle')"
  >
    <Badge :tone="boolBadgeTone(props.isPersisted, 'info', 'neutral')" size="md" interactive>
      <UiMetaText class="badge-count" tone="default">{{ props.tripleCount }}</UiMetaText>
      <span class="badge-sep">triples</span>
      <span class="badge-mode">{{ props.isPersisted ? 'persisted' : 'in-memory' }}</span>
    </Badge>
  </button>
</template>

<style scoped>
.persistence-badge {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}

.badge-count {
  font-weight: 700;
}

.badge-sep {
  color: var(--vp-c-text-3);
}

.badge-mode {
  font-size: 0.62rem;
}
</style>
