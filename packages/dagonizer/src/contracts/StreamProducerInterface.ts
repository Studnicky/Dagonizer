/**
 * StreamProducerInterface: emission contract for `StreamChannel.driven`.
 *
 * An object implementing this contract is passed to `StreamChannel.driven`.
 * The channel calls `produce(sink)` and the producer enqueues items via
 * `await sink.push(item)`. Back-pressure is automatic — each `push` awaits
 * until there is buffer capacity before control returns to the producer.
 *
 * Resolve the returned promise when emission is complete; the channel is
 * closed automatically. Reject to fail the stream.
 */

import type { StreamSinkInterface } from './StreamSinkInterface.js';

export interface StreamProducerInterface<T> {
  /**
   * Emit items by `await sink.push(item)` per item (back-pressure for free).
   * Resolve when emission is complete; reject to fail the stream.
   */
  produce(sink: StreamSinkInterface<T>): Promise<void>;
}
