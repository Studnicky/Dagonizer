/**
 * WorkSet: the scheduler's pending-work table for the batch-native DAG walk.
 *
 * Holds a map of placement IRI → pending Batch — the items waiting at each placement.
 * The walk repeatedly takes the lowest-rank placement that still holds items,
 * fires it, and routes its output items into the downstream placement entries.
 * The walk is initialized by adding the input batch at the entrypoint placement
 * and ends when no placement holds items.
 *
 * V8 shape stability: single `#entries` field set in constructor, never
 * deleted or retyped. All methods operate on the stable map reference.
 */

import type { Batch } from '../entities/batch/Batch.js';

export class WorkSet<TState> {
  readonly #entries: Map<string, Batch<TState>>;

  constructor() {
    this.#entries = new Map<string, Batch<TState>>();
  }

  /**
   * Add `batch` to the work pending at `placementIri`, concatenating with any
   * batch already held there. Creates a new entry when `placementIri` is not
   * yet present.
   * Preserves item order: existing items first, then new items.
   */
  add(placementIri: string, batch: Batch<TState>): void {
    const existing = this.#entries.get(placementIri);
    if (existing !== undefined) {
      this.#entries.set(placementIri, existing.concat(batch));
    } else {
      this.#entries.set(placementIri, batch);
    }
  }

  /**
   * Remove and return the batch pending at `placementIri`.
   * Returns `undefined` when no batch is held there.
   */
  take(placementIri: string): Batch<TState> | undefined {
    const batch = this.#entries.get(placementIri);
    if (batch !== undefined) {
      this.#entries.delete(placementIri);
    }
    return batch;
  }

  /**
   * Return the placement IRI with the lowest rank among all placements that
   * hold items.
   * Ties in rank are broken by the lowest declaration index (provided by
   * `declIndexOf`).
   *
   * Returns the placement IRI, or `null` when no placement holds items.
   */
  nextReady(
    rankOf: (placementIri: string) => number,
    declIndexOf: (placementIri: string) => number,
  ): string | null {
    let best: string | null = null;
    let bestRank = Number.MAX_SAFE_INTEGER;
    let bestDecl = Number.MAX_SAFE_INTEGER;

    for (const placementIri of this.#entries.keys()) {
      const rank = rankOf(placementIri);
      const decl = declIndexOf(placementIri);
      if (rank < bestRank || (rank === bestRank && decl < bestDecl)) {
        best = placementIri;
        bestRank = rank;
        bestDecl = decl;
      }
    }

    return best;
  }

  /** Returns true when no placement holds pending work. */
  isEmpty(): boolean {
    return this.#entries.size === 0;
  }

  /** Returns the number of placements that currently hold pending work. */
  get size(): number {
    return this.#entries.size;
  }

  /**
   * Peek at the batch pending at `placementIri` without removing it.
   * Returns `undefined` when no batch is present.
   */
  peek(placementIri: string): Batch<TState> | undefined {
    return this.#entries.get(placementIri);
  }

  /**
   * Remove and return the batch pending at `placementIri`. Throws when no batch
   * is held there. Use only at call sites that have verified the entry exists
   * (e.g. immediately after `nextReady` returns the IRI) — the throw is a
   * programming-error guard, not expected control flow.
   */
  takeExpected(placementIri: string): Batch<TState> {
    const batch = this.#entries.get(placementIri);
    if (batch === undefined) {
      throw new Error(`WorkSet.takeExpected: no batch at '${placementIri}'`);
    }
    this.#entries.delete(placementIri);
    return batch;
  }

  /**
   * Read-only iterator over all (placement, batch) pairs currently in the
   * work set. Used by `WorkSetCheckpoint.write` at the abort boundary to
   * serialise the in-flight work set without exposing the private map.
   */
  entries(): IterableIterator<[string, Batch<TState>]> {
    return this.#entries.entries();
  }
}
