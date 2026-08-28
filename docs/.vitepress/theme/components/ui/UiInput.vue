<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: string | number;
  type?: 'text' | 'password' | 'number';
  placeholder?: string;
  disabled?: boolean;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  inputClass?: string;
  wrapperClass?: string;
}>(), {
  'type': 'text',
  'disabled': false,
});

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
}>();

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div :class="['ui-input-shell', wrapperClass]">
    <span v-if="$slots.prefix" class="ui-input-shell__prefix"><slot name="prefix" /></span>
    <input
      :class="['ui-input', inputClass]"
      :type="props.type"
      :value="props.modelValue"
      :placeholder="props.placeholder"
      :disabled="props.disabled"
      :min="props.min"
      :max="props.max"
      :step="props.step"
      autocomplete="off"
      spellcheck="false"
      @input="onInput"
    />
    <span v-if="$slots.suffix" class="ui-input-shell__suffix"><slot name="suffix" /></span>
    <span v-if="$slots.actions" class="ui-input-shell__actions"><slot name="actions" /></span>
  </div>
</template>

<style scoped>
.ui-input-shell {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.45rem 0.6rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  transition: border-color 0.14s ease, box-shadow 0.14s ease;
}

.ui-input {
  width: 100%;
  padding: 0;
  background: transparent;
  color: var(--vp-c-text-1);
  border: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 0.82rem;
  min-width: 0;
}

.ui-input-shell:focus-within {
  outline: none;
  border-color: var(--dagonizer-brand);
  box-shadow: 0 0 0 2px rgba(34, 232, 255, 0.18);
}

.ui-input:focus {
  outline: none;
}

.ui-input-shell:has(.ui-input:disabled) {
  opacity: 0.65;
  cursor: not-allowed;
}

.ui-input-shell__prefix,
.ui-input-shell__suffix,
.ui-input-shell__actions {
  display: inline-flex;
  align-items: center;
  color: var(--vp-c-text-3);
  flex-shrink: 0;
}
</style>
