<script setup lang="ts">
withDefaults(defineProps<{
  tone?: 'muted' | 'accent' | 'default';
  size?: 'xs' | 'sm';
}>(), {
  'tone': 'muted',
  'size': 'sm',
});
</script>

<template>
  <span class="ui-meta-text" :class="[`ui-meta-text--${tone}`, `ui-meta-text--${size}`]">
    <slot />
  </span>
</template>

<style scoped>
.ui-meta-text {
  font-family: var(--vp-font-family-mono);
}

.ui-meta-text--xs { font-size: 0.62rem; }
.ui-meta-text--sm { font-size: 0.7rem; }

.ui-meta-text--muted { color: var(--vp-c-text-3); }
.ui-meta-text--accent { color: var(--dagonizer-brand2); }
.ui-meta-text--default { color: var(--vp-c-text-2); }
</style>
