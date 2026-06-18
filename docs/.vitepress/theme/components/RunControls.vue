<script setup lang="ts">
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

function onInput(event: Event): void {
  const target = event.target as HTMLTextAreaElement;
  emit('update:query', target.value);
}
</script>

<template>
  <footer class="run-controls">
    <textarea
      id="run-controls-input"
      name="run-controls-input"
      class="run-input"
      :value="query"
      :disabled="running"
      placeholder="Describe a book, ask for a recommendation, or search by title…"
      rows="2"
      autocomplete="off"
      @input="onInput"
    />

    <div class="run-buttons">
      <button
        class="run-btn run-btn-primary"
        :disabled="running || query.trim().length === 0"
        @click="emit('ask')"
      >
        {{ running ? 'The Archivist is thinking…' : 'Ask the Archivist' }}
      </button>

      <button
        class="run-btn run-btn-secondary"
        :disabled="running"
        @click="emit('reset')"
      >
        Reset
      </button>

      <span
        v-if="terminalKind !== 'pending'"
        :class="['run-status', `run-status-${terminalKind}`]"
      >
        {{ terminalKind }}
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

.run-input {
  width: 100%;
  resize: vertical;
  padding: 0.6rem 0.7rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  font-family: var(--vp-font-family-base);
  font-size: 0.92rem;
  line-height: 1.4;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.run-input:focus {
  outline: none;
  border-color: var(--dagonizer-brand);
  box-shadow: 0 0 0 2px rgba(34, 232, 255, 0.18);
}

.run-input:disabled {
  opacity: 0.7;
  cursor: progress;
}

.run-buttons {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.run-btn {
  padding: 0.45rem 0.95rem;
  border-radius: 4px;
  font-family: var(--vp-font-family-base);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.run-btn-primary {
  background: var(--dagonizer-brand);
  color: var(--vp-c-bg-elv);
  border: 0;
}

.run-btn-primary:hover:not([disabled]) {
  filter: brightness(1.1);
}

.run-btn-secondary {
  background: transparent;
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
}

.run-btn-secondary:hover:not([disabled]) {
  border-color: var(--dagonizer-brand);
  color: var(--dagonizer-brand);
}

.run-btn[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}

.run-status {
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
  padding: 0.2rem 0.55rem;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-left: auto;
}

.run-status-completed { background: rgba(34, 232, 255, 0.14); color: var(--dagonizer-brand); }
.run-status-failed,
.run-status-cancelled,
.run-status-timed_out { background: rgba(212, 166, 73, 0.16); color: var(--dagonizer-brand3); }
</style>
