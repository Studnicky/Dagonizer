/**
 * AnimatedDagGraph: docs-side extension of the package-shipped CytoscapeGraph
 * factory that layers on the live-run animation machine, camera follow, and
 * embed-expand toggle.
 *
 * ## Extension contract
 *
 * Extends `CytoscapeGraph` and overrides:
 *   - `composeElements()` — renders only expanded embedded-DAGs, enriches
 *     each node's `data.variant` from `nodeVariants`.
 *   - `layoutRegistry()` — returns the same expanded-only subset so
 *     `CompositeLayout` agrees with the rendered element set.
 *   - `onReady(cy)` — wires the `DagVizMachine`, tap listeners, camera
 *     follow, and zoom tracking.
 *
 * ## Public surface
 *
 * Mirrors the `defineExpose` surface that `ArchivistRunner.vue` depends on:
 *   `setActive`, `setCompleted`, `setErrored`, `markEdgeTraversed`,
 *   `dispatch`, `reset`, `fit`, `rerunLayout`, `destroy`.
 *
 * Camera buttons: `zoomIn`, `zoomOut`, `panUp`, `panDown`, `panLeft`,
 * `panRight`, `centerView`, `fitScreen`.
 *
 * Rebuild: `toggleExpand(dagName)` → `rebuild()` re-renders the element set
 * after expanding or collapsing an embedded-DAG.
 */

import type cytoscape from 'cytoscape';
import type { Core, EdgeCollection, NodeSingular } from 'cytoscape';
import { RealTimeScheduler } from '@studnicky/scheduler';
import type { ScheduledTaskType, SchedulerProviderType } from '@studnicky/scheduler';

import type { DAGType } from '../../../../../packages/dagonizer/src/entities/dag/DAG.js';
import { CytoscapeGraph } from '../../../../../packages/dagonizer/src/viz/CytoscapeGraph.ts';
import type { CytoscapeGraphOptionsType } from '../../../../../packages/dagonizer/src/viz/CytoscapeGraph.ts';
import { CytoscapeRenderer } from '../../../../../packages/dagonizer/src/viz/CytoscapeRenderer.ts';
import type { CytoscapeElementType, CytoscapeNodeDataType } from '../../../../../packages/dagonizer/src/viz/CytoscapeRenderer.ts';

import { DagVizMachine } from './DagVizMachine.ts';
import type { DagVizEvent } from './DagVizMachine.ts';
import type { EdgeVizAdapter } from './EdgeVizMachine.ts';
import type { NodeVizAdapter } from './NodeVizMachine.ts';

/**
 * Fraction of the viewport's central band within which the active-node centroid
 * is considered "comfortably framed". While the centroid stays inside this band
 * the camera does not move at all; it only re-centres once activity drifts into
 * the outer margin. The band gives the follow hysteresis so a fully-expanded
 * graph whose nodes light up across many concurrent workers does not provoke a
 * pan on every node event.
 */
const FOLLOW_CENTRE_BAND = 0.25;

/**
 * Readable idle zoom floor. A fully-expanded graph fits whole at a tiny zoom
 * (e.g. 0.04×) where node labels are illegible — the "broken speck" view. The
 * whole-graph fit is kept as the minZoom floor (zoom out to regain the
 * overview), but the camera *starts* no further out than this so nodes are
 * legible on load, anchored on the graph's entry (top). Camera-follow then pans
 * — never zooms — to keep activity framed.
 */
const READABLE_IDLE_ZOOM = 0.2;

/**
 * Absolute ceiling for manual zoom-in. A fully-expanded graph fits at a very
 * small zoom (e.g. 0.06×), so a purely fit-relative cap would top out well
 * below 1:1 and make individual nodes impossible to read. The manual zoom cap
 * is the larger of a generous fit-relative multiple and this absolute value, so
 * close inspection is always available regardless of graph size.
 */
