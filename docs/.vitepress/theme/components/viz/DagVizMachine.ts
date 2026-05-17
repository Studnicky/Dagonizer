/**
 * DagVizMachine — composite that holds per-node + per-edge
 * `NodeVizMachine` / `EdgeVizMachine` instances indexed by cytoscape id.
 *
 * The Vue runner's observer dispatches one lifecycle event into this
 * composite; the composite routes to the right sub-machine. This is the
 * single seam where the dispatcher's state machine meets the
 * visualisation's state machine — both sides are FSMs, neither side
 * pokes the other directly.
 *
 *   Observer event           Composite dispatch
 *   ───────────────          ──────────────────
 *   onNodeStart('foo')   →   { type: 'NODE_START', node: 'foo' }
 *   onNodeEnd('foo','x') →   { type: 'NODE_END',   node: 'foo' }
 *                            { type: 'EDGE_TRAVERSE', source: 'foo', route: 'x' }
 *   onError('foo', err)  →   { type: 'NODE_ERROR', node: 'foo' }
 *   onFlowStart(...)     →   { type: 'RESET' }
 */

import { EdgeVizMachine, type EdgeVizAdapter } from './EdgeVizMachine.ts';
import { NodeVizMachine, type NodeVizAdapter, type NodeVizState } from './NodeVizMachine.ts';

export type DagVizEvent =
  | { readonly type: 'NODE_START';    readonly node: string }
  | { readonly type: 'NODE_END';      readonly node: string }
  | { readonly type: 'NODE_ERROR';    readonly node: string }
  | { readonly type: 'EDGE_TRAVERSE'; readonly source: string; readonly route: string }
  | { readonly type: 'RESET' };

export interface DagVizAdapters {
  /** Build the per-node cytoscape adapter for the given node id. */
  nodeAdapter(id: string): NodeVizAdapter;
  /**
   * Build the per-edge cytoscape adapter for edges matching
   * `[source][route]`. May resolve to multiple cytoscape edges if more
   * than one carries the same source/route pair — the adapter applies
   * each operation to the full collection.
   */
  edgeAdapter(source: string, route: string): EdgeVizAdapter;
  /** Reset hook — clear classes and stop animations on every element. */
  resetAll(): void;
}

export class DagVizMachine {
  readonly #nodes = new Map<string, NodeVizMachine>();
  readonly #edges = new Map<string, EdgeVizMachine>();
  readonly #adapters: DagVizAdapters;

  constructor(adapters: DagVizAdapters) {
    this.#adapters = adapters;
  }

  /** Inspect current visual state for a node — useful for the legend / tests. */
  nodeState(id: string): NodeVizState | undefined {
    return this.#nodes.get(id)?.state;
  }

  dispatch(event: DagVizEvent): void {
    switch (event.type) {
      case 'NODE_START':
        this.#node(event.node).dispatch({ type: 'start' });
        return;
      case 'NODE_END':
        this.#node(event.node).dispatch({ type: 'end' });
        return;
      case 'NODE_ERROR':
        this.#node(event.node).dispatch({ type: 'error' });
        return;
      case 'EDGE_TRAVERSE':
        this.#edge(event.source, event.route).dispatch({ type: 'traverse' });
        return;
      case 'RESET':
        for (const m of this.#nodes.values()) m.dispatch({ type: 'reset' });
        for (const m of this.#edges.values()) m.dispatch({ type: 'reset' });
        this.#adapters.resetAll();
        return;
    }
  }

  #node(id: string): NodeVizMachine {
    let m = this.#nodes.get(id);
    if (m === undefined) {
      m = new NodeVizMachine(this.#adapters.nodeAdapter(id));
      this.#nodes.set(id, m);
    }
    return m;
  }

  #edge(source: string, route: string): EdgeVizMachine {
    const key = `${source}|${route}`;
    let m = this.#edges.get(key);
    if (m === undefined) {
      m = new EdgeVizMachine(this.#adapters.edgeAdapter(source, route));
      this.#edges.set(key, m);
    }
    return m;
  }
}
