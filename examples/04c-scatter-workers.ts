/**
 * 04c-scatter-workers: ScatterNode with a container binding.
 *
 * This is a companion to examples/04-scatter.ts showing how the same
 * ScatterNode pattern extends to worker containers. The two changes from
 * the default in-process path are:
 *
 *   1. The scatter body is a sub-DAG (body: { dag: 'scrape-item' }) so
 *      the container has a complete DAG to dispatch.
 *   2. The ScatterNode sets `container: 'io'` to route each item body
 *      through a WorkerThreadContainer instead of running in-process.
 *
 * The state class and nodes are reused from examples/dags/04-scatter.ts
 * unchanged — the DAG shape is the only difference.
 *
 * For a fully-runnable worker example with a registry module and build
 * step see examples/12-workers.ts (the canonical worker demo).
 *
 * Run: npx tsx examples/04c-scatter-workers.ts
 *      (runs in-process; container binding is noted in comments only)
 *
 * For the real worker-thread path see: examples/12-workers.ts
 *   pnpm example:12
 *
 * DAG definitions: examples/dags/04-scatter.ts (reused), this file's dags block.
 */

import { Dagonizer, DAG_CONTEXT } from '@studnicky/dagonizer';
import type { DAG } from '@studnicky/dagonizer';
import { GatherStrategyNames } from '@studnicky/dagonizer/constants';

import { ScrapeState, ProbeNode } from './dags/04-scatter.js';

// ---------------------------------------------------------------------------
// Sub-DAG: the body the ScatterNode dispatches per item.
// When container: 'io' is bound this runs inside a worker thread.
// When no container is bound (today's default) it runs in-process.
// ---------------------------------------------------------------------------

const probeItemDag: DAG = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:probe-item',
  '@type':     'DAG',
  "name":        'probe-item',
  "version":     '1',
  "entrypoint":  'probe',
  "nodes": [
    {
      '@id':   'urn:noocodex:dag:probe-item/node/probe',
      '@type': 'SingleNode',
      "name":    'probe',
      "node":    'probe',
      // Route to distinct TerminalNodes so the parent scatter sees
      // 'success' (completed) vs 'error' (failed) per clone — enabling
      // the partition gather to split URLs into succeeded/failed.
      "outputs": { "ok": 'item-ok', "fail": 'item-fail' },
    },
    {
      '@id':     'urn:noocodex:dag:probe-item/node/item-ok',
      '@type':   'TerminalNode',
      "name":    'item-ok',
      "outcome": 'completed',
    },
    {
      '@id':     'urn:noocodex:dag:probe-item/node/item-fail',
      '@type':   'TerminalNode',
      "name":    'item-fail',
      "outcome": 'failed',
    },
  ],
};

// Parent DAG: scatter with container role 'io' declared.
// To actually bind the container, pass WorkerThreadContainer to the dispatcher:
//   new Dagonizer<ScrapeState>({ containers: { io: container } })
// Without the binding the dispatcher falls back to in-process (this demo's path).
const scrapeWithContainerDag: DAG = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:scrape-c',
  '@type':     'DAG',
  "name":        'scrape-c',
  "version":     '1',
  "entrypoint":  'probe-all',
  "nodes": [
    {
      '@id':        'urn:noocodex:dag:scrape-c/node/probe-all',
      '@type':      'ScatterNode',
      "name":         'probe-all',
      "body":         { "dag": 'probe-item' },  // sub-DAG body — required for containers
      "source":       'urls',
      "itemKey":      'url',
      "concurrency":  2,
      // container: 'io',                        // ← uncomment + bind WorkerThreadContainer
      //                                         //   to route each item to a worker thread
      "gather": {
        // dag-body scatter outputs 'success'/'error' per clone (not the inner
        // node's 'ok'/'fail'); partition on those aggregate output tokens.
        "strategy":   GatherStrategyNames.PARTITION,
        "partitions": { "success": 'succeeded', "error": 'failed' },
      },
      "outputs": { 'all-success': 'end', "partial": 'end', 'all-error': 'end', "empty": 'end' },
    },
    {
      '@id':     'urn:noocodex:dag:scrape-c/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};

// ---------------------------------------------------------------------------
// Run (in-process; 'io' container role is not bound)
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<ScrapeState>();
dispatcher.registerNode(new ProbeNode());
dispatcher.registerDAG(probeItemDag);
dispatcher.registerDAG(scrapeWithContainerDag);

const state = new ScrapeState();
state.urls = [
  'https://a.example',    // 17 chars → fail
  'https://bb.example',   // 18 chars → ok
  'https://ccc.example',  // 19 chars → fail
  'https://dddd.example', // 20 chars → ok
];
await dispatcher.execute('scrape-c', state);

process.stdout.write('\n04c-scatter-workers: same probe logic, dag-body scatter shape\n');
process.stdout.write(`  succeeded: ${JSON.stringify(state.succeeded)}\n`);
process.stdout.write(`  failed:    ${JSON.stringify(state.failed)}\n`);
process.stdout.write('\nTo run this scatter over real worker threads:\n');
process.stdout.write('  1. Uncomment container: "io" in the ScatterNode above.\n');
process.stdout.write('  2. Create a WorkerThreadContainer with a compiled registry module.\n');
process.stdout.write('  3. Pass containers: { io: container } to the Dagonizer constructor.\n');
process.stdout.write('  See examples/12-workers.ts for a complete runnable worker demo.\n');
