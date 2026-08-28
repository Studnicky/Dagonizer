<script setup lang="ts">
import StateSurface from './StateSurface.vue';

withDefaults(defineProps<{
  kind?: 'empty' | 'loading' | 'error' | 'info';
}>(), {
  'kind': 'empty',
});
</script>

<template>
  <StateSurface :kind="kind">
    <slot />
  </StateSurface>
</template>
