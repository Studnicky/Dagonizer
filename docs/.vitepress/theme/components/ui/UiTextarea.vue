<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  textareaClass?: string;
}>(), {
  'disabled': false,
  'rows': 2,
});

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
  (event: 'keydown', value: KeyboardEvent): void;
}>();

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
}

function onKeydown(event: KeyboardEvent): void {
  emit('keydown', event);
}
</script>

<template>
  <textarea
    :class="['ui-textarea', textareaClass]"
    :value="props.modelValue"
    :disabled="props.disabled"
    :placeholder="props.placeholder"
    :rows="props.rows"
    autocomplete="off"
    @input="onInput"
    @keydown="onKeydown"
  />
</template>

<style scoped>
.ui-textarea {
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
}

.ui-textarea:focus {
  outline: none;
  border-color: var(--dagonizer-brand);
  box-shadow: 0 0 0 2px rgba(34, 232, 255, 0.18);
}

.ui-textarea:disabled {
  opacity: 0.7;
  cursor: progress;
}
</style>
