<script setup lang="ts">
import Badge from './Badge.vue';
import type { BadgeSizeType, BadgeToneType } from './theme';

withDefaults(defineProps<{
  tone?: BadgeToneType;
  size?: BadgeSizeType;
  dashed?: boolean;
  interactive?: boolean;
}>(), {
  'tone': 'neutral',
  'size': 'sm',
});
</script>

<template>
  <Badge :tone="tone" :size="size" :dashed="dashed" :interactive="interactive">
    <slot />
  </Badge>
</template>