const MAX_ABSOLUTE_ZOOM = 4;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Construction options for `AnimatedDagGraph`.
 *
 * Superset of `CytoscapeGraphOptionsType`: the `embeddedDAGs` and `layoutOptions`
 * fields are forwarded to the base class; the remaining fields are docs-specific.
 */
export interface AnimatedDagGraphOptions extends Partial<CytoscapeGraphOptionsType> {
  /**
   * Per-node variant registry: maps node name → variant string ('deterministic' |
   * 'non-deterministic'). Used to enrich each rendered node's `data.variant`.
   */
  readonly nodeVariants?: Readonly<Record<string, string>>;
  /**
   * Initial set of embedded-DAG names to expand. Defaults to none expanded
   * (all collapsed as opaque boxes). Mutually exclusive with `expandAll`.
   */
  readonly expandedDags?: ReadonlySet<string>;
  /**
   * When `true`, all registered embedded-DAGs are expanded on mount.
   * Takes precedence over `expandedDags`.
   */
  readonly expandAll?: boolean;
  /**
   * Called when the visitor taps a non-embed node. Receives the node name
   * (`data.node ?? data.id`).
   */
  readonly onNodeClick?: (name: string) => void;
  /**
   * Called after every zoom change with the new zoom level.
   */
  readonly onZoomChange?: (level: number) => void;
}

// ---------------------------------------------------------------------------
// AnimatedDagGraph
// ---------------------------------------------------------------------------

/**
 * Extension of `CytoscapeGraph` that adds the live-run animation machine,
 * camera follow, and embed-expand toggle for the docs site.
 */
export class AnimatedDagGraph extends CytoscapeGraph {
  // ── Docs-specific configuration ──────────────────────────────────────────

  readonly #nodeVariants: Readonly<Record<string, string>>;
  readonly #onNodeClick: ((name: string) => void) | null;
  readonly #onZoomChange: ((level: number) => void) | null;

  /** The mutable set of currently-expanded embedded-DAG names. */
  #expandedDags: Set<string>;

  // ── Runtime state (populated after mount) ────────────────────────────────

  #machine: DagVizMachine | null = null;

  /** Set of currently-active node ids for camera follow. */
  readonly #activeNodeIds: Set<string> = new Set();

  /** Scheduler-owned debounce task for camera follow. */
  readonly #scheduler: SchedulerProviderType = RealTimeScheduler.create();
  #pendingFitTask: ScheduledTaskType | null = null;

  /** True when the visitor has grabbed the camera. Released by applyFit(). */
  #userInteracted: boolean = false;

  // ── Cleanup refs ─────────────────────────────────────────────────────────

  /** Stored cy event handler refs for removeListener on destroy. */
  #onTap: ((evt: cytoscape.EventObject) => void) | null = null;
  #onMousedown: (() => void) | null = null;
  #onWheel: (() => void) | null = null;
  #onDrag: (() => void) | null = null;
  #onZoom: (() => void) | null = null;

  // ── Constructor ──────────────────────────────────────────────────────────

  constructor(
    container: ConstructorParameters<typeof CytoscapeGraph>[0],
    dag: DAGType,
    options: AnimatedDagGraphOptions = {},
  ) {
    super(container, dag, {
      ...(options.embeddedDAGs !== undefined ? { 'embeddedDAGs': options.embeddedDAGs } : {}),
      ...(options.layoutOptions !== undefined ? { 'layoutOptions': options.layoutOptions } : {}),
    });

    this.#nodeVariants  = options.nodeVariants  ?? {};
    this.#onNodeClick = options.onNodeClick ?? null;
    this.#onZoomChange = options.onZoomChange ?? null;

    // Seed the expanded set.
    if (options.expandAll === true && this.embeddedDAGs.size > 0) {
      this.#expandedDags = new Set(this.embeddedDAGs.keys());
    } else if (options.expandedDags !== undefined) {
      this.#expandedDags = new Set(options.expandedDags);
    } else {
      this.#expandedDags = new Set();
    }
  }

