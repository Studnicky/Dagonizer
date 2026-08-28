<script setup lang="ts">
import MarketingCard from './MarketingCard.vue';

withDefaults(defineProps<{
  icon?: string | null;
  title: string;
  details?: string | null;
  href?: string;
  accent?: 'cyan' | 'violet' | 'gold';
}>(), {
  'icon': null,
  'details': null,
  'accent': 'cyan',
});
</script>

<template>
  <MarketingCard
    :href="href"
    :interactive="href !== undefined"
    :accent="accent"
    class="ui-feature-callout"
  >
    <div v-if="icon" class="ui-feature-callout__icon" aria-hidden="true">{{ icon }}</div>
    <h3 class="ui-feature-callout__title">{{ title }}</h3>
    <p v-if="details" class="ui-feature-callout__details">{{ details }}</p>
    <slot />
  </MarketingCard>
</template>

<style scoped>
.ui-feature-callout {
  padding: 1.1rem 1.15rem;
}

.ui-feature-callout__icon {
  font-family: var(--vp-font-family-display);
  font-size: 1.6rem;
  color: var(--dagonizer-cyan, var(--vp-c-brand-1));
  margin-bottom: 0.35rem;
  line-height: 1;
}

.ui-feature-callout__title {
  margin: 0 0 0.35rem;
  color: var(--dagonizer-cyan, var(--vp-c-brand-1));
  font-family: var(--vp-font-family-display);
  font-size: 0.98rem;
  font-weight: 700;
}

.ui-feature-callout__details {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 0.85rem;
  line-height: 1.5;
}
</style>
