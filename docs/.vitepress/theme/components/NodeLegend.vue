<script setup lang="ts">
/**
 * NodeLegend: chip row labelling the two node variant values.
 *
 * Pure presentational. Mirrors the cytoscape stylesheet's selectors:
 * solid teal for deterministic, dashed violet for non-deterministic,
 * so the visitor can map graph borders to a category at a glance.
 */

interface LegendChip {
  readonly variant: 'deterministic' | 'non-deterministic';
  readonly label: string;
  readonly hint: string;
}

const chips: readonly LegendChip[] = [
  { variant: 'deterministic',     label: 'deterministic',     hint: 'same inputs → same outputs' },
  { variant: 'non-deterministic', label: 'non-deterministic', hint: 'LLM / web: output can vary' },
];
</script>

<template>
  <aside class="node-legend" aria-label="Node variant legend">
    <span class="node-legend-title">variants</span>
    <span
      v-for="chip in chips"
      :key="chip.variant"
      :class="['chip', `chip-${chip.variant}`]"
      :title="chip.hint"
    >{{ chip.label }}</span>
  </aside>
</template>

<style scoped>
.node-legend {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.3rem;
}

.node-legend-title {
  font-family: var(--vp-font-family-mono);
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--vp-c-text-3);
  text-align: center;
  margin-bottom: 0.1rem;
}

.chip {
  font-family: var(--vp-font-family-mono);
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.2rem 0.55rem;
  border-radius: 3px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  cursor: help;
  min-width: 90px;
  text-align: center;
  width: 100%;
  box-sizing: border-box;
}

.chip-deterministic {
  color: var(--dagonizer-brand);
  border-color: var(--dagonizer-brand);
}

.chip-non-deterministic {
  color: var(--dagonizer-brand2);
  border: 1px dashed var(--dagonizer-brand2);
}
</style>
