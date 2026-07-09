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
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';
import { GatherStrategyNames } from '@studnicky/dagonizer/constants';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// #region state
export class WorkState extends NodeStateBase {
  tasks:      number[] = [];    // source items; the scatter reads this by name
  results:    number[] = [];    // gather target: computed results land here
  lastResult: number   = 0;     // scalar written per-item; gathered by 'append'

  protected override snapshotData(): JsonObjectType {
    return {
      "tasks":      [...this.tasks],
      "results":    [...this.results],
      "lastResult": this.lastResult,
    };
  }

  protected override restoreData(snapshot: JsonObjectType): void {
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
export class SquareWorkerNode extends MonadicNode<WorkState, 'done'> {
  readonly name = 'squareWorker';
  readonly '@id' = 'urn:noocodec:node:squareWorker';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<WorkState>) {
    for (const item of batch) {
      const state = item.state;
      // Each scatter item is written to metadata under the itemKey ('task').
      const task = state.getter.number('task');
      // Store the per-item result in a scalar field. The 'append' gather
      // strategy reads this field from the child clone and appends it to
      // state.results on the parent after all items complete.
      state.lastResult = task * task;
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}
// #endregion worker-node

// ---------------------------------------------------------------------------
// Sub-DAG: the body the ScatterNode runs per item inside the worker
// ---------------------------------------------------------------------------

// #region worker-dag
export const workerDag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:square-item',
  '@type':     'DAG',
  "name":        'square-item',
  "version":     '1',
  "entrypoints": { "main": 'urn:noocodec:dag:square-item/node/square' },
  "nodes": [
    {
      '@id': 'urn:noocodec:dag:square-item/node/square',
      '@type': 'SingleNode',
      "name":    'square',
      "node":    'urn:noocodec:node:squareWorker',
      "outputs": { "done": 'urn:noocodec:dag:square-item/node/item-end' },
    },
    {
      '@id': 'urn:noocodec:dag:square-item/node/item-end',
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
export const dag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:square-all',
  '@type':     'DAG',
  "name":        'square-all',
  "version":     '1',
  "entrypoints": { "main": 'urn:noocodec:dag:square-all/node/square-all' },
  "nodes": [
    {
      '@id': 'urn:noocodec:dag:square-all/node/square-all',
      '@type':      'ScatterNode',
      "name":         'square-all',
      "body":         { "dag": 'urn:noocodec:dag:square-item' },   // scatter body: run this sub-DAG per item
      "source":       'tasks',                     // state field holding the source array
      "itemKey":      'task',                      // metadata key each item is written under
      "execution": { "mode": "item", "concurrency": 2 },                           // run up to 2 items concurrently
      "container": 'cpu',                       // route each item through the worker container
      "outputs": {
        'all-success': 'urn:noocodec:dag:square-all/node/collect-results',
        "partial": 'urn:noocodec:dag:square-all/node/collect-results',
        'all-error': 'urn:noocodec:dag:square-all/node/collect-results',
        "empty":       'urn:noocodec:dag:square-all/node/end',
      },
    },
    {
      '@id': 'urn:noocodec:dag:square-all/node/collect-results',
      '@type': 'GatherNode',
      "name": 'collect-results',
      sources: { "urn:noocodec:dag:square-all/node/square-all": {} },
      "gather": {
        "strategy": GatherStrategyNames.APPEND,
        "field": 'lastResult',
        "target": 'results',
      },
      "outputs": { "success": 'urn:noocodec:dag:square-all/node/end', "error": 'urn:noocodec:dag:square-all/node/end', "empty": 'urn:noocodec:dag:square-all/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:square-all/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};
// #endregion parent-dag
