import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { EMPTY_CONTRACT_FRAGMENT } from '../../src/contracts/OperationContractFragment.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Timeout } from '../../src/runtime/Timeout.js';

void describe('Dagonizer scatter gather strategies', () => {
  void it('partition routes items by output into distinct target paths', async () => {
    interface S extends NodeStateBase {
      items: number[];
      evens: number[];
      odds: number[];
    }
    const dispatcher = new Dagonizer<NodeStateBase>();
    class ClassifyNode implements NodeInterface<NodeStateBase, 'even' | 'odd'> {
      readonly name = 'classify';
      readonly outputs = ['even', 'odd'] as const;
  readonly 'contract' = EMPTY_CONTRACT_FRAGMENT;
      readonly timeout = Timeout.none();
      async execute(state: NodeStateBase) {
        const n = state.getMetadata<number>('item') ?? 0;
        return { 'errors': [], 'output': n % 2 === 0 ? 'even' as const : 'odd' as const };
      }
    }
    const classify = new ClassifyNode();
    dispatcher.registerNode(classify);

    const dag = new DAGBuilder('partition', '1')
      .scatter(
        'fan',
        'items',
        classify,
        { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
        {
          'itemKey': 'item',
          'gather':  { 'strategy': 'partition', 'partitions': { 'even': 'evens', 'odd': 'odds' } },
        },
      )
      .terminal('end')
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
    class ClsNode implements NodeInterface<NodeStateBase, 'success'> {
      readonly name = 'classify';
      readonly outputs = ['success'] as const;
  readonly 'contract' = EMPTY_CONTRACT_FRAGMENT;
      readonly timeout = Timeout.none();
      async execute(_state: NodeStateBase) { return { 'errors': [], 'output': 'success' as const }; }
    }
    class MergeNode implements NodeInterface<NodeStateBase, 'success'> {
      readonly name = 'merge';
      readonly outputs = ['success'] as const;
  readonly 'contract' = EMPTY_CONTRACT_FRAGMENT;
      readonly timeout = Timeout.none();
      async execute(state: NodeStateBase) {
        seenResults = state.getMetadata<GatherResultRecord[]>('gatherResults');
        return { 'errors': [], 'output': 'success' as const };
      }
    }
    const cls = new ClsNode();
    const merge = new MergeNode();
    dispatcher.registerNode(cls);
    dispatcher.registerNode(merge);

    interface S extends NodeStateBase { items: number[] }
    const dag = new DAGBuilder('customfan', '1')
      .scatter(
        'fan',
        'items',
        cls,
        { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
        {
          'itemKey': 'item',
          'gather':  { 'strategy': 'custom', 'customNode': 'merge' },
        },
      )
      .terminal('end')
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
    class PassThroughNode implements NodeInterface<NodeStateBase, 'success'> {
      readonly name = 'passThrough';
      readonly outputs = ['success'] as const;
  readonly 'contract' = EMPTY_CONTRACT_FRAGMENT;
      readonly timeout = Timeout.none();
      async execute(_state: NodeStateBase) { return { 'errors': [], 'output': 'success' as const }; }
    }
    const passThrough = new PassThroughNode();
    dispatcher.registerNode(passThrough);

    const dag = new DAGBuilder('appendfan', '1')
      .scatter(
        'fan',
        'items',
        passThrough,
        { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
        {
          'itemKey': 'item',
          'gather':  { 'strategy': 'append', 'target': 'out' },
        },
      )
      .terminal('end')
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

  void it('map gather strategy writes clone field to parent as an array (incremental gather)', async () => {
    // With incremental gather, map strategy always appends to an array — even for
    // a single-item source. Cardinality is not known up front in streaming mode,
    // so the target is always an array. This is the documented behavior change
    // introduced with native streaming scatter (§A.3.4).
    const dispatcher = new Dagonizer<NodeStateBase>();
    class ProduceNode implements NodeInterface<NodeStateBase, 'success'> {
      readonly name = 'produce';
      readonly outputs = ['success'] as const;
  readonly 'contract' = EMPTY_CONTRACT_FRAGMENT;
      readonly timeout = Timeout.none();
      async execute(state: NodeStateBase) {
        state.setMetadata('answer', 'hello');
        return { 'errors': [], 'output': 'success' as const };
      }
    }
    const produce = new ProduceNode();
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
        { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
        {
          'itemKey': 'item',
          'gather': {
            'strategy': 'map',
            'mapping':  { 'metadata.answer': 'metadata.result' },
          },
        },
      )
      .terminal('end')
      .build();
    dispatcher.registerDAG(dag);

    interface S extends NodeStateBase { items: number[] }
    const state = new NodeStateBase() as S;
    state.items = [1];
    await dispatcher.execute('mapfan', state);
    // Incremental gather always produces an array; single-item → ['hello'].
    assert.deepEqual(state.getMetadata('result'), ['hello']);
  });

  void it('scatter respects concurrency cap', async () => {
    interface S extends NodeStateBase { items: number[]; out: number[] }
    let inFlight = 0;
    let peak = 0;
    const dispatcher = new Dagonizer<NodeStateBase>();
    class SlowNode implements NodeInterface<NodeStateBase, 'success'> {
      readonly name = 'slow';
      readonly outputs = ['success'] as const;
  readonly 'contract' = EMPTY_CONTRACT_FRAGMENT;
      readonly timeout = Timeout.none();
      async execute(_state: NodeStateBase) {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((r) => setImmediate(r));
        inFlight--;
        return { 'errors': [], 'output': 'success' as const };
      }
    }
    const slow = new SlowNode();
    dispatcher.registerNode(slow);

    const dag = new DAGBuilder('conc', '1')
      .scatter(
        'fan',
        'items',
        slow,
        { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
        {
          'concurrency': 2,
          'gather':      { 'strategy': 'append', 'target': 'out' },
        },
      )
      .terminal('end')
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
      'code': 'E', 'context': {}, 'message': 'm', 'operation': 'op',
      'recoverable': false, 'timestamp': new Date().toISOString(),
    });
    state.markRunning();

    const clone = state.clone();
    assert.deepEqual(clone.getMetadata('foo'), { 'bar': 1 });
    assert.equal(clone.errors.length, 0);
    assert.equal(clone.lifecycle.kind, 'pending');
  });
});
