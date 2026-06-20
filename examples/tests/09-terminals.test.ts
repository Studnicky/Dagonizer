import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer } from '@studnicky/dagonizer';
import { GateState, StepANode, CheckNode, dag1, dag2, dag3 } from '../dags/09-terminals.ts';

describe('09-terminals: completed and failed terminal outcomes', () => {
  it('dag1 (StepANode) routes to completed terminal', async () => {
    const dispatcher = new Dagonizer<GateState>();
    dispatcher.registerNode(new StepANode());
    dispatcher.registerDAG(dag1);

    const state = new GateState();
    const result = await dispatcher.execute('demo-explicit-completed', state);

    assert.equal(result.terminalOutcome, 'completed');
  });

  it('dag2 with shouldPass=true routes to end-ok (completed)', async () => {
    const dispatcher = new Dagonizer<GateState>();
    dispatcher.registerNode(new CheckNode());
    dispatcher.registerDAG(dag2);

    const state = new GateState();
    state.shouldPass = true;
    const result = await dispatcher.execute('demo-explicit-terminals', state);

    assert.equal(result.terminalOutcome, 'completed');
  });

  it('dag2 with shouldPass=false routes to end-fail (failed)', async () => {
    const dispatcher = new Dagonizer<GateState>();
    dispatcher.registerNode(new CheckNode());
    dispatcher.registerDAG(dag2);

    const state = new GateState();
    state.shouldPass = false;
    const result = await dispatcher.execute('demo-explicit-terminals', state);

    assert.equal(result.terminalOutcome, 'failed');
  });

  it('dag3 with shouldPass=false routes to failed terminal', async () => {
    const dispatcher = new Dagonizer<GateState>();
    dispatcher.registerNode(new CheckNode());
    dispatcher.registerDAG(dag3);

    const state = new GateState();
    state.shouldPass = false;
    const result = await dispatcher.execute('demo-explicit-failed', state);

    assert.equal(result.terminalOutcome, 'failed');
  });

  it('dag3 with shouldPass=true routes to completed terminal', async () => {
    const dispatcher = new Dagonizer<GateState>();
    dispatcher.registerNode(new CheckNode());
    dispatcher.registerDAG(dag3);

    const state = new GateState();
    state.shouldPass = true;
    const result = await dispatcher.execute('demo-explicit-failed', state);

    assert.equal(result.terminalOutcome, 'completed');
  });
});
