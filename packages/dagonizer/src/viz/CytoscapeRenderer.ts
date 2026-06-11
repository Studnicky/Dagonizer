/**
 * CytoscapeRenderer: render a `DAG` as Cytoscape elements.
 *
 * Output is the array shape `cytoscape.js` consumes directly:
 *
 *   const cy = cytoscape({
 *     container: document.getElementById('graph'),
 *     elements:  CytoscapeRenderer.render(dag, { embeddedDAGs }),
 *     // ...stylesheet, layout...
 *   });
 *
 * Every placement becomes a node element carrying its `type` (single /
 * parallel / scatter / embedded-dag / terminal) so consumers can style
 * per-type via Cytoscape's `style({ selector: 'node[type="scatter"]', ... })`.
 * Every output route becomes an edge labeled with the route's name.
 *
 * TerminalNode placements render with `data.type === 'terminal'` and carry
 * `data.outcome` ('completed' | 'failed') so stylesheets can color them
 * differently. Flows end exclusively via explicit TerminalNode placements;
 * there are no synthetic END nodes.
 *
 * Compound rendering:
 *   • Embedded-DAG placements, when their target DAG is supplied via the
 *     `embeddedDAGs` registry, expand RECURSIVELY: every inner node renders
 *     with the placement as `parent`, so the user sees the actual flow
 *     inside the cluster; no shortcuts, no opaque boxes.
 *
 * Layout positioning is a separate concern handled by `CompositeLayout`.
 * This renderer returns elements WITHOUT positions; callers that need
 * positioned elements should call `CompositeLayout.compute` and attach
 * positions separately.
 *
 * Static class. The renderer does not invoke Cytoscape; it returns a
 * plain element array synchronously.
 */

import type { DAG } from '../entities/dag/DAG.js';
import type { GatherConfig } from '../entities/dag/GatherConfig.js';

import { PlacementUtils, RoleColorUtils } from './internal.js';
import type { PlacementEntry } from './internal.js';

/**
 * Data bag carried by every Cytoscape node element.
 *
 * The required fields (`id`, `label`, `type`) are always present.
 * The optional fields cover all extra keys the renderer writes per
 * placement kind, so consumers can read them in stylesheets/handlers
 * without resorting to index access.
 */
export interface CytoscapeNodeData {
  id: string;
  label: string;
  /** Placement kind; selector use: `node[type="scatter"]`. */
  type: 'single' | 'scatter' | 'embedded-dag' | 'terminal' | 'phase';
  // ── Containment (EmbeddedDAGNode / dag-body ScatterNode with a container role) ──
  container?: string;
  containerColor?: string;
  containerStroke?: string;
  containerText?: string;
  // ── Per-kind extras ──
  node?: string;       // SingleNode, PhaseNode
  dag?: string;        // EmbeddedDAGNode
  outcome?: string;    // TerminalNode
  phase?: string;      // PhaseNode
  body?: string;       // ScatterNode body ref
  source?: string;     // ScatterNode
  gather?: GatherConfig; // ScatterNode
  reducer?: string;    // ScatterNode
  // ── Compound graph parent id (set during recursive expansion) ──
  parent?: string;
  /**
   * Determinism classification for stylesheet selection
   * (`node[kind="deterministic"]` / `node[kind="non-deterministic"]`).
   * The base renderer leaves this unset; subclasses enrich it by
   * overriding `buildElements()` (e.g. from a node registry).
   */
  kind?: 'deterministic' | 'non-deterministic';
}

/** A Cytoscape node element. */
export interface CytoscapeNodeElement {
  group: 'nodes';
  data: CytoscapeNodeData;
  /** Always populated by the renderer; required so consumers can rely on it for stylesheet selection. */
  classes: string;
  /**
   * Pre-computed position from `CompositeLayout`. When present, callers should
   * use cytoscape's `preset` layout (which reads `position` from each element)
   * instead of a computed layout plugin. Cytoscape will draw compound
   * containers around children automatically given their absolute positions.
   */
  position?: { x: number; y: number };
}

/** A Cytoscape edge element. */
export interface CytoscapeEdgeElement {
  group: 'edges';
  data: {
    id: string;
    source: string;
    target: string;
    label: string;
    route: string;
  };
  /** Always populated by the renderer; required so consumers can rely on it for stylesheet selection. */
  classes: string;
}

export type CytoscapeElement = CytoscapeNodeElement | CytoscapeEdgeElement;

