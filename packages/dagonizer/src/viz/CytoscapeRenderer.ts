/**
 * CytoscapeRenderer — render a `DAG` as Cytoscape elements.
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
 * parallel / fan-out / embedded-dag / terminal) so consumers can style
 * per-type via Cytoscape's `style({ selector: 'node[type="fan-out"]', ... })`.
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
 *     inside the cluster — no shortcuts, no opaque boxes.
 *
 * Routes targeting `null` become edges to a synthetic `END` node so
 * the live runner can highlight termination explicitly. END edges
 * inside a parallel or embedded-DAG cluster are suppressed (the parent
 * placement's own edges carry the collected/terminal route out).
 *
 * Static class. The renderer does not invoke Cytoscape; it returns a
 * plain element array.
 */

import type { DAG } from '../entities/dag/DAG.js';
import type { EmbeddedDAGNode } from '../entities/dag/EmbeddedDAGNode.js';
import type { FanOutNode } from '../entities/dag/FanOutNode.js';
import type { ParallelNode } from '../entities/dag/ParallelNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';
import type { TerminalNodePlacementInterface } from '../entities/dag/TerminalNode.js';

type DAGNodeEntry = FanOutNode | ParallelNode | SingleNodePlacementInterface | EmbeddedDAGNode | TerminalNodePlacementInterface;

/** A Cytoscape node element. */
export interface CytoscapeNodeElement {
  readonly group: 'nodes';
  readonly data: {
    readonly id: string;
    readonly label: string;
    /** Placement kind — selector use: `node[type="fan-out"]`. */
    readonly type: 'single' | 'parallel' | 'fan-out' | 'embedded-dag' | 'terminal';
    /** Free-form metadata consumers can read in stylesheets. */
    readonly [key: string]: unknown;
  };
  readonly classes?: string;
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
   * `placement.dag` matches a key here is expanded inline — its
   * internal nodes/edges render as compound-graph children of the
   * placement, so the diagram shows the full inner flow instead of
   * a single opaque box.
   */
  readonly embeddedDAGs?: ReadonlyMap<string, DAG>;
  /** Max recursion depth — guards against accidental embedded-DAG cycles. */
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

