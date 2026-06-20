/**
 * 20-streaming: observe stage-by-stage progress via the async-iterable API.
 *
 * Dagonizer.execute() returns an `Execution<TState>` that is both:
 *   - Awaitable  — `await dispatcher.execute(...)` waits for the final summary.
 *   - AsyncIterable — `for await (const stage of dispatcher.execute(...))` yields
 *                      a `NodeResultType<TState>` for each node as it completes.
 *
 * The two consumption modes share a single internal generator. Iterating and
 * then awaiting returns the cached final result; the flow body runs exactly once.
 *
 * Watch: each `NodeResult` arrives before the flow resolves, letting consumers
 * log progress, update a UI, or checkpoint early-exit state.
 *
 * DAG definition (state, nodes, dag): examples/dags/20-streaming.ts
 *
 * Run: npx tsx examples/20-streaming.ts
 */

import { Dagonizer } from '@studnicky/dagonizer';
import type { NodeResultType } from '@studnicky/dagonizer';
import { PipelineState, IngestNode, EnrichNode, PersistNode, dag } from './dags/20-streaming.js';

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<PipelineState>();
dispatcher.registerNode(new IngestNode());
dispatcher.registerNode(new EnrichNode());
dispatcher.registerNode(new PersistNode());
dispatcher.registerDAG(dag);

const state = new PipelineState();

// #region streaming
// Stream each node result as it arrives, then the final summary.
const intermediateNodes: Array<NodeResultType<PipelineState>> = [];

process.stdout.write('\n20-streaming: stage-by-stage execution progress\n\n');
process.stdout.write('  Streaming nodes as they complete:\n');

const execution = dispatcher.execute('streaming-demo', state);

// Each iteration step yields one NodeResult when the node completes.
// The consumer can react (log, store, update UI) before the next node runs.
for await (const stage of execution) {
  intermediateNodes.push(stage);
  process.stdout.write(
    `    stage arrived: nodeName="${stage.nodeName}" output=${stage.output ?? '(null)'} skipped=${String(stage.skipped)}\n`,
  );
}

// Await the same Execution handle to get the final summary (cached, no re-run).
const result = await execution;
// #endregion streaming

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

process.stdout.write(`\n  ${String(intermediateNodes.length)} stages received before completion.\n`);
process.stdout.write(`  Final summary: lifecycle=${result.state.lifecycle.variant} executedNodes=[${result.executedNodes.join(', ')}]\n`);
process.stdout.write(`  State items: [${state.items.join(', ')}]\n`);
process.stdout.write('\nLesson: iterate with `for await` to consume intermediate NodeResults;\n');
process.stdout.write('        `await` on the same Execution handle returns the cached final result.\n');
process.stdout.write('        The flow body runs exactly once regardless of how you consume it.\n');
