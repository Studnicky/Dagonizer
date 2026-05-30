/**
 * 04-scatter — ScatterNode: concurrent iteration + partition gather strategy.
 *
 * Demonstrates ScatterNode with source: the engine reads the `source` field
 * from state, spawns one clone per item (up to `concurrency` at once), runs
 * the registered `node` body in each clone, then applies the `gather`
 * strategy. The `partition` strategy routes each clone's produced value into
 * named state arrays by the clone's output key.
 *
 * Watch: `ok` items land in `state.succeeded`, `fail` in `state.failed`.
 * The ScatterNode outputs (all-success | partial | all-error | empty) reflect
 * the aggregate result, not individual items.
 *
 * Run: npx tsx examples/04-scatter.ts
 */

import {
  DAG_CONTEXT,
  Dagonizer,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { DAG, NodeInterface } from '@noocodex/dagonizer';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// #region state
class ScrapeState extends NodeStateBase {
  urls:      string[] = [];  // source array — ScatterNode reads this by field name
  succeeded: string[] = [];  // partition target for 'ok' output
  failed:    string[] = [];  // partition target for 'fail' output
}
// #endregion state

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

// #region worker-node
const probe: NodeInterface<ScrapeState, 'ok' | 'fail'> = {
  "name": 'probe',
  "outputs": ['ok', 'fail'],
  async execute(state) {
    // Each item is written to state under the itemKey ('url') before execute.
    const url = state.getMetadata<string>('url') ?? '';
    // Fake probe: even-length URLs succeed, odd-length fail.
    return { "output": url.length % 2 === 0 ? 'ok' : 'fail' };
  },
};
// #endregion worker-node

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

// #region scatter-placement
const dag: DAG = {
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
        "strategy":   'partition',                     // route clones by their output key
        "partitions": { "ok": 'succeeded', "fail": 'failed' },  // output key → state field name
      },
      // Aggregate outputs — reflect final distribution, not per-clone results.
      // all-success: every clone returned 'ok'
      // partial:     mix of ok and fail
      // all-error:   every clone returned 'fail'
      // empty:       source array was empty
      "outputs": { 'all-success': null, "partial": null, 'all-error': null, "empty": null },
    },
  ],
};
// #endregion scatter-placement

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// #region run
const dispatcher = new Dagonizer<ScrapeState>();
dispatcher.registerNode(probe);
dispatcher.registerDAG(dag);

const state = new ScrapeState();
// Even-length URLs (18, 20 chars) → ok; odd-length (17, 19 chars) → fail
state.urls = [
  'https://a.example',    // 17 chars → fail
  'https://bb.example',   // 18 chars → ok
  'https://ccc.example',  // 19 chars → fail
  'https://dddd.example', // 20 chars → ok
];
await dispatcher.execute('scrape', state);

process.stdout.write('\nScatter DAG — probe runs once per URL, concurrency=2\n');
process.stdout.write(`  succeeded: ${JSON.stringify(state.succeeded)}\n`);
process.stdout.write(`  failed:    ${JSON.stringify(state.failed)}\n`);
process.stdout.write('\nLesson: ScatterNode iterates state.urls, writes each item under\n');
process.stdout.write('        itemKey "url", then partitions results into state arrays.\n');
// #endregion run
