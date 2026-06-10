/**
 * 21-per-node-timeout: engine-level per-node timeoutMs.
 *
 * Demonstrates setting `timeoutMs` directly on a node's `NodeInterface`
 * definition. When set, the engine:
 *   1. Derives a child AbortController from the run's signal.
 *   2. Arms a Scheduler timer for `timeoutMs` milliseconds.
 *   3. Races the node's `execute()` call against the deadline.
 *   4. On expiry: aborts the child signal, throws `NodeTimeoutError`,
 *      fires `onError`, and marks the run `failed` with
 *      `result.interruptedAt.reason === 'timeout'`.
 *
 * Key differences from run-level deadlineMs (ExecuteOptions):
 *   - Per-node timeout is scoped to one node's execute() only. The parent
 *     run-level signal is NOT aborted; other nodes are unaffected.
 *   - `deadlineMs` aborts the whole run; `timeoutMs` aborts just the node.
 *
 * Two runs demonstrate the contrast:
 *   (a) fastNode (timeoutMs=200): resolves in ~0 ms → completed normally.
 *   (b) slowNode (timeoutMs=50):  tries to wait 5 s → NodeTimeoutError after 50 ms.
 *
 * DAG definitions (state, nodes, dags): examples/dags/21-per-node-timeout.ts
 *
 * Run: npx tsx examples/21-per-node-timeout.ts
 */

import { Dagonizer } from '@noocodex/dagonizer';
import { TaskState, fastNode, slowNode, fastDag, slowDag } from './dags/21-per-node-timeout.js';

// ---------------------------------------------------------------------------
// Run (a): fast node — completes within budget
// ---------------------------------------------------------------------------

const fastDispatcher = new Dagonizer<TaskState>();
fastDispatcher.registerNode(fastNode);
fastDispatcher.registerDAG(fastDag);

const fastState = new TaskState();
const fastResult = await fastDispatcher.execute('fast-dag', fastState);

// ---------------------------------------------------------------------------
// Run (b): slow node — exceeds budget, NodeTimeoutError
// ---------------------------------------------------------------------------

const slowDispatcher = new Dagonizer<TaskState>();
slowDispatcher.registerNode(slowNode);
slowDispatcher.registerDAG(slowDag);

const slowState = new TaskState();
const start = Date.now();
const slowResult = await slowDispatcher.execute('slow-dag', slowState);
const elapsed = Date.now() - start;

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

process.stdout.write('\n21-per-node-timeout: engine-level per-node timeoutMs\n\n');

process.stdout.write('(a) Fast node (timeoutMs=200, completes in ~0 ms):\n');
process.stdout.write(`  lifecycle     = ${fastState.lifecycle.kind}\n`);
process.stdout.write(`  interruptedAt = ${JSON.stringify(fastResult.interruptedAt)}\n`);
process.stdout.write(`  output        = ${fastState.output}\n`);

process.stdout.write('\n(b) Slow node (timeoutMs=50, would take 5 s):\n');
process.stdout.write(`  lifecycle     = ${slowState.lifecycle.kind}\n`);
process.stdout.write(`  interruptedAt = ${JSON.stringify(slowResult.interruptedAt)}\n`);
process.stdout.write(`  elapsed       = ~${String(Math.round(elapsed / 10) * 10)} ms (capped at budget)\n`);

process.stdout.write('\nLesson: set `timeoutMs` on the NodeInterface to give a node a wall-clock\n');
process.stdout.write('        budget. The engine enforces it via the Scheduler; the node sees\n');
process.stdout.write('        an aborted context.signal. The parent run signal is unaffected.\n');
process.stdout.write('        Use run-level `deadlineMs` to cap the entire flow instead.\n');
