/**
 * 08-checkpoint: abort, snapshot, restore, resume.
 *
 * Demonstrates the full checkpoint lifecycle:
 *   1. Execute a multi-node DAG but abort mid-way.
 *   2. Capture the partial result as a Checkpoint instance.
 *   3. Persist it (here: serialise to a string as a stand-in for a DB write).
 *   4. Parse it back and restore state via a custom restore function.
 *   5. Resume from the cursor; only the remaining nodes run.
 *
 * State that needs to survive the gap must override `snapshotData()` and
 * `restoreData()`. The base class handles lifecycle; the subclass handles
 * domain fields.
 *
 * Watch: partial.cursor names the next node to run. After resume,
 * state.count equals 3 and state.log records all three tick events,
 * identical to an uninterrupted execution.
 *
 * DAG definition (state with snapshot/restore, inc node, dag): examples/dags/08-checkpoint.ts
 *
 * Run: npx tsx examples/08-checkpoint.ts
 */

import {
  Checkpoint,
  CheckpointRestoreAdapterFn,
  Dagonizer,
} from '@noocodex/dagonizer';
import { CountingState, inc, dag } from './dags/08-checkpoint.js';

// Step 1: partial run, abort after the first node completes
// #region capture
const dispatcher = new Dagonizer<CountingState>();
dispatcher.registerNode(inc);
dispatcher.registerDAG(dag);

const ctl     = new AbortController();
const initial = new CountingState();

// execute() returns an Execution (async-iterable over node results).
// Iterating yields one result per completed node (not per stage internally).
const execution = dispatcher.execute('count', initial, { "signal": ctl.signal });
let stages = 0;
for await (const _stage of execution) {
  stages++;
  if (stages === 1) ctl.abort(new Error('pause after node a'));  // fire after 'a' completes
}
const partial = await execution;

process.stdout.write('\nCheckpoint lifecycle: abort -> snapshot -> restore -> resume\n');
process.stdout.write(`  partial: count=${partial.state.count} cursor="${partial.cursor}"\n`);
// cursor = 'b': the next node that would run if we resume
// #endregion capture

// Step 2: capture and persist the checkpoint as JSON
// #region persist
// Checkpoint.capture() returns a Checkpoint instance.
// cursor !== null here because we aborted mid-run.
const checkpoint = await Checkpoint.capture('count', partial);
const persisted  = checkpoint.toJson();  // → JSON string (store in DB, file, etc.)
// #endregion persist

// Step 3: restore + resume (simulating a process restart)
// #region recall
// Parse the persisted JSON back to an unknown value, then load into a Checkpoint.
const ckpt = Checkpoint.load(JSON.parse(persisted) as unknown);

// restoreState maps the snapshot back to a typed CountingState instance.
// Consumers supply their own restore fn so the checkpoint module never
// imports domain state classes.
const { state, dagName, cursor } = ckpt.restoreState(
  CheckpointRestoreAdapterFn.fromFn((snap) => CountingState.restore(snap)),  // rehydrates domain fields via restoreData()
);

process.stdout.write(`  restored: count=${state.count} cursor="${cursor}"\n`);
// #endregion recall

// #region resume
// Resume from cursor 'b'; only nodes b and c execute.
const resumed = await dispatcher.resume(dagName, state, cursor);

process.stdout.write(`  resumed: count=${resumed.state.count} log=${JSON.stringify(resumed.state.log)}\n`);
process.stdout.write('\nLesson: cursor marks where to resume; snapshotData/restoreData\n');
process.stdout.write('        persist domain fields across the serialisation boundary.\n');
process.stdout.write('        Final count=3 and log length=3: identical to a full run.\n');
// #endregion resume
