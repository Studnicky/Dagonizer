/**
 * CytoscapeGraph: subclassable factory that creates a fully-configured
 * `cytoscape.Core` from a `DAG`.
 *
 * ## Design intent
 *
 * Consumers call `new CytoscapeGraph(container, dag)` and then
 * `await instance.mount()` to receive a `cytoscape.Core` that is:
 *   - Populated with elements from `CytoscapeRenderer`.
 *   - Positioned by `CompositeLayout` (bottom-up dagre pass).
 *   - Styled with the canonical DAG stylesheet (dark pearl-black + teal accent).
 *   - Laid out via cytoscape's built-in `preset` layout (positions pre-computed).
 *   - Configured with standard interaction defaults (pan, zoom, box-select).
 *
 * ## Cytoscape is loaded lazily
 *
 * This module uses `import type cytoscape from 'cytoscape'` so the package
 * itself never imports cytoscape as a value at module load. The `cytoscape`
 * runtime is resolved on demand by `Cytoscape.create`, which dynamic-imports
 * the optional peer inside `mount()`. This keeps the package runtime-neutral:
 * SSR contexts and builds without a DOM never load cytoscape until a graph is
 * actually mounted.
 *
 * ## Self-loop visibility fix
 *
 * Cytoscape's dimension cache for nodes with self-loop edges can become
 * degenerate when the stylesheet uses `'width': 'label'` / `'height': 'label'`
 * auto-sizing. The degenerate cache causes cytoscape to cull these nodes from
 * rendering entirely. This class applies two fixes:
 *   1. **Explicit numeric node dimensions** (180 × 48) in the stylesheet; the
 *      string `'label'` is never used for `width` or `height`.
 *   2. **`enforceVisibility` sweep** after mount: a pair of `cy.batch()` calls
 *      toggles every node's `display` style off then on, forcing cytoscape to
 *      flush the size cache so self-loop nodes are never invisible.
 *
 * ## Extension via protected hooks
 *
 * Subclasses override any of:
 *   - `composeElements()` — enrich or replace the raw element array.
 *   - `stylesheet()` — alter or extend the canonical stylesheet.
 *   - `presetLayout()` — change layout options passed to cytoscape.
 *   - `interactionDefaults()` — change pan/zoom/select configuration.
 *   - `enforceVisibility(cy)` — alter the visibility sweep strategy.
 *   - `onReady(cy)` — called after mount completes; subclasses wire animation here.
 *
 * The docs site uses this pattern: `DagGraph extends CytoscapeGraph` and
 * overrides `onReady` to attach the live-run animation machine.
 */

import type cytoscape from 'cytoscape';

import type { DAGType } from '../entities/dag/DAG.js';

import { CompositeLayout } from './CompositeLayout.js';
import type { CompositeLayoutOptionsType } from './CompositeLayout.js';
import { Cytoscape } from './Cytoscape.js';
import { CytoscapeRenderer } from './CytoscapeRenderer.js';
import type { CytoscapeElementType } from './CytoscapeRenderer.js';

// ---------------------------------------------------------------------------
// Container type
// ---------------------------------------------------------------------------

/**
 * The container element type accepted by cytoscape.
 *
 * Derived directly from `CytoscapeOptions['container']` so this module does
 * not depend on the DOM lib (`lib: ["DOM"]` is not in the project tsconfig).
 * Consumers pass a real `HTMLElement`; the type resolves correctly at their
 * call site where the DOM lib is available.
 */
type CytoscapeContainer = NonNullable<cytoscape.CytoscapeOptions['container']>;

// ---------------------------------------------------------------------------
// Module-level defaults (required-with-defaults pattern)
// ---------------------------------------------------------------------------

/** Default empty embedded-DAGs registry. */
const DEFAULT_EMBEDDED_DAGS: ReadonlyMap<string, DAGType> = new Map();

