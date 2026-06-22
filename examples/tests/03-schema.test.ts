import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import { EchoNode, dag } from '../dags/03-schema.ts';

describe('03-schema: DAGDocument.load from JSON string', () => {
  it('executes to completion and sets metadata', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(new EchoNode());
    dispatcher.registerDAG(dag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('from-json', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.cursor, null);
  });

  it('EchoNode sets metadata seen=true', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(new EchoNode());
    dispatcher.registerDAG(dag);

    const state = new NodeStateBase();
    await dispatcher.execute('from-json', state);

    assert.equal(state.getter.boolean('seen'), true);
  });

  it('executedNodes includes echo', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(new EchoNode());
    dispatcher.registerDAG(dag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('from-json', state);

    assert.ok(result.executedNodes.includes('echo'));
  });
});
