<script setup lang="ts">
import MarketingCard from './MarketingCard.vue';

withDefaults(defineProps<{
  interactive?: boolean;
  accent?: 'cyan' | 'violet' | 'gold';
}>(), {
  'interactive': false,
  'accent': 'cyan',
});
</script>

<template>
  <MarketingCard :interactive="interactive" :accent="accent" v-bind="$attrs">
    <slot />
  </MarketingCard>
</template>
