/**
 * StreamChannel: bounded single-producer/single-consumer async queue.
 *
 * Bridges a push-style producer into the pull-based scatter loop. Any object
 * with `[Symbol.asyncIterator]` satisfies `ScatterSource.toAsyncIterator`, so
 * a `StreamChannel` can be passed directly as a scatter source.
 *
 * The channel is bounded: `push` resolves immediately while the buffer has
 * capacity (`count < capacity`) and awaits (back-pressure) otherwise, resuming
 * when a consumer pulls the next item. A `StreamProducerInterface` object is
 * the canonical way to produce items via `StreamChannel.driven(producer)`.
 *
 * Constructor argument order: no required positionals, single trailing options
 * object. V8 shape: all fields initialised in constructor in declaration order.
 */

import { CircularBuffer } from '@studnicky/circular-buffer';
import { Signal } from '@studnicky/signal';

import type { ResumableStreamProducerInterface } from '../contracts/ResumableStreamProducerInterface.js';
import type { StreamProducerInterface } from '../contracts/StreamProducerInterface.js';
import type { StreamSinkInterface } from '../contracts/StreamSinkInterface.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Constructor options for `StreamChannel`. */
export type StreamChannelOptionsType = {
  'capacity': number;
  'signal': AbortSignal;
};

/** Module-level defaults. `capacity` is 256 items; signal never aborts. */
const STREAM_CHANNEL_DEFAULTS: StreamChannelOptionsType = {
  'capacity': 256,
  'signal': Signal.never(),
};

// ---------------------------------------------------------------------------
// Class-shape interface
// ---------------------------------------------------------------------------

/**
 * Public face of `StreamChannel<T>`. Combines the push-side sink with
 * close/fail controls and async-iterable consumer surface.
 */
export interface StreamChannelInterface<T> extends StreamSinkInterface<T> {
  close(): void;
  fail(err: unknown): void;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

// ---------------------------------------------------------------------------
// PushWaiter: internal record for a producer awaiting a free buffer slot
// ---------------------------------------------------------------------------

type PushWaiterType<T> = {
  'item': T;
  'resolve': () => void;
  'reject': (err: unknown) => void;
};

// ---------------------------------------------------------------------------
// PullWaiter: internal record for a consumer awaiting the next buffered item
// ---------------------------------------------------------------------------

type PullWaiterType<T> = {
  'resolve': (result: IteratorResult<T>) => void;
  'reject': (err: unknown) => void;
};

type BufferedItemType<T> = {
  'value': T;
};

// ---------------------------------------------------------------------------
// StreamChannel
// ---------------------------------------------------------------------------

export class StreamChannel<T> implements StreamChannelInterface<T> {
  readonly #options: StreamChannelOptionsType;
  readonly #buffer: CircularBuffer<BufferedItemType<T>>;
  readonly #pushWaiters: CircularBuffer<PushWaiterType<T>>;
  #pullWaiter: PullWaiterType<T> | null;
  #closed: boolean;
  #error: unknown;
  #failed: boolean;

