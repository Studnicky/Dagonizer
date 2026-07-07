import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer, Checkpoint, CheckpointRestoreAdapter } from '@studnicky/dagonizer';
import { ContextResolver } from '@studnicky/dagonizer/context';
import { CountingState, IncNode, dag } from '../dags/08-checkpoint.ts';

class Harness {
  static dispatcher(): Dagonizer<CountingState> {
    const dispatcher = new Dagonizer<CountingState>();
    dispatcher.registerNode(new IncNode());
    dispatcher.registerDAG(dag);
    return dispatcher;
  }
}

describe('08-checkpoint: capture, persist, restore, resume', () => {
  it('full run: count=3 and log has 3 entries', async () => {
    const dispatcher = Harness.dispatcher();
    const state = new CountingState();
    const result = await dispatcher.execute('count', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(state.count, 3);
    assert.equal(state.log.length, 3);
    assert.deepEqual(state.log, ['tick:1', 'tick:2', 'tick:3']);
  });

  it('checkpoint round-trip: abort after node a, resume to completion', async () => {
    const dispatcher = Harness.dispatcher();
    const ctl = new AbortController();
    const initial = new CountingState();

    // Abort after the first node (a) completes
    const execution = dispatcher.execute('count', initial, { signal: ctl.signal });
    let stages = 0;
    for await (const _stage of execution) {
      stages++;
      if (stages === 1) ctl.abort(new Error('pause after a'));
    }
    const partial = await execution;

    // cursor should point to 'b'
    assert.equal(partial.cursor, 'b', `Expected cursor to be "b" but got "${String(partial.cursor)}"`);
    assert.equal(partial.state.count, 1);

    // Capture and persist checkpoint
    const checkpoint = await Checkpoint.capture('count', partial);
    const persisted = checkpoint.toJson();

    // Parse, restore, resume
    const ckpt = Checkpoint.load(JSON.parse(persisted));
    const { state, dagName, cursor } = ckpt.restoreState(
      CheckpointRestoreAdapter.wrap((snap) => CountingState.restore(snap)),
    );

    assert.equal(dagName, ContextResolver.expand('count', {}));
    assert.equal(cursor, 'b');
    assert.equal(state.count, 1);

    // Resume from cursor b
    const resumeDispatcher = Harness.dispatcher();
    const resumed = await resumeDispatcher.resume(dagName, state, cursor);

    assert.equal(resumed.terminalOutcome, 'completed');
    assert.equal(resumed.state.count, 3);
    assert.equal(resumed.state.log.length, 3);
  });

  it('checkpoint cursor names the next node to run', async () => {
    const dispatcher = Harness.dispatcher();
    const ctl = new AbortController();
    const state = new CountingState();

    const execution = dispatcher.execute('count', state, { signal: ctl.signal });
    let seen = 0;
    for await (const _evt of execution) {
      seen++;
      if (seen === 1) ctl.abort(new Error('stop'));
    }
    const partial = await execution;

    // After aborting after the first node the cursor should be 'b'
    assert.notEqual(partial.cursor, null, 'cursor should not be null after abort');
    assert.equal(partial.cursor, 'b');
  });
});
