import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NodeRunner } from '../../src/core/NodeRunner.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import type { Item } from '../../src/entities/batch/Item.js';
import { RoutedBatchBuilder } from '../../src/entities/batch/RoutedBatch.js';
import type { NodeContextInterface } from '../../src/entities/node/NodeContext.js';
import { NodeErrorBuilder } from '../../src/entities/node/NodeError.js';
import type { NodeOutputInterface } from '../../src/entities/node/NodeOutput.js';
import { NodeOutputBuilder } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';


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

void describe('Batch', () => {
  void it('Batch.of: returns a size-1 batch with default id "0", accepts a custom id', () => {
    const batch = Batch.of(new TestState(1));
    assert.equal(batch.size, 1);
    assert.equal(batch.row(0).id, '0');
    assert.equal(batch.row(0).state.value, 1);

    const custom = Batch.of(new TestState(2), 'abc');
    assert.equal(custom.row(0).id, 'abc');
  });

  void it('Batch.empty: returns a size-0 batch with no ids', () => {
    const batch = Batch.empty<TestState>();
    assert.equal(batch.size, 0);
    assert.deepEqual(batch.ids(), []);
  });

  void it('Batch.from: builds batch from items array preserving id and order', () => {
    const items: Item<TestState>[] = [
      { 'id': 'x', 'state': new TestState(10) },
      { 'id': 'y', 'state': new TestState(20) },
    ];
    const batch = Batch.from(items);
    assert.equal(batch.size, 2);
    assert.equal(batch.row(0).id, 'x');
    assert.equal(batch.row(1).id, 'y');
  });

  void it('Batch.map: transforms state values and preserves ids', () => {
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

  void it('Batch.filter: removes items not matching predicate; returns empty batch when none match', () => {
    const batch = Batch.from<TestState>([
      { 'id': '1', 'state': new TestState(5) },
      { 'id': '2', 'state': new TestState(-1) },
      { 'id': '3', 'state': new TestState(3) },
    ]);
    const filtered = batch.filter((state) => state.value > 0);
    assert.equal(filtered.size, 2);
    assert.equal(filtered.row(0).id, '1');
    assert.equal(filtered.row(1).id, '3');

    const none = Batch.of(new TestState(-5)).filter((state) => state.value > 0);
    assert.equal(none.size, 0);
  });

  void it('Batch.partition: groups by key, preserves order within each group; single group when all share key', () => {
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

    const single = Batch.from<TestState>([
      { 'id': 'a', 'state': new TestState(1) },
      { 'id': 'b', 'state': new TestState(2) },
    ]).partition(() => 'all');
    assert.equal(single.size, 1);
    assert.equal(single.get('all')?.size, 2);
  });

  void it('Batch.concat: combines two batches in order; concat with empty preserves items', () => {
    const a = Batch.from<TestState>([{ 'id': '1', 'state': new TestState(1) }]);
    const b = Batch.from<TestState>([{ 'id': '2', 'state': new TestState(2) }]);
    const combined = a.concat(b);
    assert.equal(combined.size, 2);
    assert.equal(combined.row(0).id, '1');
    assert.equal(combined.row(1).id, '2');

    const withEmpty = Batch.of(new TestState(42)).concat(Batch.empty());
    assert.equal(withEmpty.size, 1);
    assert.equal(withEmpty.row(0).state.value, 42);
  });

  void it('Batch.ids: returns item ids in order', () => {
    const batch = Batch.from<TestState>([
      { 'id': 'x', 'state': new TestState(1) },
      { 'id': 'y', 'state': new TestState(2) },
      { 'id': 'z', 'state': new TestState(3) },
    ]);
    assert.deepEqual(batch.ids(), ['x', 'y', 'z']);
  });

  void it('Batch.row: returns correct item; throws RangeError for out-of-bounds index', () => {
    const batch = Batch.from<TestState>([
      { 'id': 'first', 'state': new TestState(10) },
      { 'id': 'second', 'state': new TestState(20) },
    ]);
    assert.equal(batch.row(0).id, 'first');
    const single = Batch.of(new TestState(1));
    assert.throws(() => single.row(1), RangeError);
    assert.throws(() => single.row(-1), RangeError);
  });

  void it('Batch[Symbol.iterator]: iterates all items in order; iterates zero items for empty batch', () => {
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

    const empty: string[] = [];
    for (const item of Batch.empty<TestState>()) {
      empty.push(item.id);
    }
    assert.deepEqual(empty, []);
  });
});

// ---------------------------------------------------------------------------
// RoutedBatchBuilder
// ---------------------------------------------------------------------------

void describe('RoutedBatchBuilder', () => {
  void it('RoutedBatchBuilder.of: creates single-output map', () => {
    const batch = Batch.of(new TestState(1));
    const routed = RoutedBatchBuilder.of('done', batch);
    assert.equal(routed.size, 1);
    assert.equal(routed.get('done')?.size, 1);
  });

  void it('RoutedBatchBuilder.from: merges duplicate keys by concat; produces empty map from empty entries', () => {
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

    const empty = RoutedBatchBuilder.from([]);
    assert.equal(empty.size, 0);
  });

  void it('RoutedBatchBuilder.empty: returns empty map', () => {
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
  void it('routes batch of 3 items to correct ports, preserving order; routes single-item batch; handles empty batch', async () => {
    const node = new TagNode();

    // Three-item batch: two positives, one negative.
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

    // Single-item batch.
    const single = await node.execute(Batch.of(new TestState(5)), ctx);
    assert.equal(single.size, 1);
    assert.ok(single.has('tagged'));
    assert.equal(single.get('tagged')?.size, 1);

    // Empty batch.
    const empty = await node.execute(Batch.empty<TestState>(), ctx);
    assert.equal(empty.size, 0);
  });

  void it('forwards errors from executeOne to state.collectError', async () => {
    const node = new ErroringNode();
    const state = new TestState(1);
    const batch = Batch.of(state);
    await node.execute(batch, ctx);
    assert.equal(state.errors.length, 1);
    assert.equal(state.errors[0]?.code, 'TEST_ERROR');
  });

  void it('implements NodeInterface batch execute — returns a Map', async () => {
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
});
