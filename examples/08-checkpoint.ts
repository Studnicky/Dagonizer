/**
 * 08-checkpoint: abort, snapshot, restore, resume.
 *
 * Demonstrates the full checkpoint lifecycle:
 *   1. Execute a multi-node DAG but abort mid-way.
 *   2. Capture the partial result as a Checkpoint instance.
 *   3. Persist it (here: serialise to a string as a stand-in for a DB write).
 *   4. Parse it back and restore state via a custom restore function.
 *   5. Resume from the cursor; only the remaining nodes run.
 */
import { Checkpoint, CheckpointRestoreAdapter, Dagonizer } from '@studnicky/dagonizer';
import { CountingState, IncNode, dag } from './dags/08-checkpoint.js';

// Step 1: partial run, abort after the first node completes
// #region capture
const dispatcher = new Dagonizer<CountingState>();
dispatcher.registerNode(new IncNode());
dispatcher.registerDAG(dag);

const ctl     = new AbortController();
const initial = new CountingState();

// execute() returns an Execution (async-iterable over node results).
// Iterating yields one result per completed node (not per stage internally).
const execution = dispatcher.execute('urn:noocodec:dag:count', initial, { "signal": ctl.signal });
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
const checkpoint = await Checkpoint.capture('urn:noocodec:dag:count', partial);
const persisted  = checkpoint.toJson();  // → JSON string (store in DB, file, etc.)
// #endregion persist

// Step 3: restore + resume (simulating a process restart)
// #region recall
// Parse the persisted JSON back to an unknown value, then load into a Checkpoint.
const ckpt = Checkpoint.load(JSON.parse(persisted));

// restoreState maps the snapshot back to a typed CountingState instance.
// Consumers supply their own restore fn so the checkpoint module never
// imports domain state classes.
const { state, dagName, cursor } = await ckpt.restoreState(
  CheckpointRestoreAdapter.wrap(() => new CountingState()),
);
// #endregion recall

// #region resume
// Resume from cursor 'b'; only nodes b and c execute.
const resumed = await dispatcher.resume(dagName, state, cursor);

process.stdout.write(`  resumed: count=${resumed.state.count} log=${JSON.stringify(resumed.state.log)}\n`);
process.stdout.write('\nLesson: cursor marks where to resume; the graph carries domain fields\n');
process.stdout.write('        across the JSON-LD and N-Quads boundaries.\n');
process.stdout.write('        Final count=3 and log length=3: identical to a full run.\n');
// #endregion resume
