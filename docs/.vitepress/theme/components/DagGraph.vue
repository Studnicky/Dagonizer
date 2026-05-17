<script setup lang="ts">
/**
 * DagGraph — cytoscape host for live DAG visualisation, driven by an
 * explicit `DagVizMachine`. The runner's observer dispatches lifecycle
 * events (`NODE_START` / `NODE_END` / `NODE_ERROR` / `EDGE_TRAVERSE` /
 * `RESET`) into this component's machine, which routes them to per-node
 * and per-edge FSMs. Entry actions on each FSM transition apply
 * cytoscape class changes and play short cytoscape animations.
 *
 * Stylesheet uses contrast-safe pairs:
 *   • brand teal background → near-black text (AAA on both light/dark themes)
 *   • brand violet bg       → near-white text (AA-large, AAA-large)
 *   • brand gold bg         → near-black text (AAA)
 *
 * Edge labels use brand2 text on an opaque dark pill so they're
 * readable against any underlying edge / theme background.
 */

import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import type { Core, ElementDefinition, EdgeCollection, NodeSingular } from 'cytoscape';

import DiagramFrame from './DiagramFrame.vue';
import { DagVizMachine, type DagVizEvent } from './viz/DagVizMachine.ts';
import type { EdgeVizAdapter } from './viz/EdgeVizMachine.ts';
import type { NodeVizAdapter } from './viz/NodeVizMachine.ts';

const props = defineProps<{
  elements: ElementDefinition[];
  ariaLabel?: string;
}>();

defineExpose({
  dispatch,
  // Backwards-compat thin wrappers so the existing runner keeps working.
  setActive,
  setCompleted,
  setErrored,
  markEdgeTraversed,
  reset,
  fit,
  rerunLayout,
});

const containerRef = ref<HTMLDivElement | null>(null);
const cy = shallowRef<Core | null>(null);
const machine = shallowRef<DagVizMachine | null>(null);
const loading = ref(true);
const loadError = ref<string | null>(null);
let resizeObserver: ResizeObserver | null = null;

onMounted(async () => {
  let cytoscape: typeof import('cytoscape').default;
  try {
    const [coreMod, dagreMod] = await Promise.all([
      import('cytoscape'),
      import('cytoscape-dagre'),
    ]);
    cytoscape = coreMod.default;
    cytoscape.use(dagreMod.default);
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

  cy.value = cytoscape({
    container,
    elements: props.elements,
    style: dagStylesheet(),
    layout: dagLayout(),
    // Nodes are grabbable by default — visitors can drag, pan, zoom,
    // shift-drag to box-select, and additively click to multi-select.
    userPanningEnabled: true,
    userZoomingEnabled: true,
    boxSelectionEnabled: true,
    selectionType: 'additive',
    wheelSensitivity: 0.25,
  });

  machine.value = new DagVizMachine({
    nodeAdapter: (id) => makeNodeAdapter(cy.value, id),
    edgeAdapter: (source, route) => makeEdgeAdapter(cy.value, source, route),
    resetAll: () => {
      cy.value?.elements().removeClass('dag-active dag-completed dag-errored dag-traversed');
      cy.value?.elements().stop(true, true);
    },
  });

  cy.value.one('layoutstop', () => {
    cy.value?.fit(undefined, 40);
    requestAnimationFrame(() => {
      const fitZoom = cy.value?.zoom() ?? 1;
      cy.value?.minZoom(fitZoom * 0.4);
      cy.value?.maxZoom(fitZoom * 4);
    });
  });

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      cy.value?.resize();
      cy.value?.fit(undefined, 40);
    });
    resizeObserver.observe(container);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  cy.value?.destroy();
  cy.value = null;
  machine.value = null;
});

async function waitForContainerSize(el: HTMLElement): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

// ── Public dispatch surface ──────────────────────────────────────────────

function dispatch(event: DagVizEvent): void {
  machine.value?.dispatch(event);
}

