<script setup lang="ts">
import { computed } from 'vue';
import UiTabs, { type UiTabDef } from './ui/UiTabs.vue';

const props = defineProps<{
  tabs: readonly UiTabDef[];
  defaultKey?: string;
}>();

const tabsProps = computed(() => ({
  'tabs': props.tabs,
  ...(props.defaultKey !== undefined ? { 'defaultKey': props.defaultKey } : {}),
  'ariaLabel': 'Runner panes',
}));
</script>

<template>
  <UiTabs v-bind="tabsProps">
    <template v-if="$slots['tab-suffix']" #tab-suffix>
      <slot name="tab-suffix" />
    </template>
    <template
      v-for="tab in props.tabs"
      :key="tab.key"
      #[tab.key]
    >
      <slot :name="tab.key" />
    </template>
  </UiTabs>
</template>
