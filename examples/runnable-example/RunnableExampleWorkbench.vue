<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  leftLabel: string;
  rightLabel: string;
  leftHint?: string | null;
  rightHint?: string | null;
  secondaryWidth?: string;
}>(), {
  'leftHint': null,
  'rightHint': null,
  'secondaryWidth': '1.55fr',
});

const workbenchStyle = computed<Readonly<Record<string, string>>>(() => ({
  '--runnable-example-workbench-secondary-width': props.secondaryWidth,
}));
</script>

<template>
  <div class="runnable-example-workbench" :style="workbenchStyle" data-runnable-example-workbench>
    <div class="runnable-example-workbench__grid">
      <section class="runnable-example-workbench__column" data-runnable-example-region="left">
        <header class="runnable-example-workbench__header">
          <span class="runnable-example-workbench__label">{{ leftLabel }}</span>
          <div
            v-if="leftHint !== null || $slots['left-meta']"
            class="runnable-example-workbench__meta"
          >
            <span v-if="leftHint !== null" class="runnable-example-workbench__hint">{{ leftHint }}</span>
            <slot name="left-meta" />
          </div>
        </header>
        <div class="runnable-example-workbench__body">
          <slot name="left" />
        </div>
      </section>

      <section class="runnable-example-workbench__column" data-runnable-example-region="right">
        <header class="runnable-example-workbench__header">
          <span class="runnable-example-workbench__label">{{ rightLabel }}</span>
          <div
            v-if="rightHint !== null || $slots['right-meta']"
            class="runnable-example-workbench__meta"
          >
            <span v-if="rightHint !== null" class="runnable-example-workbench__hint">{{ rightHint }}</span>
            <slot name="right-meta" />
          </div>
        </header>
        <div class="runnable-example-workbench__body">
          <slot name="right" />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.runnable-example-workbench__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.25rem;
}

.runnable-example-workbench__column {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.75rem;
}

.runnable-example-workbench__header {
  display: flex;
  min-height: 1.75rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.runnable-example-workbench__label {
  color: var(--vp-c-text-3);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.runnable-example-workbench__meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  min-width: 0;
}

.runnable-example-workbench__hint {
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  font-size: 0.7rem;
}

.runnable-example-workbench__body {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

@container (min-width: 720px) {
  .runnable-example-workbench__grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, var(--runnable-example-workbench-secondary-width));
  }
}
</style>
