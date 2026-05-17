/**
 * CytoscapeRenderer — render a `DAG` as Cytoscape elements.
 *
 * Output is the array shape `cytoscape.js` consumes directly:
 *
 *   const cy = cytoscape({
 *     container: document.getElementById('graph'),
 *     elements:  CytoscapeRenderer.render(dag, { subDags }),
 *     // ...stylesheet, layout...
 *   });
 *
 * Every placement becomes a node element carrying its `type` (single /
 * parallel / fan-out / sub-dag) so consumers can style per-type via
 * Cytoscape's `style({ selector: 'node[type="fan-out"]', ... })`. Every
 * output route becomes an edge labeled with the route's name.
 *
 * Compound rendering:
 *   • Parallel children render with `parent: <parallel placement name>`
 *     so cytoscape draws them inside the parallel placement's box.
 *   • Sub-DAG placements, when their target DAG is supplied via the
 *     `subDags` registry, expand RECURSIVELY: every inner node renders
 *     with the placement as `parent`, so the user sees the actual flow
 *     inside the cluster — no shortcuts, no opaque boxes.
 *
 * Routes targeting `null` become edges to a synthetic `END` node so
 * the live runner can highlight termination explicitly. END edges
 * inside a parallel or sub-DAG cluster are suppressed (the parent
 * placement's own edges carry the collected/terminal route out).
 *
 * Static class. The renderer does not invoke Cytoscape; it returns a
 * plain element array.
 */

import type { DAG } from '../entities/dag/DAG.js';
import type { FanOutNode } from '../entities/dag/FanOutNode.js';
import type { ParallelNode } from '../entities/dag/ParallelNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';
import type { SubDAGNode } from '../entities/dag/SubDAGNode.js';

type DAGNodeEntry = FanOutNode | ParallelNode | SingleNodePlacementInterface | SubDAGNode;

