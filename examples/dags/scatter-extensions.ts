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
  Batch,
  DAG_CONTEXT,
  GatherStrategies,
  GatherStrategy,
  MonadicNode,
  NodeOutputBuilder,
  NodeStateBase,
  OutcomeReducer,
  OutcomeReducers,
  RoutedBatchBuilder,
  ScalarNode,
} from '@studnicky/dagonizer';
import type {
  DAGType,
  GatherConfigType,
  GatherExecutionType,
  NodeContextType,
  NodeStateInterface,
  OutcomeRecordType,
  RoutedBatchType,
} from '@studnicky/dagonizer';
import type { StateAccessorInterface } from '@studnicky/dagonizer/contracts';

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

// #region monad-node
// BatchEnrichNode: processes the whole batch in one call.
// Extends MonadicNode (the root); the batch arrives as Batch<RankingState>.
// Use this pattern when you need access to all items at once (e.g., to hit a
// shared cache, vectorize, or partition by a property across the whole batch).
export class BatchEnrichNode extends MonadicNode<RankingState, 'enriched'> {
  readonly name = 'batch-enrich';
  readonly outputs = ['enriched'] as const;

  async execute(
    batch: Batch<RankingState>,
    _ctx: NodeContextType,
  ): Promise<RoutedBatchType<'enriched', RankingState>> {
    // Operate on the whole batch at once: normalise every item's score.
    const items = batch.items();
    const max = Math.max(...items.map((item) => item.state.candidate.score), 1);
    for (const item of items) {
      item.state.candidate = {
        ...item.state.candidate,
        score: item.state.candidate.score / max,
      };
    }
    return RoutedBatchBuilder.of('enriched', batch);
  }
}
// #endregion monad-node

// #region call-node-directly
// Direct node invocation: create a Batch from a single state and call execute().
// Returns a RoutedBatchType; check routed.has('success') to inspect results.
// Used in tests for per-node isolation without a full dispatcher.
export async function scoreOneItem(item: string): Promise<boolean> {
  const state = new RankingState();
  state.candidate = { title: item, score: 0 };
  const node = new ScoreNode();
  const ctx: NodeContextType = {
    signal: new AbortController().signal,
    dagName: 'test',
    nodeName: 'score',
    services: undefined,
  };
  const routed = await node.execute(Batch.of(state), ctx);
  return routed.has('success');
}
// #endregion call-node-directly

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
    _config: GatherConfigType,
    _batch: Parameters<GatherStrategy['reduce']>[1],
    _state: NodeStateInterface,
    _accessor: StateAccessorInterface,
  ): void {
    // accumulate nothing per-clone — finalize handles all records
  }

  override async finalize(
    config: GatherConfigType,
    execution: GatherExecutionType<NodeStateInterface>,
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

  reduce(records: ReadonlyArray<OutcomeRecordType>): string {
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

// #region reservoir-dag
/**
 * DAG showing a reservoir-configured scatter: items are batched by `route`
 * before the score node runs. The reservoir holds up to 10 items per partition
 * key; a partial batch flushes after 500 ms of idle time.
 */
export const reservoirDag: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:reservoir-demo',
  '@type':    'DAG',
  name:       'reservoir-demo',
  version:    '1',
  entrypoint: 'batch-score',
  nodes: [
    {
      '@id':       'urn:noocodex:dag:reservoir-demo/node/batch-score',
      '@type':     'ScatterNode',
      name:        'batch-score',
      body:        { node: 'score' },
      source:      'items',
      itemKey:     'item',
      concurrency: 4,
      reservoir: {
        keyField: 'route',  // accessor path on each source item → the partition key
        capacity: 10,       // release a batch when 10 items accumulate per key
        idleMs:   500,      // flush partial batches after 500 ms idle
      },
      gather: {
        strategy: 'top-n',
        target:   'topCandidates',
      },
      outputs: {
        'all-success': 'end',
        partial:       'end',
        'all-error':   'end',
        empty:         'end',
      },
    },
    {
      '@id':   'urn:noocodex:dag:reservoir-demo/node/end',
      '@type': 'TerminalNode',
      name:    'end',
      outcome: 'completed',
    },
  ],
};
// #endregion reservoir-dag
