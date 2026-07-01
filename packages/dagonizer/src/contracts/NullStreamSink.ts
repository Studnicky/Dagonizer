/**
 * NullStreamSink: a no-op `StreamSinkInterface<T>` that discards every
 * pushed item.
 *
 * The required-with-defaults constructor pattern (`options.sink ?? new
 * NullStreamSink()`) needs a concrete, always-available sink so consumers
 * that never opt into streaming still get a real value at the use site —
 * never `T | undefined`. `push` resolves immediately and never buffers,
 * so a node wired to a `NullStreamSink` behaves exactly like the
 * pre-streaming buffered call path.
 */
import type { StreamSinkInterface } from './StreamSinkInterface.js';

export class NullStreamSink<T> implements StreamSinkInterface<T> {
  /** Discard the pushed item and resolve immediately; never buffers, never rejects. */
  async push(): Promise<void> {
    return Promise.resolve();
  }
}
