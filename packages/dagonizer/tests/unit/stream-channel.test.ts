/**
 * stream-channel.test.ts
 *
 * Behavioral unit tests for `StreamChannel`: bounded single-producer /
 * single-consumer async queue that implements `AsyncIterable<T>` and
 * `StreamSinkInterface<T>`.
 *
 * Coverage:
 *   (a) push below capacity resolves without awaiting a consumer.
 *   (b) push AT capacity applies back-pressure: resolves only after the
 *       consumer drains a slot (ordering verified via event log).
 *   (c) async-iteration yields items in FIFO push order.
 *   (d) close() drains remaining buffered items then reports done.
 *   (e) fail(err) causes the next next() to reject with err.
 *   (f) abort via options.signal causes pending push/next to reject.
 *   (g) StreamChannel.driven: N-item producer → consumer iterates N items
 *       then done; a producer that rejects → iteration rejects with that error.
 *   (h) end-to-end shape: for-await drain matches array drain.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { StreamChannel } from '../../src/channels/StreamChannel.js';
import type { StreamProducerInterface } from '../../src/contracts/StreamProducerInterface.js';
import type { StreamSinkInterface } from '../../src/contracts/StreamSinkInterface.js';

// ---------------------------------------------------------------------------
// Test helpers (class-based, no freestanding functions)
// ---------------------------------------------------------------------------

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

/**
 * FixedProducer: pushes a fixed list of items then resolves.
 * Implements `StreamProducerInterface<T>` as a class per the no-callback rule.
 */
class FixedProducer<T> implements StreamProducerInterface<T> {
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
 * FailingProducer: pushes one item then rejects with the given error.
 */
class FailingProducer<T> implements StreamProducerInterface<T> {
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

class ThrowingProducer<T> implements StreamProducerInterface<T> {
  readonly #error: unknown;

  constructor(error: unknown) {
    this.#error = error;
  }

