import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer } from '@studnicky/dagonizer';
import { CountdownState, AccumulateNode, countdownDAG } from '../dags/27-recursion.ts';

class Harness {
  static dispatcher(): Dagonizer<CountdownState> {
    const dispatcher = new Dagonizer<CountdownState>();
    dispatcher.registerNode(new AccumulateNode());
    dispatcher.registerDAG(countdownDAG);
    return dispatcher;
  }
}

describe('27-recursion: countdown DAG embeds itself via dagFrom', () => {
  it('countdown(5) produces total=15 (5+4+3+2+1+0)', async () => {
    const dispatcher = Harness.dispatcher();
    const state = new CountdownState();
    state.remaining = 5;

    const result = await dispatcher.execute('countdown', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(state.total, 15);
  });

  it('countdown(0) produces total=0 (base case only)', async () => {
    const dispatcher = Harness.dispatcher();
    const state = new CountdownState();
    state.remaining = 0;

    const result = await dispatcher.execute('countdown', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(state.total, 0);
  });

  it('countdown(1) produces total=1', async () => {
    const dispatcher = Harness.dispatcher();
    const state = new CountdownState();
    state.remaining = 1;

    const result = await dispatcher.execute('countdown', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(state.total, 1);
  });

  it('countdown(3) produces total=6 (3+2+1+0)', async () => {
    const dispatcher = Harness.dispatcher();
    const state = new CountdownState();
    state.remaining = 3;

    const result = await dispatcher.execute('countdown', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(state.total, 6);
  });

  it('executedNodes includes accumulate on each invocation frame', async () => {
    const dispatcher = Harness.dispatcher();
    const state = new CountdownState();
    state.remaining = 2;

    const result = await dispatcher.execute('countdown', state);

    assert.ok(
      result.executedNodes.includes('accumulate'),
      `executedNodes: ${JSON.stringify(result.executedNodes)}`,
    );
  });

  it('countdownDAG entrypoint is accumulate', () => {
    assert.equal(countdownDAG.entrypoint, 'accumulate');
  });
});