/** A Cytoscape node element. */
export interface CytoscapeNodeElement {
  readonly group: 'nodes';
  readonly data: {
    readonly id: string;
    readonly label: string;
    /** Placement kind — selector use: `node[type="fan-out"]`. */
    readonly type: 'single' | 'parallel' | 'fan-out' | 'sub-dag' | 'terminal';
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
   * Registry of sub-DAGs by name. Any `sub-dag` placement whose
   * `placement.dag` matches a key here is expanded inline — its
   * internal nodes/edges render as compound-graph children of the
   * placement, so the diagram shows the full inner flow instead of
   * a single opaque box.
   */
  readonly subDags?: ReadonlyMap<string, DAG>;
  /** Max recursion depth — guards against accidental sub-DAG cycles. */
  readonly maxDepth?: number;
}

const END_ID = 'END';
const DEFAULT_MAX_DEPTH = 6;

const placementNode = (placement: DAGNodeEntry, id: string): CytoscapeNodeElement => {
  const base = {
    "group": 'nodes' as const,
    "data": {
      "id":    id,
      "label": placement.name,
      "type":  placement.type,
    } as CytoscapeNodeElement['data'],
    "classes": `dag-${placement.type}`,
  };

  switch (placement.type) {
    case 'single':
      return { ...base, "data": { ...base.data, "node": placement.node } };
    case 'parallel':
      return { ...base, "data": { ...base.data, "combine": placement.combine, "children": [...placement.nodes] } };
    case 'fan-out':
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
    case 'sub-dag':
      return {
        ...base,
        "data": {
          ...base.data,
          "dag":          placement.dag,
          "stateMapping": placement.stateMapping,
        },
      };
  }
};

const idIn = (prefix: string, name: string): string =>
  prefix === '' ? name : `${prefix}/${name}`;

interface RenderState {
  readonly elements: CytoscapeElement[];
  readonly options:  RenderOptions;
  touchesTerminal: boolean;
}

function renderInto(
  dag: DAG,
  /** ID prefix for nodes inside this sub-render. Empty at the top level. */
  prefix: string,
  /** Cytoscape `parent` id every node should be wrapped under (compound). */
  compoundParent: string | undefined,
  state: RenderState,
  depth: number,
  visited: ReadonlySet<string>,
): void {
  // Build child→parent map for parallel placements at this level.
  const childToParent = new Map<string, string>();
  for (const placement of dag.nodes as readonly DAGNodeEntry[]) {
    if (placement.type === 'parallel') {
      for (const child of placement.nodes) childToParent.set(child, placement.name);
    }
  }

  for (const placement of dag.nodes as readonly DAGNodeEntry[]) {
    const myId = idIn(prefix, placement.name);
    const parallelParent = childToParent.get(placement.name);
    const myCompoundParent = parallelParent !== undefined
      ? idIn(prefix, parallelParent)
      : compoundParent;

    // ── Sub-DAG: if the target DAG is registered, expand inline as a
    //    compound parent containing the sub-DAG's full flow.
    const subDagName = placement.type === 'sub-dag' ? placement.dag : null;
    const subDagBody = subDagName !== null
      ? state.options.subDags?.get(subDagName)
      : undefined;
    const shouldExpand = subDagBody !== undefined
      && subDagName !== null
      && depth < (state.options.maxDepth ?? DEFAULT_MAX_DEPTH)
      && !visited.has(subDagName);

    if (shouldExpand && subDagBody !== undefined && subDagName !== null) {
      // Emit the placement as a compound parent (label tells the visitor
      // which sub-DAG this cluster represents).
      const parentNode = placementNode(placement, myId);
      const labelled: CytoscapeNodeElement = {
        ...parentNode,
        "data": {
          ...parentNode.data,
          "label": `${placement.name}\n[${subDagName}]`,
          ...(myCompoundParent !== undefined ? { "parent": myCompoundParent } : {}),
        },
      };
      state.elements.push(labelled);

      // Recurse: render every node of the sub-DAG with `parent: myId`.
      const innerPrefix = idIn(prefix, placement.name);
      const innerVisited = new Set(visited);
      innerVisited.add(subDagName);
      renderInto(subDagBody, innerPrefix, myId, state, depth + 1, innerVisited);

      // External outputs from this placement (after the sub-DAG completes)
      // — emit them as edges from the COMPOUND PARENT to wherever the
      // placement routes. Cytoscape will draw them at the cluster boundary.
      for (const edge of placementEdges(placement, myId, prefix)) {
        if (edge.data.target === idIn(prefix, END_ID)) state.touchesTerminal = true;
        state.elements.push(edge);
      }
      continue;
    }

    // ── Regular placement (or unresolved sub-dag): emit as a single node.
    const node = placementNode(placement, myId);
    const enriched: CytoscapeNodeElement = myCompoundParent !== undefined
      ? { ...node, "data": { ...node.data, "parent": myCompoundParent } }
      : node;
    state.elements.push(enriched);

    for (const edge of placementEdges(placement, myId, prefix)) {
      // Suppress synthetic-END routes for children inside a parallel —
      // the parent placement's own edges carry the collected result.
      if (parallelParent !== undefined && edge.data.target === idIn(prefix, END_ID)) continue;
      // Inside an expanded sub-DAG (prefix non-empty), `null` targets
      // refer to the sub-DAG's terminus, not the parent's END. The
      // compound parent's own placementEdges carry the real external
      // routing — drop these internal terminal markers so cytoscape
      // doesn't try to wire an edge to a non-existent prefixed END.
      if (prefix !== '' && edge.data.target === idIn(prefix, END_ID)) continue;
      if (edge.data.target === idIn(prefix, END_ID)) state.touchesTerminal = true;
      state.elements.push(edge);
    }
  }
}

function placementEdges(
  placement: DAGNodeEntry,
  fromId: string,
  prefix: string,
): readonly CytoscapeEdgeElement[] {
  const edges: CytoscapeEdgeElement[] = [];
  for (const [output, target] of Object.entries(placement.outputs)) {
    const destId = target === null ? idIn(prefix, END_ID) : idIn(prefix, target);
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

/** Render a `DAG` as Cytoscape elements. */
export class CytoscapeRenderer {
  private constructor() { /* static class */ }

  static render(dag: DAG, options: RenderOptions = {}): readonly CytoscapeElement[] {
    const state: RenderState = {
      "elements":        [],
      "options":         options,
      "touchesTerminal": false,
    };
    renderInto(dag, '', undefined, state, 0, new Set<string>([dag.name]));

    if (state.touchesTerminal) {
      state.elements.push({
        "group": 'nodes',
        "data":  { "id": END_ID, "label": 'end', "type": 'terminal' },
        "classes": 'dag-terminal',
      });
    }

    return state.elements;
  }
}