/** Optional inputs the renderer reads. */
export interface RenderOptions {
  /**
   * Registry of embedded-DAGs by name. Any `embedded-dag` placement whose
   * `placement.dag` matches a key here is expanded inline; its
   * internal nodes/edges render as compound-graph children of the
   * placement, so the diagram shows the full inner flow instead of
   * a single opaque box.
   */
  embeddedDAGs?: ReadonlyMap<string, DAG>;
  /** Max recursion depth; guards against accidental embedded-DAG cycles. */
  maxDepth?: number;
}

/**
 * The subset of `PlacementEntry` union members that carry an `outputs` routing map.
 *
 * `TerminalNode` and `PhaseNode` are leaf placements with no outbound routes;
 * all other placement types (`SingleNode`, `ScatterNode`, `EmbeddedDAGNode`)
 * carry `outputs`. `Extract` selects only those union members so the predicate
 * return type satisfies TypeScript's assignability requirement without an unsafe cast.
 */
type PlacementWithOutputs = Extract<PlacementEntry, { outputs: Record<string, string> }>;

/** Default empty embedded-DAG registry used when none is supplied. */
const DEFAULT_EMBEDDED_DAGS: ReadonlyMap<string, DAG> = new Map();

/** Default max recursion depth for embedded-DAG inline expansion. */
const DEFAULT_MAX_DEPTH = 6;

/**
 * Canonical defaults for `RenderOptions`.
 *
 * Every field that has a default is present here. `render()` resolves
 * all options in one spread: `{ ...CYTOSCAPE_RENDER_DEFAULTS, ...options }`.
 */
const CYTOSCAPE_RENDER_DEFAULTS = {
  'embeddedDAGs': DEFAULT_EMBEDDED_DAGS,
  'maxDepth': DEFAULT_MAX_DEPTH,
} as const;

/** Resolved render options — all fields required; defaults filled before first use. */
interface ResolvedRenderOptions {
  embeddedDAGs: ReadonlyMap<string, DAG>;
  maxDepth: number;
}

/**
 * Mutable render accumulator threaded through the recursive `renderInto` calls.
 *
 * `inContainedCompound` is mutated on entry to a container-bound (worker)
 * compound and restored on exit — a save/restore pattern bounded to a single
 * `renderInto` call stack. Using a class (rather than an interface literal)
 * keeps the object shape stable across all allocation sites so V8 can assign
 * a single hidden class and inline-cache the property access.
 */
class RenderState {
  readonly elements: CytoscapeElement[];
  readonly options:  ResolvedRenderOptions;
  /**
   * True when the current recursion is inside a container-bound (worker)
   * compound. Edges emitted while this flag is set receive the
   * `route-in-worker` class so the stylesheet can style them distinctly.
   * Mutated on entry and restored on exit within `renderInto`.
   */
  inContainedCompound: boolean;

  constructor(options: ResolvedRenderOptions) {
    this.elements            = [];
    this.options             = options;
    this.inContainedCompound = false;
  }
}

/** Render a `DAG` as Cytoscape elements. */
export class CytoscapeRenderer {
  private constructor() { /* static class */ }