  constructor(options?: Partial<StreamChannelOptionsType>) {
    this.#options = { ...STREAM_CHANNEL_DEFAULTS, ...options };
    StreamChannel.#validateCapacity(this.#options.capacity);
    this.#buffer = CircularBuffer.create<BufferedItemType<T>>({
      'capacity': this.#options.capacity,
      'overflow': 'grow',
    });
    this.#pushWaiters = CircularBuffer.create<PushWaiterType<T>>({
      'capacity': this.#options.capacity,
      'overflow': 'grow',
    });
    this.#pullWaiter = null;
    this.#closed = false;
    this.#error = undefined;
    this.#failed = false;

    const { signal } = this.#options;
    if (signal.aborted) {
      this.#applyFail(StreamChannel.#abortError(signal));
    } else {
      signal.addEventListener('abort', () => {
        this.#applyFail(StreamChannel.#abortError(signal));
      }, { 'once': true });
    }
  }

  // ---------------------------------------------------------------------------
  // Push (producer side)
  // ---------------------------------------------------------------------------

  push(item: T): Promise<void> {
    if (this.#failed) {
      return Promise.reject(this.#error);
    }
    if (this.#closed) {
      return Promise.reject(new Error('StreamChannel: push after close'));
    }

    // If a consumer is awaiting an empty queue, hand the item directly.
    if (this.#pullWaiter !== null) {
      const waiter = this.#pullWaiter;
      this.#pullWaiter = null;
      waiter.resolve({ 'value': item, 'done': false });
      return Promise.resolve();
    }

    // Buffer has capacity: enqueue and resolve immediately.
    if (this.#buffer.length < this.#options.capacity) {
      this.#buffer.push({ 'value': item });
      return Promise.resolve();
    }

    // Buffer full: back-pressure — wait until a slot frees.
    return new Promise<void>((resolve, reject) => {
      this.#pushWaiters.push({ 'item': item, 'resolve': resolve, 'reject': reject });
    });
  }

  // ---------------------------------------------------------------------------
  // Close (producer side)
  // ---------------------------------------------------------------------------

  close(): void {
    if (this.#closed || this.#failed) {
      return;
    }
    this.#closed = true;

    // Drain any pending push-waiters with a rejection (closed before they ran).
    StreamChannel.#drainPushWaiters(
      this.#pushWaiters,
      new Error('StreamChannel: closed while producer was waiting'),
    );

    // If a consumer is waiting on an empty buffer, signal done.
    if (this.#pullWaiter !== null) {
      const waiter = this.#pullWaiter;
      this.#pullWaiter = null;
      waiter.resolve({ 'value': undefined, 'done': true });
    }
  }

  // ---------------------------------------------------------------------------
  // Fail (error path)
  // ---------------------------------------------------------------------------

  fail(err: unknown): void {
    if (this.#failed || this.#closed) {
      return;
    }
    this.#applyFail(err);
  }

  // ---------------------------------------------------------------------------
  // AsyncIterable (consumer side)
  // ---------------------------------------------------------------------------

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      'next': (): Promise<IteratorResult<T>> => {
        // Propagate terminal error first.
        if (this.#failed) {
          return Promise.reject(this.#error);
        }

        // Drain buffer: yield next item and release one push-waiter slot if any.
        if (this.#buffer.length > 0) {
          const entry = this.#buffer.shift();
          if (entry === undefined) {
            return Promise.reject(new Error('StreamChannel: invariant violation while shifting buffer'));
          }
          StreamChannel.#releaseOnePushWaiter(this.#buffer, this.#pushWaiters);
          return Promise.resolve({ 'value': entry.value, 'done': false });
        }

        // Buffer empty, channel closed — done.
        if (this.#closed) {
          return Promise.resolve({ 'value': undefined, 'done': true });
        }

        // Buffer empty, channel still open — await the next push.
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.#pullWaiter = { 'resolve': resolve, 'reject': reject };
        });
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Static factory: driven
  // ---------------------------------------------------------------------------

  /**
   * Construct a `StreamChannel`, invoke `producer.produce(channel)` as the
   * sink, and wire close/fail to the producer's promise settlement. Returns
   * the channel immediately (does NOT await `produce`).
   */
  static driven<T>(
    producer: StreamProducerInterface<T>,
    options?: Partial<StreamChannelOptionsType>,
  ): StreamChannel<T> {
    const channel = new StreamChannel<T>(options);
    Promise.resolve().then(() => producer.produce(channel)).then(
      () => { channel.close(); },
      (err: unknown) => { channel.fail(err); },
    );
    return channel;
  }

  // ---------------------------------------------------------------------------
  // Static factory: fanIn (many-producer / single-consumer)
  // ---------------------------------------------------------------------------

  /**
   * Construct one channel and launch every producer concurrently against it.
   *
   * WHY concurrent pushers are safe:
   *   JavaScript's event loop is single-threaded: every `push` call runs to
   *   completion before the next one begins, so the internal buffer and waiter
   *   lists are never mutated by two callers simultaneously. The `#pushWaiters`
   *   FIFO preserves fairness — whichever producer's push parks first is the
   *   first released when the consumer drains a slot. Only one `#pullWaiter`
   *   ever exists at a time because the scatter consumer is the single reader
   *   and `next()` parks at most once per call. Therefore no locking or
   *   coordination is needed beyond the event-loop serialization that already
   *   exists.
   *
   * A settle latch counts remaining live producers. When the count reaches zero
   * (all `produce` calls resolved), the channel is closed. On the first
   * rejection, the channel is failed; subsequent pushes from other producers
   * will receive a rejection from `push()` and unwind naturally.
   *
   * An empty producers array closes the channel immediately and returns it.
   */
  static fanIn<T>(
    producers: readonly StreamProducerInterface<T>[],
    options?: Partial<StreamChannelOptionsType>,
  ): StreamChannel<T> {
    const channel = new StreamChannel<T>(options);

    if (producers.length === 0) {
      channel.close();
      return channel;
    }

    let remaining = producers.length;
    let failed = false;

    for (const producer of producers) {
      Promise.resolve().then(() => producer.produce(channel)).then(
        () => {
          remaining--;
          if (remaining === 0) {
            channel.close();
          }
        },
        (err: unknown) => {
          if (!failed) {
            failed = true;
            channel.fail(err);
          }
        },
      );
    }

    return channel;
  }

  // ---------------------------------------------------------------------------
  // Static factory: resumable
  // ---------------------------------------------------------------------------

  /**
   * Construct a `StreamChannel`, invoke `producer.produce(channel, resumeAfter)`
   * with the scatter's durable pull cursor, and wire close/fail to the
   * producer's promise settlement. Returns the channel immediately (does NOT
   * await `produce`).
   *
   * The `resumeAfter` ordinal is the scatter's PULL count (i.e.
   * `StreamCursor.resumeAfter(state, scatterName)`). A producer reconstructs its
   * deterministic sequence from the start and skips the first `resumeAfter`
   * emissions so the scatter resumes from the next un-processed item.
   */
  static resumable<T>(
    producer: ResumableStreamProducerInterface<T>,
    resumeAfter: number,
    options?: Partial<StreamChannelOptionsType>,
  ): StreamChannel<T> {
    const channel = new StreamChannel<T>(options);
    Promise.resolve().then(() => producer.produce(channel, resumeAfter)).then(
      () => { channel.close(); },
      (err: unknown) => { channel.fail(err); },
    );
    return channel;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  #applyFail(err: unknown): void {
    this.#failed = true;
    this.#error = err;

    StreamChannel.#drainPushWaiters(this.#pushWaiters, err);

    if (this.#pullWaiter !== null) {
      const waiter = this.#pullWaiter;
      this.#pullWaiter = null;
      waiter.reject(err);
    }
  }

  static #drainPushWaiters<T>(waiters: CircularBuffer<PushWaiterType<T>>, err: unknown): void {
    let waiter = waiters.shift();
    while (waiter !== undefined) {
      waiter.reject(err);
      waiter = waiters.shift();
    }
  }

  static #releaseOnePushWaiter<T>(
    buffer: CircularBuffer<BufferedItemType<T>>,
    waiters: CircularBuffer<PushWaiterType<T>>,
  ): void {
    const waiter = waiters.shift();
    if (waiter !== undefined) {
      buffer.push({ 'value': waiter.item });
      waiter.resolve();
    }
  }

  static #validateCapacity(capacity: number): void {
    if (!Number.isFinite(capacity) || !Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('StreamChannel capacity must be a positive finite integer');
    }
  }

  static #abortError(signal: AbortSignal): unknown {
    return signal.reason instanceof Error
      ? signal.reason
      : new DOMException('StreamChannel: aborted', 'AbortError');
  }
}
