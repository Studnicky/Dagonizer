<script setup lang="ts">
import type { ViewerActionType, ViewerActionVariantType } from '../../../../../packages/dagonizer/src/viz/ViewerActions.ts';

const props = withDefaults(defineProps<{
  actions: readonly ViewerActionType[];
  variant?: ViewerActionVariantType;
}>(), {
  'variant': 'header',
});

const emit = defineEmits<{
  (event: 'action', id: ViewerActionType['id']): void;
}>();
</script>

<template>
  <div
    class="dagonizer-viewer-actions"
    :class="{ 'dagonizer-viewer-actions--overlay': variant === 'overlay' }"
  >
    <button
      v-for="action in props.actions"
      :key="action.id"
      class="dagonizer-viewer-action"
      :class="{ 'dagonizer-viewer-action--danger': action.tone === 'danger' }"
      type="button"
      :title="action.title"
      :aria-label="action.ariaLabel ?? action.title"
      :aria-pressed="action.pressed"
      :disabled="action.disabled === true"
      @click="emit('action', action.id)"
    >{{ action.label }}</button>
  </div>
</template>
