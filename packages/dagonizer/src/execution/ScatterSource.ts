/**
 * Scatter source normalization. A scatter placement's source value may be an
 * array, a sync `Iterable`, or an `AsyncIterable`; the scatter loop needs a
 * single unified pull interface. `ScatterSource.toAsyncIterator` wraps any of
 * them — and treats scalars / null / undefined as an empty producer.
 */
export class ScatterSource {
  private constructor() { /* static class */ }

  /**
   * Normalize any scatter source value — array, sync iterable, or async
   * iterable — to an `AsyncIterator<unknown>`. Arrays and sync iterables are
   * wrapped so the scatter loop has a single unified pull interface; scalars
   * and `null`/`undefined` normalize to an immediately-done iterator.
   */
  static toAsyncIterator(source: unknown): AsyncIterator<unknown> {
    if (source !== null && typeof source === 'object') {
      // AsyncIterable first (duck-type Symbol.asyncIterator).
      if (Symbol.asyncIterator in (source as object)) {
        return (source as AsyncIterable<unknown>)[Symbol.asyncIterator]();
      }
      // Sync iterable (duck-type Symbol.iterator), including arrays.
      if (Symbol.iterator in (source as object)) {
        const syncIter = (source as Iterable<unknown>)[Symbol.iterator]();
        return {
          next(): Promise<IteratorResult<unknown>> {
            return Promise.resolve(syncIter.next());
          },
        };
      }
    }
    // Scalar or null/undefined: treat as empty.
    return {
      next(): Promise<IteratorResult<unknown>> {
        return Promise.resolve({ 'value': undefined, 'done': true });
      },
    };
  }
}
