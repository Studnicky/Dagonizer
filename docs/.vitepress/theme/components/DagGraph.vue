<script setup lang="ts">
/**
 * DagGraph: cytoscape host for live DAG visualisation, driven by an
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
import GraphDpad from './graph/GraphDpad.vue';
import GraphLegend from './graph/GraphLegend.vue';
import type { LegendTab } from './graph/GraphLegend.vue';
import { DagVizMachine, type DagVizEvent } from './viz/DagVizMachine.ts';
import type { EdgeVizAdapter } from './viz/EdgeVizMachine.ts';
import type { NodeVizAdapter } from './viz/NodeVizMachine.ts';

const props = defineProps<{
  elements: ElementDefinition[];
  ariaLabel?: string;
}>();

const emit = defineEmits<{
  (event: 'node-click', name: string): void;
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
const zoomLevel = ref<number>(1);
let resizeObserver: ResizeObserver | null = null;

/**
 * Component-scoped warn-once set for the suffix-match migration safety net.
 * The runner now passes a full `placementPath/nodeName` id; the fallback
 * triggers only when a consumer still sends bare names. Warn once per id
 * so the gap is discoverable without flooding the console.
 */
const suffixFallbackWarned = new Set<string>();
function suffixFallbackWarn(id: string): void {
  if (suffixFallbackWarned.has(id)) return;
  suffixFallbackWarned.add(id);
  if (typeof console !== 'undefined') {
    // eslint-disable-next-line no-console
    console.debug(
      `[DagGraph] node name "${id}" resolved via suffix fallback; runner did not pass full placement path`,
    );
  }
}

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

  cy.value = cytoscape({
    container,
    elements: props.elements,
    style: dagStylesheet(),
    layout: dagLayout(),
    // Nodes are grabbable by default; visitors can drag, pan, zoom,
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
      // Synchronous hard-clear; the async fade is handled in reset() below.
      cy.value?.elements().removeClass('dag-active dag-completed dag-errored dag-traversed dag-resetting');
      cy.value?.elements().stop(true, true);
    },
  });

  cy.value.on('tap', 'node', (evt) => {
    const node = evt.target as NodeSingular;
    const data = node.data() as { node?: string; id?: string };
    const name = data.node ?? data.id;
    if (typeof name === 'string' && name.length > 0) emit('node-click', name);
  });

  // User-gesture detection: any drag (pan), wheel (zoom), or node-grab
  // hands the camera over to the visitor. The auto-follow stays paused
  // until they press Fit or Center on the D-pad; those buttons
  // explicitly hand control back to auto-follow.
  cy.value.on('mousedown', markUserGesture);
  cy.value.on('wheel',     markUserGesture);
  cy.value.on('drag',      'node', markUserGesture);

  cy.value.on('zoom', () => { pollZoom(); });
  cy.value.one('layoutstop', () => {
    cy.value?.fit(undefined, 40);
    requestAnimationFrame(() => {
      const fitZoom = cy.value?.zoom() ?? 1;
      cy.value?.minZoom(fitZoom);
      cy.value?.maxZoom(fitZoom * 8);
      pollZoom();
    });
  });

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      cy.value?.resize();
      applyFit();
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

// ── Public dispatch surface ──────────────────────────────────────────────

function dispatch(event: DagVizEvent): void {
  machine.value?.dispatch(event);
}

/**
 * Active-node tracking for smooth multi-node viewport following.
 *
 * Single-node follow caused jitter when nodes fired faster than the
 * 480 ms animation duration: each new follow interrupted the prior
 * animation, producing visible jumps. Worse, parallel scouts (four
 * scouts firing at once) made the camera bounce between them.
 *
 * Strategy: track the SET of currently-active node ids. On any
 * NODE_START / NODE_END / NODE_ERROR, debounce by 120 ms and animate
 * the viewport ONCE to fit the bounding box of the entire active set.
 * Parallel starts coalesce into one zoom-out. Sequential starts ride
 * smoothly because the prior animation completes before the next
 * fires.
 */
