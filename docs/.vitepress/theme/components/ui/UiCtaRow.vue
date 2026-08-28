<script setup lang="ts">
defineProps<{
  gap?: 'sm' | 'md';
}>();
</script>

<template>
  <div class="ui-cta-row" :class="[`ui-cta-row--${gap ?? 'md'}`]">
    <slot />
  </div>
</template>

<style scoped>
.ui-cta-row {
  display: flex;
  flex-wrap: wrap;
  padding-top: 0.5rem;
}

.ui-cta-row--sm { gap: 0.5rem; }
.ui-cta-row--md { gap: 0.6rem; }
</style>
