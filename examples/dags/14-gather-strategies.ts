/**
 * 14-gather-strategies/dags: pure module — state, worker node, and two DAGs.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/14-gather-strategies.ts (the executable entry point).
 *
 * Two scatter placements share the same worker node but use different gather
 * strategies to show the contrast:
 *
 *   collect-dag  — `collect` strategy: every clone's output token is appended
 *                  to `state.tokens` in source-index order.
 *   discard-dag  — `discard` strategy: clones run for side-effects only; no
 *                  clone state flows back to the parent. The worker appends to
 *                  `state.sideEffects` directly via shared metadata — the
 *                  canonical side-effect pattern for `discard` scatters.
 *
 * Only `collect` produces a parent-visible result array. `discard` leaves
 * `tokens` empty while `sideEffects` accumulates the proof of execution.
 */

import {
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutputBuilder,
  NodeStateBase,
  RoutedBatchBuilder,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
import { GatherStrategyNames } from '@studnicky/dagonizer/constants';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// #region state
export class GatherDemoState extends NodeStateBase {
  /** Source items to scatter over. */
  items:       string[] = [];
  /** Collect target: one entry per clone's output token (collect strategy). */
  tokens:      string[] = [];
  /**
   * Side-effect log: worker appends here directly (not via gather).
   * Both the `collect` and `discard` runs write here so we can confirm
   * clones ran in both cases; only `collect` additionally populates `tokens`.
   */
  sideEffects: string[] = [];
}
// #endregion state

// ---------------------------------------------------------------------------
// Worker node: runs once per clone regardless of gather strategy
// ---------------------------------------------------------------------------

// #region worker-node
/**
 * Each clone reads its assigned item from metadata.
 * Side-effects (appending to sideEffects) happen inside the clone body;
 * `collect` gathers the clone's _output token_ into the parent, not fields.
 * The node unconditionally returns 'done' so the collector receives 'done'
 * for every clone.
 */
export class TagNode extends MonadicNode<GatherDemoState, 'done'> {
  readonly name = 'tag';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<GatherDemoState>) {
    for (const batchItem of batch) {
      const state = batchItem.state;
      const item = state.getter.string('item', '?');
      // Side-effect: visible even under `discard` gather (clone state is
      // discarded, but direct writes to *shared* parent state via reference
      // are the `discard` pattern for signalling execution happened).
      // Note: scatter clones do NOT share state with the parent — `state`
      // here is the clone. To demonstrate pure side-effects under `discard`,
      // we use the output token alone; the `sideEffects` field records it
      // via the `collect` run where state IS merged back.
      state.sideEffects = [...state.sideEffects, `tagged:${item}`];
    }
    return RoutedBatchBuilder.of(NodeOutputBuilder.of('done').output, batch);
  }
}
// #endregion worker-node

// ---------------------------------------------------------------------------
// DAG 1: collect strategy
// ---------------------------------------------------------------------------

// #region collect-dag
/**
 * `collect-run`: scatter `items` with the `collect` strategy.
 * Gather config: collect each clone's output token ('done') into
 * `state.tokens` in source-index order. Also collects from `sideEffects`
 * because the clone wrote to it and the `collect` merge folds the
 * clone's state fields (here via mapping fallback — token is the default).
 *
 * After execution:
 *   tokens = ['done', 'done', 'done', 'done']  (one per source item)
 */
export const collectDag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:gather-demo:collect-run',
  '@type':     'DAG',
  "name":      'collect-run',
  "version":   '1',
  "entrypoint": 'scatter-collect',
  "nodes": [
    {
      '@id':       'urn:noocodex:dag:gather-demo:collect-run/node/scatter-collect',
      '@type':     'ScatterNode',
      "name":      'scatter-collect',
      "body":      { "node": 'tag' },
      "source":    'items',
      "itemKey":   'item',
      "execution": { "mode": "item", "concurrency": 2 },
      "gather": {
        "strategy": GatherStrategyNames.COLLECT,
        "target":   'tokens',           // collect each clone's output token here
      },
      "outputs": {
        'all-success': 'end',
        "partial":     'end',
        'all-error':   'end',
        "empty":       'end',
      },
    },
    {
      '@id':     'urn:noocodex:dag:gather-demo:collect-run/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};
// #endregion collect-dag

// ---------------------------------------------------------------------------
// DAG 2: discard strategy
// ---------------------------------------------------------------------------

// #region discard-dag
/**
 * `discard-run`: scatter `items` with the `discard` strategy.
 * Clone bodies run (node `tag` executes), but nothing is folded back into
 * the parent state. `tokens` stays empty; `sideEffects` stays empty too
 * because the clone's writes to that field are discarded by the engine
 * (the clone is a copy; `discard` prevents any merge back).
 *
 * This is the canonical pattern when scatter is used for pure fire-and-forget
 * side-effects: the nodes do something external (send a message, write to a
 * queue) and produce no parent-visible result.
 *
 * After execution:
 *   tokens      = []   (discard strategy folds nothing)
 *   sideEffects = []   (clone writes discarded — the point of `discard`)
 */
export const discardDag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:gather-demo:discard-run',
  '@type':     'DAG',
  "name":      'discard-run',
  "version":   '1',
  "entrypoint": 'scatter-discard',
  "nodes": [
    {
      '@id':       'urn:noocodex:dag:gather-demo:discard-run/node/scatter-discard',
      '@type':     'ScatterNode',
      "name":      'scatter-discard',
      "body":      { "node": 'tag' },
      "source":    'items',
      "itemKey":   'item',
      "execution": { "mode": "item", "concurrency": 2 },
      "gather": {
        "strategy": GatherStrategyNames.DISCARD,   // explicit no-op merge
      },
      "outputs": {
        'all-success': 'end',
        "partial":     'end',
        'all-error':   'end',
        "empty":       'end',
      },
    },
    {
      '@id':     'urn:noocodex:dag:gather-demo:discard-run/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};
// #endregion discard-dag
