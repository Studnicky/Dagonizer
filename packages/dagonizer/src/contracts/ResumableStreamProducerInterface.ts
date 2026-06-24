/**
 * ResumableStreamProducerInterface: emission contract for `StreamChannel.resumable`.
 *
 * A producer that can resume past already-consumed work. `resumeAfter` is the
 * number of items already durably consumed by the scatter (its pull count);
 * the producer re-generates its deterministic ordered sequence and skips the
 * first `resumeAfter` emissions. Pair with `StreamChannel.resumable` and
 * `StreamCursor.resumeAfter`.
 */

import type { StreamSinkInterface } from './StreamSinkInterface.js';

export interface ResumableStreamProducerInterface<T> {
  produce(sink: StreamSinkInterface<T>, resumeAfter: number): Promise<void>;
}
