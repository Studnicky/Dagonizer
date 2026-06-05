/**
 * parallel-combiner/dags: demonstrates custom ParallelCombiner and custom
 * OutcomeReducer registration via the ParallelCombiners and OutcomeReducers
 * static registries.
 *
 * Pure module: no side effects beyond registry.register calls; no dispatcher.
 */

import {
  OutcomeReducer,
  OutcomeReducers,
  ParallelCombiner,
  ParallelCombiners,
} from '@noocodex/dagonizer';
import type { OutcomeRecord, ParallelResult } from '@noocodex/dagonizer';
import type { NodeStateInterface } from '@noocodex/dagonizer';

// #region parallel-combiner
/**
 * MajorityCombiner: succeeds when more than half the parallel nodes report
 * 'success'. Registered under 'majority' so any parallel placement with
 * `combine: 'majority'` uses this strategy.
 */
class MajorityCombiner extends ParallelCombiner {
  readonly name = 'majority';

  combine(
    outputs: readonly string[],
    _results: readonly ParallelResult[],
    _state: NodeStateInterface,
  ): string {
    if (outputs.length === 0) return 'error';
    const successes = outputs.filter((o) => o === 'success').length;
    return successes > outputs.length / 2 ? 'success' : 'error';
  }
}

ParallelCombiners.register(new MajorityCombiner());
// ParallelCombiners.resolve('majority') now works in any parallel placement.
// #endregion parallel-combiner

// #region outcome-reducer
/**
 * ThresholdReducer: succeeds when at least 75% of scatter clones report
 * 'success'. Returns 'all-success', 'partial', or 'all-error' to match the
 * standard ScatterOutput vocabulary so downstream routing stays consistent.
 *
 * Registered under 'threshold-75'. Reference it via `reducer: 'threshold-75'`
 * on a ScatterNode placement to override the default 'aggregate' reducer.
 */
class ThresholdReducer extends OutcomeReducer {
  readonly name = 'threshold-75';

  reduce(records: ReadonlyArray<OutcomeRecord>): string {
    if (records.length === 0) return 'empty';
    const successRate = records.filter((r) => r.output === 'success').length / records.length;
    if (successRate >= 0.75) return 'all-success';
    if (successRate === 0)   return 'all-error';
    return 'partial';
  }
}

OutcomeReducers.register(new ThresholdReducer());
// OutcomeReducers.resolve('threshold-75') now works in any scatter placement.
// #endregion outcome-reducer

