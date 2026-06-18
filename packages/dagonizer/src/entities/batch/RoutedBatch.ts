/**
 * RoutedBatch: the result of a plural node execution.
 *
 * Maps named output ports to sub-batches of state. Each entry in the map
 * represents items that the node routed to that output port.
 *
 * `RoutedBatchBuilder` provides static factory methods for constructing
 * `RoutedBatch` values without directly instantiating `Map`.
 */

import type { Batch } from './Batch.js';

export type RoutedBatch<TOutput extends string, TState> = ReadonlyMap<TOutput, Batch<TState>>;

export class RoutedBatchBuilder {
  private constructor() { /* static class */ }

  /**
   * Creates a `RoutedBatch` with a single output port mapping.
   */
  static of<TOutput extends string, TState>(
    output: TOutput,
    batch: Batch<TState>,
  ): RoutedBatch<TOutput, TState> {
    return new Map([[output, batch]]);
  }

  /**
   * Creates a `RoutedBatch` from an array of `[output, batch]` pairs.
   * Duplicate keys are merged by concatenating their batches in encounter order.
   */
  static from<TOutput extends string, TState>(
    entries: ReadonlyArray<readonly [TOutput, Batch<TState>]>,
  ): RoutedBatch<TOutput, TState> {
    const acc = new Map<TOutput, Batch<TState>>();
    for (const [key, batch] of entries) {
      const existing = acc.get(key);
      acc.set(key, existing !== undefined ? existing.concat(batch) : batch);
    }
    return acc;
  }

  /** Creates an empty `RoutedBatch` with no output port mappings. */
  static empty<TOutput extends string, TState>(): RoutedBatch<TOutput, TState> {
    return new Map();
  }
}