/** Default CompositeLayout options (all fields delegated to CompositeLayout defaults). */
const DEFAULT_LAYOUT_OPTIONS: CompositeLayoutOptionsType = {};

/**
 * Canonical defaults for `CytoscapeGraphOptionsType`.
 *
 * Every field that has a default is present here. The constructor resolves
 * all options in one spread: `{ ...CYTOSCAPE_GRAPH_DEFAULTS, ...options }`.
 */
const CYTOSCAPE_GRAPH_DEFAULTS = {
  'embeddedDAGs': DEFAULT_EMBEDDED_DAGS,
  'layoutOptions': DEFAULT_LAYOUT_OPTIONS,
} as const;

/**
 * Vertical gap below the laid-out graph at which the first layout-unpositioned
 * node (e.g. the renderer's synthetic `END` sink) is placed.
 */
const DEFAULT_SINK_GAP = 160;

/** Vertical step between successive layout-unpositioned nodes stacked at the sink. */
const DEFAULT_SINK_STEP = 80;

// ---------------------------------------------------------------------------
// Class-shape interface (tier-1 taxonomy: same file as the class)
// ---------------------------------------------------------------------------

/**
 * Public contract of `CytoscapeGraph`.
 *
 * Consumers program to this interface when they need to accept both the base
 * class and subclasses without depending on the concrete implementation.
 */
export interface CytoscapeGraphInterface {
  /** Mount the graph: compute layout, create cytoscape Core, run hooks. */
  mount(): Promise<cytoscape.Core>;
  /** The `cytoscape.Core` instance after mount, or `null` before. */
  readonly cy: cytoscape.Core | null;
}

// ---------------------------------------------------------------------------
// Options interface
// ---------------------------------------------------------------------------

/**
 * Configuration for `CytoscapeGraph`.
 *
 * All fields are optional; defaults are supplied by the module-level constants
 * above. The constructor accepts this shape directly (no `Partial<>` wrapper)
 * so the type is honest about what callers may omit.
 */
export type CytoscapeGraphOptionsType = {
  /**
   * Registry of embedded-DAGs by DAG IRI, passed to `CytoscapeRenderer` and
   * `CompositeLayout` for recursive expansion. Default: empty `Map`.
   */
  embeddedDAGs?: ReadonlyMap<string, DAGType>;
  /**
   * Layout tuning options forwarded to `CompositeLayout.compute`.
   * Default: `{}` (all tuning delegated to CompositeLayout's own defaults).
   */
  layoutOptions?: CompositeLayoutOptionsType;
}

// ---------------------------------------------------------------------------
// CytoscapeGraph
// ---------------------------------------------------------------------------

/**
 * Subclassable factory that creates a fully-configured `cytoscape.Core` from
 * a `DAG` instance.
 *
 * Call `await instance.mount()` to build the graph. Extend this class and
 * override the protected hook methods to customise elements, stylesheet, layout,
 * or interaction defaults without reimplementing the core lifecycle.
 *
 * @example
 * ```ts
 * import { CytoscapeGraph } from '@studnicky/dagonizer/viz';
 *
 * const graph = new CytoscapeGraph(containerEl, dag);
 * const cy = await graph.mount();
 * ```
 */
export class CytoscapeGraph implements CytoscapeGraphInterface {
  /**
   * The DOM container element that cytoscape will render into.
   * Typed via `CytoscapeContainer` (derived from `CytoscapeOptions['container']`)
   * so this module does not require `lib: ["DOM"]` in its tsconfig.
   */
  protected readonly container: CytoscapeContainer;
  /** The DAG to visualise. */
  protected readonly dag: DAGType;
  /** Registry of embedded-DAGs for recursive expansion. */
  protected readonly embeddedDAGs: ReadonlyMap<string, DAGType>;
  /** Layout tuning options forwarded to CompositeLayout. */
  protected readonly layoutOptions: CompositeLayoutOptionsType;
  /** The live cytoscape Core after `mount()`. Only `mount()` writes this. */
  #cyInstance: cytoscape.Core | null;

