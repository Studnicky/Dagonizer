<script setup lang="ts">
withDefaults(defineProps<{
  kind?: 'empty' | 'loading' | 'error' | 'info';
}>(), {
  'kind': 'empty',
});
</script>

<template>
  <div :class="['dg-state-surface', `dg-state-surface--${kind}`]">
    <slot />
  </div>
</template>

<style scoped>
.dg-state-surface {
  margin: auto 0;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: color-mix(in srgb, var(--vp-c-bg-alt) 84%, transparent);
  color: var(--vp-c-text-3);
  text-align: center;
  font-size: 0.78rem;
  line-height: 1.5;
}

.dg-state-surface--empty,
.dg-state-surface--loading {
  font-style: italic;
}

.dg-state-surface--loading {
  animation: dg-state-pulse 1.4s ease-in-out infinite;
}

.dg-state-surface--error {
  border-color: color-mix(in srgb, #d04b43 55%, var(--vp-c-divider));
  color: #ff8f87;
}

.dg-state-surface--info {
  color: var(--vp-c-text-2);
}

@keyframes dg-state-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
</style>
