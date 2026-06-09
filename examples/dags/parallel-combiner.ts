/**
 * scatter-extensions/dags: demonstrates scatter extension points —
 * custom GatherStrategy and custom OutcomeReducer — via the
 * GatherStrategies and OutcomeReducers static registries.
 *
 * Pure module: no side effects beyond registry.register calls; no dispatcher.
 */

import {
  GatherStrategies,
  GatherStrategy,
  OutcomeReducer,
  OutcomeReducers,
} from '@noocodex/dagonizer';
import type {
  GatherConfig,
  GatherExecution,
  NodeStateInterface,
  OutcomeRecord,
} from '@noocodex/dagonizer';

// #region gather-strategy
/**
 * TopNGatherStrategy: collects each clone's `candidate` field, keeps the
 * top-N by score, and writes the result to `topCandidates` on the parent.
 * Registered under 'top-n'. Reference via `gather: { strategy: 'top-n', target: 'topCandidates' }`
 * on a ScatterNode placement to collect and rank clone outputs in one pass.
 */
interface ScoredCandidate {
  readonly score: number;
}

class TopNGatherStrategy extends GatherStrategy {
  readonly name = 'top-n';

  async apply<TState extends NodeStateInterface>(
    config: GatherConfig,
    execution: GatherExecution<TState>,
  ): Promise<void> {
    const target = config.target ?? 'topCandidates';
    const n = 3;
    const all = execution.records.map((r) =>
      execution.accessor.get(r.cloneState, 'candidate') as ScoredCandidate | undefined,
    ).filter((c): c is ScoredCandidate => c !== undefined);
    const sorted = [...all].sort((a, b) => b.score - a.score).slice(0, n);
    execution.accessor.set(execution.state, target, sorted);
  }
}

GatherStrategies.register(new TopNGatherStrategy());
// GatherStrategies.resolve('top-n') now works in any scatter placement.
// #endregion gather-strategy

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
