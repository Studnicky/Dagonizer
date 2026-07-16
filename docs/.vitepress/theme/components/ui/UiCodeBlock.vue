<script setup lang="ts">
const props = withDefaults(defineProps<{
  title?: string | null;
  meta?: string | null;
  code?: string | null;
  language?: string | null;
  tone?: 'default' | 'source' | 'error';
  collapsible?: boolean;
  open?: boolean;
}>(), {
  'title': null,
  'meta': null,
  'code': null,
  'language': null,
  'tone': 'default',
  'collapsible': false,
  'open': false,
});
</script>

<template>
  <details
    v-if="collapsible"
    class="ui-code-block ui-code-block--details"
    :class="[`ui-code-block--${tone}`]"
    :open="open"
  >
    <summary class="ui-code-block__summary">
      <div class="ui-code-block__header">
        <div class="ui-code-block__title-group">
          <span v-if="title" class="ui-code-block__title">{{ title }}</span>
          <span v-if="meta ?? language" class="ui-code-block__meta">{{ meta ?? language }}</span>
        </div>
      </div>
    </summary>
    <div class="ui-code-block__body">
      <slot>
        <pre v-if="code !== null"><code>{{ code }}</code></pre>
      </slot>
    </div>
  </details>

  <figure
    v-else
    class="ui-code-block"
    :class="[`ui-code-block--${tone}`]"
  >
    <header v-if="title || meta || language || $slots.actions" class="ui-code-block__header">
      <div class="ui-code-block__title-group">
        <span v-if="title" class="ui-code-block__title">{{ title }}</span>
        <span v-if="meta ?? language" class="ui-code-block__meta">{{ meta ?? language }}</span>
      </div>
      <div v-if="$slots.actions" class="ui-code-block__actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="ui-code-block__body">
      <slot>
        <pre v-if="code !== null"><code>{{ code }}</code></pre>
      </slot>
    </div>
  </figure>
</template>

<style scoped>
.ui-code-block {
  margin: 0;
  min-width: 0;
  border: var(--dagonizer-surface-border);
  border-radius: var(--dagonizer-surface-radius);
  background: var(--dagonizer-surface-bg-deep);
  background-image: var(--dagonizer-surface-grain);
  background-size: var(--dagonizer-surface-grain-size);
  overflow: hidden;
}

.ui-code-block--source {
  background: var(--vp-c-bg-soft);
}

.ui-code-block--error {
  border-left: 3px solid var(--dagonizer-violet);
}

.ui-code-block__header,
.ui-code-block__summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.7rem 0.9rem;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
}

.ui-code-block__summary {
  cursor: pointer;
  list-style: none;
}

.ui-code-block__summary::-webkit-details-marker { display: none; }

.ui-code-block__title-group {
  display: flex;
  align-items: baseline;
  gap: 0.65rem;
  min-width: 0;
}

.ui-code-block__title {
  font-family: var(--vp-font-family-display);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--dagonizer-silver);
}

.ui-code-block__meta {
  font-family: var(--vp-font-family-mono);
  font-size: 0.7rem;
  color: var(--vp-c-text-3);
}

.ui-code-block__body {
  min-width: 0;
}

.ui-code-block__body :deep(pre) {
  margin: 0;
  padding: 1rem;
  overflow: auto;
}

.ui-code-block__body :deep(code) {
  font-family: var(--vp-font-family-mono);
  font-size: 0.8rem;
}
</style>