function setActive(node: string):     void { dispatch({ type: 'NODE_START', node }); }
function setCompleted(node: string):  void { dispatch({ type: 'NODE_END',   node }); }
function setErrored(node: string):    void { dispatch({ type: 'NODE_ERROR', node }); }
function markEdgeTraversed(source: string, route: string): void {
  dispatch({ type: 'EDGE_TRAVERSE', source, route });
}
function reset(): void { dispatch({ type: 'RESET' }); }

function fit(): void { cy.value?.fit(undefined, 40); }

function onFrameResize(): void {
  cy.value?.resize();
  cy.value?.fit(undefined, 40);
}

function rerunLayout(): void {
  if (cy.value === null) return;
  const layout = cy.value.layout(dagLayout());
  layout.run();
  cy.value.one('layoutstop', () => cy.value?.fit(undefined, 40));
}

function zoomIn(): void {
  const next = (cy.value?.zoom() ?? 1) * 1.25;
  cy.value?.zoom({
    level: Math.min(next, cy.value.maxZoom()),
    renderedPosition: { x: cy.value.width() / 2, y: cy.value.height() / 2 },
  });
}

function zoomOut(): void {
  const next = (cy.value?.zoom() ?? 1) / 1.25;
  cy.value?.zoom({
    level: Math.max(next, cy.value.minZoom()),
    renderedPosition: { x: cy.value.width() / 2, y: cy.value.height() / 2 },
  });
}

function panUp():    void { cy.value?.panBy({ x: 0,   y: 80 }); }
function panDown():  void { cy.value?.panBy({ x: 0,   y: -80 }); }
function panLeft():  void { cy.value?.panBy({ x: 80,  y: 0 }); }
function panRight(): void { cy.value?.panBy({ x: -80, y: 0 }); }

function centerView(): void { cy.value?.center(); }

function expandZoom(): void {
  const next = (cy.value?.zoom() ?? 1) * 1.6;
  cy.value?.zoom({
    level: Math.min(next, cy.value?.maxZoom() ?? next),
    renderedPosition: { x: (cy.value?.width() ?? 0) / 2, y: (cy.value?.height() ?? 0) / 2 },
  });
}

function fitScreen(): void { cy.value?.fit(undefined, 40); }

// ── Adapters — the only place that touches cytoscape from the FSM. ───────

function makeNodeAdapter(cy: Core | null, id: string): NodeVizAdapter {
  return {
    addClass(name)    { cy?.$id(id).addClass(name); },
    removeClass(name) { cy?.$id(id).removeClass(name); },
    stop()            { cy?.$id(id).stop(true, true); },
    pulse() {
      const node = cy?.$id(id) as NodeSingular | undefined;
      if (node === undefined || node.length === 0) return;
      void node.animate(
        { style: { 'overlay-color': '#22e8ff', 'overlay-opacity': 0.55, 'overlay-padding': 18 } },
        { duration: 280 },
      ).animate(
        { style: { 'overlay-opacity': 0, 'overlay-padding': 0 } },
        { duration: 360 },
      );
    },
    shake() {
      const node = cy?.$id(id) as NodeSingular | undefined;
      if (node === undefined || node.length === 0) return;
      const pos = node.position();
      void node
        .animate({ position: { x: pos.x - 7, y: pos.y } }, { duration: 70 })
        .animate({ position: { x: pos.x + 7, y: pos.y } }, { duration: 70 })
        .animate({ position: { x: pos.x - 4, y: pos.y } }, { duration: 60 })
        .animate({ position: { x: pos.x,     y: pos.y } }, { duration: 60 });
    },
  };
}

function makeEdgeAdapter(cy: Core | null, source: string, route: string): EdgeVizAdapter {
  const selector = `edge[source = "${source}"][route = "${route}"]`;
  return {
    addClass(name)    { (cy?.edges(selector) as EdgeCollection | undefined)?.addClass(name); },
    removeClass(name) { (cy?.edges(selector) as EdgeCollection | undefined)?.removeClass(name); },
    stop()            { (cy?.edges(selector) as EdgeCollection | undefined)?.stop(true, true); },
    flash() {
      const edges = cy?.edges(selector) as EdgeCollection | undefined;
      if (edges === undefined || edges.length === 0) return;
      // Width + glow flash. Two animate calls in sequence; cytoscape
      // chains them via `.animate(...).animate(...)`.
      void edges.animate(
        { style: { 'width': 6, 'line-color': '#22e8ff', 'target-arrow-color': '#22e8ff' } },
        { duration: 220 },
      ).animate(
        { style: { 'width': 3 } },
        { duration: 320 },
      );
    },
  };
}

