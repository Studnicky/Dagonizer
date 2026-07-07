import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer } from '@studnicky/dagonizer';
import { ChatState, ClassifyNode, RespondNode, dag } from '../dags/01-linear.ts';

class Harness {
  static dispatcher(): Dagonizer<ChatState> {
    const dispatcher = new Dagonizer<ChatState>();
    dispatcher.registerNode(new ClassifyNode());
    dispatcher.registerNode(new RespondNode());
    dispatcher.registerDAG(dag);
    return dispatcher;
  }
}

describe('01-linear: classify → respond', () => {
  it('on_topic input echoes the input and sets topic', async () => {
    const dispatcher = Harness.dispatcher();
    const state = new ChatState();
    state.input = 'TypeScript generics';
    const result = await dispatcher.execute('chat', state);

    assert.ok(state.reply.startsWith('Echo:'), `Expected reply to start with "Echo:" but got: "${state.reply}"`);
    assert.equal(state.topic, 'on_topic');
    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.cursor, null);
  });

  it('off_topic input (weather) sets topic and produces coding reply', async () => {
    const dispatcher = Harness.dispatcher();
    const state = new ChatState();
    state.input = 'what is the weather today?';
    const result = await dispatcher.execute('chat', state);

    assert.equal(state.topic, 'off_topic');
    assert.ok(
      state.reply.toLowerCase().includes('coding'),
      `Expected reply to contain "coding" but got: "${state.reply}"`,
    );
    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.cursor, null);
  });

  it('executedNodes includes classify and respond', async () => {
    const dispatcher = Harness.dispatcher();
    const state = new ChatState();
    state.input = 'TypeScript';
    const result = await dispatcher.execute('chat', state);

    assert.ok(result.executedNodes.includes('classify'), 'executedNodes should include "classify"');
    assert.ok(result.executedNodes.includes('respond'), 'executedNodes should include "respond"');
  });

  it('dag main entrypoint is classify', () => {
    assert.equal(dag.entrypoints['main'], 'classify');
  });
});
