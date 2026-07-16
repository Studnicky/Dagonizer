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

import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

import type { DAGType } from '../../../../packages/dagonizer/src/entities/dag/DAG.js';
import type { CytoscapeGraphOptionsType } from '../../../../packages/dagonizer/src/viz/CytoscapeGraph.ts';

import DiagramFrame from './DiagramFrame.vue';
import GraphDpad from './graph/GraphDpad.vue';
import GraphLegend from './graph/GraphLegend.vue';
import ViewerOverlay from './graph/ViewerOverlay.vue';
import { createCameraDpadMachine } from '../../../../packages/dagonizer/src/viz/CameraControls.ts';
import { createViewportStatus } from '../../../../packages/dagonizer/src/viz/ViewportStatus.ts';
import { dagNodeSelection } from '../../../../packages/dagonizer/src/viz/InspectSelection.ts';
import { LegendMachine } from '../../../../packages/dagonizer/src/viz/LegendMachine.ts';
import type { LegendSectionType } from '../../../../packages/dagonizer/src/viz/LegendMachine.ts';
import type { DagNodeSelectionType } from '../../../../packages/dagonizer/src/viz/InspectSelection.ts';
import { AnimatedDagGraph } from './viz/AnimatedDagGraph.ts';
import type { DagVizEvent } from './viz/DagVizMachine.ts';

const props = defineProps<{
  dag: DAGType;
  embeddedDAGs?: ReadonlyMap<string, DAGType>;
  nodeVariants?: Readonly<Record<string, string>>;
  expandAll?: boolean;
  idMode?: 'path' | 'iri';
  initialView?: 'fit' | 'readable';
  layoutOptions?: CytoscapeGraphOptionsType['layoutOptions'];
  ariaLabel?: string;
  selectedNode?: string | null;
}>();

const emit = defineEmits<{
  (event: 'node-click', name: string): void;
  (event: 'select', selection: DagNodeSelectionType): void;
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
const dpadMachine = createCameraDpadMachine({
  'can': () => graph.value !== null,
  'getZoomLevel': () => zoomLevel.value,
  'getHint': () => createViewportStatus(zoomLevel.value, 'inline', 'drag · wheel').hint,
  'zoomIn': zoomIn,
  'zoomOut': zoomOut,
  'pan': (direction) => {
    switch (direction) {
      case 'up':    panUp(); break;
      case 'down':  panDown(); break;
      case 'left':  panLeft(); break;
      case 'right': panRight(); break;
    }
  },
  'centre': centerView,
  'fit': fitScreen,
  'expand': expandView,
});

const dagLegendSections: readonly LegendSectionType[] = [
  {
    key: 'kinds',
    label: 'Kinds',
    entries: [
      { key: 'deterministic',     swatch: 'solid',  color: '#22e8ff', label: 'deterministic' },
      { key: 'non-deterministic', swatch: 'dashed', color: '#7a6a9c', label: 'non-deterministic' },
    ],
  },
];
const legendMachine = new LegendMachine({
  'getSections': () => dagLegendSections,
});

onMounted(async () => {
  // Probe cytoscape availability up-front so the loading/error UX can render
  // before mount. AnimatedDagGraph (via CytoscapeGraph) resolves the real
  // cytoscape runtime internally through Cytoscape.create's lazy import; the
  // probe only gates the UI and is not passed into the constructor.
  try {
    await import('cytoscape');
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

  const instance = new AnimatedDagGraph(container, props.dag, {
    ...(props.embeddedDAGs !== undefined ? { 'embeddedDAGs': props.embeddedDAGs } : {}),
    ...(props.nodeVariants    !== undefined ? { 'nodeVariants':    props.nodeVariants    } : {}),
    ...(props.expandAll    !== undefined ? { 'expandAll':    props.expandAll    } : {}),
    ...(props.idMode       !== undefined ? { 'idMode':       props.idMode       } : {}),
    ...(props.initialView  !== undefined ? { 'initialView':  props.initialView  } : {}),
    ...(props.layoutOptions !== undefined ? { 'layoutOptions': props.layoutOptions } : {}),
    'onNodeClick':  (name) => {
      emit('node-click', name);
      emit('select', dagNodeSelection(name));
    },
    'onZoomChange': (level) => { zoomLevel.value = level; },
  });

  await instance.mount();
  graph.value = instance;
  instance.setInspectedNode(props.selectedNode ?? null);

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

watch(() => props.selectedNode, (name) => {
  graph.value?.setInspectedNode(name ?? null);
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
    <ViewerOverlay
      v-if="loading"
      kind="loading"
      message="Loading graph…"
    />
    <ViewerOverlay
      v-else-if="loadError"
      kind="error"
      :message="`Graph failed to load: ${loadError}`"
    />
    <div
      v-show="!loading && !loadError"
      ref="containerRef"
      class="dag-cy"
      :aria-label="ariaLabel ?? 'DAG execution graph'"
    ></div>

    <!-- Kind legend: bottom-left corner -->
    <GraphLegend
      v-if="!loading && !loadError"
      :machine="legendMachine"
      class="dag-legend-pos"
    />

    <!-- D-pad navigation: 3x3 grid anchored to the bottom-right corner -->
    <div v-if="!loading && !loadError" class="dagonizer-dpad-anchor">
      <GraphDpad
        :machine="dpadMachine"
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

/* Legend: bottom-left positioning anchor. */
.dag-legend-pos {
  position: absolute;
  bottom: 10px;
  left: 10px;
  z-index: 4;
}

</style>
