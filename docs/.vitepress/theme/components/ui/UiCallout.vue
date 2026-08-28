<script setup lang="ts">
withDefaults(defineProps<{
  kind?: 'tip' | 'info' | 'warning' | 'danger' | 'details';
  title?: string | null;
}>(), {
  'kind': 'info',
  'title': null,
});
</script>

<template>
  <aside class="ui-callout" :class="[`ui-callout--${kind}`]">
    <div v-if="title || $slots.title" class="ui-callout__title">
      <slot name="title">{{ title }}</slot>
    </div>
    <div class="ui-callout__body">
      <slot />
    </div>
  </aside>
</template>

<style scoped>
.ui-callout {
  border: var(--dagonizer-surface-border);
  border-left-width: 3px;
  border-radius: var(--dagonizer-surface-radius);
  background-color: var(--dagonizer-surface-bg);
  background-image: var(--dagonizer-surface-grain);
  background-size: var(--dagonizer-surface-grain-size);
  padding: var(--dagonizer-surface-pad);
  margin: 1.5rem 0;
}

.ui-callout--tip { border-left-color: var(--dagonizer-cyan); }
.ui-callout--info { border-left-color: var(--dagonizer-seagreen); }
.ui-callout--warning { border-left-color: var(--dagonizer-gold); }
.ui-callout--danger { border-left-color: var(--dagonizer-violet); }
.ui-callout--details { border-left-color: var(--vp-c-divider); }

.ui-callout__title {
  font-family: var(--vp-font-family-display);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.78rem;
  color: var(--dagonizer-silver);
  margin-bottom: 0.4rem;
}

.ui-callout__body :deep(p:first-child) {
  margin-top: 0;
}

.ui-callout__body :deep(p:last-child) {
  margin-bottom: 0;
}
</style>
