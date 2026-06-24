/**
 * dag-stream-producer.test.ts
 *
 * Behavioral unit tests for `DagStreamProducer`: the abstract bridge that
 * drives an inner DAG's async-iterable node-result stream into a push sink,
 * feeding an outer scatter with back-pressured live items.
 *
 * Coverage:
 *   (a) Basic bridge: a concrete subclass whose executions() returns a hand-
 *       built async generator of NodeResult fixtures is wired through
 *       StreamChannel.driven and drains the expected selected items.
 *   (b) Back-pressure: with capacity=1 the channel does not drop or duplicate
 *       items even when the producer outruns the consumer.
 *   (c) Composition: StreamChannel.fanIn([A, B]) delivers the union of both
 *       producers' items (multiset union), proving sub-DAG producers compose.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { StreamChannel } from '../../src/channels/StreamChannel.js';
import type { NodeResultType } from '../../src/entities/node/NodeResult.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';
import { DagStreamProducer } from '../../src/patterns/DagStreamProducer.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * NodeResultFixture: factory for hand-built NodeResultType fixtures.
 * Static methods on a named class per noun.verb() convention.
 */
class NodeResultFixture {
  private constructor() {}

  static of(
    nodeName: string,
    output: string | null,
    skipped: boolean,
  ): NodeResultType<NodeStateInterface> {
    return {
      'nodeName': nodeName,
      'output': output,
      'skipped': skipped,
      'state': new NodeStateBase(),
      'intermediateResults': [],
    };
  }
}

/**
 * Collects items from any `AsyncIterable` into an array.
 * Static method on a named class per noun.verb() convention.
 */
class AsyncDrain {
  private constructor() {}

  static async collect<T>(source: AsyncIterable<T>): Promise<T[]> {
    const items: T[] = [];
    for await (const item of source) {
      items.push(item);
    }
    return items;
  }
}

// ---------------------------------------------------------------------------
// Concrete subclasses of DagStreamProducer for testing
// ---------------------------------------------------------------------------

/**
 * FixtureProducer: yields a fixed list of NodeResult fixtures from executions()
 * and selects the nodeName for each non-skipped stage.
 */
class FixtureProducer extends DagStreamProducer<string> {
  readonly #stages: NodeResultType<NodeStateInterface>[];

  constructor(stages: NodeResultType<NodeStateInterface>[]) {
    super();
    this.#stages = stages;
  }

  protected async *executions(): AsyncGenerator<NodeResultType<NodeStateInterface>> {
    for (const stage of this.#stages) {
      yield stage;
    }
  }

  protected select(stage: NodeResultType<NodeStateInterface>): Iterable<string> {
    if (stage.skipped) {
      return [];
    }
    return [stage.nodeName];
  }
}

/**
 * MultiSelectProducer: yields multiple items per stage (all non-null outputs
 * and the nodeName), to verify that select() can yield more than one item.
 */
class MultiSelectProducer extends DagStreamProducer<string> {
  readonly #stages: NodeResultType<NodeStateInterface>[];

  constructor(stages: NodeResultType<NodeStateInterface>[]) {
    super();
    this.#stages = stages;
  }

  protected async *executions(): AsyncGenerator<NodeResultType<NodeStateInterface>> {
    for (const stage of this.#stages) {
      yield stage;
    }
  }

  protected select(stage: NodeResultType<NodeStateInterface>): Iterable<string> {
    const items: string[] = [stage.nodeName];
    if (stage.output !== null) {
      items.push(stage.output);
    }
    return items;
  }
}

// ---------------------------------------------------------------------------
// (a) Basic bridge
// ---------------------------------------------------------------------------

void describe('DagStreamProducer: basic bridge', () => {

  void it('non-skipped stages are selected; skipped stages are filtered out', async () => {
    const stages = [
      NodeResultFixture.of('fetch', 'success', false),
      NodeResultFixture.of('parse', null, true),   // skipped — should be filtered
      NodeResultFixture.of('store', 'done', false),
    ];

    const producer = new FixtureProducer(stages);
    const channel = StreamChannel.driven(producer);
    const items = await AsyncDrain.collect(channel);

    assert.deepStrictEqual(items, ['fetch', 'store']);
  });

  void it('all-skipped stages produce empty output', async () => {
    const stages = [
      NodeResultFixture.of('a', null, true),
      NodeResultFixture.of('b', null, true),
    ];

    const producer = new FixtureProducer(stages);
    const channel = StreamChannel.driven(producer);
    const items = await AsyncDrain.collect(channel);

    assert.deepStrictEqual(items, []);
  });

  void it('select() may yield multiple items per stage', async () => {
    const stages = [
      NodeResultFixture.of('alpha', 'route-a', false),
      NodeResultFixture.of('beta', null, false),
    ];

    const producer = new MultiSelectProducer(stages);
    const channel = StreamChannel.driven(producer);
    const items = await AsyncDrain.collect(channel);

    // alpha → ['alpha', 'route-a'], beta → ['beta']
    assert.deepStrictEqual(items, ['alpha', 'route-a', 'beta']);
  });

});

