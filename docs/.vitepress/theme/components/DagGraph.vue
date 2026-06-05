<script setup lang="ts">
/**
 * DagGraph: thin Vue host for `AnimatedDagGraph`.
 *
 * Owns:
 *   - Dynamic cytoscape import + loading/error state.
 *   - DOM container ref (`dag-cy`) passed to the class constructor.
 *   - ResizeObserver that calls `graph.cy?.resize()` + `graph.applyFit()`.
 *   - `zoomLevel` reactive value for the D-pad zoom display.
 *   - DiagramFrame + GraphLegend + GraphDpad template.
 *
 * All animation, machine, camera, and adapter logic lives in
 * `AnimatedDagGraph`; this component is a plain host.
 */

import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';

import type { DAG } from '../../../../packages/dagonizer/src/entities/dag/DAG.js';

import DiagramFrame from './DiagramFrame.vue';
import GraphDpad from './graph/GraphDpad.vue';
import GraphLegend from './graph/GraphLegend.vue';
import type { LegendTab } from './graph/GraphLegend.vue';
import { AnimatedDagGraph } from './viz/AnimatedDagGraph.ts';
import type { DagVizEvent } from './viz/DagVizMachine.ts';

const props = defineProps<{
  dag: DAG;
  embeddedDAGs?: ReadonlyMap<string, DAG>;
  nodeKinds?: Readonly<Record<string, string>>;
  expandAll?: boolean;
  ariaLabel?: string;
}>();

const emit = defineEmits<{
  (event: 'node-click', name: string): void;
}>();

defineExpose({
  dispatch,
  setActive,
  setCompleted,
  setErrored,
  markEdgeTraversed,
  reset,
  fit,
  rerunLayout,
});

const containerRef = ref<HTMLDivElement | null>(null);
const diagramFrameRef = ref<InstanceType<typeof DiagramFrame> | null>(null);
const graph = shallowRef<AnimatedDagGraph | null>(null);
const loading = ref(true);
const loadError = ref<string | null>(null);
const zoomLevel = ref<number>(1);
let resizeObserver: ResizeObserver | null = null;

const dagLegendTabs: readonly LegendTab[] = [
  {
    key: 'kinds',
    label: 'Kinds',
    entries: [
      { key: 'deterministic',     swatch: 'solid',  color: '#22e8ff', label: 'deterministic' },
      { key: 'non-deterministic', swatch: 'dashed', color: '#7a6a9c', label: 'non-deterministic' },
    ],
  },
];

onMounted(async () => {
  let cytoscape: typeof import('cytoscape').default;
  try {
    const coreMod = await import('cytoscape');
    cytoscape = coreMod.default;
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
    loading.value = false;
    return;
  }
  loading.value = false;

  const container = containerRef.value;
  if (container === null) return;

  // Flush the `loading=false` update so v-show flips display:none→block
  // before cytoscape measures the container.
  await nextTick();

  const instance = new AnimatedDagGraph(cytoscape, container, props.dag, {
    embeddedDAGs: props.embeddedDAGs,
    nodeKinds:    props.nodeKinds,
    expandAll:    props.expandAll,
    onNodeClick:  (name) => { emit('node-click', name); },
    onZoomChange: (level) => { zoomLevel.value = level; },
  });

  await instance.mount();
  graph.value = instance;

  if (typeof ResizeObserver !== 'undefined' && container !== null) {
    resizeObserver = new ResizeObserver(() => {
      graph.value?.cy?.resize();
      graph.value?.applyFit();
    });
    resizeObserver.observe(container);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  graph.value?.destroy();
  graph.value = null;
});

// ── Event forwarding ─────────────────────────────────────────────────────

function dispatch(event: DagVizEvent): void {
  graph.value?.dispatch(event);
}

function setActive(node: string): void {
  graph.value?.setActive(node);
}

function setCompleted(node: string): void {
  graph.value?.setCompleted(node);
}

function setErrored(node: string): void {
  graph.value?.setErrored(node);
}

function markEdgeTraversed(source: string, route: string): void {
  graph.value?.markEdgeTraversed(source, route);
}

async function reset(): Promise<void> {
  await graph.value?.reset();
}

function fit(): void {
  graph.value?.applyFit();
}

function rerunLayout(): void {
  graph.value?.rerunLayout();
}

// ── D-pad handlers ────────────────────────────────────────────────────────

function zoomIn():    void { graph.value?.zoomIn(); }
function zoomOut():   void { graph.value?.zoomOut(); }
function panUp():     void { graph.value?.panUp(); }
function panDown():   void { graph.value?.panDown(); }
function panLeft():   void { graph.value?.panLeft(); }
function panRight():  void { graph.value?.panRight(); }
function centerView():void { graph.value?.centerView(); }
function fitScreen(): void { graph.value?.fitScreen(); }

function expandView(): void {
  void diagramFrameRef.value?.toggleFullscreen();
}

function onFrameResize(): void {
  graph.value?.cy?.resize();
  graph.value?.applyFit();
}
</script>

<template>
  <DiagramFrame
    ref="diagramFrameRef"
    title="DAG"
    :frameless="true"
    :aria-label="ariaLabel ?? 'DAG execution graph'"
    @resize="onFrameResize"
  >
    <div v-if="loading" class="dag-loading">Loading graph…</div>
    <div v-if="loadError" class="dag-error">Graph failed to load: {{ loadError }}</div>
    <div
      v-show="!loading && !loadError"
      ref="containerRef"
      class="dag-cy"
      :aria-label="ariaLabel ?? 'DAG execution graph'"
    ></div>

    <!-- Kind legend: bottom-left corner -->
    <GraphLegend
      v-if="!loading && !loadError"
      :tabs="dagLegendTabs"
      class="dag-legend-pos"
    />

    <!-- D-pad navigation: 3x3 grid anchored to the bottom-right corner -->
    <div v-if="!loading && !loadError" class="dag-dpad-pos">
      <GraphDpad
        :zoom-level="zoomLevel"
        :pan-enabled="true"
        expand-title="Fullscreen"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
        @pan-up="panUp"
        @pan-down="panDown"
        @pan-left="panLeft"
        @pan-right="panRight"
        @centre="centerView"
        @expand="expandView"
        @fit="fitScreen"
      />
    </div>
  </DiagramFrame>
</template>

<style scoped>
.dag-cy {
  width: 100%;
  height: 100%;
  min-height: 480px;
  background-color: var(--dagonizer-surface-bg-deep, var(--dagonizer-pearl, #020306));
  background-image: var(--dagonizer-surface-grain);
  background-size: var(--dagonizer-surface-grain-size, 160px 160px);
}

.dag-loading,
.dag-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
}

.dag-error { color: var(--dagonizer-brand3); }

/* Legend: bottom-left positioning anchor. */
.dag-legend-pos {
  position: absolute;
  bottom: 10px;
  left: 10px;
  z-index: 4;
}

/* D-pad: bottom-right positioning anchor. */
.dag-dpad-pos {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 5;
}
</style>
