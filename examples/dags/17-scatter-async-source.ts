/**
 * 17-scatter-async-source/dags: pure module — state, worker node, and DAG.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/17-scatter-async-source.ts (the executable entry point).
 *
 * Demonstrates a ScatterNode whose `source` is an `AsyncIterable` (an async
 * generator) rather than a plain array. The engine normalises any async-iterable
 * source via `Dagonizer.toAsyncIterator` and drives it with the same bounded
 * worker-pool as arrays.
 *
 * Backpressure in action:
 *   The pull loop only calls `iterator.next()` when a worker slot is free
 *   (activeWorkers < concurrencyLimit). Items are therefore pulled from the
 *   generator lazily — one slot, one pull. An async generator that yields on
 *   demand will never yield more items than the concurrency cap can absorb.
 *
 * Observable evidence:
 *   An event log records every "pull" (generator yields an item) and "process"
 *   (worker body executes) event in call order. With `concurrency=2`:
 *     - Items 0 and 1 are pulled immediately (two free slots).
 *     - Item 2 is pulled only after worker 0 or 1 completes (one slot freed).
 *     - Item 3 is pulled only after the next worker completes.
 *     - …and so on.
 *   The pull events interleave with process events — the generator is never
 *   more than `concurrency` items ahead of the slowest worker.
 *
 * The source is a state field of type `AsyncIterable<string>` set by the
 * entry-point before execution. The engine reads this field via the path
 * accessor and normalises it to an AsyncIterator internally.
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
// Event log (shared between generator and worker, filled during execution)
// ---------------------------------------------------------------------------

// #region event-log
/**
 * Sequential event log, shared by the async generator and the worker node.
 * Populated at runtime — empty until `dispatcher.execute()` runs.
 */
export const eventLog: string[] = [];
// #endregion event-log

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// #region state
export class AsyncSourceState extends NodeStateBase {
  /**
   * The scatter source. The engine reads this field (path `'stream'`) and
   * normalises it to an `AsyncIterator` automatically. An `AsyncIterable`
   * set here is NOT captured by the graph — the durable projection deliberately
   * omits it because async generators are not JSON-serialisable. Resume
   * from mid-async-source requires the caller to re-provide the generator
   * at the correct position (documented in the lesson comment at the bottom
   * of the entry-point).
   */
  stream:   AsyncIterable<string> | null = null;
  /** Per-clone scalar: the worker writes the processed value here. */
  item:     string                 = '';
  /** Gather target: each clone's `item` field in order. */
  results:  string[]               = [];
}
// #endregion state

// ---------------------------------------------------------------------------
// Worker node
// ---------------------------------------------------------------------------

// #region worker-node
export class ConsumeNode extends MonadicNode<AsyncSourceState, 'done'> {
  readonly name = 'consume';
  readonly '@id' = 'urn:noocodec:node:consume';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<AsyncSourceState>) {
    for (const item of batch) {
      const state = item.state;
      const raw = state.getter.string('stream-item', '?');
      state.item = `[processed:${raw}]`;
      eventLog.push(`process  ${raw}`);
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}
// #endregion worker-node

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

// #region dag
export const dag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:async-source',
  '@type':     'DAG',
  "name":      'async-source',
  "version":   '1',
  "entrypoints": { "main": 'urn:noocodec:dag:async-source/node/scatter-stream' },
  "nodes": [
    {
      '@id': 'urn:noocodec:dag:async-source/node/scatter-stream',
      '@type':     'ScatterNode',
      "name":      'scatter-stream',
      "body":      { "node": 'urn:noocodec:node:consume' },
      "source":    'stream',            // async-iterable field; engine normalises it
      "itemKey":   'stream-item',       // metadata key each pulled item is bound to
      "execution": { "mode": "item", "concurrency": 2 },                 // max 2 items in-flight simultaneously
      "outputs": {
        'all-success': 'urn:noocodec:dag:async-source/node/collect-results',
        "partial": 'urn:noocodec:dag:async-source/node/collect-results',
        'all-error': 'urn:noocodec:dag:async-source/node/collect-results',
        "empty": 'urn:noocodec:dag:async-source/node/end',
      },
    },
    {
      '@id': 'urn:noocodec:dag:async-source/node/collect-results',
      '@type': 'GatherNode',
      "name": 'collect-results',
      sources: { "urn:noocodec:dag:async-source/node/scatter-stream": {} },
      "gather": {
        "strategy": GatherStrategyNames.MAP,
        "mapping": { "item": 'results' },
      },
      "outputs": { "success": 'urn:noocodec:dag:async-source/node/end', "error": 'urn:noocodec:dag:async-source/node/end', "empty": 'urn:noocodec:dag:async-source/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:async-source/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};
// #endregion dag
