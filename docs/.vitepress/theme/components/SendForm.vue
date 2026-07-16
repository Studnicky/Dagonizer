<script setup lang="ts">
import Spinner from './Spinner.vue';
import UiBadge from './ui/UiBadge.vue';
import UiButton from './ui/UiButton.vue';
import UiTextarea from './ui/UiTextarea.vue';
import { terminalBadgeTone } from './ui/theme';

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
  terminalVariant: 'pending' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
}>();

const emit = defineEmits<{
  (event: 'update:query', value: string): void;
  (event: 'ask'): void;
  (event: 'cancel'): void;
  (event: 'reset'): void;
}>();

function onInput(value: string): void {
  emit('update:query', value);
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
      <UiTextarea
        :model-value="query"
        :disabled="running"
        placeholder="Describe a book, ask for a recommendation, or search by title…"
        :rows="2"
        textarea-class="send-input"
        @update:model-value="onInput"
        @keydown="onKey"
      />
      <UiButton
        :variant="running ? 'danger' : 'primary'"
        size="icon"
        :class="[{ 'send-btn-running': running }]"
        :disabled="!running && query.trim().length === 0"
        @click="onActionClick"
      >
        <template #leading><Spinner v-if="running" /></template>
        <span class="send-glyph" aria-hidden="true">{{ running ? '✕' : '▶' }}</span>
      </UiButton>
    </div>

    <div class="send-footer">
      <span
        v-if="terminalVariant !== 'pending'"
        class="send-status"
      ><UiBadge :tone="terminalBadgeTone(terminalVariant)" size="md">{{ terminalVariant }}</UiBadge></span>

      <UiButton
        class="send-reset"
        variant="ghost"
        size="sm"
        :disabled="running"
        @click="emit('reset')"
      >reset conversation</UiButton>
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

.send-input { min-height: 64px; }

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

/* Running state: a rotating ring sits behind the ✕ glyph so the
   button reads as "actively working" rather than just "click to cancel". */
.send-btn-running {
  position: relative;
  overflow: hidden;
}

.send-btn-running .send-glyph {
  position: relative;
  z-index: 1;
}

.send-glyph { line-height: 1; }

.send-footer {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding-top: 0.1rem;
}

.send-reset { margin-left: auto; }

.send-status { display: inline-flex; }
</style>
