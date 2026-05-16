import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { DAG } from '../../src/entities/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

void describe('Dagonizer fan-in strategies', () => {
  void it('partition routes items by output into distinct target paths', async () => {
    interface S extends NodeStateBase {
      items: number[];
      evens: number[];
      odds: number[];
    }
    const dispatcher = new Dagonizer<NodeStateBase>();
    const classify: NodeInterface<NodeStateBase, 'even' | 'odd'> = {
      'name': 'classify',
      'outputs': ['even', 'odd'],
      async execute(state) {
        const n = state.getMetadata<number>('item') ?? 0;
        return { 'output': n % 2 === 0 ? 'even' : 'odd' };
      },
    };
    dispatcher.registerNode(classify);

    const dag: DAG = {
      'name': 'partition',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [
        { 'type': 'fan-out', 'name': 'fan', 'node': 'classify',
          'source': 'items', 'itemKey': 'item',
          'fanIn': { 'strategy': 'partition', 'partitions': { 'even': 'evens', 'odd': 'odds' } },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new NodeStateBase() as S;
    state.items = [1, 2, 3, 4, 5];
    state.evens = [];
    state.odds = [];
    await dispatcher.execute('partition', state);
    assert.deepEqual(state.evens.sort(), [2, 4]);
    assert.deepEqual(state.odds.sort(), [1, 3, 5]);
  });

  void it('custom invokes a custom node with fanInResults metadata', async () => {
    let seenResults: Record<string, unknown[]> | undefined;
    const dispatcher = new Dagonizer<NodeStateBase>();
    const cls: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'classify',
      'outputs': ['success'],
      async execute() { return { 'output': 'success' }; },
    };
    const merge: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'merge',
      'outputs': ['success'],
      async execute(state) {
        seenResults = state.getMetadata<Record<string, unknown[]>>('fanInResults');
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(cls);
    dispatcher.registerNode(merge);

    interface S extends NodeStateBase { items: number[] }
    const dag: DAG = {
      'name': 'customfan',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [
        { 'type': 'fan-out', 'name': 'fan', 'node': 'classify',
          'source': 'items', 'itemKey': 'item',
          'fanIn': { 'strategy': 'custom', 'customNode': 'merge' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);
    const state = new NodeStateBase() as S;
    state.items = [1, 2, 3];
    await dispatcher.execute('customfan', state);
    assert.ok(seenResults !== undefined);
    assert.deepEqual(seenResults?.['success']?.sort?.(), [1, 2, 3]);
  });

  void it('fan-out respects concurrency cap', async () => {
    interface S extends NodeStateBase { items: number[]; out: number[] }
    let inFlight = 0;
    let peak = 0;
    const dispatcher = new Dagonizer<NodeStateBase>();
    const slow: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'slow',
      'outputs': ['success'],
      async execute() {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((r) => setImmediate(r));
        inFlight--;
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(slow);
    const dag: DAG = {
      'name': 'conc',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [
        { 'type': 'fan-out', 'name': 'fan', 'node': 'slow',
          'source': 'items', 'concurrency': 2,
          'fanIn': { 'strategy': 'append', 'target': 'out' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);
    const state = new NodeStateBase() as S;
    state.items = [1, 2, 3, 4, 5, 6];
    state.out = [];
    await dispatcher.execute('conc', state);
    assert.ok(peak <= 2, `expected peak <= 2 but got ${peak}`);
  });
});

void describe('NodeStateBase clone semantics', () => {
  void it('clone copies metadata but resets errors/warnings/lifecycle', () => {
    const state = new NodeStateBase();
    state.setMetadata('foo', { 'bar': 1 });
    state.collectError({
      'code': 'E', 'message': 'm', 'operation': 'op',
      'recoverable': false, 'timestamp': new Date().toISOString(),
    });
    state.markRunning();

    const clone = state.clone();
    assert.deepEqual(clone.getMetadata('foo'), { 'bar': 1 });
    assert.equal(clone.errors.length, 0);
    assert.equal(clone.lifecycle.kind, 'pending');
  });
});
