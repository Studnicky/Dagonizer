/**
 * 04-scatter: ScatterNode concurrent iteration with partition gather strategy.
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
 * DAG definition (state, worker node, dag): examples/dags/04-scatter.ts
 *
 * Run: npx tsx examples/04-scatter.ts
 */

import { Dagonizer } from '@studnicky/dagonizer';
import { ScrapeState, ProbeNode, dag } from './dags/04-scatter.js';

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// #region run
const dispatcher = new Dagonizer<ScrapeState>();
dispatcher.registerNode(new ProbeNode());
dispatcher.registerDAG(dag);

const state = new ScrapeState();
// Even-length URLs (18, 20 chars) → ok; odd-length (17, 19 chars) → fail
state.urls = [
  'https://a.example',    // 17 chars → fail
  'https://bb.example',   // 18 chars → ok
  'https://ccc.example',  // 19 chars → fail
  'https://dddd.example', // 20 chars → ok
];
await dispatcher.execute('urn:noocodec:dag:scrape', state);

process.stdout.write('\nScatter DAG: probe runs once per URL, concurrency=2\n');
process.stdout.write(`  succeeded: ${JSON.stringify(state.succeeded)}\n`);
process.stdout.write(`  failed:    ${JSON.stringify(state.failed)}\n`);
process.stdout.write('\nLesson: ScatterNode iterates state.urls, writes each item under\n');
process.stdout.write('        itemKey "url", then partitions results into state arrays.\n');
// #endregion run
