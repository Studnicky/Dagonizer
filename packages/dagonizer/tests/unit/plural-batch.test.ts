import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { EMPTY_CONTRACT_FRAGMENT } from '../../src/contracts/OperationContractFragment.js';
import { Batch } from '../../src/core/batch/Batch.js';
import type { Item } from '../../src/core/batch/Item.js';
import { RoutedBatchBuilder } from '../../src/core/batch/RoutedBatch.js';
import type { RoutedBatch } from '../../src/core/batch/RoutedBatch.js';
import { NodeRunner } from '../../src/core/NodeRunner.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import type { NodeContextInterface } from '../../src/entities/node/NodeContext.js';
import { NodeErrorBuilder } from '../../src/entities/node/NodeError.js';
import type { NodeOutputInterface } from '../../src/entities/node/NodeOutput.js';
import { NodeOutputBuilder } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Timeout } from '../../src/runtime/Timeout.js';


// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

class TestState extends NodeStateBase {
  'value': number;
  constructor(value: number) {
    super();
    this.value = value;
  }
}

const ctx: NodeContextInterface = {
  'signal': new AbortController().signal,
  'dagName': 'test-dag',
  'nodeName': 'test-node',
  'services': undefined,
};

// ---------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------

void describe('Batch.of', () => {
  void it('returns a size-1 batch with default id "0"', () => {
    const batch = Batch.of(new TestState(1));
    assert.equal(batch.size, 1);
    assert.equal(batch.row(0).id, '0');
    assert.equal(batch.row(0).state.value, 1);
  });

  void it('accepts a custom id', () => {
    const batch = Batch.of(new TestState(2), 'abc');
    assert.equal(batch.row(0).id, 'abc');
  });
});

void describe('Batch.empty', () => {
  void it('returns a size-0 batch', () => {
    const batch = Batch.empty<TestState>();
    assert.equal(batch.size, 0);
    assert.deepEqual(batch.ids(), []);
  });
});

void describe('Batch.from', () => {
  void it('builds batch from items array', () => {
    const items: Item<TestState>[] = [
      { 'id': 'x', 'state': new TestState(10) },
      { 'id': 'y', 'state': new TestState(20) },
    ];
    const batch = Batch.from(items);
    assert.equal(batch.size, 2);
    assert.equal(batch.row(0).id, 'x');
    assert.equal(batch.row(1).id, 'y');
  });
});

void describe('Batch.map', () => {
  void it('transforms state values and preserves ids', () => {
    const batch = Batch.from<TestState>([
      { 'id': 'a', 'state': new TestState(1) },
      { 'id': 'b', 'state': new TestState(2) },
    ]);
    const mapped = batch.map((state, id) => ({ 'val': state.value * 2, 'id': id }));
    assert.equal(mapped.size, 2);
    assert.equal(mapped.row(0).id, 'a');
    assert.equal(mapped.row(0).state.val, 2);
    assert.equal(mapped.row(1).id, 'b');
    assert.equal(mapped.row(1).state.val, 4);
  });
});

void describe('Batch.filter', () => {
  void it('removes items not matching predicate', () => {
    const batch = Batch.from<TestState>([
      { 'id': '1', 'state': new TestState(5) },
      { 'id': '2', 'state': new TestState(-1) },
      { 'id': '3', 'state': new TestState(3) },
    ]);
    const filtered = batch.filter((state) => state.value > 0);
    assert.equal(filtered.size, 2);
    assert.equal(filtered.row(0).id, '1');
    assert.equal(filtered.row(1).id, '3');
  });

  void it('returns empty batch when no items match', () => {
    const batch = Batch.of(new TestState(-5));
    const filtered = batch.filter((state) => state.value > 0);
    assert.equal(filtered.size, 0);
  });
});

void describe('Batch.partition', () => {
  void it('groups by key and preserves order within each group', () => {
    const batch = Batch.from<TestState>([
      { 'id': '1', 'state': new TestState(1) },
      { 'id': '2', 'state': new TestState(-1) },
      { 'id': '3', 'state': new TestState(2) },
      { 'id': '4', 'state': new TestState(-2) },
    ]);
    const groups = batch.partition((state) => state.value > 0 ? 'pos' : 'neg');
    assert.equal(groups.size, 2);
    const pos = groups.get('pos');
    const neg = groups.get('neg');
    assert.ok(pos !== undefined);
    assert.ok(neg !== undefined);
    assert.equal(pos.size, 2);
    assert.equal(neg.size, 2);
    assert.equal(pos.row(0).id, '1');
    assert.equal(pos.row(1).id, '3');
    assert.equal(neg.row(0).id, '2');
    assert.equal(neg.row(1).id, '4');
  });

  void it('creates single group when all items share key', () => {
    const batch = Batch.from<TestState>([
      { 'id': 'a', 'state': new TestState(1) },
      { 'id': 'b', 'state': new TestState(2) },
    ]);
    const groups = batch.partition(() => 'all');
    assert.equal(groups.size, 1);
    assert.equal(groups.get('all')?.size, 2);
  });
});

