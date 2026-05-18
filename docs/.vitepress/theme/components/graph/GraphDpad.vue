<script setup lang="ts">
/**
 * GraphDpad — shared 3×3 D-pad navigation control for any graph canvas.
 *
 * Layout (row-major, 3 cols × 3 rows):
 *   [zoom-in ] [pan-up  ] [zoom-out]
 *   [pan-left] [centre  ] [pan-right]
 *   [expand  ] [pan-down] [fit     ]
 *
 * When `zoomLevel` is provided a small readout is rendered above the D-pad
 * (e.g. "1.0×") — this is the zoom indicator ported from MemoryGraph.
 *
 * Pan buttons can be hidden via `:pan-enabled="false"` when the underlying
 * canvas (e.g. cosmos.gl) does not expose a first-class pan API.
 */

withDefaults(defineProps<{
  zoomLevel?: number;
  panEnabled?: boolean;
}>(), {
  zoomLevel: undefined,
  panEnabled: true,
});

const emit = defineEmits<{
  (event: 'zoom-in'):    void;
  (event: 'zoom-out'):   void;
  (event: 'pan-up'):     void;
  (event: 'pan-down'):   void;
  (event: 'pan-left'):   void;
  (event: 'pan-right'):  void;
  (event: 'centre'):     void;
  (event: 'expand'):     void;
  (event: 'fit'):        void;
}>();
</script>

<template>
  <div class="graph-dpad-wrap" aria-label="Graph navigation controls">
    <!-- Zoom level readout — shown only when the parent provides a level -->
    <aside v-if="zoomLevel !== undefined" class="graph-zoom-hud" aria-live="polite">
      <span class="graph-zoom-level">{{ zoomLevel.toFixed(2) }}×</span>
      <span class="graph-zoom-hint">drag · wheel</span>
    </aside>

    <!-- 3×3 D-pad grid -->
    <div class="graph-dpad" aria-label="Navigation D-pad">
      <!-- Row 1 -->
      <button class="dpad-btn" title="Zoom in"     @click="emit('zoom-in')">＋</button>
      <button
        class="dpad-btn"
        :class="{ 'dpad-btn--disabled': !panEnabled }"
        :disabled="!panEnabled"
        title="Pan up"
        @click="panEnabled && emit('pan-up')"
      >▲</button>
      <button class="dpad-btn" title="Zoom out"    @click="emit('zoom-out')">－</button>

      <!-- Row 2 -->
      <button
        class="dpad-btn"
        :class="{ 'dpad-btn--disabled': !panEnabled }"
        :disabled="!panEnabled"
        title="Pan left"
        @click="panEnabled && emit('pan-left')"
      >◀</button>
      <button class="dpad-btn" title="Centre view" @click="emit('centre')">⊙</button>
      <button
        class="dpad-btn"
        :class="{ 'dpad-btn--disabled': !panEnabled }"
        :disabled="!panEnabled"
        title="Pan right"
        @click="panEnabled && emit('pan-right')"
      >▶</button>

      <!-- Row 3 -->
      <button class="dpad-btn" title="Expand zoom" @click="emit('expand')">⛶</button>
      <button
        class="dpad-btn"
        :class="{ 'dpad-btn--disabled': !panEnabled }"
        :disabled="!panEnabled"
        title="Pan down"
        @click="panEnabled && emit('pan-down')"
      >▼</button>
      <button class="dpad-btn" title="Fit to view" @click="emit('fit')">⤢</button>
    </div>
  </div>
</template>

<style scoped>
/* Wrap — stacks zoom HUD above D-pad, anchored bottom-right by parent. */
.graph-dpad-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

/* Zoom HUD — identical to the MemoryGraph mg-hud styling. */
.graph-zoom-hud {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.3rem 0.6rem;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.7rem;
  color: var(--vp-c-text-2);
  pointer-events: none;
}

.graph-zoom-level {
  color: var(--dagonizer-brand2);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.graph-zoom-hint {
  color: var(--vp-c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.62rem;
}

/* D-pad — 3×3 grid, identical to the dag-dpad styling. */
.graph-dpad {
  display: grid;
  grid-template-columns: repeat(3, 32px);
  grid-template-rows: repeat(3, 32px);
  gap: 4px;
  background: rgba(0, 0, 0, 0.30);
  padding: 6px;
  border-radius: 8px;
  backdrop-filter: blur(4px);
}

.dpad-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  padding: 0;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  line-height: 1;
}

.dpad-btn:hover:not(:disabled) {
  background: var(--vp-c-bg);
  border-color: var(--dagonizer-brand);
  color: var(--dagonizer-brand);
}

.dpad-btn:focus-visible {
  outline: 2px solid var(--dagonizer-brand);
  outline-offset: 1px;
}

.dpad-btn--disabled,
.dpad-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
