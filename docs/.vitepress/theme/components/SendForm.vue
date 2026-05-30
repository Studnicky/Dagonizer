<script setup lang="ts">
/**
 * SendForm: textarea + action button side-by-side.
 *
 *   ┌──────────────────────────────────────────────────────────┬──────────┐
 *   │ textarea                                                 │ ▶ / ✕   │
 *   └──────────────────────────────────────────────────────────┴──────────┘
 *
 * While idle the action button sends the query (▶). While a run is
 * in-progress it flips to a Cancel button (✕, red styling) and emits
 * `cancel` instead of `ask`. Enter (without Shift) sends; Shift-Enter
 * inserts a newline.
 *
 * The reset action lives in the footer to keep the primary affordance
 * unambiguous.
 */

const props = defineProps<{
  query: string;
  running: boolean;
  terminalKind: 'pending' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
}>();

const emit = defineEmits<{
  (event: 'update:query', value: string): void;
  (event: 'ask'): void;
  (event: 'cancel'): void;
  (event: 'reset'): void;
}>();

function onInput(event: Event): void {
  emit('update:query', (event.target as HTMLTextAreaElement).value);
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (props.running) {
      emit('cancel');
    } else {
      emit('ask');
    }
  }
}

function onActionClick(): void {
  if (props.running) {
    emit('cancel');
  } else {
    emit('ask');
  }
}
</script>

<template>
  <footer class="send-form">
    <div class="send-row">
      <textarea
        class="send-input"
        :value="query"
        :disabled="running"
        placeholder="Describe a book, ask for a recommendation, or search by title…"
        rows="2"
        @input="onInput"
        @keydown="onKey"
      />
      <button
        :class="['send-btn', { 'send-btn-cancel': running, 'send-btn-running': running }]"
        :disabled="!running && query.trim().length === 0"
        :title="running ? 'Cancel the current run (Esc / Enter)' : 'Ask the Archivist (Enter)'"
        :aria-label="running ? 'Cancel' : 'Ask the Archivist'"
        @click="onActionClick"
      >
        <span v-if="running" class="send-spinner" aria-hidden="true"></span>
        <span class="send-glyph" aria-hidden="true">{{ running ? '✕' : '▶' }}</span>
      </button>
    </div>

    <div class="send-footer">
      <span
        v-if="terminalKind !== 'pending'"
        :class="['send-status', `send-status-${terminalKind}`]"
      >{{ terminalKind }}</span>

      <button
        class="send-reset"
        :disabled="running"
        title="Clear conversation (memory persists)"
        @click="emit('reset')"
      >reset conversation</button>
    </div>
  </footer>
</template>

<style scoped>
.send-form {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.send-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.6rem;
  align-items: stretch;
}

.send-input {
  width: 100%;
  resize: vertical;
  padding: 0.7rem 0.85rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  font-family: var(--vp-font-family-base);
  font-size: 0.96rem;
  line-height: 1.45;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  min-height: 64px;
}

.send-input:focus {
  outline: none;
  border-color: var(--dagonizer-brand);
  box-shadow: 0 0 0 2px rgba(34, 232, 255, 0.18);
}

.send-input:disabled { opacity: 0.7; cursor: progress; }

/* Running state: pulsing cyan glow around the textarea so it's clearly
   active rather than just disabled. */
.send-form:has(.send-btn-running) .send-input {
  border-color: var(--dagonizer-brand);
  box-shadow: 0 0 0 2px rgba(34, 232, 255, 0.18), 0 0 16px -4px rgba(34, 232, 255, 0.45);
  animation: send-input-pulse 1.8s ease-in-out infinite;
}

@keyframes send-input-pulse {
  0%, 100% { box-shadow: 0 0 0 2px rgba(34, 232, 255, 0.18), 0 0 16px -4px rgba(34, 232, 255, 0.35); }
  50%      { box-shadow: 0 0 0 2px rgba(34, 232, 255, 0.32), 0 0 28px -2px rgba(34, 232, 255, 0.65); }
}

.send-btn {
  width: 64px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--dagonizer-brand);
  color: var(--vp-c-bg-elv);
  border: 0;
  border-radius: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 1.3rem;
  font-weight: 700;
  cursor: pointer;
  transition: filter 0.12s ease, transform 0.12s ease, background 0.18s ease;
}

/* Cancel state: red accent so the visitor clearly understands the action. */
.send-btn-cancel {
  background: #c0392b;
}

/* Running state: a rotating ring sits behind the ✕ glyph so the
   button reads as "actively working" rather than just "click to cancel". */
.send-btn-running {
  position: relative;
  overflow: hidden;
}

.send-spinner {
  position: absolute;
  inset: 6px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.18);
  border-top-color: rgba(255, 255, 255, 0.9);
  animation: send-spin 0.9s linear infinite;
  pointer-events: none;
}

.send-btn-running .send-glyph {
  position: relative;
  z-index: 1;
}

@keyframes send-spin {
  to { transform: rotate(360deg); }
}

.send-btn:hover:not([disabled]) { filter: brightness(1.12); transform: translateX(1px); }
.send-btn:focus-visible { outline: 2px solid var(--dagonizer-brand); outline-offset: 2px; }
.send-btn[disabled] { opacity: 0.45; cursor: not-allowed; }

.send-glyph { line-height: 1; }

.send-footer {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding-top: 0.1rem;
}

.send-reset {
  margin-left: auto;
  background: transparent;
  color: var(--vp-c-text-3);
  border: 0;
  padding: 0.2rem 0.4rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 0.12s ease;
}

.send-reset:hover:not([disabled]) { color: var(--dagonizer-brand3); }
.send-reset[disabled] { opacity: 0.4; cursor: not-allowed; }

.send-status {
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
  padding: 0.2rem 0.55rem;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.send-status-completed { background: rgba(34, 232, 255, 0.14); color: var(--dagonizer-brand); }
.send-status-failed,
.send-status-cancelled,
.send-status-timed_out { background: rgba(212, 166, 73, 0.16); color: var(--dagonizer-brand3); }
</style>
