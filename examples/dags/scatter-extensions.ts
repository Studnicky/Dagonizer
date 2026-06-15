/**
 * scatter-extensions/dags: demonstrates scatter extension points —
 * custom GatherStrategy and custom OutcomeReducer — via the
 * GatherStrategies and OutcomeReducers static registries.
 * Also defines ScoreNode used by the entry's scatter DAG.
 *
 * Side effects: GatherStrategies.register and OutcomeReducers.register calls
 * at module load. Import this module to install 'top-n' and 'threshold-75'.
 */

import {
  GatherStrategies,
  GatherStrategy,
  NodeOutputBuilder,
  NodeStateBase,
  OutcomeReducer,
  OutcomeReducers,
  ScalarNode,
} from '@noocodex/dagonizer';
import type {
  GatherConfig,
  GatherExecution,
  NodeStateInterface,
  OutcomeRecord } from '@noocodex/dagonizer';
import type { StateAccessor } from '@noocodex/dagonizer/contracts';

// ── Domain state (re-exported so entry can reference the type) ────────────────

export interface ScoredCandidate {
  readonly title: string;
  readonly score: number;
}

export class RankingState extends NodeStateBase {
  items: string[]               = [];
  candidate: ScoredCandidate    = { title: '', score: 0 };
  topCandidates: ScoredCandidate[] = [];
}

// #region score-node
// Worker node: produces a scored candidate from each scatter item.
export class ScoreNode extends ScalarNode<RankingState, 'success' | 'error'> {
  readonly name    = 'score';
  readonly outputs = ['success', 'error'] as const;

  protected override async executeOne(state: RankingState) {
    const item = state.getMetadata<string>('item') ?? '';
    // Synthetic score: proportional to string length
    state.candidate = { title: item, score: item.length };
    return NodeOutputBuilder.of('success');
  }
}
// #endregion score-node

// #region gather-strategy
/**
 * TopNGatherStrategy: collects each clone's `candidate` field, keeps the
 * top-N by score, and writes the result to `topCandidates` on the parent.
 * Registered under 'top-n'. Reference via `gather: { strategy: 'top-n', target: 'topCandidates' }`
 * on a ScatterNode placement to collect and rank clone outputs in one pass.
 */
interface ScoredItem {
  readonly score: number;
}

class TopNGatherStrategy extends GatherStrategy {
  readonly name = 'top-n';

  override reduce(
    _config: GatherConfig,
    _batch: Parameters<GatherStrategy['reduce']>[1],
    _state: NodeStateInterface,
    _accessor: StateAccessor,
  ): void {
    // accumulate nothing per-clone — finalize handles all records
  }

  override async finalize(
    config: GatherConfig,
    execution: GatherExecution<NodeStateInterface>,
  ): Promise<void> {
    const target = config.target ?? 'topCandidates';
    const n = 3;
    const all = execution.records.map((r) =>
      execution.accessor.get<ScoredItem>(r.cloneState, 'candidate'),
    ).filter((c): c is ScoredItem => c !== null);
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
