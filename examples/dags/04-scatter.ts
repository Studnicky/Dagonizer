/**
 * 04-scatter/dags: pure module — state, worker node, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/04-scatter.ts (the executable entry point).
 */

import {
  DAG_CONTEXT,
  NodeOutputBuilder,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { DAG } from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer/contracts';
import { GatherStrategyName } from '@noocodex/dagonizer/constants';

// #region state
export class ScrapeState extends NodeStateBase {
  urls:      string[] = [];  // source array; ScatterNode reads this by field name
  succeeded: string[] = [];  // partition target for 'ok' output
  failed:    string[] = [];  // partition target for 'fail' output
}
// #endregion state

// #region worker-node
export const probe: NodeInterface<ScrapeState, 'ok' | 'fail'> = {
  "name": 'probe',
  "outputs": ['ok', 'fail'],
  async execute(state) {
    // Each item is written to state under the itemKey ('url') before execute.
    const url = state.getMetadata<string>('url') ?? '';
    // Fake probe: even-length URLs succeed, odd-length fail.
    return NodeOutputBuilder.of(url.length % 2 === 0 ? 'ok' : 'fail');
  },
};
// #endregion worker-node

// #region scatter-placement
export const dag: DAG = {
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
      "concurrency":  2,                               // max clones in-flight simultaneously
      "gather": {
        "strategy":   GatherStrategyName.PARTITION,      // route clones by their output key
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
