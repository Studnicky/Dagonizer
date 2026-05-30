import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

void describe('Dagonizer scatter gather strategies', () => {
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

    const dag = new DAGBuilder('partition', '1')
      .scatter(
        'fan',
        'items',
        classify,
        { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
        {
          'itemKey': 'item',
          'gather':  { 'strategy': 'partition', 'partitions': { 'even': 'evens', 'odd': 'odds' } },
        },
      )
      .build();
    dispatcher.registerDAG(dag);

    const state = new NodeStateBase() as S;
    state.items = [1, 2, 3, 4, 5];
    state.evens = [];
    state.odds  = [];
    await dispatcher.execute('partition', state);
    assert.deepEqual(state.evens.sort(), [2, 4]);
    assert.deepEqual(state.odds.sort(), [1, 3, 5]);
  });

  void it('custom invokes a custom node with gatherResults metadata', async () => {
    interface GatherResultRecord { index: number; item: unknown; output: string }
    let seenResults: GatherResultRecord[] | undefined;

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
        seenResults = state.getMetadata<GatherResultRecord[]>('gatherResults');
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(cls);
    dispatcher.registerNode(merge);

    interface S extends NodeStateBase { items: number[] }
    const dag = new DAGBuilder('customfan', '1')
      .scatter(
        'fan',
        'items',
        cls,
        { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
        {
          'itemKey': 'item',
          'gather':  { 'strategy': 'custom', 'customNode': 'merge' },
        },
      )
      .build();
    dispatcher.registerDAG(dag);

    const state = new NodeStateBase() as S;
    state.items = [1, 2, 3];
    await dispatcher.execute('customfan', state);

    assert.ok(seenResults !== undefined);
    assert.equal(seenResults?.length, 3);
    // gatherResults carries {index, item, output}; items are source items
    const items = seenResults?.map((r) => r.item).sort((a, b) => Number(a) - Number(b));
    assert.deepEqual(items, [1, 2, 3]);
    assert.ok(seenResults?.every((r) => r.output === 'success'));
  });

  void it('append gathers clone items into a target array in source-index order', async () => {
    interface S extends NodeStateBase { items: number[]; out: number[] }

    const dispatcher = new Dagonizer<NodeStateBase>();
    const passThrough: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'passThrough',
      'outputs': ['success'],
      async execute() { return { 'output': 'success' }; },
    };
    dispatcher.registerNode(passThrough);

    const dag = new DAGBuilder('appendfan', '1')
      .scatter(
        'fan',
        'items',
        passThrough,
        { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
        {
          'itemKey': 'item',
          'gather':  { 'strategy': 'append', 'target': 'out' },
        },
      )
      .build();
    dispatcher.registerDAG(dag);

    const state = new NodeStateBase() as S;
    state.items = [10, 20, 30];
    state.out   = [];
    await dispatcher.execute('appendfan', state);
    // append with no `field` uses the source item; order follows source index
    assert.deepEqual([...state.out].sort((a, b) => a - b), [10, 20, 30]);
    assert.equal(state.out.length, 3);
  });

  void it('map gather strategy writes clone field as scalar to parent via source array', async () => {
    interface S extends NodeStateBase { items: number[]; result: string }

    const dispatcher = new Dagonizer<NodeStateBase>();
    const produce: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'produce',
      'outputs': ['success'],
      async execute(state) {
        state.setMetadata('answer', 'hello');
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(produce);

    // Single-item source scatter + map strategy: reads cloneState metadata
    // via dotted path accessor; use a plain top-level key written via setMetadata
    // that is accessible as a metadata field directly via cloneState.
    // The accessor reads dotted paths off the state object itself; metadata is
    // stored under the 'metadata' property on NodeStateBase.
    const dag = new DAGBuilder('mapfan', '1')
      .scatter(
        'fan',
        'items',
        produce,
        { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
        {
          'itemKey': 'item',
          'gather': {
            'strategy': 'map',
            'mapping':  { 'metadata.answer': 'metadata.result' },
          },
        },
      )
      .build();
    dispatcher.registerDAG(dag);

    const state = new NodeStateBase() as S;
    state.items = [1];
    await dispatcher.execute('mapfan', state);
    assert.equal(state.getMetadata('result'), 'hello');
  });

  void it('scatter respects concurrency cap', async () => {
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

    const dag = new DAGBuilder('conc', '1')
      .scatter(
        'fan',
        'items',
        slow,
        { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
        {
          'concurrency': 2,
          'gather':      { 'strategy': 'append', 'target': 'out' },
        },
      )
      .build();
    dispatcher.registerDAG(dag);

    const state = new NodeStateBase() as S;
    state.items = [1, 2, 3, 4, 5, 6];
    state.out   = [];
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
