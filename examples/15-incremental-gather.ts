/**
 * 15-incremental-gather: incremental vs batch scatter gather.
 *
 * Strategies that implement `applyIncremental` (the built-ins: `map`,
 * `append`, `collect`, `partition`) fold each clone's result into parent state
 * immediately after that clone's body completes — before the next clone starts.
 * The parent's gather target grows after EACH item; no waiting for all clones.
 *
 * Strategies without `applyIncremental` (`custom`, and any consumer strategy
 * that omits the override) accumulate all records in memory and call `apply`
 * once after EVERY clone is done. The parent's gather target is empty until
 * the entire scatter finishes.
 *
 * This example registers two observable strategies that log their fold calls
 * so the timing difference is visible in the console output:
 *
 *   logging-map  — has `applyIncremental`; logs one fold per clone.
 *   batch-only   — no `applyIncremental`; logs one `apply` call at the end.
 *
 * Run them with concurrency=1 (serial) on the same 4-item source so the fold
 * sequence is deterministic.
 *
 * DAG definitions: examples/dags/15-incremental-gather.ts
 *
 * Run: npx tsx examples/15-incremental-gather.ts
 */

import { Dagonizer, GatherStrategies } from '@noocodex/dagonizer';
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

await incrDispatcher.execute('incremental', incrState);

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
process.stdout.write('All clones complete before apply is called once.\n\n');

await batchDispatcher.execute('batch', batchState);

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
process.stdout.write('Incremental (applyIncremental defined): N clones → N fold calls; parent state grows per item.\n');
process.stdout.write('Batch (no applyIncremental): N clones → 1 apply call at the end; parent state updates once.\n');
process.stdout.write('Built-in incremental strategies: map, append, collect, partition.\n');
process.stdout.write('Built-in batch strategies: custom. Any consumer strategy without applyIncremental is also batch.\n');