// ── Layout + stylesheet ──────────────────────────────────────────────────

function dagLayout(): Record<string, unknown> {
  // Dagre — directed-acyclic flowchart layout. Entrypoint sits at the
  // top, terminals at the bottom, arrows always flow downward. Nodes
  // never overlap because dagre measures ranks then packs them.
  return {
    name: 'dagre',
    rankDir: 'TB',          // top → bottom
    align: 'UL',
    rankSep: 90,            // vertical gap between ranks
    nodeSep: 60,            // horizontal gap between siblings in same rank
    edgeSep: 30,
    ranker: 'tight-tree',
    fit: true,
    padding: 40,
    animate: false,
    nodeDimensionsIncludeLabels: true,
  };
}

// Contrast pairs — every fill colour is paired with a text colour that
// reaches WCAG AAA against it on both light and dark themes.
//
//   teal #22e8ff  →  text #04141c (very-dark navy)
//   violet #9b51e0 → text #ffffff
//   gold #d4a649  →  text #1a1410 (very-dark)
//   default bg-alt → text-1 (theme-driven, already AAA)
function dagStylesheet(): unknown[] {
  return [
    { selector: 'node', style: {
      'background-color': 'var(--vp-c-bg-alt)',
      'border-color': 'var(--vp-c-divider)',
      'border-width': 1.5,
      'color': 'var(--vp-c-text-1)',
      'label': 'data(label)',
      'font-family': 'var(--vp-font-family-mono)',
      'font-size': 15,
      'font-weight': 700,
      'text-halign': 'center',
      'text-valign': 'center',
      'text-wrap': 'wrap',
      'text-max-width': '200px',
      'text-outline-color': 'var(--vp-c-bg)',
      'text-outline-width': 1,
      'text-outline-opacity': 0.8,
      'padding': '16px',
      'width': 'label',
      'height': 'label',
      'shape': 'round-rectangle',
      'transition-property': 'border-color, border-width, background-color, color',
      'transition-duration': 220,
    } },
    { selector: 'node[type="fan-out"]',  style: { 'shape': 'hexagon' } },
    { selector: 'node[type="parallel"]', style: {
      'shape': 'round-rectangle',
      'background-color': 'rgba(155, 81, 224, 0.08)',
      'background-opacity': 1,
      'border-color': '#9b51e0',
      'border-width': 2,
      'border-style': 'dashed',
      'text-valign': 'top',
      'text-halign': 'center',
      'text-margin-y': -6,
      'padding': '24px',
      'font-size': 12,
      'color': '#c89bff',
    } },
    { selector: 'node[type="sub-dag"]',  style: { 'shape': 'cut-rectangle' } },
    { selector: 'node[type="terminal"]', style: { 'shape': 'round-rectangle', 'background-color': 'var(--vp-c-bg-elv)', 'border-color': '#d4a649' } },
    // Compound-graph children inside a parallel — slightly indented look.
    { selector: 'node:parent', style: {
      'shape': 'round-rectangle',
      'background-color': 'rgba(155, 81, 224, 0.06)',
      'border-color': '#9b51e0',
      'border-style': 'dashed',
      'border-width': 2,
      'text-valign': 'top',
    } },

    // Kind-tagged styling — solid teal border for deterministic, dashed
    // violet for non-deterministic. Mirrors the NodeLegend chip colors.
    { selector: 'node[kind="deterministic"]', style: {
      'border-color': '#22e8ff',
      'border-style': 'solid',
      'border-width': 2,
    } },
    { selector: 'node[kind="non-deterministic"]', style: {
      'border-color': '#9b51e0',
      'border-style': 'dashed',
      'border-width': 2.5,
    } },

    // State styling — LOUD solid fills with paired AAA-contrast text.
    { selector: 'node.dag-active', style: {
      'background-color': '#22e8ff',
      'border-color': '#22e8ff',
      'border-width': 4,
      'color': '#04141c',
      'text-outline-color': '#22e8ff',
      'text-outline-width': 2,
      'text-outline-opacity': 1,
    } },
    { selector: 'node.dag-completed', style: {
      'background-color': '#0e8a99',
      'border-color': '#22e8ff',
      'border-width': 3,
      'color': '#eafcff',
      'text-outline-color': '#0e8a99',
      'text-outline-width': 2,
      'text-outline-opacity': 1,
    } },
    { selector: 'node.dag-errored', style: {
      'background-color': '#d4a649',
      'border-color': '#7a5a1c',
      'border-width': 4,
      'color': '#1a1410',
      'text-outline-color': '#d4a649',
      'text-outline-width': 2,
      'text-outline-opacity': 1,
    } },
    { selector: 'node:selected', style: { 'border-color': '#22e8ff', 'border-width': 4 } },

    // Edges — labels on dark pill, brand-violet text so they pop against
    // both light and dark themes.
    { selector: 'edge', style: {
      'curve-style': 'bezier',
      'line-color': 'var(--vp-c-divider)',
      'target-arrow-color': 'var(--vp-c-divider)',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 1.3,
      'label': 'data(label)',
      'font-family': 'var(--vp-font-family-mono)',
      'font-size': 13,
      'font-weight': 600,
      'color': '#c89bff',
      'text-background-color': '#0c0a14',
      'text-background-opacity': 0.96,
      'text-background-padding': '5px',
      'text-background-shape': 'round-rectangle',
      'text-border-color': '#9b51e0',
      'text-border-width': 1,
      'text-border-opacity': 0.7,
      'text-margin-y': -3,
      'width': 1.8,
      'transition-property': 'line-color, target-arrow-color, width',
      'transition-duration': 220,
    } },
    { selector: 'edge.dag-traversed', style: {
      'line-color': '#22e8ff',
      'target-arrow-color': '#22e8ff',
      'width': 3,
      'color': '#22e8ff',
      'text-border-color': '#22e8ff',
    } },
  ];
}
</script>

