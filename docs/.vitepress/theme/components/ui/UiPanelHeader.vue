<script setup lang="ts">
import { computed } from 'vue';
import PanelHeader from './PanelHeader.vue';

const props = defineProps<{
  title: string;
  meta?: string | null;
  hint?: string | null;
  titleTag?: 'h3' | 'h4';
  variant?: 'plain' | 'band';
  accent?: 'default' | 'brand';
}>();

const headerProps = computed(() => ({
  'title': props.title,
  ...(props.meta !== undefined ? { 'meta': props.meta } : {}),
  ...(props.hint !== undefined ? { 'hint': props.hint } : {}),
  ...(props.titleTag !== undefined ? { 'titleTag': props.titleTag } : {}),
  ...(props.variant !== undefined ? { 'variant': props.variant } : {}),
  ...(props.accent !== undefined ? { 'accent': props.accent } : {}),
}));
</script>

<template>
  <PanelHeader v-bind="headerProps">
    <template v-if="$slots.meta" #meta>
      <slot name="meta" />
    </template>
    <template v-if="$slots.actions" #actions>
      <slot name="actions" />
    </template>
  </PanelHeader>
</template>
