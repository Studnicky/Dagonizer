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
 * differently. The synthetic `END` node (emitted when any null route exists)
 * also uses `data.type === 'terminal'` but is distinguished by
 * `data.synthetic === true`.
 *
 * Compound rendering:
 *   • Parallel children render with `parent: <parallel placement name>`
 *     so cytoscape draws them inside the parallel placement's box.
 *   • Embedded-DAG placements, when their target DAG is supplied via the
 *     `embeddedDAGs` registry, expand RECURSIVELY: every inner node renders
 *     with the placement as `parent`, so the user sees the actual flow
 *     inside the cluster; no shortcuts, no opaque boxes.
 *
 * Routes targeting `null` become edges to a synthetic `END` node so
 * the live runner can highlight termination explicitly. END edges
 * inside a parallel or embedded-DAG cluster are suppressed (the parent
 * placement's own edges carry the collected/terminal route out).
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

import { embeddedDagName, idIn } from './internal.js';
import type { PlacementEntry } from './internal.js';

/** A Cytoscape node element. */
export interface CytoscapeNodeElement {
  readonly group: 'nodes';
  readonly data: {
    readonly id: string;
    readonly label: string;
    /** Placement kind; selector use: `node[type="scatter"]`. */
    readonly type: 'single' | 'parallel' | 'scatter' | 'embedded-dag' | 'terminal' | 'phase';
    /** Free-form metadata consumers can read in stylesheets. */
    readonly [key: string]: unknown;
  };
  readonly classes?: string;
  /**
   * Pre-computed position from `CompositeLayout`. When present, callers should
   * use cytoscape's `preset` layout (which reads `position` from each element)
   * instead of a computed layout plugin. Cytoscape will draw compound
   * containers around children automatically given their absolute positions.
   */
  readonly position?: { readonly x: number; readonly y: number };
}

/** A Cytoscape edge element. */
export interface CytoscapeEdgeElement {
  readonly group: 'edges';
  readonly data: {
    readonly id: string;
    readonly source: string;
    readonly target: string;
    readonly label: string;
    readonly route: string;
  };
  readonly classes?: string;
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
  readonly embeddedDAGs?: ReadonlyMap<string, DAG>;
  /** Max recursion depth; guards against accidental embedded-DAG cycles. */
  readonly maxDepth?: number;
}

interface RenderState {
  readonly elements: CytoscapeElement[];
  readonly options:  RenderOptions;
  touchesTerminal: boolean;
}

/** Render a `DAG` as Cytoscape elements. */
export class CytoscapeRenderer {
  private constructor() { /* static class */ }

  /** Synthetic terminator node id emitted once per DAG that has any null-route. */
  private static readonly END_ID = 'END';

  /** Default embedded-DAG inline-expansion recursion cap (cycle / accidental-loop guard). */
  private static readonly DEFAULT_MAX_DEPTH = 6;

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
  private static readonly PLACEMENT_KIND: Readonly<Record<string, 'single' | 'parallel' | 'scatter' | 'embedded-dag' | 'terminal' | 'phase'>> = {
    'SingleNode':       'single',
    'ParallelNode':     'parallel',
    'ScatterNode':      'scatter',
    'EmbeddedDAGNode':  'embedded-dag',
    'TerminalNode':     'terminal',
    'PhaseNode':        'phase',
  };

  static render(dag: DAG, options: RenderOptions = {}): readonly CytoscapeElement[] {
    const state: RenderState = {
      "elements":        [],
      "options":         options,
      "touchesTerminal": false,
    };
    CytoscapeRenderer.renderInto(dag, '', undefined, state, 0, new Set<string>([dag.name]));

    if (state.touchesTerminal) {
      state.elements.push({
        "group": 'nodes',
        "data":  { "id": CytoscapeRenderer.END_ID, "label": 'End', "type": 'terminal', "synthetic": true },
        "classes": 'dag-terminal',
      });
    }

    return state.elements;
  }

  /** Render one placement as a Cytoscape node element with type-discriminated metadata. */
  private static placementNode(placement: PlacementEntry, id: string): CytoscapeNodeElement {
    const kind = CytoscapeRenderer.PLACEMENT_KIND[placement['@type']] ?? 'single';
    const base = {
      "group": 'nodes' as const,
      "data": {
        "id":    id,
        "label": CytoscapeRenderer.titleCase(placement.name),
        "type":  kind,
      } as CytoscapeNodeElement['data'],
      "classes": `dag-${kind}`,
    };

    switch (placement['@type']) {
      case 'SingleNode':
        return { ...base, "data": { ...base.data, "node": placement.node } };
      case 'ParallelNode':
        return { ...base, "data": { ...base.data, "combine": placement.combine, "children": [...placement.nodes] } };
      case 'ScatterNode': {
        const bodyRef = 'node' in placement.body ? placement.body.node : placement.body.dag;
        return {
          ...base,
          "data": {
            ...base.data,
            "body":        bodyRef,
            "source":      placement.source,
            "gather":      placement.gather,
            "reducer":     placement.reducer,
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

  /** Render a placement's outbound routes as Cytoscape edge elements. */
  private static placementEdges(
    placement: PlacementEntry,
    fromId: string,
    prefix: string,
  ): readonly CytoscapeEdgeElement[] {
    // TerminalNode placements are leaf placements; they have no outputs field.
    if (!('outputs' in placement)) return [];
    const edges: CytoscapeEdgeElement[] = [];
    for (const [output, target] of Object.entries(placement.outputs)) {
      const destId = target === null
        ? idIn(prefix, CytoscapeRenderer.END_ID)
        : idIn(prefix, target);
      edges.push({
        "group": 'edges',
        "data": {
          "id":     `${fromId}__${output}__${destId}`,
          "source": fromId,
          "target": destId,
          "label":  output,
          "route":  output,
        },
        "classes": `route-${output}${target === null ? ' route-terminal' : ''}`,
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
    // Build child→parent map for parallel placements at this level.
    const childToParent = new Map<string, string>();
    for (const placement of dag.nodes as readonly PlacementEntry[]) {
      if (placement['@type'] === 'ParallelNode') {
        for (const child of placement.nodes) childToParent.set(child, placement.name);
      }
    }

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
    const maxDepth = state.options.maxDepth ?? CytoscapeRenderer.DEFAULT_MAX_DEPTH;
    for (const placement of dag.nodes as readonly PlacementEntry[]) {
      const dagName = embeddedDagName(placement);
      if (dagName === null) continue;
      const body = state.options.embeddedDAGs?.get(dagName);
      if (body === undefined) continue;
      if (depth >= maxDepth) continue;
      if (visited.has(dagName)) continue;
      const placementId = idIn(prefix, placement.name);
      const entryChildId = idIn(placementId, body.entrypoint);
      embeddedEntryRewrite.set(placement.name, entryChildId);
    }

    for (const placement of dag.nodes as readonly PlacementEntry[]) {
      const myId = idIn(prefix, placement.name);
      const parallelParent = childToParent.get(placement.name);
      const myCompoundParent = parallelParent !== undefined
        ? idIn(prefix, parallelParent)
        : compoundParent;

      // ── EmbeddedDAGNode / ScatterNode with body.dag: if the target DAG is
      //    registered, expand inline as a compound parent containing the
      //    sub-DAG's full flow.
      const embedDagName = embeddedDagName(placement);
      const embeddedDagBody = embedDagName !== null
        ? state.options.embeddedDAGs?.get(embedDagName)
        : undefined;
      const shouldExpand = embeddedDagBody !== undefined
        && embedDagName !== null
        && depth < (state.options.maxDepth ?? CytoscapeRenderer.DEFAULT_MAX_DEPTH)
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
        const innerPrefix = idIn(prefix, placement.name);
        const innerVisited = new Set(visited);
        innerVisited.add(embedDagName);
        CytoscapeRenderer.renderInto(embeddedDagBody, innerPrefix, myId, state, depth + 1, innerVisited);

        // External outputs from this placement (after the embedded-DAG completes)
        // Rewrite the SOURCE from the compound to the matching inner
        // terminal/leaf child(ren) so dagre ranks the exits at the bottom
        // of the compound rather than aggregating from the compound's
        // geometric center. Mapping:
        //   • output named 'error' | 'failed' → inner TerminalNode(failed)
        //     placements
        //   • all other outputs → inner TerminalNode(completed) placements
        //     AND null-route leaves (those exit via the natural-end path)
        // If no matching inner leaf is found for an output, fall through
        // to the compound source (original behavior).
        const innerLeaves = CytoscapeRenderer.collectExitLeaves(embeddedDagBody, innerPrefix);
        for (const edge of CytoscapeRenderer.placementEdges(placement, myId, prefix)) {
          if (edge.data.target === idIn(prefix, CytoscapeRenderer.END_ID)) {
            state.touchesTerminal = true;
          }
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
        const endId = idIn(prefix, CytoscapeRenderer.END_ID);
        // Suppress synthetic-END routes for children inside a parallel;
        // the parent placement's own edges carry the collected result.
        if (parallelParent !== undefined && edge.data.target === endId) continue;
        // Inside an expanded embedded-DAG (prefix non-empty), `null` targets
        // refer to the embedded-DAG's terminus, not the parent's END. The
        // compound parent's own placementEdges carry the real external
        // routing; drop these internal terminal markers so cytoscape
        // doesn't try to wire an edge to a non-existent prefixed END.
        if (prefix !== '' && edge.data.target === endId) continue;
        if (edge.data.target === endId) state.touchesTerminal = true;
        // Entry-point rewrite: if this edge targets an embedded-DAG
        // placement at this level, retarget to that placement's
        // entrypoint child so dagre lays the compound out top-down
        // with the entry visually at the top.
        const rewrittenTarget = CytoscapeRenderer.rewriteToEmbeddedEntry(edge.data.target, prefix, embeddedEntryRewrite);
        if (rewrittenTarget !== edge.data.target) {
          state.elements.push({
            ...edge,
            "data": { ...edge.data, "target": rewrittenTarget, "id": `${edge.data.source}__${edge.data.route}__${rewrittenTarget}` },
          });
        } else {
          state.elements.push(edge);
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
      const placementId = idIn(prefix, placementName);
      if (targetId === placementId) return entryChildId;
    }
    return targetId;
  }

  /**
   * Enumerate the inner exit-points of an embedded-DAG body so the renderer
   * can rewrite the parent placement's outgoing edges to originate from
   * them. Two categories:
   *   • `failed`: TerminalNode placements with outcome 'failed'
   *   • `completed`: TerminalNode placements with outcome 'completed' PLUS
   *                   placements with at least one `null` route (natural
   *                   end-of-flow; counts as completed in v0.11 semantics)
   * Each id is returned prefixed with the parent placement path.
   */
  private static collectExitLeaves(
    body: DAG,
    innerPrefix: string,
  ): { readonly completed: readonly string[]; readonly failed: readonly string[] } {
    // Children of a parallel placement use `null` routes to signal
    // "collected back to the parallel parent"; they are NOT exit
    // leaves of the embedded-DAG. Build a set of parallel-children
    // names so we can skip them.
    const parallelChildren = new Set<string>();
    for (const placement of body.nodes as readonly PlacementEntry[]) {
      if (placement['@type'] === 'ParallelNode') {
        for (const child of placement.nodes) parallelChildren.add(child);
      }
    }

    const completed: string[] = [];
    const failed: string[] = [];
    for (const placement of body.nodes as readonly PlacementEntry[]) {
      if (parallelChildren.has(placement.name)) continue;
      const placementId = idIn(innerPrefix, placement.name);
      if (placement['@type'] === 'TerminalNode') {
        if (placement.outcome === 'failed') failed.push(placementId);
        else completed.push(placementId);
        continue;
      }
      if ('outputs' in placement) {
        for (const target of Object.values(placement.outputs)) {
          if (target === null) {
            completed.push(placementId);
            break;
          }
        }
      }
    }
    return { completed, failed };
  }
}