<template>
  <DiagramFrame
    title="DAG"
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

    <!-- D-pad navigation — 3×3 grid anchored to the right-centre of the canvas -->
    <div class="dag-dpad" aria-label="DAG navigation controls">
      <button class="dpad-btn" title="Zoom in"      @click="zoomIn">＋</button>
      <button class="dpad-btn" title="Pan up"        @click="panUp">▲</button>
      <button class="dpad-btn" title="Zoom out"     @click="zoomOut">－</button>

      <button class="dpad-btn" title="Pan left"     @click="panLeft">◀</button>
      <button class="dpad-btn" title="Centre view"  @click="centerView">⊙</button>
      <button class="dpad-btn" title="Pan right"    @click="panRight">▶</button>

      <button class="dpad-btn" title="Expand zoom"  @click="expandZoom">⛶</button>
      <button class="dpad-btn" title="Pan down"     @click="panDown">▼</button>
      <button class="dpad-btn" title="Fit to view"  @click="fitScreen">⤢</button>
    </div>
  </DiagramFrame>
</template>

<style scoped>
.dag-cy {
  width: 100%;
  height: 100%;
  min-height: 480px;
  background: var(--vp-c-bg);
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

/* D-pad — 3×3 navigation grid anchored to the right-centre of the frame body. */
.dag-dpad {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  grid-template-columns: repeat(3, 32px);
  grid-template-rows: repeat(3, 32px);
  gap: 4px;
  z-index: 5;
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

.dpad-btn:hover {
  background: var(--vp-c-bg);
  border-color: var(--dagonizer-brand);
  color: var(--dagonizer-brand);
}

.dpad-btn:focus-visible {
  outline: 2px solid var(--dagonizer-brand);
  outline-offset: 1px;
}
</style>
