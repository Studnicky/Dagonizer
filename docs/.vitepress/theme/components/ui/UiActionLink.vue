<script setup lang="ts">
withDefaults(defineProps<{
  href: string;
  variant?: 'brand' | 'alt' | 'pill';
}>(), {
  'variant': 'brand',
});
</script>

<template>
  <a
    :href="href"
    class="ui-action-link"
    :class="[`ui-action-link--${variant}`]"
  >
    <slot />
  </a>
</template>

<style scoped>
.ui-action-link {
  display: inline-block;
  text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.2s ease, box-shadow 0.2s ease;
}

.ui-action-link--brand,
.ui-action-link--alt {
  padding: 0.6rem 1.2rem;
  font-weight: 600;
  font-size: 0.9rem;
  border: 1px solid transparent;
  border-radius: var(--dagonizer-surface-radius, 6px);
}

.ui-action-link--brand {
  background: var(--dagonizer-cyan, var(--vp-c-brand-1));
  color: var(--dagonizer-pearl, var(--vp-c-bg));
}

.ui-action-link--brand:hover {
  background: var(--dagonizer-gold, var(--vp-c-brand-2));
  color: var(--dagonizer-pearl, var(--vp-c-bg));
}

.ui-action-link--alt {
  background: transparent;
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-divider);
}

.ui-action-link--alt:hover {
  border-color: var(--dagonizer-gold, var(--vp-c-brand-2));
  color: var(--dagonizer-gold, var(--vp-c-brand-2));
  background: rgba(212, 166, 73, 0.08);
}

.ui-action-link--pill {
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  padding: 0.8rem 1.35rem;
  color: var(--vp-c-text-1);
}

.ui-action-link--pill:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 30px -18px var(--dagonizer-cyan);
}

.ui-action-link--pill.ui-action-link--brand,
.ui-action-link--pill[data-variant="brand"] {
  background: var(--dagonizer-cyan);
  color: var(--dagonizer-pearl);
  border-color: transparent;
}
</style>
