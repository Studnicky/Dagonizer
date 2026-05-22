/**
 * 08-checkpoint — abort → snapshot → restore → resume.
 *
 * Demonstrates the full checkpoint lifecycle:
 *   1. Execute a multi-node DAG but abort mid-way.
 *   2. Capture the partial result as a JSON checkpoint.
 *   3. Persist it (here: serialise to a string as a stand-in for a DB write).
 *   4. Parse it back and restore state via a custom restore function.
 *   5. Resume from the cursor — only the remaining nodes run.
 *
 * State that needs to survive the gap must override `snapshotData()` and
 * `restoreData()`. The base class handles lifecycle; the subclass handles
 * domain fields.
 *
 * Watch: partial.cursor names the next node to run. After resume,
 * state.count equals 3 and state.log records all three tick events —
 * identical to an uninterrupted execution.
 *
 * Run: npx tsx examples/08-checkpoint.ts
 */

import type { JsonObject } from '@noocodex/dagonizer/entities';
import {
  Checkpoint,
  DAG_CONTEXT,
  Dagonizer,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { DAG, NodeInterface } from '@noocodex/dagonizer';

// ---------------------------------------------------------------------------
// State — overrides snapshot/restore to persist domain fields
// ---------------------------------------------------------------------------

class CountingState extends NodeStateBase {
  count = 0;
  log:  string[] = [];

  /**
   * Serialize domain fields into a plain JSON-serialisable object.
   * Called by Checkpoint.from() to capture state at the abort point.
   */
  protected override snapshotData(): JsonObject {
    return { "count": this.count, "log": [...this.log] };
  }

  /**
   * Restore domain fields from a previously-captured snapshot.
   * Called by CountingState.restore() after the parse step.
   */
  protected override restoreData(snapshot: JsonObject): void {
    const c = snapshot['count'];
    if (typeof c === 'number') this.count = c;
    const l = snapshot['log'];
    if (Array.isArray(l)) this.log = l.filter((x): x is string => typeof x === 'string');
  }
}

// ---------------------------------------------------------------------------
// Node — increments count and records each tick in log
// ---------------------------------------------------------------------------

const inc: NodeInterface<CountingState, 'success'> = {
  "name": 'inc',
  "outputs": ['success'],
  async execute(state) {
    state.count++;
    state.log.push(`tick:${state.count}`);
    return { "output": 'success' };
  },
};

// ---------------------------------------------------------------------------
// DAG — three sequential inc placements: a → b → c
// ---------------------------------------------------------------------------

const dag: DAG = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:count',
  '@type':     'DAG',
  "name":        'count',
  "version":     '1',
  "entrypoint":  'a',
  "nodes": [
    {
      '@id':   'urn:noocodex:dag:count/node/a',
      '@type': 'SingleNode',
      "name":    'a',
      "node":    'inc',
      "outputs": { "success": 'b' },  // routes to 'b' on success
    },
    {
      '@id':   'urn:noocodex:dag:count/node/b',
      '@type': 'SingleNode',
      "name":    'b',
      "node":    'inc',
      "outputs": { "success": 'c' },  // routes to 'c' on success
    },
    {
      '@id':   'urn:noocodex:dag:count/node/c',
      '@type': 'SingleNode',
      "name":    'c',
      "node":    'inc',
      "outputs": { "success": null },  // end of flow
    },
  ],
};

// ---------------------------------------------------------------------------
// Step 1: partial run — abort after the first node completes
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<CountingState>();
dispatcher.registerNode(inc);
dispatcher.registerDAG(dag);

const ctl     = new AbortController();
const initial = new CountingState();

// execute() returns an Execution — async-iterable over node results.
// Iterating yields one result per completed node (not per stage internally).
const execution = dispatcher.execute('count', initial, { "signal": ctl.signal });
let stages = 0;
for await (const _stage of execution) {
  stages++;
  if (stages === 1) ctl.abort(new Error('pause after node a'));  // fire after 'a' completes
}
const partial = await execution;

process.stdout.write('\nCheckpoint lifecycle — abort → snapshot → restore → resume\n');
process.stdout.write(`  partial: count=${partial.state.count} cursor="${partial.cursor}"\n`);
// cursor = 'b': the next node that would run if we resume

// ---------------------------------------------------------------------------
// Step 2: persist the checkpoint as JSON
// ---------------------------------------------------------------------------

const checkpoint = Checkpoint.from('count', partial);  // capture state + cursor
const persisted  = Checkpoint.toJson(checkpoint);       // → JSON string (store in DB, file, etc.)

// ---------------------------------------------------------------------------
// Step 3: restore + resume (simulating a process restart)
// ---------------------------------------------------------------------------

// Parse the persisted JSON back to an unknown value, then restore.
// The second arg is a state factory — consumers supply their own restore fn
// so the checkpoint module never imports domain state classes.
const parsed = JSON.parse(persisted) as unknown;
const { state, dagName, cursor } = Checkpoint.restore(
  parsed,
  (snap) => CountingState.restore(snap),  // rehydrates domain fields via restoreData()
);

process.stdout.write(`  restored: count=${state.count} cursor="${cursor}"\n`);

// Resume from cursor 'b' — only nodes b and c execute.
const resumed = await dispatcher.resume(dagName, state, cursor);

process.stdout.write(`  resumed: count=${resumed.state.count} log=${JSON.stringify(resumed.state.log)}\n`);
process.stdout.write('\nLesson: cursor marks where to resume; snapshotData/restoreData\n');
process.stdout.write('        persist domain fields across the serialisation boundary.\n');
process.stdout.write('        Final count=3 and log length=3: identical to a full run.\n');