  /** Mapping from JSON-LD placement-discriminator to Cytoscape `data.type` value. */
  private static readonly PLACEMENT_KIND: Readonly<Record<string, 'single' | 'parallel' | 'fan-out' | 'embedded-dag' | 'terminal'>> = {
    'SingleNode':   'single',
    'ParallelNode': 'parallel',
    'FanOutNode':   'fan-out',
    'EmbeddedDAGNode':  'embedded-dag',
    'TerminalNode': 'terminal',
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
        "data":  { "id": CytoscapeRenderer.END_ID, "label": 'end', "type": 'terminal', "synthetic": true },
        "classes": 'dag-terminal',
      });
    }

    return state.elements;
  }

  /** Build a placement-name id, optionally prefixed by an enclosing scope. */
  private static idIn(prefix: string, name: string): string {
    return prefix === '' ? name : `${prefix}/${name}`;
  }

  /** Render one placement as a Cytoscape node element with type-discriminated metadata. */
  private static placementNode(placement: DAGNodeEntry, id: string): CytoscapeNodeElement {
    const kind = CytoscapeRenderer.PLACEMENT_KIND[placement['@type']] ?? 'single';
    const base = {
      "group": 'nodes' as const,
      "data": {
        "id":    id,
        "label": placement.name,
        "type":  kind,
      } as CytoscapeNodeElement['data'],
      "classes": `dag-${kind}`,
    };

    switch (placement['@type']) {
      case 'SingleNode':
        return { ...base, "data": { ...base.data, "node": placement.node } };
      case 'ParallelNode':
        return { ...base, "data": { ...base.data, "combine": placement.combine, "children": [...placement.nodes] } };
      case 'FanOutNode':
        return {
          ...base,
          "data": {
            ...base.data,
            "node":        placement.node,
            "source":      placement.source,
            "itemKey":     placement.itemKey,
            "concurrency": placement.concurrency,
            "fanIn":       placement.fanIn,
          },
        };
      case 'EmbeddedDAGNode':
        return {
          ...base,
          "data": {
            ...base.data,
            "dag":          placement.dag,
            "stateMapping": placement.stateMapping,
          },
        };
      case 'TerminalNode':
        return {
          ...base,
          "data": {
            ...base.data,
            "outcome": placement.outcome,
          },
        };
    }
  }

  /** Render a placement's outbound routes as Cytoscape edge elements. */
  private static placementEdges(
    placement: DAGNodeEntry,
    fromId: string,
    prefix: string,
  ): readonly CytoscapeEdgeElement[] {
    // TerminalNode placements are leaf placements — they have no outputs field.
    if (!('outputs' in placement)) return [];
    const edges: CytoscapeEdgeElement[] = [];
    for (const [output, target] of Object.entries(placement.outputs)) {
      const destId = target === null
        ? CytoscapeRenderer.idIn(prefix, CytoscapeRenderer.END_ID)
        : CytoscapeRenderer.idIn(prefix, target);
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
    for (const placement of dag.nodes as readonly DAGNodeEntry[]) {
      if (placement['@type'] === 'ParallelNode') {
        for (const child of placement.nodes) childToParent.set(child, placement.name);
      }
    }

    for (const placement of dag.nodes as readonly DAGNodeEntry[]) {
      const myId = CytoscapeRenderer.idIn(prefix, placement.name);
      const parallelParent = childToParent.get(placement.name);
      const myCompoundParent = parallelParent !== undefined
        ? CytoscapeRenderer.idIn(prefix, parallelParent)
        : compoundParent;

      // ── Embedded-DAG: if the target DAG is registered, expand inline as a
      //    compound parent containing the embedded-DAG's full flow.
      const embeddedDagName = placement['@type'] === 'EmbeddedDAGNode' ? placement.dag : null;
      const embeddedDagBody = embeddedDagName !== null
        ? state.options.embeddedDAGs?.get(embeddedDagName)
        : undefined;
      const shouldExpand = embeddedDagBody !== undefined
        && embeddedDagName !== null
        && depth < (state.options.maxDepth ?? CytoscapeRenderer.DEFAULT_MAX_DEPTH)
        && !visited.has(embeddedDagName);

      if (shouldExpand && embeddedDagBody !== undefined && embeddedDagName !== null) {
        // Emit the placement as a compound parent (label tells the visitor
        // which embedded-DAG this cluster represents).
        const parentNode = CytoscapeRenderer.placementNode(placement, myId);
        const labelled: CytoscapeNodeElement = {
          ...parentNode,
          "data": {
            ...parentNode.data,
            "label": `${placement.name}\n[${embeddedDagName}]`,
            ...(myCompoundParent !== undefined ? { "parent": myCompoundParent } : {}),
          },
        };
        state.elements.push(labelled);

        // Recurse: render every node of the embedded-DAG with `parent: myId`.
        const innerPrefix = CytoscapeRenderer.idIn(prefix, placement.name);
        const innerVisited = new Set(visited);
        innerVisited.add(embeddedDagName);
        CytoscapeRenderer.renderInto(embeddedDagBody, innerPrefix, myId, state, depth + 1, innerVisited);

        // External outputs from this placement (after the embedded-DAG completes)
        // — emit them as edges from the COMPOUND PARENT to wherever the
        // placement routes. Cytoscape will draw them at the cluster boundary.
        for (const edge of CytoscapeRenderer.placementEdges(placement, myId, prefix)) {
          if (edge.data.target === CytoscapeRenderer.idIn(prefix, CytoscapeRenderer.END_ID)) {
            state.touchesTerminal = true;
          }
          state.elements.push(edge);
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
        const endId = CytoscapeRenderer.idIn(prefix, CytoscapeRenderer.END_ID);
        // Suppress synthetic-END routes for children inside a parallel —
        // the parent placement's own edges carry the collected result.
        if (parallelParent !== undefined && edge.data.target === endId) continue;
        // Inside an expanded embedded-DAG (prefix non-empty), `null` targets
        // refer to the embedded-DAG's terminus, not the parent's END. The
        // compound parent's own placementEdges carry the real external
        // routing — drop these internal terminal markers so cytoscape
        // doesn't try to wire an edge to a non-existent prefixed END.
        if (prefix !== '' && edge.data.target === endId) continue;
        if (edge.data.target === endId) state.touchesTerminal = true;
        state.elements.push(edge);
      }
    }
  }
}
