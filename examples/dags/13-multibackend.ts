/**
 * 13-multibackend/dags: pure module — state, nodes, and DAG consts.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/13-multibackend.ts and examples/dags/13-multibackend.registry.ts.
 *
 * Architecture:
 *   A DAG with TWO distinct container roles:
 *     - `cpu` role: a ScatterNode whose body is a sub-DAG runs inside a
 *       WorkerThreadContainer (thread pool). Each scatter item squares a number.
 *     - `io` role: an EmbeddedDAGNode runs inside a ForkContainer (fork pool).
 *       The embedded DAG sums all squared results.
 *
 *   The primary purpose of this example is to demonstrate that the Mermaid
 *   renderer emits TWO distinct `classDef contained-cpu` / `classDef contained-io`
 *   lines with DIFFERENT fills so the two backend roles are visually separable.
 *
 *   Real dual-backend execution requires the registry to be compiled first:
 *     tsc -p examples/tsconfig.multibackend.json
 *   then:
 *     node examples/dist/13-multibackend.js
 *
 *   The Mermaid render path works with tsx directly (no compile step needed).
 */

import {
  DAG_CONTEXT,
  NodeOutputBuilder,
  NodeStateBase,
  ScalarNode,
} from '@noocodex/dagonizer';
import type { DAG } from '@noocodex/dagonizer';
import type { JsonObject } from '@noocodex/dagonizer/entities';
import { GatherStrategyName } from '@noocodex/dagonizer/constants';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// #region state
export class MultiBackendState extends NodeStateBase {
  tasks:      number[] = [];   // source items; scatter reads this by name
  results:    number[] = [];   // gather target: squared results land here
  lastResult: number   = 0;    // scalar per-item, gathered by 'append'
  total:      number   = 0;    // sum of all squared results (written by sum node)

  protected override snapshotData(): JsonObject {
    return {
      "tasks":      [...this.tasks],
      "results":    [...this.results],
      "lastResult": this.lastResult,
      "total":      this.total,
    };
  }

  protected override restoreData(snapshot: JsonObject): void {
    const tasks = snapshot['tasks'];
    if (Array.isArray(tasks)) {
      this.tasks = tasks.filter((x): x is number => typeof x === 'number');
    }
    const results = snapshot['results'];
    if (Array.isArray(results)) {
      this.results = results.filter((x): x is number => typeof x === 'number');
    }
    const last = snapshot['lastResult'];
    if (typeof last === 'number') this.lastResult = last;
    const total = snapshot['total'];
    if (typeof total === 'number') this.total = total;
  }
}
// #endregion state

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

// #region nodes
/** CPU node: squares the current scatter item. Runs inside the `cpu` container. */
export class SquareNode extends ScalarNode<MultiBackendState, 'done'> {
  readonly name = 'squareNode';
  readonly outputs = ['done'] as const;

  protected override async executeOne(state: MultiBackendState) {
    const task = state.getMetadata<number>('task') ?? 0;
    state.lastResult = task * task;
    return NodeOutputBuilder.of('done');
  }
}

/** IO node: sums all results. Runs inside the `io` container. */
export class SumNode extends ScalarNode<MultiBackendState, 'done'> {
  readonly name = 'sumNode';
  readonly outputs = ['done'] as const;

  protected override async executeOne(state: MultiBackendState) {
    state.total = state.results.reduce((acc, n) => acc + n, 0);
    return NodeOutputBuilder.of('done');
  }
}
// #endregion nodes

// ---------------------------------------------------------------------------
// Sub-DAG: runs per scatter item in the `cpu` container
// ---------------------------------------------------------------------------

// #region cpu-dag
export const squareItemDag: DAG = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:square-item-mb',
  '@type':     'DAG',
  "name":       'square-item-mb',
  "version":    '1',
  "entrypoint": 'square',
  "nodes": [
    {
      '@id':   'urn:noocodex:dag:square-item-mb/node/square',
      '@type': 'SingleNode',
      "name":    'square',
      "node":    'squareNode',
      "outputs": { "done": 'item-end' },
    },
    {
      '@id':     'urn:noocodex:dag:square-item-mb/node/item-end',
      '@type':   'TerminalNode',
      "name":    'item-end',
      "outcome": 'completed',
    },
  ],
};
// #endregion cpu-dag

// ---------------------------------------------------------------------------
// Sub-DAG: runs in the `io` container — sums the collected results
// ---------------------------------------------------------------------------

// #region io-dag
export const sumResultsDag: DAG = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:sum-results',
  '@type':     'DAG',
  "name":       'sum-results',
  "version":    '1',
  "entrypoint": 'sum',
  "nodes": [
    {
      '@id':   'urn:noocodex:dag:sum-results/node/sum',
      '@type': 'SingleNode',
      "name":    'sum',
      "node":    'sumNode',
      "outputs": { "done": 'sum-end' },
    },
    {
      '@id':     'urn:noocodex:dag:sum-results/node/sum-end',
      '@type':   'TerminalNode',
      "name":    'sum-end',
      "outcome": 'completed',
    },
  ],
};
// #endregion io-dag

// ---------------------------------------------------------------------------
// Parent DAG: scatter (cpu) → sum (io)
// ---------------------------------------------------------------------------

// #region parent-dag
export const dag: DAG = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:multibackend',
  '@type':     'DAG',
  "name":       'multibackend',
  "version":    '1',
  "entrypoint": 'square-all',
  "nodes": [
    {
      '@id':        'urn:noocodex:dag:multibackend/node/square-all',
      '@type':      'ScatterNode',
      "name":         'square-all',
      "body":         { "dag": 'square-item-mb' },
      "source":       'tasks',
      "itemKey":      'task',
      "concurrency":  2,
      "container":    'cpu',                  // routes per-item body to the WorkerThreadContainer
      "gather": {
        "strategy":   GatherStrategyName.APPEND,
        "field":      'lastResult',
        "target":     'results',
      },
      "outputs": {
        'all-success': 'sum-all',
        "partial":     'sum-all',
        'all-error':   'end',
        "empty":       'end',
      },
    },
    {
      '@id':       'urn:noocodex:dag:multibackend/node/sum-all',
      '@type':     'EmbeddedDAGNode',
      "name":       'sum-all',
      "dag":        'sum-results',
      "container":  'io',                     // routes the embedded DAG to the ForkContainer
      // The child clone preserves only metadata; domain fields cross the
      // boundary via state mapping. Seed the child's `results` from the
      // parent (input), and copy the child's `total` back (output).
      "stateMapping": {
        "input":  { "results": 'results' },
        "output": { "total":   'total' },
      },
      "outputs":    { "success": 'end' },
    },
    {
      '@id':     'urn:noocodex:dag:multibackend/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};
// #endregion parent-dag
