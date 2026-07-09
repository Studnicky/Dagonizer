/**
 * 15-incremental-gather: per-clone vs batch scatter gather.
 *
 * Every `GatherStrategy` subclass implements the fold contract:
 *   - `reduce(config, batch, state, accessor)`: called once per clone (or per
 *     micro-batch) as results arrive. Override this to fold incrementally.
 *   - `finalize(config, execution)`: called once after ALL clones complete.
 *     Override this (and leave `reduce` as a no-op) for all-at-once processing.
 *
 * The built-in `map`, `append`, `collect`, and `partition` strategies fold in
 * `reduce` — parent state grows after EACH clone. The built-in `custom`
 * strategy accumulates nothing in `reduce` and does its work in `finalize`.
 *
 * This example registers two observable strategies that log their fold calls
 * so the timing difference is visible in the console output:
 *
 *   logging-map  — overrides `reduce`; logs one fold per clone.
 *   batch-only   — no-op `reduce`, overrides `finalize`; logs one call at end.
 *
 * Run them with concurrency=1 (serial) on the same 4-item source so the fold
 * sequence is deterministic.
 *
 * DAG definitions: examples/dags/15-incremental-gather.ts
 *
 * Run: npx tsx examples/15-incremental-gather.ts
 */

import { Dagonizer, GatherStrategies } from '@studnicky/dagonizer';
import {
  IncrementalState,
  ObservableStrategies,
  ShoutNode,
  incrementalDag,
  batchDag,
} from './dags/15-incremental-gather.js';

// ---------------------------------------------------------------------------
// Register observable strategies
// ---------------------------------------------------------------------------

const foldLog = ObservableStrategies.register();

// ---------------------------------------------------------------------------
// Run: incremental gather (logging-map)
// ---------------------------------------------------------------------------

// #region run-incremental
const incrDispatcher = new Dagonizer<IncrementalState>();
incrDispatcher.registerNode(new ShoutNode());
incrDispatcher.registerDAG(incrementalDag);

const incrState = new IncrementalState();
incrState.words = ['hello', 'world', 'from', 'dagonizer'];

process.stdout.write('\n=== incremental gather (logging-map strategy) ===\n');
process.stdout.write('Each clone folds immediately after it completes.\n\n');

await incrDispatcher.execute('urn:noocodec:dag:incremental', incrState);

for (const entry of foldLog) {
  process.stdout.write(`  ${entry}\n`);
}
process.stdout.write(`\n  Final results: ${JSON.stringify(incrState.results)}\n`);
// #endregion run-incremental

// ---------------------------------------------------------------------------
// Run: batch-only gather
// ---------------------------------------------------------------------------

// #region run-batch
foldLog.length = 0;  // clear log between runs

const batchDispatcher = new Dagonizer<IncrementalState>();
batchDispatcher.registerNode(new ShoutNode());
batchDispatcher.registerDAG(batchDag);

const batchState = new IncrementalState();
batchState.words = ['hello', 'world', 'from', 'dagonizer'];

process.stdout.write('\n=== batch gather (batch-only strategy) ===\n');
process.stdout.write('All clones complete before finalize is called once.\n\n');

await batchDispatcher.execute('urn:noocodec:dag:batch', batchState);

for (const entry of foldLog) {
  process.stdout.write(`  ${entry}\n`);
}
process.stdout.write(`\n  Final results: ${JSON.stringify(batchState.results)}\n`);
// #endregion run-batch

// ---------------------------------------------------------------------------
// Clean up consumer-registered strategies
// ---------------------------------------------------------------------------

GatherStrategies.unregister('logging-map');
GatherStrategies.unregister('batch-only');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

process.stdout.write('\n--- Lesson ---\n');
process.stdout.write('Per-clone (reduce overridden): N clones → N reduce calls; parent state grows per item.\n');
process.stdout.write('Batch (reduce is no-op, finalize overridden): N clones → 1 finalize call at the end.\n');
process.stdout.write('Built-in per-clone strategies: map, append, collect, partition.\n');
process.stdout.write('Built-in batch strategies: custom. Any consumer strategy with no-op reduce and finalize override is also batch.\n');