  // ── Private helper: filtered (expanded-only) registry ────────────────────

  /**
   * Build a registry containing only the embedded-DAGs currently in
   * `#expandedDags`. Used by both `composeElements()` and `layoutRegistry()`.
   */
  #filteredRegistry(): ReadonlyMap<string, DAGType> {
    const out = new Map<string, DAGType>();
    for (const [name, dag] of this.embeddedDAGs) {
      if (this.#expandedDags.has(name)) out.set(name, dag);
    }
    return out;
  }

  // ── CytoscapeGraph hook overrides ─────────────────────────────────────────

  protected override composeElements(): ReadonlyArray<CytoscapeElementType> {
    const filtered = this.#filteredRegistry();
    const raw = CytoscapeRenderer.render(this.dag, { embeddedDAGs: filtered });

    // Enrich each node element with data.variant from nodeVariants map.
    return raw.map((el) => {
      if (el.group !== 'nodes') return el;
      const nodeData = el.data;
      const nodeName = (nodeData as { node?: string }).node ?? nodeData.id;
      const rawVariant = nodeName !== undefined ? this.#nodeVariants[nodeName] : undefined;
      if (rawVariant === undefined) return el;
      // Narrow the raw string to the CytoscapeNodeDataType variant union; unknown
      // values are dropped so the stylesheet never receives an invalid variant.
      const variant = (rawVariant === 'deterministic' || rawVariant === 'non-deterministic')
        ? rawVariant as CytoscapeNodeDataType['variant']
        : undefined;
      if (variant === undefined) return el;
      return { ...el, 'data': { ...el.data, 'variant': variant } };
    });
  }

  protected override layoutRegistry(): ReadonlyMap<string, DAGType> {
    return this.#filteredRegistry();
  }

