/**
 * 17-scatter-async-source: ScatterNode over an AsyncIterable source with
 * bounded-concurrency backpressure.
 *
 * The scatter source field can hold any of: `Array`, `Iterable`, or
 * `AsyncIterable`. The engine normalises all three to the same
 * `AsyncIterator` interface internally. The pull loop only calls
 * `iterator.next()` when a worker slot is free — giving true backpressure:
 * the generator yields no more than `concurrency` items ahead of the
 * slowest worker.
 *
 * This example sets `state.stream` to an async generator and uses `concurrency=2`.
 * An event log records every "pull" (generator yields) and "process" (worker runs)
 * event in call order. The interleaving proves that items 2+ are only pulled
 * after worker slots free — the generator is held back by the pool.
 *
 * Compare to array sources: arrays are eagerly available (all items exist at
 * once) but the engine still applies the same bounded-concurrency pull
 * discipline — only the lazy "when is data produced?" differs, not the
 * backpressure semantics.
 *
 * Note on resumability: an `AsyncIterable` on state is NOT captured by
 * `Checkpoint.capture()` (generators are not JSON-serialisable). If you
 * abort a scatter with an async source, the resume call must re-provide
 * the generator at the continuation position — the engine will pull from
 * it starting at the first item, but acked items are skipped via the
 * `ackedResults` index (no re-execution). For fully durable sources,
 * use an array and rely on the checkpoint's acked-index tracking.
 *
 * DAG definitions: examples/dags/17-scatter-async-source.ts
 *
 * Run: npx tsx examples/17-scatter-async-source.ts
 */

import { Dagonizer } from '@noocodex/dagonizer';
import {
  AsyncSourceState,
  ConsumeNode,
  dag,
  eventLog,
} from './dags/17-scatter-async-source.js';

// ---------------------------------------------------------------------------
// Async generator source factory
// ---------------------------------------------------------------------------

// #region generator
/**
 * Builds an async generator that yields string items. Each `next()` call
 * logs the item as it is produced (simulating a data source where items are
 * expensive to produce — network pages, DB cursor rows, streamed API results).
 *
 * The generator uses no internal await so it yields immediately on each call,
 * but because it is declared `async function*`, each `next()` invocation
 * returns a Promise. This lets the engine's pull-loop correctly interleave
 * pulls and worker completions under bounded concurrency.
 */
class AsyncStream {
  static async *from(items: readonly string[]): AsyncGenerator<string> {
    for (const item of items) {
      eventLog.push(`pull     ${item}`);
      yield item;
    }
  }
}
// #endregion generator

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// #region run
const dispatcher = new Dagonizer<AsyncSourceState>();
dispatcher.registerNode(new ConsumeNode());
dispatcher.registerDAG(dag);

const ITEMS = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
const state = new AsyncSourceState();
// Assign the async generator as the scatter source.
// The engine reads `state.stream` (the `source` path) and normalises it.
state.stream = AsyncStream.from(ITEMS);

process.stdout.write('\n=== Scatter over AsyncIterable (concurrency=2) ===\n\n');

await dispatcher.execute('async-source', state);

process.stdout.write('Event log (pull = generator yielded, process = worker ran):\n');
for (const entry of eventLog) {
  process.stdout.write(`  ${entry}\n`);
}
process.stdout.write(`\nResults collected: ${JSON.stringify(state.results)}\n`);
// #endregion run

// ---------------------------------------------------------------------------
// Analyse backpressure
// ---------------------------------------------------------------------------

// #region analyse
process.stdout.write('\n--- Backpressure analysis ---\n');

// Total pulls should equal ITEMS.length — generator only yielded on demand.
const totalPulls = eventLog.filter((e) => e.startsWith('pull')).length;
const totalProcesses = eventLog.filter((e) => e.startsWith('process')).length;
process.stdout.write(`  Total pulls:    ${totalPulls}  (= ${ITEMS.length} items, generator not pre-consumed)\n`);
process.stdout.write(`  Total processes: ${totalProcesses}  (= ${ITEMS.length} items)\n`);

// At no point should pulls exceed processes by more than concurrency (2).
// Walk the log and track the high-water mark of (pulls - processes).
let pulls = 0;
let processes = 0;
let maxInflight = 0;
for (const entry of eventLog) {
  if (entry.startsWith('pull')) {
    pulls++;
    maxInflight = Math.max(maxInflight, pulls - processes);
  } else {
    processes++;
  }
}
process.stdout.write(`  Max in-flight items (pulls ahead of processes): ${maxInflight}\n`);
process.stdout.write(`  Concurrency cap: 2 — backpressure holds: ${maxInflight <= 2 ? 'yes' : 'no'}\n`);
process.stdout.write(`\n  All ${ITEMS.length} items processed: ${state.results.length === ITEMS.length ? 'yes' : 'no'}\n`);

process.stdout.write('\n--- Lesson ---\n');
process.stdout.write('AsyncIterable source: items produced on demand, not buffered upfront.\n');
process.stdout.write('Bounded concurrency: at most `concurrency` items are in-flight at once.\n');
process.stdout.write('Backpressure: the engine only pulls the next item when a slot frees.\n');
process.stdout.write('Max in-flight ≤ concurrency proves the generator was never over-pulled.\n');
process.stdout.write('Use async sources for: database cursors, paginated APIs, streamed results.\n');
// #endregion analyse