  /**
   * Create a new `CytoscapeGraph`.
   *
   * @param container The DOM element cytoscape will render into.
   * @param dag The DAG to visualise.
   * @param options Optional configuration; all fields have sensible defaults.
   */
  constructor(
    container: CytoscapeContainer,
    dag: DAGType,
    options: CytoscapeGraphOptionsType = {},
  ) {
    const resolved = { ...CYTOSCAPE_GRAPH_DEFAULTS, ...options };
    this.container        = container;
    this.dag              = dag;
    this.embeddedDAGs     = resolved.embeddedDAGs;
    this.layoutOptions    = resolved.layoutOptions;
    this.#cyInstance      = null;
  }

  /**
   * Read-only access to the live `cytoscape.Core` for subclasses.
   * Subclasses may read but not write `cyInstance`; writes are owned by `mount()`.
   */
  protected get cyInstance(): cytoscape.Core | null {
    return this.#cyInstance;
  }

  // ── CytoscapeGraphInterface ───────────────────────────────────────────────

  /**
   * The `cytoscape.Core` after a successful `mount()`, or `null` if the graph
   * has not yet been mounted.
   */
  get cy(): cytoscape.Core | null {
    return this.#cyInstance;
  }

  /**
   * Compute layout, create the `cytoscape.Core`, and run all post-mount hooks.
   *
   * Steps:
   *   1. Build elements via `composeElements()`.
   *   2. Compute node positions via `CompositeLayout.compute()`.
   *   3. Apply positions to each node element.
   *   4. Construct the `cytoscape.Core` via `Cytoscape.create` (lazy peer import)
   *      with elements, stylesheet, and layout.
   *   5. Run `enforceVisibility(cy)` to clear the self-loop size cache.
   *   6. Call `onReady(cy)` for subclass post-mount work (e.g. animation wiring).
   *   7. Return the mounted `Core`.
   *
   * @returns The mounted `cytoscape.Core`.
   */
  async mount(): Promise<cytoscape.Core> {
    const positioned = await this.applyLayout(this.composeElements());

    const cy = await this.construct({
      "container": this.container,
      // Cast to cytoscape.ElementDefinition[] at the boundary where cytoscape
      // consumes the elements. CytoscapeElementType is structurally compatible with
      // ElementDefinition; the cast is isolated to this single call site.
      "elements":  positioned as cytoscape.ElementDefinition[],
      "style":     this.stylesheet(),
      "layout":    this.presetLayout(),
      ...this.interactionDefaults(),
    });

    this.#cyInstance = cy;

    this.enforceVisibility(cy);
    this.onReady(cy);

    return cy;
  }

  /**
   * Construct the `cytoscape.Core` from the fully-resolved options.
   *
   * Default implementation delegates to `Cytoscape.create`, which lazily
   * dynamic-imports the optional `cytoscape` peer. This is the single
   * extension point that replaces the former injected factory: subclasses
   * running in SSR/headless contexts, against a pinned cytoscape build, or
   * under a renderer-less test harness override this to supply their own
   * `Core` without reimplementing the mount lifecycle.
   *
   * @param options The complete cytoscape constructor options assembled by
   *   `mount()` (container, elements, stylesheet, layout, interaction defaults).
   * @returns The constructed `cytoscape.Core`.
   */
  protected construct(options: cytoscape.CytoscapeOptions): Promise<cytoscape.Core> {
    return Cytoscape.create(options);
  }

