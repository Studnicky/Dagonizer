<script setup lang="ts">
import { nextTick, ref } from 'vue';
import Spinner from './Spinner.vue';
import UiBadge from './ui/UiBadge.vue';
import UiButton from './ui/UiButton.vue';
import UiSelect from './ui/UiSelect.vue';
import UiTextarea from './ui/UiTextarea.vue';
import { terminalBadgeTone } from './ui/theme';

const props = withDefaults(defineProps<{
  query: string;
  running: boolean;
  terminalVariant: 'pending' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
  sampleQueries?: readonly string[];
  placeholder?: string;
}>(), {
  'sampleQueries': () => [],
  'placeholder': 'Describe a book, ask for a recommendation, or search by title…',
});

const emit = defineEmits<{
  (event: 'update:query', value: string): void;
  (event: 'ask'): void;
  (event: 'cancel'): void;
  (event: 'reset'): void;
}>();

const selectedSample = ref('');

async function onSampleSelect(value: string): Promise<void> {
  if (value.length === 0) return;
  selectedSample.value = value;
  emit('update:query', value);
  await nextTick();
  selectedSample.value = '';
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
</script>

<template>
  <footer class="send-form">
    <div class="send-row">
      <UiTextarea
        :model-value="query"
        :disabled="running"
        :placeholder="placeholder"
        :rows="2"
        textarea-class="send-input"
        @update:model-value="emit('update:query', $event)"
        @keydown="onKey"
      />
      <div class="send-actions">
        <label v-if="sampleQueries.length > 0" class="send-samples">
          <span class="send-samples-label">Sample query</span>
          <UiSelect
            :model-value="selectedSample"
            :disabled="running"
            select-class="send-samples-select"
            @update:model-value="onSampleSelect"
          >
            <option value="" disabled>Choose a sample…</option>
            <option v-for="sample in sampleQueries" :key="sample" :value="sample">{{ sample }}</option>
          </UiSelect>
        </label>
        <UiButton
          :variant="running ? 'danger' : 'primary'"
          size="icon"
          :class="[{ 'send-btn-running': running }]"
          :disabled="!running && query.trim().length === 0"
          :aria-label="running ? 'Cancel request' : 'Send message'"
          @click="running ? emit('cancel') : emit('ask')"
        >
          <template #leading><Spinner v-if="running" /></template>
          <span class="send-glyph" aria-hidden="true">{{ running ? '✕' : '▶' }}</span>
        </UiButton>
      </div>
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

.send-actions {
  display: flex;
  align-items: stretch;
  gap: 0.6rem;
}

.send-samples {
  display: flex;
  width: clamp(11rem, 24vw, 18rem);
}

.send-samples-label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.send-samples-select { height: 100%; }

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

@media (max-width: 640px) {
  .send-row { grid-template-columns: 1fr; }
  .send-actions { justify-content: flex-end; }
  .send-samples { flex: 1 1 auto; width: auto; }
}
</style>
