<script setup lang="ts">
/**
 * StateLegend — five chips showing the DAG's visual states.
 *
 *   pending · active · completed · errored · traversed-edge
 *
 * Each chip mirrors the exact colour pair the cytoscape stylesheet
 * applies, so the legend stays truthful even if the user re-themes.
 * The `active` chip pulses to match the cytoscape pulse animation;
 * `errored` jitters to match the shake.
 */

interface StateChip {
  readonly key: 'pending' | 'active' | 'completed' | 'errored' | 'traversed';
  readonly label: string;
  readonly hint: string;
}

const chips: readonly StateChip[] = [
  { key: 'pending',    label: 'pending',    hint: 'Awaiting dispatch.' },
  { key: 'active',     label: 'active',     hint: 'Currently executing; pulses while running.' },
  { key: 'completed',  label: 'completed',  hint: 'Finished successfully.' },
  { key: 'errored',    label: 'errored',    hint: 'Threw or returned an error route.' },
  { key: 'traversed',  label: 'traversed →', hint: 'Edge taken by the dispatcher; flashes on traversal.' },
];
</script>

<template>
  <aside class="state-legend" aria-label="DAG state legend">
    <span class="state-legend-title">states</span>
    <span
      v-for="chip in chips"
      :key="chip.key"
      :class="['state-chip', `state-chip-${chip.key}`]"
      :title="chip.hint"
    >{{ chip.label }}</span>
  </aside>
</template>

<style scoped>
.state-legend {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.3rem;
}

.state-legend-title {
  font-family: var(--vp-font-family-mono);
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--vp-c-text-3);
  text-align: center;
  margin-bottom: 0.1rem;
}

.state-chip {
  font-family: var(--vp-font-family-mono);
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.22rem 0.55rem;
  border-radius: 4px;
  border: 1px solid var(--vp-c-divider);
  cursor: help;
  line-height: 1;
  min-width: 90px;
  text-align: center;
  width: 100%;
  box-sizing: border-box;
}

/* Mirror the DagGraph cytoscape stylesheet exactly. */
.state-chip-pending {
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-divider);
}

.state-chip-active {
  background: #22e8ff;
  color: #04141c;
  border-color: #22e8ff;
  box-shadow: 0 0 0 0 rgba(34, 232, 255, 0.6);
  animation: chip-pulse 1.4s ease-in-out infinite;
}

.state-chip-completed {
  background: #0e8a99;
  color: #eafcff;
  border-color: #22e8ff;
}

.state-chip-errored {
  background: #d4a649;
  color: #1a1410;
  border-color: #7a5a1c;
  animation: chip-shake 1.6s ease-in-out infinite;
}

.state-chip-traversed {
  background: transparent;
  color: #22e8ff;
  border: 1px solid #22e8ff;
  border-radius: 999px;
}

@keyframes chip-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34, 232, 255, 0.55); }
  50%      { box-shadow: 0 0 0 6px rgba(34, 232, 255, 0); }
}

@keyframes chip-shake {
  0%, 100% { transform: translateX(0); }
  20%      { transform: translateX(-1px); }
  40%      { transform: translateX(1px); }
  60%      { transform: translateX(-0.5px); }
  80%      { transform: translateX(0.5px); }
}
</style>