  /**
   * Compute layout for `elements` via `CompositeLayout` and return a new array
   * with a `position` attached to every node element.
   *
   * Accepts `ReadonlyArray<CytoscapeElementType>` so the internal typed elements from
   * `composeElements()` flow through without an intermediate cast. The cast to
   * `cytoscape.ElementDefinition[]` is deferred to the `Cytoscape.create` call
   * in `mount()`.
   *
   * Nodes the layout engine does not position are placed below the laid-out
   * graph at its horizontal centre so they never collapse onto the preset
   * layout's origin (0,0) and overlap the entrypoint.
   *
   * Reused by `mount()` and by subclasses that re-layout after mutating the
   * element set (e.g. expanding an embedded-DAG). Uses `layoutRegistry()` so a
   * subclass can lay out against the same embedded-DAG subset it renders.
   */
  protected async applyLayout(
    elements: ReadonlyArray<CytoscapeElementType>,
  ): Promise<CytoscapeElementType[]> {
    const layout = await CompositeLayout.compute(
      this.dag,
      this.layoutRegistry(),
      this.layoutOptions,
    );

    const laidOut = [...layout.positions.values()];
    const centreX = laidOut.length > 0
      ? laidOut.reduce((sum, p) => sum + p.x, 0) / laidOut.length
      : 0;
    const lowestY = laidOut.length > 0
      ? Math.max(...laidOut.map((p) => p.y))
      : 0;
    let sinkY = lowestY + DEFAULT_SINK_GAP;

    return elements.map((el) => {
      if (el.group !== 'nodes') return el;
      const id = el.data.id;
      if (typeof id !== 'string') return el;
      const pos = layout.positions.get(id);
      if (pos !== undefined) return { ...el, "position": { "x": pos.x, "y": pos.y } };
      const defaultPosition = { "x": centreX, "y": sinkY };
      sinkY += DEFAULT_SINK_STEP;
      return { ...el, "position": defaultPosition };
    });
  }

  /**
   * The embedded-DAG registry used for layout. Defaults to the full
   * `embeddedDAGs` passed at construction. Subclasses that render only a
   * subset of embedded-DAGs expanded (collapse/expand UX) override this to
   * return the SAME subset they emit from `composeElements()`, so layout and
   * rendering agree on which compounds are expanded.
   */
  protected layoutRegistry(): ReadonlyMap<string, DAGType> {
    return this.embeddedDAGs;
  }

  // ── Protected hook methods ────────────────────────────────────────────────

  /**
   * Build the Cytoscape element array for this DAG.
   *
   * Default implementation delegates to `CytoscapeRenderer.render`. Subclasses
   * may override to enrich elements (e.g. add `data.variant` from a node registry)
   * or replace them entirely.
   *
   * Returns `ReadonlyArray<CytoscapeElementType>` so the internal typed elements
   * flow through `applyLayout()` without a cast; the cast to
   * `cytoscape.ElementDefinition[]` is deferred to the `Cytoscape.create` call
   * in `mount()`.
   */
  protected composeElements(): ReadonlyArray<CytoscapeElementType> {
    return CytoscapeRenderer.render(this.dag, {
      "embeddedDAGs": this.embeddedDAGs,
    });
  }

