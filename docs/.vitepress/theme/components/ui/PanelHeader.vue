<script setup lang="ts">
withDefaults(defineProps<{
  title: string;
  meta?: string | null;
  hint?: string | null;
  titleTag?: 'h3' | 'h4';
  variant?: 'plain' | 'band';
  accent?: 'default' | 'brand';
}>(), {
  'titleTag': 'h4',
  'variant': 'plain',
  'accent': 'default',
});
</script>

<template>
  <header class="dg-panel-header" :class="[`dg-panel-header--${variant}`, `dg-panel-header--${accent}`]">
    <div class="dg-panel-header__title-group">
      <component :is="titleTag" class="dg-panel-header__title">{{ title }}</component>
      <span v-if="hint" class="dg-panel-header__hint">{{ hint }}</span>
    </div>
    <div v-if="$slots.meta || meta" class="dg-panel-header__meta">
      <slot name="meta">{{ meta }}</slot>
    </div>
    <div v-if="$slots.actions" class="dg-panel-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.dg-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.75rem;
}

.dg-panel-header--plain {
  margin-bottom: 0.7rem;
}

.dg-panel-header--band {
  padding: 0.7rem 0.9rem;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
  margin-bottom: 0;
}

.dg-panel-header__title-group {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  min-width: 0;
  flex: 1 1 auto;
}

.dg-panel-header__title {
  margin: 0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--vp-c-text-3);
  flex-shrink: 0;
}

.dg-panel-header--brand .dg-panel-header__title {
  color: var(--dagonizer-cyan);
}

.dg-panel-header__hint,
.dg-panel-header__meta {
  font-family: var(--vp-font-family-mono);
  font-size: 0.68rem;
  color: var(--vp-c-text-3);
}

.dg-panel-header__hint {
  font-style: italic;
  min-width: 0;
}

.dg-panel-header__meta {
  white-space: nowrap;
}

.dg-panel-header__actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
</style>