void describe('Batch.concat', () => {
  void it('combines two batches in order', () => {
    const a = Batch.from<TestState>([{ 'id': '1', 'state': new TestState(1) }]);
    const b = Batch.from<TestState>([{ 'id': '2', 'state': new TestState(2) }]);
    const combined = a.concat(b);
    assert.equal(combined.size, 2);
    assert.equal(combined.row(0).id, '1');
    assert.equal(combined.row(1).id, '2');
  });

  void it('concat with empty batch returns original items', () => {
    const batch = Batch.of(new TestState(42));
    const combined = batch.concat(Batch.empty());
    assert.equal(combined.size, 1);
    assert.equal(combined.row(0).state.value, 42);
  });
});

void describe('Batch.ids', () => {
  void it('returns item ids in order', () => {
    const batch = Batch.from<TestState>([
      { 'id': 'x', 'state': new TestState(1) },
      { 'id': 'y', 'state': new TestState(2) },
      { 'id': 'z', 'state': new TestState(3) },
    ]);
    assert.deepEqual(batch.ids(), ['x', 'y', 'z']);
  });
});

void describe('Batch.row', () => {
  void it('returns first item at index 0', () => {
    const batch = Batch.from<TestState>([
      { 'id': 'first', 'state': new TestState(10) },
      { 'id': 'second', 'state': new TestState(20) },
    ]);
    assert.equal(batch.row(0).id, 'first');
  });

  void it('throws RangeError for out-of-bounds index', () => {
    const batch = Batch.of(new TestState(1));
    assert.throws(() => batch.row(1), RangeError);
    assert.throws(() => batch.row(-1), RangeError);
  });
});

void describe('Batch[Symbol.iterator]', () => {
  void it('iterates all items in order', () => {
    const batch = Batch.from<TestState>([
      { 'id': 'a', 'state': new TestState(1) },
      { 'id': 'b', 'state': new TestState(2) },
      { 'id': 'c', 'state': new TestState(3) },
    ]);
    const collected: string[] = [];
    for (const item of batch) {
      collected.push(item.id);
    }
    assert.deepEqual(collected, ['a', 'b', 'c']);
  });

  void it('iterates zero items for empty batch', () => {
    const batch = Batch.empty<TestState>();
    const collected: string[] = [];
    for (const item of batch) {
      collected.push(item.id);
    }
    assert.deepEqual(collected, []);
  });
});

// ---------------------------------------------------------------------------
// RoutedBatchBuilder
// ---------------------------------------------------------------------------

void describe('RoutedBatchBuilder.of', () => {
  void it('creates single-output map', () => {
    const batch = Batch.of(new TestState(1));
    const routed = RoutedBatchBuilder.of('done', batch);
    assert.equal(routed.size, 1);
    assert.equal(routed.get('done')?.size, 1);
  });
});

void describe('RoutedBatchBuilder.from', () => {
  void it('merges duplicate keys by concat', () => {
    const a = Batch.from<TestState>([{ 'id': '1', 'state': new TestState(1) }]);
    const b = Batch.from<TestState>([{ 'id': '2', 'state': new TestState(2) }]);
    const c = Batch.from<TestState>([{ 'id': '3', 'state': new TestState(3) }]);
    const routed = RoutedBatchBuilder.from<'x' | 'y', TestState>([
      ['x', a],
      ['y', c],
      ['x', b],
    ]);
    assert.equal(routed.size, 2);
    const xBatch = routed.get('x');
    assert.ok(xBatch !== undefined);
    assert.equal(xBatch.size, 2);
    assert.equal(xBatch.row(0).id, '1');
    assert.equal(xBatch.row(1).id, '2');
    assert.equal(routed.get('y')?.size, 1);
  });

  void it('produces empty map from empty entries array', () => {
    const routed = RoutedBatchBuilder.from([]);
    assert.equal(routed.size, 0);
  });
});

void describe('RoutedBatchBuilder.empty', () => {
  void it('returns empty map', () => {
    const routed = RoutedBatchBuilder.empty();
    assert.equal(routed.size, 0);
  });
});

// ---------------------------------------------------------------------------
// ScalarNode
// ---------------------------------------------------------------------------

class TagNode extends ScalarNode<TestState, 'tagged' | 'skip'> {
  readonly name = 'tag';
  readonly outputs = ['tagged', 'skip'] as const;
  protected async executeOne(
    state: TestState,
    _ctx: NodeContextInterface,
  ): Promise<NodeOutputInterface<'tagged' | 'skip'>> {
    return NodeOutputBuilder.of(state.value > 0 ? 'tagged' : 'skip');
  }
}

