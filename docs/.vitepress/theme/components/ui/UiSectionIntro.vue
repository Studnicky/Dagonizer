<script setup lang="ts">
withDefaults(defineProps<{
  eyebrow?: string | null;
  title: string;
  lead?: string | null;
  summary?: string | null;
  variant?: 'standard' | 'display';
}>(), {
  'eyebrow': null,
  'lead': null,
  'summary': null,
  'variant': 'standard',
});
</script>

<template>
  <div class="ui-section-intro" :class="[`ui-section-intro--${variant}`]">
    <p v-if="eyebrow || $slots.eyebrow" class="ui-section-intro__eyebrow">
      <slot name="eyebrow">
        <span class="ui-section-intro__eyebrow-dot" aria-hidden="true"></span>{{ eyebrow }}
      </slot>
    </p>
    <h1 class="ui-section-intro__title">{{ title }}</h1>
    <p v-if="lead" class="ui-section-intro__lead">{{ lead }}</p>
    <p v-if="summary" class="ui-section-intro__summary">{{ summary }}</p>
    <div v-if="$slots.actions" class="ui-section-intro__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.ui-section-intro {
  min-width: 0;
}

.ui-section-intro__eyebrow,
.ui-section-intro__lead,
.ui-section-intro__summary,
.ui-section-intro__actions {
  margin: 0 0 1rem;
}

.ui-section-intro__eyebrow {
  color: var(--dagonizer-cyan);
  font: 700 0.68rem var(--vp-font-family-mono);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.ui-section-intro__eyebrow-dot {
  display: inline-block;
  width: 0.45rem;
  height: 0.45rem;
  margin-right: 0.5rem;
  border-radius: 50%;
  background: var(--dagonizer-cyan);
  box-shadow: 0 0 18px var(--dagonizer-cyan);
}

.ui-section-intro__title {
  margin: 0 0 1.3rem;
  color: var(--dagonizer-silver);
  font-family: var(--vp-font-family-display);
  line-height: 0.9;
  letter-spacing: -0.05em;
  border: 0;
  padding: 0;
}

.ui-section-intro--standard .ui-section-intro__title {
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 800;
}

.ui-section-intro--display .ui-section-intro__title {
  font-size: clamp(4rem, 9vw, 8rem);
  font-weight: 700;
  letter-spacing: -0.08em;
}

.ui-section-intro__lead {
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-display);
  font-weight: 600;
  letter-spacing: -0.03em;
}

.ui-section-intro--standard .ui-section-intro__lead {
  font-size: clamp(1.05rem, 2vw, 1.4rem);
  line-height: 1.4;
}

.ui-section-intro--display .ui-section-intro__lead {
  font-size: clamp(1.35rem, 2.4vw, 2rem);
}

.ui-section-intro__summary {
  color: var(--vp-c-text-2);
  line-height: 1.6;
  max-width: 60ch;
}

.ui-section-intro__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  padding-top: 0.5rem;
}
</style>
