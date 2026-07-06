/**
 * RoutedBatchType: the result of a plural node execution.
 *
 * Maps named output ports to sub-batches of state. Each entry in the map
 * represents items that the node routed to that output port.
 *
 * `RoutedBatch` provides static factory methods for constructing
 * `RoutedBatchType` values without directly instantiating `Map`.
 */

import type { Batch } from './Batch.js';

export type RoutedBatchType<TOutput extends string, TState> = ReadonlyMap<TOutput, Batch<TState>>;

export class RoutedBatch {
  private constructor() { /* static class */ }

  static create<TOutput extends string, TState>(): RoutedBatchType<TOutput, TState>;
  static create<TOutput extends string, TState>(
    entries: ReadonlyArray<readonly [TOutput, Batch<TState>]>,
  ): RoutedBatchType<TOutput, TState>;
  static create<TOutput extends string, TState>(
    output: TOutput,
    batch: Batch<TState>,
  ): RoutedBatchType<TOutput, TState>;
  static create<TOutput extends string, TState>(
    outputOrEntries?: TOutput | ReadonlyArray<readonly [TOutput, Batch<TState>]>,
    batch?: Batch<TState>,
  ): RoutedBatchType<TOutput, TState> {
    if (outputOrEntries === undefined) return new Map();
    if (typeof outputOrEntries === 'string') {
      if (batch === undefined) throw new TypeError('RoutedBatch.create(output, batch) requires a batch');
      return new Map([[outputOrEntries, batch]]);
    }
    const entries = outputOrEntries;
    const acc = new Map<TOutput, Batch<TState>>();
    for (const [key, batch] of entries) {
      const existing = acc.get(key);
      acc.set(key, existing !== undefined ? existing.concat(batch) : batch);
    }
    return acc;
  }
}
