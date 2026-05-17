<script setup lang="ts">
/**
 * GraphLegend — shared bottom-left legend for any graph canvas.
 *
 * Accepts a `tabs` array so the same component renders:
 *   • DAG: a single "Kinds" tab with deterministic / non-deterministic entries.
 *   • Memory: a single "Layers" tab with the four named-graph layer entries,
 *     each clickable to toggle visibility. Emits `toggle(key)` when clicked.
 *
 * Entry swatch shapes:
 *   'solid'  — a solid filled square (default)
 *   'dashed' — an outlined square with a dashed border
 *   'square' — alias for 'solid'
 *   'circle' — a filled circle (pill border-radius)
 */

export interface LegendEntry {
  readonly key:    string;
  readonly swatch: 'solid' | 'dashed' | 'square' | 'circle';
  readonly color:  string;
  readonly label:  string;
  readonly active?: boolean;
}

export interface LegendTab {
  readonly key:     string;
  readonly label:   string;
  readonly entries: readonly LegendEntry[];
}

const props = withDefaults(defineProps<{
  tabs: readonly LegendTab[];
}>(), {});

const emit = defineEmits<{
  (event: 'toggle', key: string): void;
}>();

function isClickable(entry: LegendEntry): boolean {
  return entry.active !== undefined;
}
</script>

<template>
  <aside class="graph-legend" aria-label="Graph legend">
    <template v-for="tab in props.tabs" :key="tab.key">
      <span class="legend-title">{{ tab.label }}</span>
      <button
        v-for="entry in tab.entries"
        :key="entry.key"
        type="button"
        :class="[
          'legend-entry',
          { 'legend-entry--clickable': isClickable(entry) },
          { 'legend-entry--off': entry.active === false },
        ]"
        :style="{ '--entry-color': entry.color }"
        :aria-pressed="isClickable(entry) ? entry.active : undefined"
        :title="isClickable(entry) ? (entry.active ? `Hide ${entry.label}` : `Show ${entry.label}`) : entry.label"
        :disabled="!isClickable(entry)"
        @click="isClickable(entry) && emit('toggle', entry.key)"
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

.legend-title {
  font-family: var(--vp-font-family-mono);
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--vp-c-text-3);
  text-align: left;
  margin-bottom: 0.1rem;
  padding: 0;
  pointer-events: none;
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
