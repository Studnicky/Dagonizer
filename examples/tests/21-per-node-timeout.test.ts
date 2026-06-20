import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer } from '@studnicky/dagonizer';
import { TaskState, FastTaskNode, SlowTaskNode, fastDag, slowDag } from '../dags/21-per-node-timeout.ts';

describe('21-per-node-timeout: per-node timeout budgets', () => {
  it('fast dag completes within budget', async () => {
    const dispatcher = new Dagonizer<TaskState>();
    dispatcher.registerNode(new FastTaskNode());
    dispatcher.registerDAG(fastDag);

    const state = new TaskState();
    const result = await dispatcher.execute('fast-dag', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(state.output, 'fast-done');
  });

  it('slow dag is interrupted (timeout fires before node completes)', async () => {
    const dispatcher = new Dagonizer<TaskState>();
    dispatcher.registerNode(new SlowTaskNode());
    dispatcher.registerDAG(slowDag);

    const state = new TaskState();
    const result = await dispatcher.execute('slow-dag', state);

    // The engine sets interruptedAt when a timeout fires; terminalOutcome may be 'failed' or null
    const interrupted =
      result.interruptedAt !== null ||
      result.terminalOutcome === 'failed' ||
      result.cursor !== null;

    assert.ok(
      interrupted,
      `Expected slow dag to be interrupted but got: terminalOutcome=${String(result.terminalOutcome)} interruptedAt=${JSON.stringify(result.interruptedAt)} cursor=${String(result.cursor)}`,
    );
  });
});
