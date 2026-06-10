/**
 * 12-workers/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/12-workers.ts and examples/dags/12-workers.registry.ts.
 *
 * Architecture:
 *   A ScatterNode whose body is a sub-DAG binds `container: 'cpu'`. The
 *   dispatcher dispatches each scatter item to a WorkerThreadContainer
 *   that hosts a DagHost in a real worker thread. The worker dynamic-
 *   imports `12-workers.registry.js` (compiled from the .ts source) to
 *   reconstruct the identical bundle — same nodes, same DAG, same state
 *   restore function — inside the isolate.
 *
 *   The same DAG runs in-process if you remove `container: 'cpu'` from
 *   the ScatterNode and omit the containers option. See examples/04-scatter.ts
 *   for the in-process pattern; this example shows the container variant.
 *   See also examples/12-workers.ts for how to opt in to the container path.
 */

import {
  DAG_CONTEXT,
  NodeOutputBuilder,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { DAG } from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer/contracts';
import type { JsonObject } from '@noocodex/dagonizer/entities';
import { GatherStrategyName } from '@noocodex/dagonizer/constants';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// #region state
export class WorkState extends NodeStateBase {
  tasks:      number[] = [];    // source items; the scatter reads this by name
  results:    number[] = [];    // gather target: computed results land here
  lastResult: number   = 0;     // scalar written per-item; gathered by 'append'

  protected override snapshotData(): JsonObject {
    return {
      "tasks":      [...this.tasks],
      "results":    [...this.results],
      "lastResult": this.lastResult,
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
  }
}
// #endregion state

// ---------------------------------------------------------------------------
// Worker node: reads current task from metadata and squares it
// ---------------------------------------------------------------------------

// #region worker-node
export const squareWorker: NodeInterface<WorkState, 'done'> = {
  "name":    'squareWorker',
  "outputs": ['done'],
  async execute(state) {
    // Each scatter item is written to metadata under the itemKey ('task').
    const task = state.getMetadata<number>('task') ?? 0;
    // Store the per-item result in a scalar field. The 'append' gather
    // strategy reads this field from the child clone and appends it to
    // state.results on the parent after all items complete.
    state.lastResult = task * task;
    return NodeOutputBuilder.of('done');
  },
};
// #endregion worker-node

// ---------------------------------------------------------------------------
// Sub-DAG: the body the ScatterNode runs per item inside the worker
// ---------------------------------------------------------------------------

// #region worker-dag
export const workerDag: DAG = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:square-item',
  '@type':     'DAG',
  "name":        'square-item',
  "version":     '1',
  "entrypoint":  'square',
  "nodes": [
    {
      '@id':   'urn:noocodex:dag:square-item/node/square',
      '@type': 'SingleNode',
      "name":    'square',
      "node":    'squareWorker',
      "outputs": { "done": 'item-end' },
    },
    {
      '@id':     'urn:noocodex:dag:square-item/node/item-end',
      '@type':   'TerminalNode',
      "name":    'item-end',
      "outcome": 'completed',
    },
  ],
};
// #endregion worker-dag

// ---------------------------------------------------------------------------
// Parent DAG: scatter over tasks, run workerDag per item in a container
// ---------------------------------------------------------------------------

// #region parent-dag
export const dag: DAG = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:square-all',
  '@type':     'DAG',
  "name":        'square-all',
  "version":     '1',
  "entrypoint":  'square-all',
  "nodes": [
    {
      '@id':        'urn:noocodex:dag:square-all/node/square-all',
      '@type':      'ScatterNode',
      "name":         'square-all',
      "body":         { "dag": 'square-item' },   // scatter body: run this sub-DAG per item
      "source":       'tasks',                     // state field holding the source array
      "itemKey":      'task',                      // metadata key each item is written under
      "concurrency":  2,                           // run up to 2 items concurrently
      "container":    'cpu',                       // route each item through the worker container
      "gather": {
        "strategy":   GatherStrategyName.APPEND,     // collect results into a state array
        "field":      'lastResult',                // scalar field on child state (per item)
        "target":     'results',                   // target array on parent state
      },
      "outputs": {
        'all-success': 'end',
        "partial":     'end',
        'all-error':   'end',
        "empty":       'end',
      },
    },
    {
      '@id':     'urn:noocodex:dag:square-all/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};
// #endregion parent-dag