class ErroringNode extends ScalarNode<TestState, 'done'> {
  readonly name = 'erroring';
  readonly outputs = ['done'] as const;
  protected async executeOne(
    _state: TestState,
    _ctx: NodeContextInterface,
  ): Promise<NodeOutputInterface<'done'>> {
    const err = NodeErrorBuilder.from(
      'TEST_ERROR',
      'test error message',
      'executeOne',
      true,
      new Date().toISOString(),
    );
    return NodeOutputBuilder.of('done', { 'errors': [err] });
  }
}

void describe('ScalarNode', () => {
  void it('routes batch of 3 items to correct ports, preserving order', async () => {
    const node = new TagNode();
    const batch = Batch.from<TestState>([
      { 'id': '1', 'state': new TestState(1) },
      { 'id': '2', 'state': new TestState(-1) },
      { 'id': '3', 'state': new TestState(2) },
    ]);
    const result = await node.execute(batch, ctx);
    assert.equal(result.size, 2);
    const tagged = result.get('tagged');
    const skip = result.get('skip');
    assert.ok(tagged !== undefined);
    assert.ok(skip !== undefined);
    assert.equal(tagged.size, 2);
    assert.equal(skip.size, 1);
    assert.equal(tagged.row(0).id, '1');
    assert.equal(tagged.row(1).id, '3');
    assert.equal(skip.row(0).id, '2');
  });

  void it('routes single-item batch correctly', async () => {
    const node = new TagNode();
    const batch = Batch.of(new TestState(5));
    const result = await node.execute(batch, ctx);
    assert.equal(result.size, 1);
    assert.ok(result.has('tagged'));
    assert.equal(result.get('tagged')?.size, 1);
  });

  void it('produces empty routed batch for empty input', async () => {
    const node = new TagNode();
    const result = await node.execute(Batch.empty<TestState>(), ctx);
    assert.equal(result.size, 0);
  });

  void it('forwards errors from executeOne to state.collectError', async () => {
    const node = new ErroringNode();
    const state = new TestState(1);
    const batch = Batch.of(state);
    await node.execute(batch, ctx);
    assert.equal(state.errors.length, 1);
    assert.equal(state.errors[0]?.code, 'TEST_ERROR');
  });

  void it('implements NodeInterface batch execute', async () => {
    const node = new TagNode();
    const batch = Batch.of(new TestState(5));
    const result = await node.execute(batch, ctx);
    assert.ok(result instanceof Map);
    assert.ok(result.has('tagged'));
  });
});

// ---------------------------------------------------------------------------
// NodeRunner
// ---------------------------------------------------------------------------

void describe('NodeRunner', () => {
  void it('delegates to node.execute(batch, ctx)', async () => {
    const node = new TagNode();
    const batch = Batch.from<TestState>([
      { 'id': '1', 'state': new TestState(1) },
      { 'id': '2', 'state': new TestState(-1) },
    ]);
    const result = await NodeRunner.run(node, batch, ctx);
    assert.equal(result.size, 2);
    assert.ok(result.has('tagged'));
    assert.ok(result.has('skip'));
  });

  void it('hand-written batch execute produces same result as ScalarNode', async () => {
    const scalarNode = new TagNode();
    const handWrittenNode: NodeInterface<TestState, 'tagged' | 'skip'> = {
      'name': 'hw-tag',
      'outputs': ['tagged', 'skip'] as const,
      'contract': EMPTY_CONTRACT_FRAGMENT,
      'timeout': Timeout.none(),
      async execute(batch: Batch<TestState>): Promise<RoutedBatch<'tagged' | 'skip', TestState>> {
        const acc = new Map<'tagged' | 'skip', Item<TestState>[]>();
        for (const item of batch) {
          const output = item.state.value > 0 ? 'tagged' as const : 'skip' as const;
          const bucket = acc.get(output);
          if (bucket !== undefined) { bucket.push(item); } else { acc.set(output, [item]); }
        }
        const routed = new Map<'tagged' | 'skip', Batch<TestState>>();
        for (const [key, items] of acc) { routed.set(key, Batch.from(items)); }
        return routed;
      },
    };

    const items: Item<TestState>[] = [
      { 'id': '1', 'state': new TestState(1) },
      { 'id': '2', 'state': new TestState(-1) },
      { 'id': '3', 'state': new TestState(3) },
    ];
    const batchA = Batch.from<TestState>(items);
    const batchB = Batch.from<TestState>(items);

    const scalarResult = await NodeRunner.run(scalarNode, batchA, ctx);
    const hwResult = await NodeRunner.run(handWrittenNode, batchB, ctx);

    assert.equal(scalarResult.size, hwResult.size);
    assert.equal(scalarResult.get('tagged')?.size, hwResult.get('tagged')?.size);
    assert.equal(scalarResult.get('skip')?.size, hwResult.get('skip')?.size);
  });
});
