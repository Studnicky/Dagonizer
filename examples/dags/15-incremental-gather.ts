/**
 * 15-incremental-gather/dags: pure module — state, nodes, and DAGs.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/15-incremental-gather.ts (the executable entry point).
 *
 * Demonstrates the difference between incremental and batch gather:
 *
 *   Incremental strategies (`map`, `append`, `collect`, `partition`) call
 *   `applyIncremental` after EACH clone body completes, folding results into
 *   parent state as they arrive. The engine also supports batch strategies
 *   (`custom`, and any consumer strategy without `applyIncremental`) that
 *   accumulate all records and call `apply` once at the end.
 *
 *   This module registers two strategies that extend the built-in `map` and
 *   `custom` behaviours respectively, but add a print-log call so the timing
 *   of each fold is observable from the outside.
 */

import {
  DAG_CONTEXT,
  GatherStrategies,
  GatherStrategy,
  NodeOutputBuilder,
  NodeStateBase,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';
import { IncrementalGatherStrategy } from '@noocodex/dagonizer/core';
import type { DAG, NodeInterface} from '@noocodex/dagonizer';
import type { GatherExecution, GatherRecord } from '@noocodex/dagonizer';
import type { GatherConfig } from '@noocodex/dagonizer';
import type { StateAccessor } from '@noocodex/dagonizer/contracts';
import type { NodeStateInterface } from '@noocodex/dagonizer';
import { GatherStrategyName } from '@noocodex/dagonizer/constants';

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
export class ShoutNode implements NodeInterface<IncrementalState, 'done'> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly name = 'shout';
  readonly outputs = ['done'] as const;

  async execute(state: IncrementalState) {
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
 * Wraps the built-in `map` strategy's `applyIncremental` logic and
 * emits a log line each time a single record is folded into parent state.
 * Makes the streaming accumulation of `state.results` visible during execution.
 */
export class LoggingMapStrategy extends IncrementalGatherStrategy {
  readonly name = 'logging-map';

  private readonly foldLog: string[];

  constructor(foldLog: string[]) {
    super();
    this.foldLog = foldLog;
  }

  // Called after EACH clone body completes (streaming fold).
  override applyIncremental(
    config: GatherConfig,
    record: GatherRecord<NodeStateInterface>,
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void {
    const mapping = config.mapping ?? {};
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

  // Called once after ALL clones complete for strategies that bypass
  // applyIncremental (ours never accumulates records for batch).
  async apply<TState extends NodeStateInterface>(
    _config: GatherConfig,
    execution: GatherExecution<TState>,
  ): Promise<void> {
    // No-op for this strategy: applyIncremental already handled every record.
    // The batch apply is only reached when the strategy has NO applyIncremental
    // or when acked records are replayed from a prior run. Neither applies here.
    this.foldLog.push(`[batch-apply called] ${execution.records.length} records (should be 0 for incremental)`);
  }
}

/**
 * Custom gather strategy: accumulates ALL records into a single array
 * in one batch call after every clone completes. No `applyIncremental`
 * override — the engine falls back to calling `apply` once at the end.
 */
export class BatchOnlyStrategy extends GatherStrategy {
  readonly name = 'batch-only';

  private readonly foldLog: string[];

  constructor(foldLog: string[]) {
    super();
    this.foldLog = foldLog;
  }

  // NO applyIncremental override — engine uses batch mode.

  async apply<TState extends NodeStateInterface>(
    _config: GatherConfig,
    execution: GatherExecution<TState>,
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
export const incrementalDag: DAG = {
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
export const batchDag: DAG = {
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
        "strategy": 'batch-only',            // no applyIncremental → batch at end
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

// Re-export GatherStrategyName for the entry-point to verify built-in list.
export { GatherStrategyName };
