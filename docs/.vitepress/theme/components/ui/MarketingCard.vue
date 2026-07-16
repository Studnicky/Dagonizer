<script setup lang="ts">
withDefaults(defineProps<{
  interactive?: boolean;
  accent?: 'cyan' | 'violet' | 'gold';
}>(), {
  'interactive': false,
  'accent': 'cyan',
});
</script>

<template>
  <component
    :is="$attrs.href ? 'a' : 'div'"
    :class="[
      'dg-marketing-card',
      `dg-marketing-card--${accent}`,
      interactive ? 'dg-marketing-card--interactive' : '',
    ]"
    v-bind="$attrs"
  >
    <slot />
  </component>
</template>

<style scoped>
.dg-marketing-card {
  position: relative;
  display: block;
  background-color: var(--dagonizer-surface-bg, var(--vp-c-bg-alt));
  background-image: var(--dagonizer-surface-grain);
  background-size: var(--dagonizer-surface-grain-size, 160px 160px);
  border: var(--dagonizer-surface-border, 1px solid var(--vp-c-divider));
  border-radius: var(--dagonizer-surface-radius, 6px);
  color: inherit;
  text-decoration: none;
  overflow: hidden;
  transition: border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}

.dg-marketing-card--interactive:hover {
  transform: translateY(-2px);
  box-shadow: 0 16px 35px -28px rgba(34, 232, 255, 0.4);
}

.dg-marketing-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px 0 0;
  background: linear-gradient(135deg, var(--dg-marketing-card-accent-a), var(--dg-marketing-card-accent-b));
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}

.dg-marketing-card--cyan {
  --dg-marketing-card-accent-a: var(--dagonizer-cyan);
  --dg-marketing-card-accent-b: var(--dagonizer-brand2);
}

.dg-marketing-card--violet {
  --dg-marketing-card-accent-a: var(--dagonizer-brand2);
  --dg-marketing-card-accent-b: var(--dagonizer-brand3);
}

.dg-marketing-card--gold {
  --dg-marketing-card-accent-a: var(--dagonizer-brand3);
  --dg-marketing-card-accent-b: var(--dagonizer-cyan);
}
</style>
