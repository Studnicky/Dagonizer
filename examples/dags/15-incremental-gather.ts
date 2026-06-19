/**
 * 15-incremental-gather/dags: pure module — state, nodes, and DAGs.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/15-incremental-gather.ts (the executable entry point).
 *
 * Demonstrates the difference between incremental and batch gather:
 *
 *   Strategies that override `reduce` are called after EACH clone body
 *   completes (or per micro-batch), folding results into parent state as they
 *   arrive. Strategies that leave `reduce` as a no-op and override `finalize`
 *   instead accumulate all records and call `finalize` once after every clone
 *   completes.
 *
 *   This module registers two strategies that extend `GatherStrategy` directly,
 *   but add a print-log call so the timing of each fold is observable from the
 *   outside.
 */

import {
  DAG_CONTEXT,
  GatherStrategies,
  GatherStrategy,
  NodeOutputBuilder,
  NodeStateBase,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';
import type { GatherExecutionType, GatherRecordType } from '@studnicky/dagonizer';
import type { GatherConfigType } from '@studnicky/dagonizer';
import type { StateAccessorInterface } from '@studnicky/dagonizer/contracts';
import type { NodeStateInterface } from '@studnicky/dagonizer';
import { GatherStrategyNames } from '@studnicky/dagonizer/constants';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// #region state
export class IncrementalState extends NodeStateBase {
  /** Items to scatter over. */
  words:     string[] = [];
  /** Per-clone scalar: the node writes the processed value here. */
  processed: string  = '';
  /** Gather target: each clone's `processed` scalar is appended here. */
  results:   string[] = [];
}
// #endregion state

// ---------------------------------------------------------------------------
// Worker node: converts an item and records it on the clone
// ---------------------------------------------------------------------------

// #region worker-node
export class ShoutNode extends ScalarNode<IncrementalState, 'done'> {
  readonly name = 'shout';
  readonly outputs = ['done'] as const;

  protected override async executeOne(state: IncrementalState) {
    const word = state.getMetadata<string>('word') ?? '?';
    // Write a scalar to `processed` on the clone. The map gather reads
    // `processed` off each clone and appends it to the parent's `results`.
    // (A map gather appends one entry per clone; keep the source field scalar.)
    state.processed = word.toUpperCase();
    return NodeOutputBuilder.of('done');
  }
}
// #endregion worker-node

// ---------------------------------------------------------------------------
// Observable gather strategies
// ---------------------------------------------------------------------------

// #region observable-strategies
/**
 * Wraps per-clone `reduce` logic and emits a log line each time a single
 * record is folded into parent state. Makes the streaming accumulation of
 * `state.results` visible during execution.
 */
export class LoggingMapStrategy extends GatherStrategy {
  readonly name = 'logging-map';

  private readonly foldLog: string[];

  constructor(foldLog: string[]) {
    super();
    this.foldLog = foldLog;
  }

  // Called after EACH clone body completes (or per micro-batch).
  override reduce(
    config: GatherConfigType,
    batch: Parameters<GatherStrategy['reduce']>[1],
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    const mapping = config.mapping ?? {};
    for (const item of batch) {
      const record = item.state as GatherRecordType<NodeStateInterface>;
      for (const [clonePath, parentPath] of Object.entries(mapping)) {
        const value = accessor.get(record.cloneState, clonePath);
        const existing = accessor.get<readonly unknown[]>(state, parentPath) ?? [];
        const next = [...existing, value];
        accessor.set(state, parentPath, next);
        this.foldLog.push(
          `[incremental] clone[${record.index}] folded → results now ${JSON.stringify(next)}`,
        );
      }
    }
  }
}

/**
 * Custom gather strategy: accumulates ALL records into a single array in one
 * call after every clone completes. `reduce` is a no-op; `finalize` handles
 * all records at the end.
 */
export class BatchOnlyStrategy extends GatherStrategy {
  readonly name = 'batch-only';

  private readonly foldLog: string[];

  constructor(foldLog: string[]) {
    super();
    this.foldLog = foldLog;
  }

  // accumulate nothing per-clone — finalize handles all records
  override reduce(
    _config: GatherConfigType,
    _batch: Parameters<GatherStrategy['reduce']>[1],
    _state: NodeStateInterface,
    _accessor: StateAccessorInterface,
  ): void {
    // no-op
  }

  override async finalize(
    _config: GatherConfigType,
    execution: GatherExecutionType<NodeStateInterface>,
  ): Promise<void> {
    const values = execution.records.map((r) =>
      execution.accessor.get(r.cloneState, 'processed'),
    );
    const existing = execution.accessor.get<readonly unknown[]>(execution.state, 'results') ?? [];
    const allValues = [...existing, ...values];
    execution.accessor.set(execution.state, 'results', allValues);
    this.foldLog.push(
      `[batch] apply called ONCE with ${execution.records.length} records → results ${JSON.stringify(allValues)}`,
    );
  }
}
// #endregion observable-strategies

// ---------------------------------------------------------------------------
// Strategy registration
// ---------------------------------------------------------------------------

// #region register
/**
 * Register both observable strategies with a shared log array.
 * Returns the log array so callers can print it after execution.
 *
 * Call `GatherStrategies.unregister('logging-map')` /
 * `GatherStrategies.unregister('batch-only')` to clean up in tests.
 */
export class ObservableStrategies {
  static register(): string[] {
    const foldLog: string[] = [];
    GatherStrategies.register(new LoggingMapStrategy(foldLog));
    GatherStrategies.register(new BatchOnlyStrategy(foldLog));
    return foldLog;
  }
}
// #endregion register

// ---------------------------------------------------------------------------
// DAG: incremental gather (map / logging-map)
// ---------------------------------------------------------------------------

// #region incremental-dag
export const incrementalDag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:gather-demo:incremental',
  '@type':     'DAG',
  "name":      'incremental',
  "version":   '1',
  "entrypoint": 'scatter',
  "nodes": [
    {
      '@id':       'urn:noocodex:dag:gather-demo:incremental/node/scatter',
      '@type':     'ScatterNode',
      "name":      'scatter',
      "body":      { "node": 'shout' },
      "source":    'words',
      "itemKey":   'word',
      "concurrency": 1,                     // serial so fold ordering is deterministic
      "gather": {
        "strategy": 'logging-map',              // consumer-registered strategy name
        "mapping":  { "processed": 'results' }, // clone.processed (scalar) → parent.results
      },
      "outputs": {
        'all-success': 'end',
        "partial":     'end',
        'all-error':   'end',
        "empty":       'end',
      },
    },
    {
      '@id':     'urn:noocodex:dag:gather-demo:incremental/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};
// #endregion incremental-dag

// ---------------------------------------------------------------------------
// DAG: batch-only gather
// ---------------------------------------------------------------------------

// #region batch-dag
export const batchDag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:gather-demo:batch',
  '@type':     'DAG',
  "name":      'batch',
  "version":   '1',
  "entrypoint": 'scatter',
  "nodes": [
    {
      '@id':       'urn:noocodex:dag:gather-demo:batch/node/scatter',
      '@type':     'ScatterNode',
      "name":      'scatter',
      "body":      { "node": 'shout' },
      "source":    'words',
      "itemKey":   'word',
      "concurrency": 1,
      "gather": {
        "strategy": 'batch-only',            // reduce is no-op → finalize handles all records at end
        "mapping":  { "results": 'results' },
      },
      "outputs": {
        'all-success': 'end',
        "partial":     'end',
        'all-error':   'end',
        "empty":       'end',
      },
    },
    {
      '@id':     'urn:noocodex:dag:gather-demo:batch/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};
// #endregion batch-dag

// Re-export GatherStrategyNames for the entry-point to verify built-in list.
export { GatherStrategyNames };