const activeNodeIds = new Set<string>();
let pendingFitTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * User-gesture latch. When true, the auto-follow does not move the
 * camera; the visitor is driving. Released only when they press the
 * D-pad's Fit or Center button. Pan/zoom buttons count as gestures
 * (they're explicit camera control), so those buttons ALSO set the
 * latch; only Fit/Center clear it.
 */
const userInteracted = ref(false);
function markUserGesture(): void { userInteracted.value = true; }

function resolveNode(id: string): ReturnType<NonNullable<typeof cy.value>['$id']> | null {
  const core = cy.value;
  if (core === null) return null;
  const exact = core.$id(id);
  if (exact.length > 0) return exact;
  suffixFallbackWarn(id);
  return core.nodes().filter((n) => n.id().endsWith(`/${id}`));
}

function followActiveSet(): void {
  if (pendingFitTimer !== null) clearTimeout(pendingFitTimer);
  pendingFitTimer = setTimeout(() => {
    pendingFitTimer = null;
    // Respect the user-gesture latch. If the visitor has grabbed the
    // camera (pan / zoom / drag-node), the active-node SET still
    // updates (so state classes still highlight), but we do not
    // move the camera. The latch is cleared only when they press
    // Fit or Center on the D-pad.
    if (userInteracted.value) return;
    const core = cy.value;
    if (core === null || activeNodeIds.size === 0) return;
    let nodes = core.collection();
    for (const id of activeNodeIds) {
      const found = resolveNode(id);
      if (found !== null && found.length > 0) nodes = nodes.union(found);
    }
    if (nodes.length === 0) return;
    // Synchronous fit. Cytoscape's `cy.animate({ fit: ... })` is silently
    // a no-op in this build, so we fit directly. The 120 ms debounce
    // above coalesces parallel starts into one snap, which reads as
    // "the camera lifts out to show the parallel branch" rather than
    // bouncing across each node. Sequential single-node starts get one
    // snap per node; smooth at the cadence the DAG actually runs.
    core.fit(nodes, 80);
    pollZoom();
  }, 120);
}

function setActive(node: string):     void {
  dispatch({ type: 'NODE_START', node });
  activeNodeIds.add(node);
  followActiveSet();
}

function setCompleted(node: string):  void {
  dispatch({ type: 'NODE_END',   node });
  activeNodeIds.delete(node);
  if (activeNodeIds.size > 0) followActiveSet();
}
function setErrored(node: string):    void {
  dispatch({ type: 'NODE_ERROR', node });
  activeNodeIds.delete(node);
  if (activeNodeIds.size > 0) followActiveSet();
}
function markEdgeTraversed(source: string, route: string): void {
  dispatch({ type: 'EDGE_TRAVERSE', source, route });
}
/**
 * Reset the visualisation with a brief fade-out transition before clearing
 * state classes. Adds `dag-resetting` (opacity fade via stylesheet) for
 * ~280 ms, then dispatches RESET to remove all state classes so the next
 * run lights nodes on a clean slate. Callers should await this before
 * emitting NODE_START events to ensure the fade completes first.
 */
async function reset(): Promise<void> {
  // Halt any in-flight viewport animation and pending follow-fit
  // timer FIRST. Otherwise an inbound RESET racing with a previous
  // run's tail-end pan/zoom leaves the camera mid-flight and visibly
  // jitters after the fade.
  cy.value?.stop(true, false);
  if (pendingFitTimer !== null) { clearTimeout(pendingFitTimer); pendingFitTimer = null; }
  activeNodeIds.clear();

  const stateEls = cy.value?.elements('.dag-active, .dag-completed, .dag-errored, .dag-traversed');
  if (stateEls !== undefined && stateEls.length > 0) {
    stateEls.addClass('dag-resetting');
    await new Promise<void>((resolve) => { setTimeout(resolve, 280); });
  }
  dispatch({ type: 'RESET' });
  // Snap the camera back to the fitted view so the next run starts
  // from a known frame instead of wherever the previous run left off.
  applyFit();
}

/**
 * Fit the graph to the current viewport from CURRENT state (container
 * dimensions, elements bounding box, whatever the layout's already
 * applied). Cytoscape's `cy.fit()` re-measures both on every call;
 * the result is never cached. Also re-clamps minZoom (so the visitor
 * can't zoom out past the fit) and maxZoom (8× the fit, generous
 * enough to read individual node labels).
 *
 * Calling `applyFit` releases the user-gesture latch; auto-follow
 * resumes from the next node-start event. This is the "hand control
 * back to the camera" semantic the visitor expects from the Fit and
 * Center buttons.
 */
function applyFit(): void {
  userInteracted.value = false;
  cy.value?.fit(undefined, 40);
  requestAnimationFrame(() => {
    const fitZoom = cy.value?.zoom() ?? 1;
    cy.value?.minZoom(fitZoom);
    cy.value?.maxZoom(fitZoom * 8);
    pollZoom();
  });
}

function fit(): void { applyFit(); }

function onFrameResize(): void {
  cy.value?.resize();
  applyFit();
}

function rerunLayout(): void {
  if (cy.value === null) return;
  const layout = cy.value.layout(dagLayout());
  layout.run();
  cy.value.one('layoutstop', () => { applyFit(); });
}

function pollZoom(): void {
  zoomLevel.value = cy.value?.zoom() ?? 1;
}

function zoomIn(): void {
  markUserGesture();
  const next = (cy.value?.zoom() ?? 1) * 1.25;
  cy.value?.zoom({
    level: Math.min(next, cy.value.maxZoom()),
    renderedPosition: { x: cy.value.width() / 2, y: cy.value.height() / 2 },
  });
}

function zoomOut(): void {
  markUserGesture();
  const next = (cy.value?.zoom() ?? 1) / 1.25;
  cy.value?.zoom({
    level: Math.max(next, cy.value.minZoom()),
    renderedPosition: { x: cy.value.width() / 2, y: cy.value.height() / 2 },
  });
}

function panUp():    void { markUserGesture(); cy.value?.panBy({ x: 0,   y: 80 }); }
function panDown():  void { markUserGesture(); cy.value?.panBy({ x: 0,   y: -80 }); }
function panLeft():  void { markUserGesture(); cy.value?.panBy({ x: 80,  y: 0 }); }
function panRight(): void { markUserGesture(); cy.value?.panBy({ x: -80, y: 0 }); }

// D-pad centre button: re-pan the graph to the viewport centre at the
// CURRENT zoom. `cy.center()` only re-pans, never rezooms, which is what
// distinguishes Centre from Fit (Fit also resets zoom to the fitted level).
// Treated as a manual gesture, so it pauses auto-follow like the pan buttons.
function centerView(): void { markUserGesture(); cy.value?.center(); }

function expandZoom(): void {
  markUserGesture();
  const next = (cy.value?.zoom() ?? 1) * 1.6;
  cy.value?.zoom({
    level: Math.min(next, cy.value?.maxZoom() ?? next),
    renderedPosition: { x: (cy.value?.width() ?? 0) / 2, y: (cy.value?.height() ?? 0) / 2 },
  });
}

function fitScreen(): void { applyFit(); }

// ── Adapters: the only place that touches cytoscape from the FSM. ───────

function makeNodeAdapter(cy: Core | null, id: string): NodeVizAdapter {
  // Resolve the dispatcher's id to a cytoscape element. The runner now
  // passes a full cytoscape-style id (`[...placementPath, nodeName].join('/')`)
  // so `cy.$id(id)` matches exactly in the common path; including inner
  // placements inside an embedded-DAG, which disambiguates same-named
  // nodes across multiple embedded-DAG instances.
  //
  // The suffix fallback remains as a migration safety net for consumers
  // that have not yet threaded the placement path through to `setActive`
  // etc. It warns once per missing id so the gap is discoverable instead
  // of silently lighting up every same-named placement at once.
  const target = () => {
    if (cy === null) return undefined;
    const exact = cy.$id(id);
    if (exact.length > 0) return exact;
    suffixFallbackWarn(id);
    return cy.nodes().filter((n) => n.id().endsWith(`/${id}`));
  };
  return {
    addClass(name)    { target()?.addClass(name); },
    removeClass(name) { target()?.removeClass(name); },
    stop()            { target()?.stop(true, true); },
    pulse() {
      const nodes = target();
      if (nodes === undefined || nodes.length === 0) return;
      void nodes.animate(
        { style: { 'overlay-color': '#22e8ff', 'overlay-opacity': 0.55, 'overlay-padding': 18 } },
        { duration: 280 },
      ).animate(
        { style: { 'overlay-opacity': 0, 'overlay-padding': 0 } },
        { duration: 360 },
      );
    },
    shake() {
      const nodes = target();
      if (nodes === undefined || nodes.length === 0) return;
      const first = nodes[0] as NodeSingular;
      const pos = first.position();
      void nodes
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
  // Use cytoscape's built-in `preset` layout, which places each node at its
  // `position` field. Positions are pre-computed by CompositeLayout inside
  // CytoscapeRenderer.render() using @dagrejs/dagre in a bottom-up recursive
  // pass; this correctly handles embedded-DAG compounds without the ordering
  // and overlap bugs that cytoscape-dagre exhibits on compound graphs.
  return {
    name: 'preset',
    fit: true,
    padding: 60,
    animate: false,
  };
}

// Contrast pairs: every fill colour is paired with a text colour that
// reaches WCAG AAA against it on both light and dark themes.
//
//   teal #22e8ff   →  text #04141c (very-dark navy)
//   dusty violet   →  compound bg #3a2f4a, node fill #7a6a9c, label #a99cc4
//   gold #d4a649   →  text #1a1410 (very-dark)
//   default bg-alt →  text-1 (theme-driven, already AAA)
function dagStylesheet(): unknown[] {
  // Palette mirrors the mermaid theme tokens in palette.css so the
  // cytoscape canvas and SSR mermaid SVGs read as the same family:
  // pearl-black node fill, teal accent border, pearl text, monospace
  // type. Active / completed / errored states change the BORDER
  // (loud) and a subtle interior tint; the fill stays mostly dark
  // so the canvas isn't dominated by one color when a graph is
  // largely "completed".
  return [
    { selector: 'node', style: {
      'background-color': '#020306',           // --mermaid-node-fill (pearl-black)
      'border-color':     '#22e8ff',           // --mermaid-node-stroke (teal)
      'border-width':     1.4,
      'color':            '#eef3f7',           // --mermaid-node-text (pearl)
      'label':            'data(label)',
      'font-family':      'var(--vp-font-family-mono)',
      'font-size':        14,
      'font-weight':      500,
      'text-halign':      'center',
      'text-valign':      'center',
      'text-wrap':        'wrap',
      'text-max-width':   '220px',
      'text-outline-color':   '#020306',
      'text-outline-width':   2,
      'text-outline-opacity': 1,
      'padding':          '14px',
      'width':            'label',
      'height':           'label',
      'shape':            'round-rectangle',
      'transition-property': 'border-color, border-width, background-color, color, opacity',
      'transition-duration': 220,
    } },
    { selector: 'node[type="scatter"]',  style: { 'shape': 'concave-hexagon' } },
    { selector: 'node[type="parallel"]', style: {
      'shape':            'round-hexagon',
      'background-color': '#04060a',           // --mermaid-cluster-fill (deepest navy)
      'background-opacity': 1,
      'border-color':     '#7a8290',           // --mermaid-cluster-stroke (steel)
      'border-width':     1.4,
      'border-style':     'dashed',
      'text-valign':      'top',
      'text-halign':      'center',
      'text-margin-y':    -6,
      'padding':          '22px',
      'font-family':      'var(--vp-font-family-mono)',
      'font-size':        13,
      'font-weight':      600,
      'color':            '#eef3f7',
    } },
    { selector: 'node[type="embedded-dag"]', style: { 'shape': 'round-hexagon' } },
    { selector: 'node[type="terminal"]', style: {
      'shape':            'round-rectangle',
      'background-color': '#020306',
      'border-color':     '#d4a649',           // gold accent for terminals
    } },
    // Compound parent (embedded-dag / parallel wrapper): calm steel
    // border on the deepest navy so the cluster reads as a frame,
    // not a focal point.
    { selector: 'node:parent', style: {
      'shape':            'round-hexagon',
      'background-color': '#04060a',
      'border-color':     '#7a8290',
      'border-style':     'dashed',
      'border-width':     1.4,
      'text-valign':      'top',
      'font-family':      'var(--vp-font-family-mono)',
      'font-size':        13,
      'font-weight':      600,
      'color':            '#eef3f7',
    } },

    // Kind-tagged styling: solid teal border for deterministic,
    // dashed violet for non-deterministic. Mirrors NodeLegend.
    { selector: 'node[kind="deterministic"]', style: {
      'border-color': '#22e8ff',
      'border-style': 'solid',
      'border-width': 1.4,
    } },
    { selector: 'node[kind="non-deterministic"]', style: {
      'border-color': '#8f6dff',                // brand violet
      'border-style': 'dashed',
      'border-width': 1.6,
    } },

    // State styling: keep the pearl-black interior and shift the
    // border / outline color so the canvas stays calm and one
    // active node pops without flooding the viewport with cyan.
    { selector: 'node.dag-active', style: {
      'background-color': '#020306',
      'border-color':     '#22e8ff',
      'border-width':     3,
      'color':            '#22e8ff',
      'text-outline-color': '#020306',
    } },
    { selector: 'node.dag-completed', style: {
      'background-color': '#020306',
      'border-color':     '#0e8a99',
      'border-width':     2,
      'color':            '#eafcff',
      'text-outline-color': '#020306',
    } },
    { selector: 'node.dag-errored', style: {
      'background-color': '#020306',
      'border-color':     '#d4a649',
      'border-width':     3,
      'color':            '#d4a649',
      'text-outline-color': '#020306',
    } },
    // Transient fade-out class applied during reset; opacity glides to 0.15
    // over 280 ms (matching the transition-duration on the node base style),
    // then RESET removes it and all state classes so the next run starts clean.
    { selector: 'node.dag-resetting', style: {
      'opacity': 0.15,
      'transition-property': 'opacity',
      'transition-duration': 280,
    } },
    { selector: 'node:selected', style: { 'border-color': '#22e8ff', 'border-width': 4 } },

    // Edges: straight angled lines (matches mermaid curve: linear),
    // teal stroke and arrowheads. Labels anchor near the source end
    // and ride along the first horizontal segment of the taxi curve;
    // this keeps them well clear of downstream nodes (the old
    // mid-segment placement collided with target nodes when the taxi
    // turn happened close to one).
    { selector: 'edge', style: {
      'curve-style':         'round-taxi',    // angled segments with rounded corners
      'taxi-direction':      'vertical',
      'taxi-turn':           '50%',           // turn at midpoint between source and target ranks; label sits in the middle vertical channel
      'taxi-radius':         16,              // rounded corner radius for round-taxi
      'line-color':          '#22e8ff',
      'target-arrow-color':  '#22e8ff',
      'target-arrow-shape':  'vee',           // sharper 6-sided wedge, matches hex motif
      'arrow-scale':         1.4,
      'source-endpoint':     'outside-to-node-or-label',
      'target-endpoint':     'outside-to-node-or-label',
      // Edge route name (success / error / ranked / …) rendered as a pill
      // mid-edge. Horizontal text (no autorotate) so labels are uniformly
      // readable regardless of which segment of the taxi curve they ride.
      // `mid-source` text-margin slides the pill toward the source end so
      // labels for incoming-to-the-same-target edges don't stack on top
      // of each other (different sources offset → distinct positions).
      'label':                       'data(label)',
      'text-rotation':               'none',
      'text-margin-y':               -8,        // sit just above the edge line
      'edge-text-rotation':          'none',
      'text-events':                 'no',
      'font-family':         'var(--vp-font-family-mono)',
      'font-size':           12,
      'font-weight':         600,
      'color':               '#eef3f7',
      'text-background-color':   '#0e1525',
      'text-background-opacity': 1,
      'text-background-padding': '6px',
      'text-background-shape':   'round-rectangle',
      'text-border-color':    '#7a8290',
      'text-border-width':    1,
      'text-border-opacity':  0.85,
      'width':               1.4,
      'z-index':             1,               // labels above lines, below selected outlines
      'transition-property': 'line-color, target-arrow-color, width',
      'transition-duration': 220,
    } },
    { selector: 'edge.dag-traversed', style: {
      'line-color':         '#22e8ff',
      'target-arrow-color': '#22e8ff',
      'width':              3,
      'color':              '#22e8ff',
      'text-border-color':  '#22e8ff',
    } },

    // Retry routes: a bounded flow-shape loop. When source === target (a node
    // retrying itself, e.g. extract-query) the taxi curve has no lane, so
    // switch to a bezier loop and give it a definite direction/sweep so the
    // arc reads as a self-loop instead of a degenerate stub. Amber + dashed
    // marks it as the "try again" edge, distinct from the teal happy path.
    // (Also styles the compose→validate back-edge, which shares the 'retry'
    // route name; a 2-node loop the same colouring suits.)
    { selector: 'edge.route-retry', style: {
      'curve-style':        'bezier',
      'loop-direction':     '-45deg',
      'loop-sweep':         '-90deg',
      'control-point-step-size': 56,
      'line-style':         'dashed',
      'line-color':         '#f5a623',
      'target-arrow-color': '#f5a623',
      'color':              '#f5a623',
      'text-border-color':  '#f5a623',
    } },

    // Salvage routes: the give-up edge to a deterministic recovery node.
    // Rose + dashed so the "exhausted, recover" path is legible at a glance
    // and clearly not the success route.
    { selector: 'edge.route-salvage', style: {
      'line-style':         'dashed',
      'line-color':         '#e8556d',
      'target-arrow-color': '#e8556d',
      'color':              '#e8556d',
      'text-border-color':  '#e8556d',
    } },
  ];
}
</script>

<template>
  <DiagramFrame
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
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
        @pan-up="panUp"
        @pan-down="panDown"
        @pan-left="panLeft"
        @pan-right="panRight"
        @centre="centerView"
        @expand="expandZoom"
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
  /* Match the mermaid frame surface so the two diagrams read as
     panels of the same family: pearl-black with engraved navy grain. */
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
