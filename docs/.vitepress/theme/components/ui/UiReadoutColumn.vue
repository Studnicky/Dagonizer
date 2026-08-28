<script setup lang="ts">
withDefaults(defineProps<{
  title: string;
  tone?: 'default' | 'brand';
  muted?: boolean;
}>(), {
  'tone': 'default',
  'muted': false,
});
</script>

<template>
  <section
    class="ui-readout-column"
    :class="[
      `ui-readout-column--${tone}`,
      { 'ui-readout-column--muted': muted },
    ]"
  >
    <header class="ui-readout-column__head">{{ title }}</header>
    <div class="ui-readout-column__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.ui-readout-column {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  min-width: 0;
  border-left-width: 2px;
  border-left-color: var(--vp-c-text-3);
}

.ui-readout-column--brand {
  border-left-color: var(--dagonizer-brand);
}

.ui-readout-column--muted {
  opacity: 0.85;
}

.ui-readout-column__head {
  font-size: 0.63rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--vp-c-divider);
  margin-bottom: 0.1rem;
}

.ui-readout-column--brand .ui-readout-column__head {
  color: var(--dagonizer-brand);
}

.ui-readout-column__body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}
</style>
