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
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
import { GatherStrategyNames } from '@studnicky/dagonizer/constants';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// #region state
export class MultiBackendState extends NodeStateBase {
  tasks:      number[] = [];   // source items; scatter reads this by name
  results:    number[] = [];   // gather target: squared results land here
  lastResult: number   = 0;    // scalar per-item, gathered by 'append'
  total:      number   = 0;    // sum of all squared results (written by sum node)


}
// #endregion state

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

// #region nodes
/** CPU node: squares the current scatter item. Runs inside the `cpu` container. */
export class SquareNode extends MonadicNode<MultiBackendState, 'done'> {
  readonly name = 'squareNode';
  readonly '@id' = 'urn:noocodec:node:squareNode';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<MultiBackendState>) {
    for (const item of batch) {
      const task = item.state.getter.number('task');
      item.state.lastResult = task * task;
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

/** IO node: sums all results. Runs inside the `io` container. */
export class SumNode extends MonadicNode<MultiBackendState, 'done'> {
  readonly name = 'sumNode';
  readonly '@id' = 'urn:noocodec:node:sumNode';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<MultiBackendState>) {
    for (const item of batch) {
      item.state.total = item.state.results.reduce((acc, n) => acc + n, 0);
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}
// #endregion nodes

// ---------------------------------------------------------------------------
// Sub-DAG: runs per scatter item in the `cpu` container
// ---------------------------------------------------------------------------

// #region cpu-dag
export const squareItemDag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:square-item-mb',
  '@type':     'DAG',
  "name":       'square-item-mb',
  "version":    '1',
  "entrypoints": { "main": 'urn:noocodec:dag:square-item-mb/node/square' },
  "nodes": [
    {
      '@id': 'urn:noocodec:dag:square-item-mb/node/square',
      '@type': 'SingleNode',
      "name":    'square',
      "node":    'urn:noocodec:node:squareNode',
      "outputs": { "done": 'urn:noocodec:dag:square-item-mb/node/item-end' },
    },
    {
      '@id': 'urn:noocodec:dag:square-item-mb/node/item-end',
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
export const sumResultsDag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:sum-results',
  '@type':     'DAG',
  "name":       'sum-results',
  "version":    '1',
  "entrypoints": { "main": 'urn:noocodec:dag:sum-results/node/sum' },
  "nodes": [
    {
      '@id': 'urn:noocodec:dag:sum-results/node/sum',
      '@type': 'SingleNode',
      "name":    'sum',
      "node":    'urn:noocodec:node:sumNode',
      "outputs": { "done": 'urn:noocodec:dag:sum-results/node/sum-end' },
    },
    {
      '@id': 'urn:noocodec:dag:sum-results/node/sum-end',
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
export const dag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:multibackend',
  '@type':     'DAG',
  "name":       'multibackend',
  "version":    '1',
  "entrypoints": { "main": 'urn:noocodec:dag:multibackend/node/square-all' },
  "nodes": [
    {
      '@id': 'urn:noocodec:dag:multibackend/node/square-all',
      '@type':      'ScatterNode',
      "name":         'square-all',
      "body":         { "dag": 'urn:noocodec:dag:square-item-mb' },
      "source":       'tasks',
      "itemKey":      'task',
      "execution": { "mode": "item", "concurrency": 2 },
      "container":    'cpu',                  // routes per-item body to the WorkerThreadContainer
      "outputs": {
        'all-success': 'urn:noocodec:dag:multibackend/node/collect-results',
        "partial": 'urn:noocodec:dag:multibackend/node/collect-results',
        'all-error': 'urn:noocodec:dag:multibackend/node/end',
        "empty": 'urn:noocodec:dag:multibackend/node/end',
      },
    },
    {
      '@id': 'urn:noocodec:dag:multibackend/node/collect-results',
      '@type': 'GatherNode',
      "name": 'collect-results',
      sources: { "urn:noocodec:dag:multibackend/node/square-all": {} },
      "gather": {
        "strategy":   GatherStrategyNames.APPEND,
        "field":      'lastResult',
        "target":     'results',
      },
      "outputs": { "success": 'urn:noocodec:dag:multibackend/node/sum-all', "error": 'urn:noocodec:dag:multibackend/node/end', "empty": 'urn:noocodec:dag:multibackend/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:multibackend/node/sum-all',
      '@type':     'EmbeddedDAGNode',
      "name":       'sum-all',
      "dag":        'urn:noocodec:dag:sum-results',
      "container":  'io',                     // routes the embedded DAG to the ForkContainer
      // The child clone preserves only metadata; domain fields cross the
      // boundary via state mapping. Seed the child's `results` from the
      // parent (input), and copy the child's `total` back (output).
      "stateMapping": {
        "input":  { "results": 'results' },
        "output": { "total":   'total' },
      },
      "outputs":    { "success": 'urn:noocodec:dag:multibackend/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:multibackend/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};
// #endregion parent-dag
