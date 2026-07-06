/**
 * 06-cancellation: AbortSignal + deadlineMs.
 *
 * Demonstrates two independent cancellation shapes:
 *   (a) caller-controlled abort: the caller holds an AbortController and
 *       fires it when the user cancels. The node must observe context.signal.
 *   (b) deadline timeout: pass deadlineMs to execute(); the dispatcher
 *       synthesizes an AbortSignal that fires after the deadline.
 *
 * Watch: lifecycle.variant records the terminal reason: 'cancelled' for an
 * explicit abort, 'timed_out' for a deadline. The cursor is the next node
 * that would have run (useful for resume).
 *
 * DAG definition (cancellation-aware slow node, dag): examples/dags/06-cancellation.ts
 *
 * Run: npx tsx examples/06-cancellation.ts
 */

import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import { Signal } from '@studnicky/signal';
import { BatchProcessNode, SlowNode, batchDag, dag } from './dags/06-cancellation.js';

const dispatcher = new Dagonizer<NodeStateBase>();
dispatcher.registerNode(new SlowNode());
dispatcher.registerNode(new BatchProcessNode());
dispatcher.registerDAG(dag);
dispatcher.registerDAG(batchDag);

// #region abort-signal
// (a) Caller-controlled abort: fires after 25 ms
const ctl    = new AbortController();
const aState = new NodeStateBase();
setTimeout(() => ctl.abort(new Error('user pressed cancel')), 25);
const aResult = await dispatcher.execute('slow-dag', aState, { "signal": ctl.signal });
// #endregion abort-signal

// #region deadline
// (b) Dispatcher deadline: fires after 25 ms automatically
const bState  = new NodeStateBase();
const bResult = await dispatcher.execute('slow-dag', bState, { "deadlineMs": 25 });
// #endregion deadline

// #region cursor-check
// Check the cursor and lifecycle after a cancelled run. The cursor holds the
// name of the next node that would have run; pass it to resume() to continue.
if (aResult.cursor !== null) {
  process.stdout.write(`paused at node: ${aResult.cursor}\n`);
  process.stdout.write(`lifecycle: ${aState.lifecycle.variant}\n`); // 'cancelled'
}
// #endregion cursor-check

// #region interrupted-at
// interruptedAt carries the node name and the abort discriminant.
// It is null on clean exits (completed, terminal reached, node throw without abort).
if (aResult.interruptedAt !== null) {
  process.stdout.write(`interrupted at node: ${aResult.interruptedAt.nodeName}\n`);
  process.stdout.write(`reason: ${aResult.interruptedAt.reason}\n`); // 'abort' or 'timeout'
}
if (bResult.interruptedAt !== null) {
  process.stdout.write(`deadline interrupted at: ${bResult.interruptedAt.nodeName}\n`);
  process.stdout.write(`reason: ${bResult.interruptedAt.reason}\n`); // 'timeout'
}
// #endregion interrupted-at

// #region signal-composition
// Compose a user abort and a request-scoped deadline into a single signal
// before passing it to execute().
const userAbortController = new AbortController();
const combined = Signal.compose({
  'signal':     userAbortController.signal,
  'deadlineMs': 10_000,
});

const cState  = new NodeStateBase();
const cResult = await dispatcher.execute('slow-dag', cState, { signal: combined });
userAbortController.abort(new Error('request scope ended')); // clean up
// #endregion signal-composition

process.stdout.write('\nCancellation shapes: AbortSignal vs deadlineMs\n');
process.stdout.write(`  (a) AbortController: lifecycle=${aState.lifecycle.variant} cursor="${aResult.cursor}"\n`);
process.stdout.write(`  (b) deadlineMs:      lifecycle=${bState.lifecycle.variant} cursor="${bResult.cursor}"\n`);
process.stdout.write(`  (c) composed signal: lifecycle=${cState.lifecycle.variant} cursor="${cResult.cursor}"\n`);
process.stdout.write('\nLesson: observe context.signal in every long-running operation.\n');
process.stdout.write('        lifecycle.variant records the terminal reason;\n');
process.stdout.write('        cursor records where resumption would begin.\n');
