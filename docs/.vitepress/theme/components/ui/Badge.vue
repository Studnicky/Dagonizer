<script setup lang="ts">
import { computed } from 'vue';

import type { BadgeSizeType, BadgeToneType } from './theme';

const props = withDefaults(defineProps<{
  tone?: BadgeToneType;
  size?: BadgeSizeType;
  dashed?: boolean;
  interactive?: boolean;
}>(), {
  'tone': 'neutral',
  'size': 'sm',
});

const classes = computed(() => [
  'dg-badge',
  `dg-badge--${props.tone}`,
  `dg-badge--${props.size}`,
  ...(props.dashed ? ['dg-badge--dashed'] : []),
  ...(props.interactive ? ['dg-badge--interactive'] : []),
]);
</script>

<template>
  <span :class="classes">
    <slot />
  </span>
</template>

<style scoped>
.dg-badge {
  --dg-badge-border: var(--vp-c-divider);
  --dg-badge-fill: color-mix(in srgb, var(--vp-c-bg-elv) 88%, transparent);
  --dg-badge-text: var(--vp-c-text-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 1px solid var(--dg-badge-border);
  border-radius: 999px;
  background: var(--dg-badge-fill);
  color: var(--dg-badge-text);
  font-family: var(--vp-font-family-mono);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
  transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease, transform 0.12s ease;
}

.dg-badge--sm {
  padding: 0.16rem 0.52rem;
  font-size: 0.66rem;
}

.dg-badge--md {
  padding: 0.22rem 0.62rem;
  font-size: 0.72rem;
}

.dg-badge--dashed {
  border-style: dashed;
}

.dg-badge--interactive:hover {
  transform: translateY(-1px);
}

.dg-badge--neutral {
  --dg-badge-border: var(--vp-c-divider);
  --dg-badge-fill: color-mix(in srgb, var(--vp-c-bg-elv) 90%, transparent);
  --dg-badge-text: var(--vp-c-text-3);
}

.dg-badge--info {
  --dg-badge-border: color-mix(in srgb, var(--dagonizer-brand2) 62%, var(--vp-c-divider));
  --dg-badge-fill: color-mix(in srgb, var(--dagonizer-brand2) 12%, transparent);
  --dg-badge-text: var(--dagonizer-brand2);
}

.dg-badge--success {
  --dg-badge-border: color-mix(in srgb, var(--dagonizer-brand) 65%, var(--vp-c-divider));
  --dg-badge-fill: color-mix(in srgb, var(--dagonizer-brand) 12%, transparent);
  --dg-badge-text: var(--dagonizer-brand);
}

.dg-badge--warning {
  --dg-badge-border: color-mix(in srgb, var(--dagonizer-brand3) 65%, var(--vp-c-divider));
  --dg-badge-fill: color-mix(in srgb, var(--dagonizer-brand3) 12%, transparent);
  --dg-badge-text: var(--dagonizer-brand3);
}

.dg-badge--danger {
  --dg-badge-border: color-mix(in srgb, #d04b43 65%, var(--vp-c-divider));
  --dg-badge-fill: color-mix(in srgb, #d04b43 12%, transparent);
  --dg-badge-text: #ff8f87;
}

.dg-badge--accent {
  --dg-badge-border: color-mix(in srgb, var(--dagonizer-cyan) 65%, var(--vp-c-divider));
  --dg-badge-fill: color-mix(in srgb, var(--dagonizer-cyan) 12%, transparent);
  --dg-badge-text: var(--dagonizer-cyan);
}
</style>
