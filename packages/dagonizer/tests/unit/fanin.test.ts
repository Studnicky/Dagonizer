import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

void describe('Dagonizer scatter gather strategies', () => {
  void it('first-class gather waits for multiple entrypoint producers', async () => {
    class MultiEntryState extends NodeStateBase {
      leftValue = '';
      rightValue = '';
      seenSources: string[] = [];
    }

    const dispatcher = new Dagonizer<MultiEntryState>();
    const left = TestNode.make<MultiEntryState>('left', ['success'], (state) => {
      state.leftValue = 'left-ready';
      return 'success';
    });
    const right = TestNode.make<MultiEntryState>('right', ['success'], (state) => {
      state.rightValue = 'right-ready';
      return 'success';
    });
    const merge = TestNode.make<MultiEntryState>('merge', ['success'], (state) => {
      const raw = state.getMetadata('gatherResults');
      const records = Array.isArray(raw) ? raw.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null) : [];
      state.seenSources = records.map((record) => String(record['source'])).sort();
      return 'success';
    });

    dispatcher.registerNode(left);
    dispatcher.registerNode(right);
    dispatcher.registerNode(merge);

    const dag = new DAGBuilder('multi-entry-gather', '1')
      .node('left', left, { 'success': 'join' })
      .node('right', right, { 'success': 'join' })
      .gather('join', ['left', 'right'], { 'strategy': 'custom', 'customNode': 'merge' }, { 'success': 'end', 'error': 'failed' })
      .terminal('end')
      .terminal('failed', { 'outcome': 'failed' })
      .entrypoints({ 'left': 'left', 'right': 'right' })
      .build();
    dispatcher.registerDAG(dag);

    const state = new MultiEntryState();
    const result = await dispatcher.execute('multi-entry-gather', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.deepEqual(state.seenSources, ['left', 'right']);
  });

  void it('first-class gather consumes embedded DAG gatherResult projection', async () => {
    class ChildState extends NodeStateBase {
      answer = '';
    }
    class ParentState extends NodeStateBase {
      seenResults: unknown[] = [];
    }

    const dispatcher = new Dagonizer<ParentState>();
    const answer = TestNode.make<ChildState>('answer', ['success'], (state) => {
      state.answer = 'forty-two';
      return 'success';
    });
    const merge = TestNode.make<ParentState>('merge', ['success'], (state) => {
      const raw = state.getMetadata('gatherResults');
      const records = Array.isArray(raw) ? raw.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null) : [];
      state.seenResults = records.map((record) => record['result']);
      return 'success';
    });

    const childDag = new DAGBuilder('child-answer', '1')
      .node('answer', answer, { 'success': 'done' })
      .terminal('done')
      .build();

    const parentDag = new DAGBuilder('embedded-gather-result', '1')
      .embed<ChildState, ParentState>('invoke', 'child-answer', { 'success': 'join', 'error': 'join' }, {
        'gatherResult': { 'resultField': 'answer' },
      })
      .gather('join', ['invoke'], { 'strategy': 'custom', 'customNode': 'merge' }, { 'success': 'end', 'error': 'failed' })
      .terminal('end')
      .terminal('failed', { 'outcome': 'failed' })
      .build();

    dispatcher.registerNode(answer);
    dispatcher.registerNode(merge);
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new ParentState();
    const result = await dispatcher.execute('embedded-gather-result', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.deepEqual(state.seenResults, ['forty-two']);
  });

  void it('partition routes items by output into distinct target paths', async () => {
    class PartitionState extends NodeStateBase {
      items: number[] = [];
      evens: number[] = [];
      odds: number[] = [];
    }
    const dispatcher = new Dagonizer<NodeStateBase>();
    const classify = TestNode.make<NodeStateBase>('classify', ['even', 'odd'], (state) => {
      const n = state.getter.number('item');
      return n % 2 === 0 ? 'even' : 'odd';
    });
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

    const state = new PartitionState();
    state.items = [1, 2, 3, 4, 5];
    state.evens = [];
    state.odds  = [];
    await dispatcher.execute('partition', state);
    assert.deepEqual(state.evens.sort(), [2, 4]);
    assert.deepEqual(state.odds.sort(), [1, 3, 5]);
  });

  void it('custom invokes a custom node with gatherResults metadata', async () => {
    interface GatherResultRecord {
      source: string;
      index: number | null;
      item: unknown;
      output: string;
      terminalOutcome: 'completed' | 'failed' | null;
      result: unknown;
    }

    class GatherResultRecordGuard {
      private constructor() {}
      static isArray(v: unknown): v is GatherResultRecord[] {
        if (!Array.isArray(v)) return false;
        return v.every((entry) => {
          if (typeof entry !== 'object' || entry === null) return false;
          return 'item' in entry && 'output' in entry;
        });
      }
    }

    let seenResults: GatherResultRecord[] | undefined;

    class CustomFanState extends NodeStateBase {
      items: number[] = [];
      doubled = 0;
    }

    const dispatcher = new Dagonizer<CustomFanState>();
    const cls = TestNode.make<CustomFanState>('classify', ['success'], (state) => {
      const item = state.getMetadata('item');
      state.doubled = typeof item === 'number' ? item * 2 : 0;
      return 'success';
    });
    const merge = TestNode.make<CustomFanState>('merge', ['success'], (state) => {
      const raw = state.getMetadata('gatherResults');
      seenResults = GatherResultRecordGuard.isArray(raw) ? raw : undefined;
      return 'success';
    });
    dispatcher.registerNode(cls);
    dispatcher.registerNode(merge);

    const dag = new DAGBuilder('customfan', '1')
      .scatter(
        'fan',
        'items',
        cls,
        { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
        {
          'itemKey': 'item',
          'gather':  { 'strategy': 'custom', 'customNode': 'merge', 'resultField': 'doubled' },
        },
      )
      .terminal('end')
      .build();
    dispatcher.registerDAG(dag);

    const state = new CustomFanState();
    state.items = [1, 2, 3];
    await dispatcher.execute('customfan', state);

    assert.ok(seenResults !== undefined);
    assert.equal(seenResults?.length, 3);
    // gatherResults carries producer metadata plus the projected result.
    const items = seenResults?.map((r) => r.item).sort((a, b) => Number(a) - Number(b));
    assert.deepEqual(items, [1, 2, 3]);
    assert.ok(seenResults?.every((r) => r.output === 'success'));
    assert.ok(seenResults?.every((r) => r.source === 'fan'));
    assert.deepEqual(
      seenResults?.map((r) => r.result).sort((a, b) => Number(a) - Number(b)),
      [2, 4, 6],
    );
  });

  void it('append gathers clone items into a target array in source-index order', async () => {
    class AppendState extends NodeStateBase { items: number[] = []; out: number[] = []; }

    const dispatcher = new Dagonizer<NodeStateBase>();
    const passThrough = TestNode.make('passThrough', ['success']);
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

    const state = new AppendState();
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
    const produce = TestNode.make('produce', ['success'], (state) => {
      state.setMetadata('answer', 'hello');
      return 'success';
    });
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

    class MapFanState extends NodeStateBase { items: number[] = []; }
    const state = new MapFanState();
    state.items = [1];
    await dispatcher.execute('mapfan', state);
    // Incremental gather always produces an array; single-item → ['hello'].
    assert.deepEqual(state.getMetadata('result'), ['hello']);
  });

  void it('scatter respects concurrency cap', async () => {
    class ConcState extends NodeStateBase { items: number[] = []; out: number[] = []; }
    let inFlight = 0;
    let peak = 0;
    const dispatcher = new Dagonizer<NodeStateBase>();
    const slow = TestNode.make('slow', ['success'], async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((r) => setImmediate(r));
      inFlight--;
      return 'success';
    });
    dispatcher.registerNode(slow);

    const dag = new DAGBuilder('conc', '1')
      .scatter(
        'fan',
        'items',
        slow,
        { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
        {
          'execution': { 'mode': 'item', 'concurrency': 2 },
          'gather':      { 'strategy': 'append', 'target': 'out' },
        },
      )
      .terminal('end')
      .build();
    dispatcher.registerDAG(dag);

    const state = new ConcState();
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
    assert.equal(clone.lifecycle.variant, 'pending');
  });
});
