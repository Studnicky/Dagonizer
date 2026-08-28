<script setup lang="ts">
defineProps<{
  align?: 'left' | 'center';
}>();
</script>

<template>
  <span class="ui-legend-title" :class="`ui-legend-title--${align ?? 'left'}`">
    <slot />
  </span>
</template>

<style scoped>
.ui-legend-title {
  font-family: var(--vp-font-family-mono);
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--vp-c-text-3);
  margin-bottom: 0.1rem;
}

.ui-legend-title--left { text-align: left; }
.ui-legend-title--center { text-align: center; }
</style>
