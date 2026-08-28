<script setup lang="ts">
import { computed } from 'vue';
import UiTabs, { type UiTabDef } from './UiTabs.vue';

const props = defineProps<{
  tabs: readonly UiTabDef[];
  defaultKey?: string;
  ariaLabel?: string;
}>();

const tabsProps = computed(() => ({
  'tabs': props.tabs,
  ...(props.defaultKey !== undefined ? { 'defaultKey': props.defaultKey } : {}),
  ...(props.ariaLabel !== undefined ? { 'ariaLabel': props.ariaLabel } : {}),
}));
</script>

<template>
  <UiTabs
    v-bind="tabsProps"
    class="ui-code-tabs"
  >
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

<style scoped>
.ui-code-tabs {
  min-height: 0;
}

.ui-code-tabs :deep(.ui-tabs__row) {
  background: var(--vp-c-bg-soft);
}

.ui-code-tabs :deep(.ui-tabs__pane > *) {
  background: transparent;
}
</style>
