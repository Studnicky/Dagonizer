/**
 * 06-cancellation: AbortSignal + deadlineMs.
 *
 * Demonstrates two independent cancellation shapes:
 *   (a) caller-controlled abort: the caller holds an AbortController and
 *       fires it when the user cancels. The node must observe context.signal.
 *   (b) deadline timeout: pass deadlineMs to execute(); the dispatcher
 *       synthesizes an AbortSignal that fires after the deadline.
 *
 * Watch: lifecycle.kind records the terminal reason: 'cancelled' for an
 * explicit abort, 'timed_out' for a deadline. The cursor is the next node
 * that would have run (useful for resume).
 *
 * DAG definition (cancellation-aware slow node, dag): examples/dags/06-cancellation.ts
 *
 * Run: npx tsx examples/06-cancellation.ts
 */

import { Dagonizer, NodeStateBase } from '@noocodex/dagonizer';
import { SlowNode, dag } from './dags/06-cancellation.js';

const dispatcher = new Dagonizer<NodeStateBase>();
dispatcher.registerNode(new SlowNode());
dispatcher.registerDAG(dag);

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

process.stdout.write('\nCancellation shapes: AbortSignal vs deadlineMs\n');
process.stdout.write(`  (a) AbortController: lifecycle=${aState.lifecycle.kind} cursor="${aResult.cursor}"\n`);
process.stdout.write(`  (b) deadlineMs:      lifecycle=${bState.lifecycle.kind} cursor="${bResult.cursor}"\n`);
process.stdout.write('\nLesson: observe context.signal in every long-running operation.\n');
process.stdout.write('        lifecycle.kind records the terminal reason;\n');
process.stdout.write('        cursor records where resumption would begin.\n');
