import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer } from '@studnicky/dagonizer';
import { ChatState, ClassifyNode, RespondNode, dag } from '../dags/02-builder.topology.ts';

function makeDispatcher(): Dagonizer<ChatState> {
  const dispatcher = new Dagonizer<ChatState>();
  dispatcher.registerNode(new ClassifyNode());
  dispatcher.registerNode(new RespondNode());
  dispatcher.registerDAG(dag);
  return dispatcher;
}

describe('02-builder: DAGBuilder produces identical DAG shape', () => {
  it('on_topic input echoes and completes', async () => {
    const dispatcher = makeDispatcher();
    const state = new ChatState();
    state.input = 'TypeScript generics';
    const result = await dispatcher.execute('chat', state);

    assert.ok(state.reply.startsWith('Echo:'), `Expected reply to start with "Echo:" but got: "${state.reply}"`);
    assert.equal(state.topic, 'on_topic');
    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.cursor, null);
  });

  it('off_topic input (weather) produces coding reply', async () => {
    const dispatcher = makeDispatcher();
    const state = new ChatState();
    state.input = 'weather forecast for today';
    const result = await dispatcher.execute('chat', state);

    assert.equal(state.topic, 'off_topic');
    assert.ok(
      state.reply.toLowerCase().includes('coding'),
      `Expected reply to contain "coding" but got: "${state.reply}"`,
    );
    assert.equal(result.terminalOutcome, 'completed');
  });

  it('executedNodes includes classify and respond', async () => {
    const dispatcher = makeDispatcher();
    const state = new ChatState();
    state.input = 'Explain async/await';
    const result = await dispatcher.execute('chat', state);

    assert.ok(result.executedNodes.includes('classify'));
    assert.ok(result.executedNodes.includes('respond'));
  });

  it('dag entrypoint is classify', () => {
    assert.equal(dag.entrypoint, 'classify');
  });

});
