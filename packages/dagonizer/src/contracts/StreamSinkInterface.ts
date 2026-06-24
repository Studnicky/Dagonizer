/**
 * StreamSinkInterface: push-side sink contract for `StreamChannel`.
 *
 * A bounded single-producer push target. The producer calls `push(item)` to
 * enqueue each item. `push` resolves immediately when the channel buffer has
 * capacity; it awaits (back-pressure) when the buffer is full and resolves
 * once a consumer drains a slot.
 *
 * Closing or failing the channel causes pending and future `push` calls to
 * reject. Implementations MUST NOT throw synchronously.
 */
export interface StreamSinkInterface<T> {
  /** Resolve immediately while buffered count < capacity; await (back-pressure) when full. */
  push(item: T): Promise<void>;
}
