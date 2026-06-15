/**
 * Frontier: mutable scheduler data structure for the batch-native DAG walk.
 *
 * Holds a map of placement-name → pending Batch. The scheduler seeds the
 * entry placement and repeatedly picks the lowest-rank non-empty placement
 * to fire, merging each node's routed output into downstream placements.
 *
 * V8 shape stability: single `#entries` field set in constructor, never
 * deleted or retyped. All methods operate on the stable map reference.
 */

import type { Batch } from './batch/Batch.js';

export class Frontier<TState> {
  readonly #entries: Map<string, Batch<TState>>;

  constructor() {
    this.#entries = new Map<string, Batch<TState>>();
  }

  /**
   * Merge `batch` into the batch already held at `placement`.
   * Creates a new entry when `placement` is not yet in the frontier.
   * Preserves item order: existing items first, then new items.
   */
  merge(placement: string, batch: Batch<TState>): void {
    const existing = this.#entries.get(placement);
    if (existing !== undefined) {
      this.#entries.set(placement, existing.concat(batch));
    } else {
      this.#entries.set(placement, batch);
    }
  }

  /**
   * Remove and return the batch at `placement`.
   * Returns `undefined` when no batch is held at that placement.
   */
  take(placement: string): Batch<TState> | undefined {
    const batch = this.#entries.get(placement);
    if (batch !== undefined) {
      this.#entries.delete(placement);
    }
    return batch;
  }

  /**
   * Pick the non-empty placement with the lowest rank among all entries.
   * Ties in rank are broken by the lowest declaration index (provided by
   * `declIndexOf`).
   *
   * Returns the placement name, or `null` when the frontier is empty.
   */
  pickReady(
    rankOf: (name: string) => number,
    declIndexOf: (name: string) => number,
  ): string | null {
    let best: string | null = null;
    let bestRank = Number.MAX_SAFE_INTEGER;
    let bestDecl = Number.MAX_SAFE_INTEGER;

    for (const name of this.#entries.keys()) {
      const rank = rankOf(name);
      const decl = declIndexOf(name);
      if (rank < bestRank || (rank === bestRank && decl < bestDecl)) {
        best = name;
        bestRank = rank;
        bestDecl = decl;
      }
    }

    return best;
  }

  /** Returns true when the frontier holds no pending batches. */
  isEmpty(): boolean {
    return this.#entries.size === 0;
  }

  /** Returns the number of placement entries currently held. */
  get size(): number {
    return this.#entries.size;
  }

  /**
   * Peek at the batch held at `placement` without removing it.
   * Returns `undefined` when no batch is present.
   */
  peek(placement: string): Batch<TState> | undefined {
    return this.#entries.get(placement);
  }
}
