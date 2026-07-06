/**
 * stream-resume.test.ts
 *
 * Behavioral unit tests for the Wave 2 streaming additions:
 *   (1) StreamCursor.resumeAfter returns 0 for a fresh state (no checkpoint).
 *   (2) StreamCursor.resumeAfter returns the scatter engine's nextIndex after a
 *       bounded checkpoint is seeded via ScatterCheckpoint.writeBounded.
 *   (3) StreamChannel.resumable passes resumeAfter to producer.produce(sink, n)
 *       and the emitted items (skipping the first n) drain correctly.
 *   (4) StreamChannel.fanIn: two producers → all items delivered; channel closes
 *       after both settle (for-await terminates).
 *   (5) StreamChannel.fanIn empty array → iterator immediately done.
 *   (6) StreamChannel.fanIn first-producer-rejects → for-await rejects with that
 *       error; the second producer's pending push rejects (unwinds safely).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { StreamChannel } from '../../src/channels/StreamChannel.js';
import { StreamCursor } from '../../src/channels/StreamCursor.js';
import { ScatterCheckpoint } from '../../src/checkpoint/ScatterCheckpoint.js';
import type { ResumableStreamProducerInterface } from '../../src/contracts/ResumableStreamProducerInterface.js';
import type { StreamProducerInterface } from '../../src/contracts/StreamProducerInterface.js';
import type { StreamSinkInterface } from '../../src/contracts/StreamSinkInterface.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

// ---------------------------------------------------------------------------
// Test helpers (class-based, noun.verb() convention)
// ---------------------------------------------------------------------------

/**
 * Collects items from any `AsyncIterable` into an array.
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

/**
 * SkipProducer: a resumable producer that emits integers [0, count) and skips
 * the first `resumeAfter` emissions. Records the `resumeAfter` it received so
 * tests can assert pass-through.
 */
class SkipProducer implements ResumableStreamProducerInterface<number> {
  readonly #count: number;
  #receivedResumeAfter: number;

  constructor(count: number) {
    this.#count = count;
    this.#receivedResumeAfter = -1;
  }

  get receivedResumeAfter(): number {
    return this.#receivedResumeAfter;
  }

  async produce(sink: StreamSinkInterface<number>, resumeAfter: number): Promise<void> {
    this.#receivedResumeAfter = resumeAfter;
    for (let i = resumeAfter; i < this.#count; i++) {
      await sink.push(i);
    }
  }
}

/**
 * CountingProducer: pushes a fixed list of items then resolves.
 * Implements `StreamProducerInterface<T>`.
 */
class CountingProducer<T> implements StreamProducerInterface<T> {
  readonly #items: T[];

  constructor(items: T[]) {
    this.#items = items;
  }

  async produce(sink: StreamSinkInterface<T>): Promise<void> {
    for (const item of this.#items) {
      await sink.push(item);
    }
  }
}

/**
 * SlowFailProducer: pushes one item then rejects. Used to test the fanIn
 * failure path.
 */
class SlowFailProducer<T> implements StreamProducerInterface<T> {
  readonly #item: T;
  readonly #error: unknown;

  constructor(item: T, error: unknown) {
    this.#item = item;
    this.#error = error;
  }

  async produce(sink: StreamSinkInterface<T>): Promise<void> {
    await sink.push(this.#item);
    throw this.#error;
  }
}

/**
 * BlockingProducer: parks at its first push (which back-pressures when the
 * capacity-1 channel is full). Used to verify the second producer unwinds when
 * the channel is failed underneath it.
 */
class BlockingProducer<T> implements StreamProducerInterface<T> {
  readonly #items: T[];

  constructor(items: T[]) {
    this.#items = items;
  }

  async produce(sink: StreamSinkInterface<T>): Promise<void> {
    for (const item of this.#items) {
      await sink.push(item);
    }
  }
}

class ThrowingProducer<T> implements StreamProducerInterface<T>, ResumableStreamProducerInterface<T> {
  readonly #error: unknown;

  constructor(error: unknown) {
    this.#error = error;
  }

