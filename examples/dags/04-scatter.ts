/**
 * 04-scatter/dags: pure module — state, worker node, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/04-scatter.ts (the executable entry point).
 */

import {
  DAG_CONTEXT,
  GatherStrategies,
  GatherStrategy,
  NodeOutputBuilder,
  NodeStateBase,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { Batch, GatherExecutionType, GatherRecordType, NodeStateInterface, SchemaObjectType } from '@studnicky/dagonizer';
import type { GatherConfigType } from '@studnicky/dagonizer/entities';
import type { DAGType } from '@studnicky/dagonizer';
import type { StateAccessorInterface } from '@studnicky/dagonizer/contracts';
import { GatherStrategyNames } from '@studnicky/dagonizer/constants';

// #region state
export class ScrapeState extends NodeStateBase {
  urls:      string[] = [];  // source array; ScatterNode reads this by field name
  succeeded: string[] = [];  // partition target for 'ok' output
  failed:    string[] = [];  // partition target for 'fail' output
}
// #endregion state

// #region worker-node
export class ProbeNode extends ScalarNode<ScrapeState, 'ok' | 'fail'> {
  readonly name = 'probe';
  readonly outputs = ['ok', 'fail'] as const;
  override get outputSchema(): Record<'ok' | 'fail', SchemaObjectType> {
    return { 'ok': { 'type': 'object' }, 'fail': { 'type': 'object' } };
  }

  protected override async executeOne(state: ScrapeState) {
    // Each item is written to state under the itemKey ('url') before execute.
    const url = state.getter.string('url');
    // Fake probe: even-length URLs succeed, odd-length fail.
    return NodeOutputBuilder.of(url.length % 2 === 0 ? 'ok' : 'fail');
  }
}
// #endregion worker-node

// ---------------------------------------------------------------------------
// Gather config examples: one const per strategy for doc transclusion
// ---------------------------------------------------------------------------

// #region gather-map
// strategy 'map': each clone writes a scalar; N clones produce an index-ordered
// array. 'candidate' on the clone accumulates into 'candidates' on the parent.
export const gatherMap = { strategy: 'map', mapping: { 'candidate': 'candidates' } } as const;
// #endregion gather-map

// #region gather-append
// strategy 'append': flattens clone field (or source item) into parent array.
// 'target' is the dotted path on the parent state that receives the values.
export const gatherAppend = { strategy: 'append', target: 'results' } as const;
// #endregion gather-append

// #region gather-collect
// strategy 'collect': preserves positional order between source items and
// their collected output tokens. Unlike 'append', 'collect' maps index → value.
export const gatherCollect = { strategy: 'collect', target: 'outputTokens' } as const;
// #endregion gather-collect

// #region gather-discard
// strategy 'discard': no clone state flows back to the parent.
// Use for side-effect-only fan-outs (notifications, fire-and-forget writes).
export const gatherDiscard = { strategy: 'discard' } as const;
// #endregion gather-discard

// #region gather-custom
// strategy 'custom': the dispatcher stages per-clone records under
// state.metadata.gatherResults and dispatches the named registered node.
// The named node drives the merge logic (deduplicate, rank, aggregate).
export const gatherCustom = { strategy: 'custom', customNode: 'mergeCandidates' } as const;
// #endregion gather-custom

// #region gather-partition
// strategy 'partition': groups clone results by their output token.
// Each key maps to a parent-state field that receives the matching clones.
export const gatherPartition = { strategy: 'partition', partitions: { success: 'passed', error: 'failed' } } as const;
// #endregion gather-partition

// ---------------------------------------------------------------------------
// Custom gather strategy skeleton (doc region — no side effects)
// ---------------------------------------------------------------------------

// #region custom-gather-strategy
// Extend GatherStrategy: implement initial / reduce / finalize.
// 'initial' seeds the accumulator; 'reduce' folds each batch of clone records;
// 'finalize' does any end-of-gather work (sort, trim, dispatch a custom node).
class TopNGather extends GatherStrategy {
  readonly name = 'top-n';
  override initial(_config: GatherConfigType, _state: NodeStateInterface, _accessor: StateAccessorInterface): void { /* seed */ }
  override reduce(_config: GatherConfigType, _batch: Batch<GatherRecordType>, _state: NodeStateInterface, _accessor: StateAccessorInterface): void { /* fold */ }
  override async finalize(_config: GatherConfigType, _execution: GatherExecutionType<NodeStateInterface>): Promise<void> { /* trim to top-N */ }
}
GatherStrategies.register(new TopNGather());
// #endregion custom-gather-strategy

// #region scatter-placement
export const dag: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id':        'urn:noocodex:dag:scrape',
  '@type':      'DAG',
  "name":         'scrape',
  "version":      '1',
  "entrypoint":   'probe-all',
  "nodes": [
    {
      '@id':        'urn:noocodex:dag:scrape/node/probe-all',
      '@type':      'ScatterNode',                   // iterate source, run node per clone
      "name":         'probe-all',
      "body":         { "node": 'probe' },             // which registered node to invoke per clone
      "source":       'urls',                          // state field to read the items array from
      "itemKey":      'url',                           // metadata key each item is written under
      "execution": { "mode": "item", "concurrency": 2 },                               // max clones in-flight simultaneously
      "gather": {
        "strategy":   GatherStrategyNames.PARTITION,      // route clones by their output key
        "partitions": { "ok": 'succeeded', "fail": 'failed' },  // output key → state field name
      },
      // Aggregate outputs: reflect final distribution, not per-clone results.
      // all-success: every clone returned 'ok'
      // partial:     mix of ok and fail
      // all-error:   every clone returned 'fail'
      // empty:       source array was empty
      "outputs": { 'all-success': 'end', "partial": 'end', 'all-error': 'end', "empty": 'end' },
    },
    {
      '@id':     'urn:noocodex:dag:scrape/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};
// #endregion scatter-placement
