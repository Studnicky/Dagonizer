/**
 * CytoscapeRenderer — render a `DAG` as Cytoscape elements.
 *
 * Output is the array shape `cytoscape.js` consumes directly:
 *
 *   const cy = cytoscape({
 *     container: document.getElementById('graph'),
 *     elements:  CytoscapeRenderer.render(dag, { deepDags }),
 *     // ...stylesheet, layout...
 *   });
 *
 * Every placement becomes a node element carrying its `type` (single /
 * parallel / fan-out / deep-dag) so consumers can style per-type via
 * Cytoscape's `style({ selector: 'node[type="fan-out"]', ... })`. Every
 * output route becomes an edge labeled with the route's name.
 *
 * Compound rendering:
 *   • Parallel children render with `parent: <parallel placement name>`
 *     so cytoscape draws them inside the parallel placement's box.
 *   • Deep-DAG placements, when their target DAG is supplied via the
 *     `deepDags` registry, expand RECURSIVELY: every inner node renders
 *     with the placement as `parent`, so the user sees the actual flow
 *     inside the cluster — no shortcuts, no opaque boxes.
 *
 * Routes targeting `null` become edges to a synthetic `END` node so
 * the live runner can highlight termination explicitly. END edges
 * inside a parallel or deep-DAG cluster are suppressed (the parent
 * placement's own edges carry the collected/terminal route out).
 *
 * Static class. The renderer does not invoke Cytoscape; it returns a
 * plain element array.
 */

import type { DAG } from '../entities/dag/DAG.js';
import type { DeepDAGNode } from '../entities/dag/DeepDAGNode.js';
import type { FanOutNode } from '../entities/dag/FanOutNode.js';
import type { ParallelNode } from '../entities/dag/ParallelNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';

type DAGNodeEntry = FanOutNode | ParallelNode | SingleNodePlacementInterface | DeepDAGNode;

/** A Cytoscape node element. */
export interface CytoscapeNodeElement {
  readonly group: 'nodes';
  readonly data: {
    readonly id: string;
    readonly label: string;
    /** Placement kind — selector use: `node[type="fan-out"]`. */
    readonly type: 'single' | 'parallel' | 'fan-out' | 'deep-dag' | 'terminal';
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
   * Registry of deep-DAGs by name. Any `deep-dag` placement whose
   * `placement.dag` matches a key here is expanded inline — its
   * internal nodes/edges render as compound-graph children of the
   * placement, so the diagram shows the full inner flow instead of
   * a single opaque box.
   */
  readonly deepDags?: ReadonlyMap<string, DAG>;
  /** Max recursion depth — guards against accidental sub-DAG cycles. */
  readonly maxDepth?: number;
}

const END_ID = 'END';
const DEFAULT_MAX_DEPTH = 6;

const PLACEMENT_KIND: Readonly<Record<string, 'single' | 'parallel' | 'fan-out' | 'deep-dag'>> = {
  'SingleNode':  'single',
  'ParallelNode': 'parallel',
  'FanOutNode':  'fan-out',
  'DeepDAGNode': 'deep-dag',
};

const placementNode = (placement: DAGNodeEntry, id: string): CytoscapeNodeElement => {
  const kind = PLACEMENT_KIND[placement['@type']] ?? 'single';
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
    case 'DeepDAGNode':
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
    if (placement['@type'] === 'ParallelNode') {
      for (const child of placement.nodes) childToParent.set(child, placement.name);
    }
  }

  for (const placement of dag.nodes as readonly DAGNodeEntry[]) {
    const myId = idIn(prefix, placement.name);
    const parallelParent = childToParent.get(placement.name);
    const myCompoundParent = parallelParent !== undefined
      ? idIn(prefix, parallelParent)
      : compoundParent;

    // ── Deep-DAG: if the target DAG is registered, expand inline as a
    //    compound parent containing the deep-DAG's full flow.
    const deepDagName = placement['@type'] === 'DeepDAGNode' ? placement.dag : null;
    const deepDagBody = deepDagName !== null
      ? state.options.deepDags?.get(deepDagName)
      : undefined;
    const shouldExpand = deepDagBody !== undefined
      && deepDagName !== null
      && depth < (state.options.maxDepth ?? DEFAULT_MAX_DEPTH)
      && !visited.has(deepDagName);

    if (shouldExpand && deepDagBody !== undefined && deepDagName !== null) {
      // Emit the placement as a compound parent (label tells the visitor
      // which deep-DAG this cluster represents).
      const parentNode = placementNode(placement, myId);
      const labelled: CytoscapeNodeElement = {
        ...parentNode,
        "data": {
          ...parentNode.data,
          "label": `${placement.name}\n[${deepDagName}]`,
          ...(myCompoundParent !== undefined ? { "parent": myCompoundParent } : {}),
        },
      };
      state.elements.push(labelled);

      // Recurse: render every node of the deep-DAG with `parent: myId`.
      const innerPrefix = idIn(prefix, placement.name);
      const innerVisited = new Set(visited);
      innerVisited.add(deepDagName);
      renderInto(deepDagBody, innerPrefix, myId, state, depth + 1, innerVisited);

      // External outputs from this placement (after the sub-DAG completes)
      // — emit them as edges from the COMPOUND PARENT to wherever the
      // placement routes. Cytoscape will draw them at the cluster boundary.
      for (const edge of placementEdges(placement, myId, prefix)) {
        if (edge.data.target === idIn(prefix, END_ID)) state.touchesTerminal = true;
        state.elements.push(edge);
      }
      continue;
    }

    // ── Regular placement (or unresolved deep-dag): emit as a single node.
    const node = placementNode(placement, myId);
    const enriched: CytoscapeNodeElement = myCompoundParent !== undefined
      ? { ...node, "data": { ...node.data, "parent": myCompoundParent } }
      : node;
    state.elements.push(enriched);

    for (const edge of placementEdges(placement, myId, prefix)) {
      // Suppress synthetic-END routes for children inside a parallel —
      // the parent placement's own edges carry the collected result.
      if (parallelParent !== undefined && edge.data.target === idIn(prefix, END_ID)) continue;
      // Inside an expanded deep-DAG (prefix non-empty), `null` targets
      // refer to the deep-DAG's terminus, not the parent's END. The
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