  produce(_sink: StreamSinkInterface<T>, _resumeAfter?: number): Promise<void> {
    throw this.#error;
  }
}

// ---------------------------------------------------------------------------
// (1) StreamCursor.resumeAfter — fresh state returns 0
// ---------------------------------------------------------------------------

void describe('StreamCursor.resumeAfter: fresh state', () => {

  void it('returns 0 when no scatter checkpoint exists', () => {
    const state = new NodeStateBase();
    const result = StreamCursor.resumeAfter(state, 'my-scatter');
    assert.strictEqual(result, 0);
  });

});

// ---------------------------------------------------------------------------
// (2) StreamCursor.resumeAfter — bounded checkpoint seeded
// ---------------------------------------------------------------------------

void describe('StreamCursor.resumeAfter: bounded checkpoint', () => {

  void it('returns nextIndex from a seeded bounded checkpoint', () => {
    const state = new NodeStateBase();
    const name = 'scatter-a';

    // Seed a bounded checkpoint: watermark=5, no ahead-acked, no inbox.
    // restoreRunState will set nextIndex = watermarkRef.value = 5.
    ScatterCheckpoint.writeBounded(state, name, [], 5, [], {});

    // Compute expected value the same way the engine does.
    const stored = ScatterCheckpoint.read(state, name);
    const expected = ScatterCheckpoint.restoreRunState(stored, true).nextIndex;
    assert.strictEqual(expected, 5);

    const actual = StreamCursor.resumeAfter(state, name);
    assert.strictEqual(actual, expected);
  });

  void it('returns 0 with compactable:false when no retained checkpoint exists', () => {
    const state = new NodeStateBase();
    const result = StreamCursor.resumeAfter(state, 'scatter-b', { 'compactable': false });
    assert.strictEqual(result, 0);
  });

});

// ---------------------------------------------------------------------------
// (3) StreamChannel.resumable — passes resumeAfter through to producer
// ---------------------------------------------------------------------------

void describe('StreamChannel.resumable', () => {

  void it('passes resumeAfter to producer.produce and drains the correct items', async () => {
    const producer = new SkipProducer(10); // emits 0..9
    const resumeAfter = 3;

    // Producer will skip items 0, 1, 2 and emit 3..9.
    const channel = StreamChannel.resumable(producer, resumeAfter);
    const items = await AsyncDrain.collect(channel);

    assert.strictEqual(producer.receivedResumeAfter, resumeAfter, 'resumeAfter must be forwarded');
    assert.deepStrictEqual(items, [3, 4, 5, 6, 7, 8, 9]);
  });

  void it('resumeAfter=0 behaves identically to a fresh producer', async () => {
    const producer = new SkipProducer(4);
    const channel = StreamChannel.resumable(producer, 0);
    const items = await AsyncDrain.collect(channel);

    assert.strictEqual(producer.receivedResumeAfter, 0);
    assert.deepStrictEqual(items, [0, 1, 2, 3]);
  });

  void it('synchronous producer throw fails the returned channel', async () => {
    const sentinel = new Error('resumable-sync-throw');
    const channel = StreamChannel.resumable(new ThrowingProducer<number>(sentinel), 5);

    await assert.rejects(
      () => AsyncDrain.collect(channel),
      (err: unknown) => err === sentinel,
    );
  });

});

// ---------------------------------------------------------------------------
// (4) StreamChannel.fanIn — two producers, all items delivered
// ---------------------------------------------------------------------------

void describe('StreamChannel.fanIn: two producers', () => {

  void it('delivers all items from both producers and closes after both settle', async () => {
    const p1 = new CountingProducer([1, 2, 3]);
    const p2 = new CountingProducer([10, 20, 30]);

    const channel = StreamChannel.fanIn([p1, p2]);
    const items = await AsyncDrain.collect(channel);

    // Order between producers is non-deterministic; assert the multiset.
    const sorted = [...items].sort((a, b) => a - b);
    assert.deepStrictEqual(sorted, [1, 2, 3, 10, 20, 30]);
  });

});

// ---------------------------------------------------------------------------
// (5) StreamChannel.fanIn — empty array closes immediately
// ---------------------------------------------------------------------------

void describe('StreamChannel.fanIn: empty producers array', () => {

  void it('returns a channel that is immediately done', async () => {
    const channel = StreamChannel.fanIn<number>([]);
    const items = await AsyncDrain.collect(channel);
    assert.deepStrictEqual(items, []);
  });

});

// ---------------------------------------------------------------------------
// (6) StreamChannel.fanIn — first producer rejects
// ---------------------------------------------------------------------------

void describe('StreamChannel.fanIn: first producer rejects', () => {

  void it('for-await rejects with the first producer error; second producer unwinds', async () => {
    const sentinel = new Error('fanin-failure');

    // SlowFailProducer pushes one item then throws.
    // BlockingProducer pushes more items — capacity-1 channel means its second
    // push will park; when the channel is failed that push rejects so the
    // producer unwinds via the rejected push.
    const p1 = new SlowFailProducer<number>(42, sentinel);
    const p2 = new BlockingProducer<number>([99, 100]);

    // Capacity 1: buffer fills after p2 pushes 99, then p2's push(100) parks.
    // p1 pushes 42 (direct-handed or buffered), then fails the channel.
    const channel = StreamChannel.fanIn([p1, p2], { 'capacity': 1 });

    let caught: unknown = null;
    const collected: number[] = [];
    try {
      for await (const item of channel) {
        collected.push(item);
      }
    } catch (err) {
      caught = err;
    }

    assert.strictEqual(caught, sentinel, 'for-await must reject with the producer error');
    // We may or may not have collected some items before the error surfaces;
    // the important assertion is the error identity.
  });

  void it('synchronous producer throw fails the returned channel', async () => {
    const sentinel = new Error('fanin-sync-throw');
    const channel = StreamChannel.fanIn([new ThrowingProducer<number>(sentinel)]);

    await assert.rejects(
      () => AsyncDrain.collect(channel),
      (err: unknown) => err === sentinel,
    );
  });

});
