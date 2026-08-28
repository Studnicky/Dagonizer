<script setup lang="ts">
import Badge from './ui/Badge.vue';
import UiLegendTitle from './ui/UiLegendTitle.vue';
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
    <UiLegendTitle align="center">variants</UiLegendTitle>
    <span
      v-for="chip in chips"
      :key="chip.variant"
      :title="chip.hint"
    ><Badge :tone="chip.variant === 'deterministic' ? 'accent' : 'info'" :dashed="chip.variant === 'non-deterministic'">{{ chip.label }}</Badge></span>
  </aside>
</template>

<style scoped>
.node-legend {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.3rem;
}

</style>