  produce(_sink: StreamSinkInterface<T>): Promise<void> {
    throw this.#error;
  }
}

// ---------------------------------------------------------------------------
// (a) push below capacity resolves without awaiting a consumer
// ---------------------------------------------------------------------------

void describe('StreamChannel: push below capacity', () => {

  void it('resolves immediately when buffer is not full', async () => {
    const channel = new StreamChannel<number>({ 'capacity': 10 });
    // Push 5 items into a capacity-10 channel; none should hang.
    await channel.push(1);
    await channel.push(2);
    await channel.push(3);
    channel.close();

    const items = await AsyncDrain.collect(channel);
    assert.deepStrictEqual(items, [1, 2, 3]);
  });

});

void describe('StreamChannel: constructor validation', () => {
  void it('rejects non-positive capacity', () => {
    assert.throws(
      () => new StreamChannel<number>({ 'capacity': 0 }),
      (err: unknown) => err instanceof RangeError && err.message.includes('positive finite integer'),
    );
  });

  void it('rejects non-integer capacity', () => {
    assert.throws(
      () => new StreamChannel<number>({ 'capacity': 1.5 }),
      (err: unknown) => err instanceof RangeError && err.message.includes('positive finite integer'),
    );
  });
});

// ---------------------------------------------------------------------------
// (b) push AT capacity applies back-pressure
// ---------------------------------------------------------------------------

void describe('StreamChannel: back-pressure at capacity', () => {

  void it('push at capacity awaits until the consumer drains a slot', async () => {
    const log: string[] = [];
    const channel = new StreamChannel<number>({ 'capacity': 1 });

    // Fill the buffer to capacity.
    await channel.push(10);

    // This push should block because buffer is full.
    const pushPromise = channel.push(20).then(() => {
      log.push('push-resolved');
    });

    // Yield to the event loop so that if push resolves spuriously, it can.
    await Promise.resolve();
    assert.deepStrictEqual(log, [], 'push must not resolve before consumer drains');

    // Consume the first item — this frees a slot and unblocks the second push.
    const iter = channel[Symbol.asyncIterator]();
    const first = await iter.next();
    assert.deepStrictEqual(first, { 'value': 10, 'done': false });

    // Now the push can resolve.
    await pushPromise;
    assert.deepStrictEqual(log, ['push-resolved'], 'push resolves after consumer drains slot');

    channel.close();
    const second = await iter.next();
    assert.deepStrictEqual(second, { 'value': 20, 'done': false });
    const done = await iter.next();
    assert.strictEqual(done.done, true);
  });

});

// ---------------------------------------------------------------------------
// (c) async-iteration yields items in FIFO push order
// ---------------------------------------------------------------------------

void describe('StreamChannel: FIFO iteration order', () => {

  void it('yields items in the order they were pushed', async () => {
    const channel = new StreamChannel<string>({ 'capacity': 5 });
    await channel.push('a');
    await channel.push('b');
    await channel.push('c');
    channel.close();

    const items = await AsyncDrain.collect(channel);
    assert.deepStrictEqual(items, ['a', 'b', 'c']);
  });

  void it('yields undefined as a legitimate payload value', async () => {
    const channel = new StreamChannel<undefined>({ 'capacity': 2 });
    await channel.push(undefined);
    channel.close();

    const iter = channel[Symbol.asyncIterator]();
    assert.deepStrictEqual(await iter.next(), { 'value': undefined, 'done': false });
    assert.deepStrictEqual(await iter.next(), { 'value': undefined, 'done': true });
  });

});

// ---------------------------------------------------------------------------
// (d) close() drains remaining buffered items then signals done
// ---------------------------------------------------------------------------

void describe('StreamChannel: close drains buffer then done', () => {

  void it('close() after buffered pushes — consumer drains all then gets done', async () => {
    const channel = new StreamChannel<number>({ 'capacity': 4 });
    await channel.push(1);
    await channel.push(2);
    await channel.push(3);
    channel.close();

    const items = await AsyncDrain.collect(channel);
    assert.deepStrictEqual(items, [1, 2, 3]);
  });

  void it('close() is idempotent', () => {
    const channel = new StreamChannel<number>({ 'capacity': 4 });
    channel.close();
    channel.close(); // must not throw
  });

});

// ---------------------------------------------------------------------------
// (e) fail(err) causes next() to reject with err
// ---------------------------------------------------------------------------

void describe('StreamChannel: fail propagates error to consumer', () => {

  void it('fail() causes iterator next() to reject with the given error', async () => {
    const channel = new StreamChannel<number>({ 'capacity': 4 });
    const sentinel = new Error('test-failure');
    channel.fail(sentinel);

    const iter = channel[Symbol.asyncIterator]();
    await assert.rejects(
      () => iter.next(),
      (err: unknown) => err === sentinel,
    );
  });

  void it('fail() causes push() to reject with the given error', async () => {
    const channel = new StreamChannel<number>({ 'capacity': 4 });
    const sentinel = new Error('push-failure');
    channel.fail(sentinel);

    await assert.rejects(
      () => channel.push(1),
      (err: unknown) => err === sentinel,
    );
  });

  void it('fail() is idempotent — first error wins', async () => {
    const channel = new StreamChannel<number>({ 'capacity': 4 });
    const first = new Error('first');
    const second = new Error('second');
    channel.fail(first);
    channel.fail(second); // must not throw

    const iter = channel[Symbol.asyncIterator]();
    await assert.rejects(
      () => iter.next(),
      (err: unknown) => err === first,
    );
  });

});

// ---------------------------------------------------------------------------
// (f) abort via options.signal causes pending push/next to reject
// ---------------------------------------------------------------------------

void describe('StreamChannel: abort signal terminates channel', () => {

  void it('aborting signal causes a pending next() to reject', async () => {
    const ac = new AbortController();
    const channel = new StreamChannel<number>({ 'signal': ac.signal });

    const iter = channel[Symbol.asyncIterator]();
    const nextPromise = iter.next();

    ac.abort(new Error('aborted'));

    await assert.rejects(
      () => nextPromise,
      (err: unknown) => err instanceof Error && err.message === 'aborted',
    );
  });

  void it('aborting signal causes a pending push() to reject', async () => {
    const ac = new AbortController();
    const channel = new StreamChannel<number>({ 'capacity': 1, 'signal': ac.signal });

    // Fill buffer.
    await channel.push(1);

    // This push blocks because buffer is full.
    const pushPromise = channel.push(2);

    ac.abort(new Error('aborted-push'));

    await assert.rejects(
      () => pushPromise,
      (err: unknown) => err instanceof Error && err.message === 'aborted-push',
    );
  });

  void it('constructing with an already-aborted signal starts the channel in failed state', async () => {
    const ac = new AbortController();
    ac.abort(new Error('pre-aborted'));

    const channel = new StreamChannel<number>({ 'signal': ac.signal });

    await assert.rejects(
      () => channel.push(1),
      (err: unknown) => err instanceof Error && err.message === 'pre-aborted',
    );
  });

});

// ---------------------------------------------------------------------------
// (g) StreamChannel.driven: producer → consumer integration
// ---------------------------------------------------------------------------

void describe('StreamChannel.driven', () => {

  void it('N-item producer — consumer iterates exactly N items then done', async () => {
    const producer = new FixedProducer([10, 20, 30]);
    const channel = StreamChannel.driven(producer);

    const items = await AsyncDrain.collect(channel);
    assert.deepStrictEqual(items, [10, 20, 30]);
  });

  void it('rejecting producer — iteration rejects with that error', async () => {
    const sentinel = new Error('producer-error');
    const producer = new FailingProducer('x', sentinel);
    const channel = StreamChannel.driven(producer);

    // The producer pushes one item then throws; we expect the error to surface
    // eventually during iteration (after or instead of that item).
    const iter = channel[Symbol.asyncIterator]();
    let caught: unknown = null;
    const collected: string[] = [];
    try {
      for (;;) {
        const result = await iter.next();
        if (result.done) break;
        collected.push(result.value);
      }
    } catch (err) {
      caught = err;
    }

    // The first item was buffered and should be drained; then the error surfaces.
    assert.strictEqual(collected[0], 'x');
    assert.strictEqual(caught, sentinel, 'iteration must reject with the producer error');
  });

  void it('synchronous producer throw fails the returned channel', async () => {
    const sentinel = new Error('producer-sync-throw');
    const producer = new ThrowingProducer<number>(sentinel);
    const channel = StreamChannel.driven(producer);

    const iter = channel[Symbol.asyncIterator]();
    await assert.rejects(
      () => iter.next(),
      (err: unknown) => err === sentinel,
    );
  });

});

// ---------------------------------------------------------------------------
// (h) end-to-end: for-await drain matches array drain
// ---------------------------------------------------------------------------

void describe('StreamChannel: end-to-end AsyncIterable shape', () => {

  void it('for-await drains identically to an array', async () => {
    const expected = [1, 2, 3, 4, 5];
    const producer = new FixedProducer(expected);
    const channel = StreamChannel.driven(producer);

    const actual: number[] = [];
    for await (const item of channel) {
      actual.push(item);
    }

    assert.deepStrictEqual(actual, expected);
  });

  void it('empty producer yields zero items', async () => {
    const producer = new FixedProducer<number>([]);
    const channel = StreamChannel.driven(producer);

    const items = await AsyncDrain.collect(channel);
    assert.deepStrictEqual(items, []);
  });

});
