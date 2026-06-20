import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import { SlowNode, BatchProcessNode, dag, batchDag } from '../dags/06-cancellation.ts';

describe('06-cancellation: abort signal interrupts execution', () => {
  it('aborting immediately interrupts the slow dag', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(new SlowNode());
    dispatcher.registerDAG(dag);

    const ctl = new AbortController();
    const state = new NodeStateBase();

    const execution = dispatcher.execute('slow-dag', state, { signal: ctl.signal });
    // Abort before the node can complete
    ctl.abort(new Error('cancel'));

    const result = await execution;

    const interrupted = result.cursor !== null || result.interruptedAt !== null;
    assert.ok(interrupted, `Expected run to be interrupted but cursor=${String(result.cursor)} interruptedAt=${JSON.stringify(result.interruptedAt)}`);
  });

  it('aborting during batch iteration interrupts the batch dag', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(new BatchProcessNode());
    dispatcher.registerDAG(batchDag);

    const ctl = new AbortController();
    const state = new NodeStateBase();

    // Start execution and abort after a very short delay
    const execution = dispatcher.execute('batch-dag', state, { signal: ctl.signal });
    setTimeout(() => ctl.abort(new Error('cancel-batch')), 50);

    const result = await execution;

    // Either cursor is set (interrupted before completing) OR interruptedAt is set
    const interrupted = result.cursor !== null || result.interruptedAt !== null;
    assert.ok(interrupted, `Expected batch-dag run to be interrupted but cursor=${String(result.cursor)}`);
  });
});
