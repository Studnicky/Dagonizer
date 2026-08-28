<script setup lang="ts">
import { computed } from 'vue';

import { LegendMachine } from '../../../../../packages/dagonizer/src/viz/LegendMachine.ts';
import UiLegendTitle from '../ui/UiLegendTitle.vue';

const props = withDefaults(defineProps<{
  machine: LegendMachine;
}>(), {});

const state = computed(() => props.machine.state());
</script>

<template>
  <aside class="graph-legend" aria-label="Graph legend">
    <template v-for="section in state.sections" :key="section.key">
      <UiLegendTitle>{{ section.label }}</UiLegendTitle>
      <button
        v-for="entry in section.entries"
        :key="entry.key"
        type="button"
        :class="[
          'legend-entry',
          { 'legend-entry--clickable': props.machine.isToggleable(entry) },
          { 'legend-entry--off': entry.active === false },
        ]"
        :style="{ '--entry-color': entry.color }"
        :aria-pressed="props.machine.isToggleable(entry) ? entry.active : undefined"
        :title="props.machine.isToggleable(entry) ? (entry.active ? `Hide ${entry.label}` : `Show ${entry.label}`) : entry.label"
        :disabled="!props.machine.isToggleable(entry)"
        @click="props.machine.isToggleable(entry) && props.machine.toggle(entry.key)"
      >
        <span
          :class="[
            'legend-swatch',
            `legend-swatch--${entry.swatch === 'square' ? 'solid' : entry.swatch}`,
          ]"
          :style="{ background: entry.swatch === 'dashed' ? 'transparent' : entry.color,
                    borderColor: entry.color,
                    borderStyle: entry.swatch === 'dashed' ? 'dashed' : 'solid' }"
          aria-hidden="true"
        ></span>
        <span class="legend-label">{{ entry.label }}</span>
      </button>
    </template>
  </aside>
</template>

<style scoped>
/* Position is set by the parent via absolute placement. */
.graph-legend {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  padding: 0.35rem 0.6rem;
  z-index: 4;
}

.legend-entry {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: transparent;
  border: none;
  padding: 0.1rem 0;
  cursor: default;
  font-family: var(--vp-font-family-mono);
  font-size: 0.65rem;
  color: var(--entry-color, var(--vp-c-text-2));
  white-space: nowrap;
  text-align: left;
  transition: opacity 0.12s ease;
}

.legend-entry--clickable {
  cursor: pointer;
}

.legend-entry--clickable:hover {
  opacity: 0.8;
}

.legend-entry--off {
  opacity: 0.4;
  filter: grayscale(0.6);
}

.legend-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border-width: 1.5px;
  flex-shrink: 0;
}

.legend-swatch--circle {
  border-radius: 50%;
}

.legend-swatch--dashed {
  background: transparent !important;
}
</style>
