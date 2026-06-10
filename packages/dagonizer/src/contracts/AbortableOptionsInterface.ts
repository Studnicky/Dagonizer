/**
 * AbortableOptionsInterface: trailing options object for any method that
 * accepts an optional cancellation signal.
 *
 * Follows the project convention of required positional arguments followed by
 * a single trailing `options` config object. Consumers pass
 * `{ signal: controller.signal }` to wire cancellation into an async
 * operation; omitting `options` (or passing `{}`) is always valid.
 *
 * Implementations that do not support cancellation (e.g. in-process
 * `MemoryCheckpointStore`) may accept the parameter and ignore it.
 */
export interface AbortableOptionsInterface {
  /** Optional `AbortSignal` to cancel the operation. */
  readonly signal?: AbortSignal;
}