  protected override onReady(cy: Core): void {
    this.#machine = new DagVizMachine({
      nodeAdapter: (id) => this.#makeNodeAdapter(cy, id),
      edgeAdapter: (source, route) => this.#makeEdgeAdapter(cy, source, route),
      resetAll: () => {
        cy.elements().removeClass('dag-active dag-completed dag-errored dag-traversed dag-resetting');
        cy.elements().stop(true, true);
      },
    });

    // ── cy event listeners ────────────────────────────────────────────────

    this.#onTap = (evt: cytoscape.EventObject) => {
      const node = evt.target as NodeSingular;
      const data = node.data() as {
        node?: string; id?: string; type?: string; dag?: string; body?: string;
      };

      // Click-to-expand: tapping an embedded-dag or scatter-with-dag-body node
      // toggles expansion of its embedded DAG.
      const nodeType = data.type;
      let dagName: string | undefined;
      if (nodeType === 'embedded-dag' && typeof data.dag === 'string') {
        dagName = data.dag;
      } else if (nodeType === 'scatter' && typeof data.body === 'string') {
        if (this.embeddedDAGs.has(data.body)) dagName = data.body;
      }
      if (dagName !== undefined && this.embeddedDAGs.has(dagName)) {
        void this.toggleExpand(dagName);
        return;
      }

      const name = data.node ?? data.id;
      if (typeof name === 'string' && name.length > 0 && this.#onNodeClick !== null) {
        this.#onNodeClick(name);
      }
    };

    this.#onMousedown = () => { this.#markUserGesture(); };
    this.#onWheel     = () => { this.#markUserGesture(); };
    this.#onDrag      = () => { this.#markUserGesture(); };
    this.#onZoom      = () => { this.#pollZoom(cy); };

    cy.on('tap', 'node', this.#onTap);
    cy.on('mousedown', this.#onMousedown);
    cy.on('wheel', this.#onWheel);
    cy.on('drag', 'node', this.#onDrag);
    cy.on('zoom', this.#onZoom);

    // Fit on load. The `preset` layout completes SYNCHRONOUSLY during mount(),
    // so by the time this onReady hook runs `layoutstop` has already fired —
    // a `cy.one('layoutstop')` here would never run for the initial layout and
    // the graph would render unfit. Call applyFit() directly instead (it does
    // its own double-pass via requestAnimationFrame to settle compound boxes).
    this.applyFit();
  }

  // ── Private: adapters ────────────────────────────────────────────────────

  #makeNodeAdapter(cy: Core, id: string): NodeVizAdapter {
    const target = () => {
      const exact = cy.$id(id);
      if (exact.length > 0) return exact;
      return cy.nodes().filter((n: NodeSingular) => n.id().endsWith(`/${id}`));
    };
    return {
      addClass(name: string)    { target()?.addClass(name); },
      removeClass(name: string) { target()?.removeClass(name); },
      stop()                    { target()?.stop(true, true); },
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

  #makeEdgeAdapter(cy: Core, source: string, route: string): EdgeVizAdapter {
    const selector = `edge[source = "${source}"][route = "${route}"]`;
    return {
      addClass(name: string)    { (cy.edges(selector) as EdgeCollection).addClass(name); },
      removeClass(name: string) { (cy.edges(selector) as EdgeCollection).removeClass(name); },
      stop()                    { (cy.edges(selector) as EdgeCollection).stop(true, true); },
      flash() {
        const edges = cy.edges(selector) as EdgeCollection;
        if (edges.length === 0) return;
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

  // ── Private: camera helpers ───────────────────────────────────────────────

  #markUserGesture(): void { this.#userInteracted = true; }

  #pollZoom(cy: Core): void {
    if (this.#onZoomChange !== null) this.#onZoomChange(cy.zoom());
  }

  // ── Public: node resolution ───────────────────────────────────────────────

  resolveNode(id: string): ReturnType<Core['$id']> | null {
    const cy = this.cyInstance;
    if (cy === null) return null;

    const exact = cy.$id(id);
    if (exact.length > 0) return exact;

    const suffix = cy.nodes().filter((n: NodeSingular) => n.id().endsWith(`/${id}`));
    if (suffix.length > 0) {
      return suffix;
    }

    // Ancestor fallback: inner node id not rendered (collapsed embedded-dag).
    let candidate = id;
    for (;;) {
      const slash = candidate.lastIndexOf('/');
      if (slash <= 0) break;
      candidate = candidate.slice(0, slash);
      const ancestor = cy.$id(candidate);
      if (ancestor.length > 0) return ancestor;
    }

    return cy.collection();
  }

  // ── Public: camera follow ─────────────────────────────────────────────────

  #followActiveSet(): void {
    this.#pendingFitTask?.cancel();
    this.#pendingFitTask = this.#scheduler.scheduleAt(Date.now() + 200, () => {
      this.#pendingFitTask = null;
      if (this.#userInteracted) return;
      const cy = this.cyInstance;
      if (cy === null || this.#activeNodeIds.size === 0) return;
      let nodes = cy.collection();
      for (const id of this.#activeNodeIds) {
        const found = this.resolveNode(id);
        if (found !== null && found.length > 0) nodes = nodes.union(found);
      }
      if (nodes.length === 0) return;
      // Calm follow: never change zoom. The visitor's (or idle-fit) zoom level
      // is preserved so the camera does not thrash as execution lights up nodes
      // across a fully-expanded graph — every per-concept embedded-DAG node that
      // starts would otherwise trigger a fit-and-zoom. Only re-centre, and only
      // when the active centroid has drifted out of the viewport's central band
      // (hysteresis), so localized activity is brought into frame while
      // graph-spanning concurrent activity leaves the camera still.
      const bb = nodes.renderedBoundingBox();
      const w = cy.width();
      const h = cy.height();
      const centroidX = (bb.x1 + bb.x2) / 2;
      const centroidY = (bb.y1 + bb.y2) / 2;
      const insideX = centroidX > w * FOLLOW_CENTRE_BAND && centroidX < w * (1 - FOLLOW_CENTRE_BAND);
      const insideY = centroidY > h * FOLLOW_CENTRE_BAND && centroidY < h * (1 - FOLLOW_CENTRE_BAND);
      if (insideX && insideY) return;
      cy.animate({ 'center': { 'eles': nodes } }, { 'duration': 240, 'easing': 'ease' });
      this.#pollZoom(cy);
    });
  }

  // ── Public: dispatch surface ─────────────────────────────────────────────

  dispatch(event: DagVizEvent): void {
    this.#machine?.dispatch(event);
  }

  setActive(node: string): void {
    this.dispatch({ type: 'NODE_START', node });
    this.#activeNodeIds.add(node);
    this.#followActiveSet();
  }

  setCompleted(node: string): void {
    this.dispatch({ type: 'NODE_END', node });
    this.#activeNodeIds.delete(node);
    if (this.#activeNodeIds.size > 0) this.#followActiveSet();
  }

  setErrored(node: string): void {
    this.dispatch({ type: 'NODE_ERROR', node });
    this.#activeNodeIds.delete(node);
    if (this.#activeNodeIds.size > 0) this.#followActiveSet();
  }

  markEdgeTraversed(source: string, route: string): void {
    this.dispatch({ type: 'EDGE_TRAVERSE', source, route });
  }

  /**
   * Fade-out reset: adds `dag-resetting` class for ~280 ms, then dispatches
   * RESET to clear all state classes, then snaps the camera back to fit.
   */
  async reset(): Promise<void> {
    const cy = this.cyInstance;
    cy?.stop(true, false);
    this.#pendingFitTask?.cancel();
    this.#pendingFitTask = null;
    this.#activeNodeIds.clear();

    const stateEls = cy?.elements('.dag-active, .dag-completed, .dag-errored, .dag-traversed');
    if (stateEls !== undefined && stateEls.length > 0) {
      stateEls.addClass('dag-resetting');
      await new Promise<void>((resolve) => { this.#scheduler.scheduleAt(Date.now() + 280, resolve); });
    }
    this.dispatch({ type: 'RESET' });
    this.applyFit();
  }

  /**
   * Fit and release user-gesture latch. The auto-follow resumes from the next
   * node-start event after this call.
   */
  applyFit(): void {
    this.#userInteracted = false;
    // Fit now, then again on the next frame: deeply-nested compound bounding
    // boxes can finish settling a frame after layoutstop, so a single
    // synchronous fit under-measures the full graph and under-zooms. The second
    // pass captures the final extent.
    this.#fitOnce();
    requestAnimationFrame(() => { this.#fitOnce(); });
  }

  /** One fit pass: unclamp → fit-all → re-clamp around the resulting zoom. */
  #fitOnce(): void {
    const cy = this.cyInstance;
    if (cy === null) return;
    // Re-measure the container first: cytoscape fits against its CACHED viewport
    // size, so if the pane resized (tab shown, fullscreen toggled, column
    // reflow) without a resize() the fit zoom is computed against stale
    // dimensions and under/over-zooms. resize() syncs to the live container.
    cy.resize();
    // Unclamp before fitting so fit works whether the graph grew (expanded) or
    // shrank (collapsed) since the last clamp; re-clamp around the new fit.
    cy.minZoom(1e-50);
    cy.maxZoom(1e50);
    cy.fit(undefined, 40);
    const fitZoom = cy.zoom();
    cy.minZoom(fitZoom);
    cy.maxZoom(Math.max(fitZoom * 8, MAX_ABSOLUTE_ZOOM));
    // Land at a readable zoom anchored on the graph's entry (top-centre) rather
    // than the whole-graph speck. minZoom still equals the whole-graph fit, so
    // zooming out to the overview remains available.
    const readable = Math.min(READABLE_IDLE_ZOOM, cy.maxZoom());
    if (fitZoom < readable) {
      cy.zoom(readable);
      const bb = cy.elements().boundingBox();
      cy.pan({
        'x': cy.width() / 2 - ((bb.x1 + bb.x2) / 2) * readable,
        'y': 40 - bb.y1 * readable,
      });
    }
    this.#pollZoom(cy);
  }

  fit(): void { this.applyFit(); }

  rerunLayout(): void {
    const cy = this.cyInstance;
    if (cy === null) return;
    const layout = cy.layout({
      name:    'preset',
      fit:     true,
      padding: 60,
      animate: false,
    });
    // `preset` runs synchronously, so layoutstop has already fired here — fit
    // directly rather than via a `cy.one('layoutstop')` that would never run.
    layout.run();
    this.applyFit();
  }

  // ── Public: camera buttons ────────────────────────────────────────────────

  zoomIn(): void {
    const cy = this.cyInstance;
    if (cy === null) return;
    this.#markUserGesture();
    const next = cy.zoom() * 1.25;
    cy.zoom({
      level: Math.min(next, cy.maxZoom()),
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  }

  zoomOut(): void {
    const cy = this.cyInstance;
    if (cy === null) return;
    this.#markUserGesture();
    const next = cy.zoom() / 1.25;
    cy.zoom({
      level: Math.max(next, cy.minZoom()),
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  }

  panUp():    void { this.#markUserGesture(); this.cyInstance?.panBy({ x: 0,   y: -80 }); }
  panDown():  void { this.#markUserGesture(); this.cyInstance?.panBy({ x: 0,   y: 80 }); }
  // Pressing left moves the view toward the left (reveals content on the left),
  // i.e. pan the scene right — matching the memory graph's pan direction.
  panLeft():  void { this.#markUserGesture(); this.cyInstance?.panBy({ x: 80,  y: 0 }); }
  panRight(): void { this.#markUserGesture(); this.cyInstance?.panBy({ x: -80, y: 0 }); }

  centerView(): void { this.#markUserGesture(); this.cyInstance?.center(); }
  fitScreen():  void { this.applyFit(); }

  // ── Public: expand/collapse toggle + rebuild ──────────────────────────────

  /**
   * Toggle the expansion state of `dagName`, then re-render and re-layout.
   */
  async toggleExpand(dagName: string): Promise<void> {
    if (this.#expandedDags.has(dagName)) {
      this.#expandedDags.delete(dagName);
    } else {
      this.#expandedDags.add(dagName);
    }
    await this.rebuild();
  }

  /**
   * Re-render the element set with the current `#expandedDags` state and
   * re-apply layout without recreating the cytoscape Core.
   */
  async rebuild(): Promise<void> {
    const cy = this.cyInstance;
    if (cy === null) return;
    const positioned = await this.applyLayout(this.composeElements());
    cy.elements().remove();
    cy.add(positioned as Parameters<Core['add']>[0]);
    this.rerunLayout();
    this.enforceVisibility(cy);
    this.applyFit();
  }

  // ── Public: lifecycle ─────────────────────────────────────────────────────

  /**
   * Tear down: cancel all pending timers, remove cy event listeners, and
   * destroy the cytoscape Core. Call from Vue's `onBeforeUnmount`.
   */
  destroy(): void {
    this.#pendingFitTask?.cancel();
    this.#pendingFitTask = null;
    this.#scheduler.cancelAll();

    const cy = this.cyInstance;
    if (cy !== null) {
      if (this.#onTap !== null)      cy.off('tap', 'node', this.#onTap);
      if (this.#onMousedown !== null) cy.off('mousedown', this.#onMousedown);
      if (this.#onWheel !== null)     cy.off('wheel', this.#onWheel);
      if (this.#onDrag !== null)      cy.off('drag', 'node', this.#onDrag);
      if (this.#onZoom !== null)      cy.off('zoom', this.#onZoom);
      cy.destroy();
    }

    this.#machine      = null;
  }
}
