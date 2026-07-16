<script setup lang="ts">
import UiField from './UiField.vue';
import UiInput from './UiInput.vue';

const props = defineProps<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
}>();

const emit = defineEmits<{
  (event: 'update:value', value: number): void;
}>();

function onRange(event: Event): void {
  emit('update:value', Number((event.target as HTMLInputElement).value));
}

function onNumber(value: string): void {
  emit('update:value', Number(value));
}
</script>

<template>
  <UiField :label="label" :unit="unit ?? null">
    <input
      class="ui-range-field__slider"
      type="range"
      :value="value"
      :min="min"
      :max="max"
      :step="step"
      @input="onRange"
    />
    <UiInput
      type="number"
      :model-value="String(value)"
      :min="min"
      :max="max"
      :step="step"
      input-class="ui-range-field__number"
      @update:model-value="onNumber"
    />
  </UiField>
</template>

<style scoped>
.ui-range-field__slider {
  width: 100%;
  accent-color: var(--dagonizer-brand);
  cursor: pointer;
}

.ui-range-field__number {
  max-width: 96px;
  text-align: right;
}
</style>
