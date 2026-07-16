<script setup lang="ts">
import UiBadge from './ui/UiBadge.vue';
import UiButton from './ui/UiButton.vue';
import UiTextarea from './ui/UiTextarea.vue';
import { terminalBadgeTone } from './ui/theme';
/**
 * RunControls: textarea, ask/reset buttons, terminal status badge.
 *
 * Stateless presentational component. Parent owns the query string and
 * is notified via `update:query`, `ask`, and `reset` events.
 */

defineProps<{
  query: string;
  running: boolean;
  terminalKind: 'pending' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
}>();

const emit = defineEmits<{
  (event: 'update:query', value: string): void;
  (event: 'ask'): void;
  (event: 'reset'): void;
}>();

function onInput(value: string): void {
  emit('update:query', value);
}
</script>

<template>
  <footer class="run-controls">
    <UiTextarea
      :model-value="query"
      :disabled="running"
      placeholder="Describe a book, ask for a recommendation, or search by title…"
      :rows="2"
      textarea-class="run-input"
      @update:model-value="onInput"
    />

    <div class="run-buttons">
      <UiButton
        variant="primary"
        :disabled="running || query.trim().length === 0"
        @click="emit('ask')"
      >
        {{ running ? 'The Archivist is thinking…' : 'Ask the Archivist' }}
      </UiButton>

      <UiButton
        variant="secondary"
        :disabled="running"
        @click="emit('reset')"
      >
        Reset
      </UiButton>

      <span
        v-if="terminalKind !== 'pending'"
        class="run-status"
      >
        <UiBadge :tone="terminalBadgeTone(terminalKind)" size="md">{{ terminalKind }}</UiBadge>
      </span>
    </div>
  </footer>
</template>

<style scoped>
.run-controls {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.run-input { font-size: 0.92rem; line-height: 1.4; padding: 0.6rem 0.7rem; }

.run-buttons {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.run-status { margin-left: auto; }
</style>