  /**
   * Convert a kebab-case placement name to Title Case for display.
   * Path segments separated by `/` are each title-cased and joined with ` / `.
   *
   * @example
   *   titleCase('extract-query')                       // 'Extract Query'
   *   titleCase('similar-search/openlibrary-scout')    // 'Similar Search / Openlibrary Scout'
   *   titleCase('no-results')                          // 'No Results'
   */
  static titleCase(name: string): string {
    return name
      .split('/')
      .map((seg) => seg
        .split('-')
        .map((w) => w.length === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '))
      .join(' / ');
  }

  /** Mapping from JSON-LD placement-discriminator to Cytoscape `data.type` value. */
  private static readonly PLACEMENT_KIND: Readonly<Record<string, 'single' | 'scatter' | 'embedded-dag' | 'terminal' | 'phase'>> = {
    'SingleNode':       'single',
    'ScatterNode':      'scatter',
    'EmbeddedDAGNode':  'embedded-dag',
    'TerminalNode':     'terminal',
    'PhaseNode':        'phase',
  };

  static render(dag: DAG, options: RenderOptions = {}): readonly CytoscapeElement[] {
    const resolved: ResolvedRenderOptions = { ...CYTOSCAPE_RENDER_DEFAULTS, ...options };
    const state = new RenderState(resolved);
    CytoscapeRenderer.renderInto(dag, '', undefined, state, 0, new Set<string>([dag.name]));
    return state.elements;
  }

  /**
   * Build the base `CytoscapeNodeData` for a placement, including container
   * role colors when the placement is bound to a worker/isolate container.
   *
   * Extracted from `placementNode` to eliminate the inline IIFE and make the
   * logic independently testable. In-process placements (no container role)
   * receive only `id`, `label`, and `type`; container-bound placements receive
   * the additional `container*` color keys (honoring `exactOptionalPropertyTypes`).
   */
  private static buildNodeData(
    id: string,
    label: string,
    kind: CytoscapeNodeData['type'],
    role: string | null,
  ): CytoscapeNodeData {
    if (role !== null) {
      const colors = RoleColorUtils.forRole(role);
      return {
        "id":               id,
        "label":            label,
        "type":             kind,
        "container":        role,
        "containerColor":   colors.fill,
        "containerStroke":  colors.stroke,
        "containerText":    colors.text,
      };
    }
    return { "id": id, "label": label, "type": kind };
  }

  /**
   * Render one placement as a Cytoscape node element with type-discriminated metadata.
   *
   * Containment: placements bound to a `container` role (worker/isolate) carry:
   *   `data.container`       — the role string
   *   `data.containerColor`  — per-role fill color (from `RoleColorUtils.forRole`)
   *   `data.containerStroke` — per-role border color
   *   `data.containerText`   — per-role label color
   * and the additional `dag-contained` class alongside the existing `dag-${kind}`
   * class. In-process placements omit all four container data keys entirely
   * (honoring `exactOptionalPropertyTypes`).
   *
   * The stylesheet rule for `.dag-contained` reads the color via cytoscape
   * `data(...)` mapping so each node paints with its own role color:
   *   `'background-color': 'data(containerColor)'`
   *   `'border-color':     'data(containerStroke)'`
   *   `'color':            'data(containerText)'`
   *
   * Consumer stylesheet selectors for contained nodes:
   *   `.dag-contained`        — class selector, matches any contained placement
   *   `node[container]`       — data selector, matches any node with a container role
   *   `node[container="cpu"]` — data selector, matches a specific role
   */
  private static placementNode(placement: PlacementEntry, id: string): CytoscapeNodeElement {
    const kind = CytoscapeRenderer.PLACEMENT_KIND[placement['@type']] ?? 'single';
    const role = PlacementUtils.containerRole(placement);

    const baseLabel = CytoscapeRenderer.titleCase(placement.name);
    const baseData: CytoscapeNodeData = CytoscapeRenderer.buildNodeData(id, baseLabel, kind, role);

    // Append dag-contained class for stylesheet selection.
    const classes = role !== null ? `dag-${kind} dag-contained` : `dag-${kind}`;

    const base = {
      "group": 'nodes' as const,
      "data":    baseData,
      "classes": classes,
    };

    switch (placement['@type']) {
      case 'SingleNode':
        return { ...base, "data": { ...base.data, "node": placement.node } };
      case 'ScatterNode': {
        const bodyRef = 'node' in placement.body ? placement.body.node : placement.body.dag;
        return {
          ...base,
          "data": {
            ...base.data,
            "body":        bodyRef,
            "source":      placement.source,
            "gather":      placement.gather,
            ...(placement.reducer !== undefined ? { "reducer": placement.reducer } : {}),
          },
        };
      }
      case 'EmbeddedDAGNode':
        return { ...base, "data": { ...base.data, "dag": placement.dag } };
      case 'TerminalNode':
        return {
          ...base,
          "data": {
            ...base.data,
            "outcome": placement.outcome,
          },
        };
      case 'PhaseNode':
        return {
          ...base,
          "data": {
            ...base.data,
            "phase": placement.phase,
            "node":  placement.node,
          },
        };
    }
  }

  /**
   * Type predicate that narrows a `PlacementEntry` to a `PlacementWithOutputs`.
   *
   * Checks for the presence of `outputs` as an own property. This avoids a
   * type-unsafe `as Record<string,string>` cast at every call site.
   */
  private static hasOutputs(placement: PlacementEntry): placement is PlacementWithOutputs {
    return 'outputs' in placement;
  }

  /** Render a placement's outbound routes as Cytoscape edge elements. */
  private static placementEdges(
    placement: PlacementEntry,
    fromId: string,
    prefix: string,
  ): readonly CytoscapeEdgeElement[] {
    // TerminalNode and PhaseNode are leaf placements with no outbound routes.
    if (!CytoscapeRenderer.hasOutputs(placement)) return [];
    const edges: CytoscapeEdgeElement[] = [];
    for (const [output, target] of Object.entries(placement.outputs)) {
      const destId = PlacementUtils.idIn(prefix, target);
      edges.push({
        "group": 'edges',
        "data": {
          "id":     `${fromId}__${output}__${destId}`,
          "source": fromId,
          "target": destId,
          "label":  output,
          "route":  output,
        },
        "classes": `route-${output}`,
      });
    }
    return edges;
  }

  /**
   * Render every placement of `dag` into `state.elements`, with optional
   * compound-parent wrapping (for parallel/embedded-DAG expansions). Recurses
   * into embedded-DAGs when their target body is in `state.options.embeddedDAGs`.
   */
  private static renderInto(
    dag: DAG,
    prefix: string,
    compoundParent: string | undefined,
    state: RenderState,
    depth: number,
    visited: ReadonlySet<string>,
  ): void {
    // Build an embedded-DAG entrypoint-rewrite map for THIS level: when an
    // edge at this level targets an embedded-DAG placement that will be
    // expanded (its body is registered), rewrite the target to the
    // embedded-DAG's entrypoint child so dagre gets a real rank
    // constraint between the predecessor and the FIRST child of the
    // compound, not the compound's geometric center. Without this,
    // dagre treats the compound as a rank-opaque slot whose internal
    // layout is decided only by intra-compound edges, often producing
    // an inverted child order and a compound positioned above its own
    // predecessor.
    const embeddedEntryRewrite = new Map<string, string>();
    const maxDepth = state.options.maxDepth;
    for (const placement of PlacementUtils.narrowNodes(dag)) {
      const dagName = PlacementUtils.embeddedDagName(placement);
      if (dagName === null) continue;
      const body = state.options.embeddedDAGs.get(dagName);
      if (body === undefined) continue;
      if (depth >= maxDepth) continue;
      if (visited.has(dagName)) continue;
      const placementId = PlacementUtils.idIn(prefix, placement.name);
      const entryChildId = PlacementUtils.idIn(placementId, body.entrypoint);
      embeddedEntryRewrite.set(placement.name, entryChildId);
    }

    for (const placement of PlacementUtils.narrowNodes(dag)) {
      const myId = PlacementUtils.idIn(prefix, placement.name);
      const myCompoundParent = compoundParent;

      // ── EmbeddedDAGNode / ScatterNode with body.dag: if the target DAG is
      //    registered, expand inline as a compound parent containing the
      //    sub-DAG's full flow.
      const embedDagName = PlacementUtils.embeddedDagName(placement);
      const embeddedDagBody = embedDagName !== null
        ? state.options.embeddedDAGs.get(embedDagName)
        : undefined;
      const shouldExpand = embeddedDagBody !== undefined
        && embedDagName !== null
        && depth < state.options.maxDepth
        && !visited.has(embedDagName);

      if (shouldExpand && embeddedDagBody !== undefined && embedDagName !== null) {
        // Emit the placement as a compound parent (label tells the visitor
        // which embedded-DAG this cluster represents).
        const parentNode = CytoscapeRenderer.placementNode(placement, myId);
        const labelled: CytoscapeNodeElement = {
          ...parentNode,
          "data": {
            ...parentNode.data,
            "label": `${CytoscapeRenderer.titleCase(placement.name)}\n[${embedDagName}]`,
            ...(myCompoundParent !== undefined ? { "parent": myCompoundParent } : {}),
          },
        };
        state.elements.push(labelled);

        // Recurse: render every node of the embedded-DAG with `parent: myId`.
        // If this placement is container-bound (worker/isolate), mark the state so
        // edges emitted inside receive the `route-in-worker` class.
        const innerPrefix = PlacementUtils.idIn(prefix, placement.name);
        const innerVisited = new Set(visited);
        innerVisited.add(embedDagName);
        const placementRole = PlacementUtils.containerRole(placement);
        const wasContained = state.inContainedCompound;
        if (placementRole !== null) state.inContainedCompound = true;
        CytoscapeRenderer.renderInto(embeddedDagBody, innerPrefix, myId, state, depth + 1, innerVisited);
        state.inContainedCompound = wasContained;

        // External outputs from this placement (after the embedded-DAG completes)
        // Rewrite the SOURCE from the compound to the matching inner
        // terminal/leaf child(ren) so dagre ranks the exits at the bottom
        // of the compound rather than aggregating from the compound's
        // geometric center. Mapping:
        //   • output named 'error' | 'failed' → inner TerminalNode(failed) placements
        //   • all other outputs → inner TerminalNode(completed) placements
        // If no matching inner leaf is found for an output, fall through
        // to the compound source (original behavior).
        const innerLeaves = CytoscapeRenderer.collectExitLeaves(embeddedDagBody, innerPrefix);
        for (const edge of CytoscapeRenderer.placementEdges(placement, myId, prefix)) {
          const isErrorRoute = edge.data.route === 'error' || edge.data.route === 'failed';
          const candidateSources = isErrorRoute ? innerLeaves.failed : innerLeaves.completed;
          if (candidateSources.length > 0) {
            for (const sourceId of candidateSources) {
              state.elements.push({
                ...edge,
                "data": { ...edge.data, "source": sourceId, "id": `${sourceId}__${edge.data.route}__${edge.data.target}` },
              });
            }
          } else {
            state.elements.push(edge);
          }
        }
        continue;
      }

      // ── Regular placement (or unresolved embedded-dag): emit as a single node.
      const node = CytoscapeRenderer.placementNode(placement, myId);
      const enriched: CytoscapeNodeElement = myCompoundParent !== undefined
        ? { ...node, "data": { ...node.data, "parent": myCompoundParent } }
        : node;
      state.elements.push(enriched);

      for (const edge of CytoscapeRenderer.placementEdges(placement, myId, prefix)) {
        // Entry-point rewrite: if this edge targets an embedded-DAG
        // placement at this level, retarget to that placement's
        // entrypoint child so dagre lays the compound out top-down
        // with the entry visually at the top.
        const rewrittenTarget = CytoscapeRenderer.rewriteToEmbeddedEntry(edge.data.target, prefix, embeddedEntryRewrite);
        // Worker-edge class: edges inside a container-bound compound receive
        // `route-in-worker` so the stylesheet can style them distinctly (dashed,
        // role-colored) to signal "runs in a worker context".
        const workerClass = state.inContainedCompound ? ' route-in-worker' : '';
        if (rewrittenTarget !== edge.data.target) {
          state.elements.push({
            ...edge,
            "classes": `${edge.classes}${workerClass}`,
            "data": { ...edge.data, "target": rewrittenTarget, "id": `${edge.data.source}__${edge.data.route}__${rewrittenTarget}` },
          });
        } else {
          state.elements.push(
            workerClass !== ''
              ? { ...edge, "classes": `${edge.classes}${workerClass}` }
              : edge,
          );
        }
      }
    }
  }

  /**
   * If `targetId` (an already-prefixed placement id) matches one of the
   * embedded-DAG placements at this level (per `entryMap` keyed by
   * un-prefixed placement names), return the entrypoint child id;
   * otherwise return `targetId` unchanged.
   */
  private static rewriteToEmbeddedEntry(
    targetId: string,
    prefix: string,
    entryMap: ReadonlyMap<string, string>,
  ): string {
    for (const [placementName, entryChildId] of entryMap) {
      const placementId = PlacementUtils.idIn(prefix, placementName);
      if (targetId === placementId) return entryChildId;
    }
    return targetId;
  }

  /**
   * Enumerate the inner exit-points of an embedded-DAG body so the renderer
   * can rewrite the parent placement's outgoing edges to originate from
   * them. Two categories:
   *   • `failed`: TerminalNode placements with outcome 'failed'
   *   • `completed`: TerminalNode placements with outcome 'completed'
   * Each id is returned prefixed with the parent placement path.
   */
  private static collectExitLeaves(
    body: DAG,
    innerPrefix: string,
  ): { readonly completed: readonly string[]; readonly failed: readonly string[] } {
    const completed: string[] = [];
    const failed: string[] = [];
    for (const placement of PlacementUtils.narrowNodes(body)) {
      if (placement['@type'] !== 'TerminalNode') continue;
      const placementId = PlacementUtils.idIn(innerPrefix, placement.name);
      if (placement.outcome === 'failed') failed.push(placementId);
      else completed.push(placementId);
    }
    return { completed, failed };
  }
}
