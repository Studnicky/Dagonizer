<script setup lang="ts">
withDefaults(defineProps<{
  padding?: 'md' | 'lg';
  fillHeight?: boolean;
  minHeight?: string | null;
}>(), {
  'padding': 'lg',
  'fillHeight': false,
  'minHeight': null,
});
</script>

<template>
  <section
    class="ui-pane-surface"
    :class="[
      `ui-pane-surface--${padding}`,
      { 'ui-pane-surface--fill-height': fillHeight },
    ]"
    :style="minHeight !== null ? { minHeight } : undefined"
  >
    <slot />
  </section>
</template>

<style scoped>
.ui-pane-surface {
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.ui-pane-surface--md {
  padding: 0.7rem 0.85rem;
}

.ui-pane-surface--lg {
  padding: 0.8rem 0.9rem;
}

.ui-pane-surface--fill-height {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
</style>