  /**
   * Return the canonical DAG stylesheet.
   *
   * The stylesheet is ported from `DagGraph.vue` with two required bug fixes:
   *   1. `'width'` and `'height'` on the node base rule use explicit numeric
   *      values (180 and 48 respectively) instead of the string `'label'`.
   *      The string `'label'` triggers a degenerate size cache on self-loop
   *      nodes that causes cytoscape to cull them from rendering.
   *   2. `'font-family'` uses a real font stack instead of the CSS custom
   *      property `var(--vp-font-family-mono)`, which cytoscape cannot resolve
   *      on the canvas context.
   *
   * Subclasses may override to extend or replace this stylesheet.
   */
  protected stylesheet(): cytoscape.StylesheetStyle[] {
    const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    return [
      // ── Node base ─────────────────────────────────────────────────────────
      // width/height are explicit numbers (NOT 'label') to avoid the degenerate
      // size-cache bug that makes self-loop nodes invisible in cytoscape.
      { "selector": 'node', "style": {
        'background-color':     '#020306',
        'border-color':         '#22e8ff',
        'border-width':         1.4,
        'color':                '#eef3f7',
        'label':                'data(label)',
        'font-family':          MONO,
        'font-size':            14,
        'font-weight':          500,
        'text-halign':          'center',
        'text-valign':          'center',
        'text-wrap':            'wrap',
        'text-max-width':       '150px',
        'text-outline-color':   '#020306',
        'text-outline-width':   2,
        'text-outline-opacity': 1,
        'padding':              '14px',
        // Explicit numeric sizing — NEVER 'label' — prevents the self-loop
        // size-cache deoptimisation in cytoscape's internal renderer.
        'width':                180,
        'height':               48,
        'shape':                'round-rectangle',
        'transition-property':  'border-color, border-width, background-color, color, opacity',
        'transition-duration':  220,
      } },

      // ── Per-type shapes ───────────────────────────────────────────────────
      { "selector": 'node[type="scatter"]',  "style": { 'shape': 'concave-hexagon' } },
      { "selector": 'node[type="parallel"]', "style": {
        'shape':              'round-hexagon',
        'background-color':   '#04060a',
        'background-opacity': 1,
        'border-color':       '#7a8290',
        'border-width':       1.4,
        'border-style':       'dashed',
        'text-valign':        'top',
        'text-halign':        'center',
        'text-margin-y':      -6,
        'padding':            '22px',
        'font-family':        MONO,
        'font-size':          13,
        'font-weight':        600,
        'color':              '#eef3f7',
      } },
      { "selector": 'node[type="embedded-dag"]', "style": { 'shape': 'round-hexagon' } },
      { "selector": 'node[type="terminal"]', "style": {
        'shape':            'round-rectangle',
        'background-color': '#020306',
        'border-color':     '#d4a649',
      } },
      { "selector": 'node[type="phase"]', "style": {
        'shape':            'barrel',
        'background-color': '#020306',
        'border-color':     '#8f6dff',
        'border-style':     'dashed',
        'border-width':     1.4,
        'width':            180,
        'height':           48,
        'font-family':      MONO,
        'font-size':        13,
        'font-weight':      500,
      } },

      // ── Compound parent (parallel / embedded-dag wrapper) ─────────────────
      { "selector": 'node:parent', "style": {
        'shape':            'round-hexagon',
        'background-color': '#04060a',
        'border-color':     '#7a8290',
        'border-style':     'dashed',
        'border-width':     1.4,
        'text-valign':      'top',
        'font-family':      MONO,
        'font-size':        13,
        'font-weight':      600,
        'color':            '#eef3f7',
      } },

      // ── Contained (worker/isolate) placements ─────────────────────────────
      // Applied to any placement with a `container` role (EmbeddedDAGNode or
      // dag-body ScatterNode bound to a worker isolate via DagContainerInterface).
      // The shape from the `@type` rule above is preserved; only the border,
      // background, and text change — driven by per-node `data(...)` values
      // written by CytoscapeRenderer.placementNode so each container role
      // gets its own distinct color without enumerating roles in the stylesheet.
      // Selectable via `.dag-contained` (class) or `node[container]` (data).
      { "selector": 'node.dag-contained', "style": {
        'background-color':   'data(containerColor)',
        'border-color':       'data(containerStroke)',
        'border-width':       2,
        'color':              'data(containerText)',
        'text-outline-color': 'data(containerColor)',
      } },
      // Contained compound parents: when a contained placement also becomes a
      // compound (i.e. it is expanded inline as an embedded-DAG), the `node:parent`
      // rule above overrides the background-color and border-color back to the
      // default dark theme. This rule re-applies the role colors with higher
      // specificity so the compound container is visibly distinct.
      { "selector": 'node.dag-contained:parent', "style": {
        'background-color':   'data(containerColor)',
        'background-opacity': 0.18,
        'border-color':       'data(containerStroke)',
        'border-width':       2.5,
        'border-style':       'dashed',
        'color':              'data(containerText)',
        'text-outline-color': 'data(containerColor)',
      } },
      // Edges inside a container-bound (worker) compound. The renderer applies
      // the `route-in-worker` class to every edge emitted while recursing into
      // a placement that has a `container` role. These edges are styled dashed
      // with an amber tone to signal "runs in a worker / remote context".
      // The color is intentionally fixed (not per-role) so all worker-internal
      // edges read consistently regardless of which role the compound uses.
      { "selector": 'edge.route-in-worker', "style": {
        'line-style':         'dashed',
        'line-color':         '#d97706',
        'target-arrow-color': '#d97706',
        'color':              '#d97706',
        'text-border-color':  '#d97706',
        'width':              1.4,
      } },

      // ── Variant-tagged styles ─────────────────────────────────────────────
      { "selector": 'node[variant="deterministic"]', "style": {
        'border-color': '#22e8ff',
        'border-style': 'solid',
        'border-width': 1.4,
      } },
      { "selector": 'node[variant="non-deterministic"]', "style": {
        'border-color': '#8f6dff',
        'border-style': 'dashed',
        'border-width': 1.6,
      } },

      // ── State classes ─────────────────────────────────────────────────────
      { "selector": 'node.dag-active', "style": {
        'background-color':   '#020306',
        'border-color':       '#22e8ff',
        'border-width':       3,
        'color':              '#22e8ff',
        'text-outline-color': '#020306',
      } },
      { "selector": 'node.dag-completed', "style": {
        'background-color':   '#020306',
        'border-color':       '#0e8a99',
        'border-width':       2,
        'color':              '#eafcff',
        'text-outline-color': '#020306',
      } },
      { "selector": 'node.dag-errored', "style": {
        'background-color':   '#020306',
        'border-color':       '#d4a649',
        'border-width':       3,
        'color':              '#d4a649',
        'text-outline-color': '#020306',
      } },
      { "selector": 'node.dag-resetting', "style": {
        'opacity':             0.15,
        'transition-property': 'opacity',
        'transition-duration': 280,
      } },
      { "selector": 'node:selected', "style": {
        'border-color': '#22e8ff',
        'border-width': 4,
      } },

      // ── Edge base ─────────────────────────────────────────────────────────
      { "selector": 'edge', "style": {
        'curve-style':             'round-taxi',
        'taxi-direction':          'vertical',
        'taxi-turn':               '50%',
        'taxi-radius':             16,
        'line-color':              '#22e8ff',
        'target-arrow-color':      '#22e8ff',
        'target-arrow-shape':      'vee',
        'arrow-scale':             1.4,
        'source-endpoint':         'outside-to-node-or-label',
        'target-endpoint':         'outside-to-node-or-label',
        'label':                   'data(label)',
        'text-rotation':           'none',
        'text-margin-y':           -8,
        'text-events':             'no',
        'font-family':             MONO,
        'font-size':               12,
        'font-weight':             600,
        'color':                   '#eef3f7',
        'text-background-color':   '#0e1525',
        'text-background-opacity': 1,
        'text-background-padding': '6px',
        'text-background-shape':   'roundrectangle',
        'text-border-color':       '#7a8290',
        'text-border-width':       1,
        'text-border-opacity':     0.85,
        'width':                   1.4,
        'z-index':                 1,
        'transition-property':     'line-color, target-arrow-color, width',
        'transition-duration':     220,
      } },
      { "selector": 'edge.dag-traversed', "style": {
        'line-color':         '#22e8ff',
        'target-arrow-color': '#22e8ff',
        'width':              3,
        'color':              '#22e8ff',
        'text-border-color':  '#22e8ff',
      } },

      // ── Self-loop catch-all ───────────────────────────────────────────────
      // round-taxi cannot draw self-loop edges (source === target); bezier
      // renders the arc correctly. Owns the loop GEOMETRY (curve-style +
      // loop-direction / loop-sweep / control-point-step-size) for any route
      // tagged `self-loop` by CytoscapeRenderer.placementEdges (retry, parked,
      // and any future self-loops). A wide control-point-step-size with a
      // narrow sweep keeps the arc clear of the node body and of overlapping
      // neighbours; outside-to-node endpoints anchor both ends on the node
      // perimeter (a label-relative or off-node endpoint collapses the loop to
      // a degenerate stub). Route-specific rules below set color/dash only and
      // MUST NOT re-specify loop geometry, or they override this and the loop
      // collapses.
      { "selector": 'edge.self-loop', "style": {
        'curve-style':             'bezier',
        'loop-direction':          '-90deg',
        'loop-sweep':              '-25deg',
        'control-point-step-size': 110,
        'source-endpoint':         'outside-to-node',
        'target-endpoint':         'outside-to-node',
      } },

      // ── Retry routes: color/dash only ─────────────────────────────────────
      // Loop geometry is owned by `edge.self-loop` above; this rule adds only
      // the retry color and dashed line so it never overrides the loop shape.
      { "selector": 'edge.route-retry', "style": {
        'line-style':               'dashed',
        'line-color':               '#f5a623',
        'target-arrow-color':       '#f5a623',
        'color':                    '#f5a623',
        'text-border-color':        '#f5a623',
      } },

      // ── Salvage routes ────────────────────────────────────────────────────
      { "selector": 'edge.route-salvage', "style": {
        'line-style':         'dashed',
        'line-color':         '#e8556d',
        'target-arrow-color': '#e8556d',
        'color':              '#e8556d',
        'text-border-color':  '#e8556d',
      } },
    ];
  }

