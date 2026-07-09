import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer } from '@studnicky/dagonizer';
import { IncrementState, IncrementNode, child, parent } from '../dags/05-embedded-dags.ts';

describe('05-embedded-dags: EmbeddedDAGNode seeds and writes back state', () => {
  it('parent increments seed via child DAG and writes result back', async () => {
    const dispatcher = new Dagonizer<IncrementState>();
    dispatcher.registerNode(new IncrementNode());
    dispatcher.registerDAG(child);
    dispatcher.registerDAG(parent);

    const state = new IncrementState();
    state.seed = 5;
    const result = await dispatcher.execute('urn:noocodec:dag:parent', state);

    assert.equal(result.terminalOutcome, 'completed');
    // seed=5 → child.payload seeded to 5 → incremented to 6 → result=6
    assert.equal(state.result, 6);
  });

  it('seed=0 produces result=1', async () => {
    const dispatcher = new Dagonizer<IncrementState>();
    dispatcher.registerNode(new IncrementNode());
    dispatcher.registerDAG(child);
    dispatcher.registerDAG(parent);

    const state = new IncrementState();
    state.seed = 0;
    await dispatcher.execute('urn:noocodec:dag:parent', state);

    assert.equal(state.result, 1);
  });

  it('executedNodes includes the embedded invoke placement', async () => {
    const dispatcher = new Dagonizer<IncrementState>();
    dispatcher.registerNode(new IncrementNode());
    dispatcher.registerDAG(child);
    dispatcher.registerDAG(parent);

    const state = new IncrementState();
    state.seed = 3;
    const result = await dispatcher.execute('urn:noocodec:dag:parent', state);

    assert.ok(result.executedNodes.includes('invoke'), `executedNodes: ${JSON.stringify(result.executedNodes)}`);
  });
});
