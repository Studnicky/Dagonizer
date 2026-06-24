/**
 * 31-hitl: HITL park-and-correlate.
 *
 * Demonstrates the park-and-correlate primitive for human-in-the-loop (HITL)
 * flows:
 *
 *   1. Execute a DAG; a node routes to the reserved 'parked' output.
 *   2. The engine captures a checkpoint, transitions lifecycle to
 *      'awaiting-input', and returns result.parked with a correlationKey and
 *      cursor — all without suspending the engine itself.
 *   3. The caller (simulating a human decision here) captures the checkpoint,
 *      applies the decision to the restored state, and calls resume().
 *   4. Execution re-enters at the parked node, routes 'approved', and runs
 *      to completion.
 *
 * Key points:
 *   - result.parked.correlationKey: opaque key the node set in state metadata.
 *     Used to correlate a webhook or queue message with the parked run.
 *   - result.parked.cursor: the placement name to pass to dispatcher.resume().
 *   - result.cursor is also set (identical to parked.cursor) for Checkpoint.capture.
 *   - lifecycle variant on the parked result is 'awaiting-input'.
 *   - resume() re-enters at the cursor placement; resetLifecycle() is called
 *     automatically so markRunning() can re-enter 'running'.
 *
 * DAG definition: examples/dags/31-hitl.ts
 *
 * Run: npx tsx examples/31-hitl.ts
 */

import {
  Checkpoint,
  CheckpointRestoreAdapter,
  Dagonizer,
} from '@studnicky/dagonizer';
import { ApproveNode, dag, HitlState, PrepareNode, ProcessNode } from './dags/31-hitl.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<HitlState>();
dispatcher.registerNode(new PrepareNode());
dispatcher.registerNode(new ApproveNode());
dispatcher.registerNode(new ProcessNode());
dispatcher.registerDAG(dag);

// ---------------------------------------------------------------------------
// Step 1: Initial run — parks at 'approve' waiting for human input
// ---------------------------------------------------------------------------

const initialState = new HitlState();
const parkedResult = await dispatcher.execute('hitl', initialState);

process.stdout.write('\n=== HITL park-and-correlate example ===\n\n');
process.stdout.write(`Step 1 — Initial run:\n`);
process.stdout.write(`  lifecycle:      ${parkedResult.state.lifecycle.variant}\n`);
process.stdout.write(`  cursor:         ${parkedResult.cursor}\n`);
process.stdout.write(`  parked.correlationKey: ${parkedResult.parked?.correlationKey}\n`);
process.stdout.write(`  parked.cursor:  ${parkedResult.parked?.cursor}\n`);
process.stdout.write(`  log: ${JSON.stringify(parkedResult.state.log)}\n\n`);

// Verify park state
if (parkedResult.parked === null) throw new Error('Expected result.parked to be non-null');
if (parkedResult.state.lifecycle.variant !== 'awaiting-input') {
  throw new Error('Expected lifecycle to be awaiting-input');
}

// ---------------------------------------------------------------------------
// Step 2: Capture checkpoint (persists state + cursor for resume)
// ---------------------------------------------------------------------------

const ckpt = await Checkpoint.capture('hitl', parkedResult);
const persisted = ckpt.toJson(); // In a real app: store in DB or message queue

process.stdout.write(`Step 2 — Checkpoint captured:\n`);
process.stdout.write(`  cursor in checkpoint: ${ckpt.data.cursor}\n\n`);

// ---------------------------------------------------------------------------
// Step 3: Simulate human approval (happens out-of-band in real apps)
// ---------------------------------------------------------------------------

// In a real app: a webhook/callback arrives with the decision.
// Here we simulate it by resolving immediately.
const humanDecision: 'approved' | 'rejected' = await Promise.resolve('approved');

process.stdout.write(`Step 3 — Human decision: ${humanDecision}\n\n`);

// ---------------------------------------------------------------------------
// Step 4: Restore checkpoint + apply decision + resume
// ---------------------------------------------------------------------------

const recalled = Checkpoint.load(JSON.parse(persisted));
const { state: resumedState, dagName, cursor } = recalled.restoreState(
  CheckpointRestoreAdapter.wrap((snap) => HitlState.restore(snap)),
);

// Apply the human decision to the restored state
resumedState.decision = humanDecision;

process.stdout.write(`Step 4 — Resume from cursor '${cursor}':\n`);
const finalResult = await dispatcher.resume(dagName, resumedState, cursor);

process.stdout.write(`  lifecycle:      ${finalResult.state.lifecycle.variant}\n`);
process.stdout.write(`  terminalOutcome: ${finalResult.terminalOutcome}\n`);
process.stdout.write(`  parked:         ${finalResult.parked}\n`);
process.stdout.write(`  log: ${JSON.stringify(finalResult.state.log)}\n\n`);

process.stdout.write(`Lesson: park-and-correlate suspends execution without blocking\n`);
process.stdout.write(`        the engine. Cursor + correlationKey persist the position;\n`);
process.stdout.write(`        resume() re-enters at the parked node with the decision set.\n`);
