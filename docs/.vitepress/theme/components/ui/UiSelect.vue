<script setup lang="ts">
defineProps<{
  modelValue: string;
  disabled?: boolean;
  selectClass?: string;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
}>();

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <select
    :class="['ui-select', selectClass]"
    :value="modelValue"
    :disabled="disabled === true"
    @change="onChange"
  >
    <slot />
  </select>
</template>

<style scoped>
.ui-select {
  width: 100%;
  background: var(--vp-c-bg-elv);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 0.45rem 0.6rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.82rem;
  cursor: pointer;
  transition: border-color 0.14s ease, box-shadow 0.14s ease;
}

.ui-select:focus {
  outline: none;
  border-color: var(--dagonizer-brand);
  box-shadow: 0 0 0 2px rgba(34, 232, 255, 0.18);
}

.ui-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
