/**
 * RoutedBatchType: the result of a plural node execution.
 *
 * Maps named output ports to sub-batches of state. Each entry in the map
 * represents items that the node routed to that output port.
 *
 * `RoutedBatchBuilder` provides static factory methods for constructing
 * `RoutedBatchType` values without directly instantiating `Map`.
 */

import type { Batch } from './Batch.js';

export type RoutedBatchType<TOutput extends string, TState> = ReadonlyMap<TOutput, Batch<TState>>;

export class RoutedBatchBuilder {
  private constructor() { /* static class */ }

  /**
   * Creates a `RoutedBatchType` with a single output port mapping.
   */
  static of<TOutput extends string, TState>(
    output: TOutput,
    batch: Batch<TState>,
  ): RoutedBatchType<TOutput, TState> {
    return new Map([[output, batch]]);
  }

  /**
   * Creates a `RoutedBatchType` from an array of `[output, batch]` pairs.
   * Duplicate keys are merged by concatenating their batches in encounter order.
   */
  static from<TOutput extends string, TState>(
    entries: ReadonlyArray<readonly [TOutput, Batch<TState>]>,
  ): RoutedBatchType<TOutput, TState> {
    const acc = new Map<TOutput, Batch<TState>>();
    for (const [key, batch] of entries) {
      const existing = acc.get(key);
      acc.set(key, existing !== undefined ? existing.concat(batch) : batch);
    }
    return acc;
  }

  /** Creates an empty `RoutedBatchType` with no output port mappings. */
  static empty<TOutput extends string, TState>(): RoutedBatchType<TOutput, TState> {
    return new Map();
  }
}