// ---------------------------------------------------------------------------
// (b) Back-pressure
// ---------------------------------------------------------------------------

void describe('DagStreamProducer: back-pressure with bounded channel', () => {

  void it('capacity=1 channel drains all 20 items in order without dropping or duplicating', async () => {
    const count = 20;
    const stages = Array.from({ 'length': count }, (_, i) =>
      NodeResultFixture.of(`node-${i}`, 'ok', false),
    );

    const producer = new FixtureProducer(stages);
    // capacity:1 forces back-pressure on every push
    const channel = StreamChannel.driven(producer, { 'capacity': 1 });
    const items = await AsyncDrain.collect(channel);

    const expected = Array.from({ 'length': count }, (_, i) => `node-${i}`);
    assert.strictEqual(items.length, count, 'item count must match');
    assert.deepStrictEqual(items, expected, 'items must be in order, no drops or duplicates');
  });

  void it('capacity=2 channel drains 20 items correctly', async () => {
    const count = 20;
    const stages = Array.from({ 'length': count }, (_, i) =>
      NodeResultFixture.of(`n${i}`, null, false),
    );

    const producer = new FixtureProducer(stages);
    const channel = StreamChannel.driven(producer, { 'capacity': 2 });
    const items = await AsyncDrain.collect(channel);

    assert.strictEqual(items.length, count);
    assert.deepStrictEqual(items, Array.from({ 'length': count }, (_, i) => `n${i}`));
  });

});

// ---------------------------------------------------------------------------
// (c) Composition via StreamChannel.fanIn
// ---------------------------------------------------------------------------

void describe('DagStreamProducer: composition with fanIn', () => {

  void it('fanIn of two FixtureProducers delivers the union of both producers items', async () => {
    const stagesA = [
      NodeResultFixture.of('a1', 'ok', false),
      NodeResultFixture.of('a2', 'ok', false),
    ];
    const stagesB = [
      NodeResultFixture.of('b1', 'ok', false),
      NodeResultFixture.of('b2', 'ok', false),
      NodeResultFixture.of('b3', 'ok', false),
    ];

    const producerA = new FixtureProducer(stagesA);
    const producerB = new FixtureProducer(stagesB);

    const channel = StreamChannel.fanIn([producerA, producerB]);
    const items = await AsyncDrain.collect(channel);

    // Both producers run concurrently; we assert the multiset union is correct.
    // Sort to remove interleaving nondeterminism.
    const sorted = [...items].sort();
    assert.deepStrictEqual(sorted, ['a1', 'a2', 'b1', 'b2', 'b3']);
    assert.strictEqual(items.length, 5, 'no items dropped or duplicated');
  });

  void it('fanIn with a skipping producer only delivers the non-skipped items', async () => {
    const stagesA = [
      NodeResultFixture.of('real', 'ok', false),
    ];
    const stagesB = [
      NodeResultFixture.of('skip-me', null, true),
      NodeResultFixture.of('also-real', 'ok', false),
    ];

    const producerA = new FixtureProducer(stagesA);
    const producerB = new FixtureProducer(stagesB);

    const channel = StreamChannel.fanIn([producerA, producerB]);
    const items = await AsyncDrain.collect(channel);

    const sorted = [...items].sort();
    assert.deepStrictEqual(sorted, ['also-real', 'real']);
  });

  void it('fanIn of an empty producers array delivers no items', async () => {
    const channel = StreamChannel.fanIn<string>([]);
    const items = await AsyncDrain.collect(channel);
    assert.deepStrictEqual(items, []);
  });

  void it('fanIn of three producers delivers all items from all three', async () => {
    const make = (prefix: string, n: number): FixtureProducer =>
      new FixtureProducer(
        Array.from({ 'length': n }, (_, i) => NodeResultFixture.of(`${prefix}${i}`, 'ok', false)),
      );

    const channel = StreamChannel.fanIn([make('x', 3), make('y', 2), make('z', 4)]);
    const items = await AsyncDrain.collect(channel);

    assert.strictEqual(items.length, 9);
    // Verify all expected names appear (sort to ignore interleave order)
    const sorted = [...items].sort();
    const expected = [
      'x0', 'x1', 'x2',
      'y0', 'y1',
      'z0', 'z1', 'z2', 'z3',
    ].sort();
    assert.deepStrictEqual(sorted, expected);
  });

});