  /**
   * Return the cytoscape layout options for positioning pre-computed elements.
   *
   * Uses the built-in `preset` layout, which reads `position` from each element.
   * Positions are pre-computed by `CompositeLayout.compute` (bottom-up dagre pass),
   * so no cytoscape layout plugin is required.
   *
   * Subclasses may override to change padding, animate, or supply a different
   * layout when positions are not pre-computed.
   */
  protected presetLayout(): cytoscape.PresetLayoutOptions {
    return {
      "name":    'preset',
      "fit":     true,
      "padding": 60,
      "animate": false,
    };
  }

  /**
   * Return the cytoscape interaction default options merged into the Core config.
   *
   * These fields are spread directly into the `cytoscape({...})` constructor
   * options, enabling pan, zoom, box-select, and additive selection out of
   * the box. `wheelSensitivity` is tuned down from the default to avoid
   * accidental viewport jumps on track-pad scroll.
   */
  protected interactionDefaults(): Partial<cytoscape.CytoscapeOptions> {
    return {
      "userPanningEnabled":  true,
      "userZoomingEnabled":  true,
      "boxSelectionEnabled": true,
      "selectionType":       'additive',
      "wheelSensitivity":    0.25,
    };
  }

  /**
   * Force cytoscape to recompute the visibility cache for all nodes.
   *
   * Self-loop edges (e.g. a `retry` route whose target is the node itself) can
   * leave a degenerate entry in cytoscape's internal size cache when the node
   * was created with auto-sizing (`'width': 'label'`). Even with explicit
   * numeric sizing this sweep is a belt-and-suspenders guard: toggling
   * `display` off then on in two `batch()` calls discards the stale cache
   * entry so every node, including self-loop nodes, renders correctly.
   *
   * Subclasses may override to replace or extend the sweep strategy.
   */
  protected enforceVisibility(cy: cytoscape.Core): void {
    cy.batch(() => { cy.nodes().style('display', 'none'); });
    cy.batch(() => { cy.nodes().style('display', 'element'); });
  }

  /**
   * Called after the `cytoscape.Core` is mounted and visibility is enforced.
   *
   * Default implementation is a no-op. Subclasses override this to wire
   * animation machines, event listeners, or other post-mount behaviour.
   *
   * @param _cy The mounted `cytoscape.Core`.
   */
   
  protected onReady(_cy: cytoscape.Core): void {
    // No-op in the base class. Subclasses wire animation here.
  }
}
