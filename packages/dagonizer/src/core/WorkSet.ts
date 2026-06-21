/**
 * WorkSet: the scheduler's pending-work table for the batch-native DAG walk.
 *
 * Holds a map of node-name → pending Batch — the items waiting at each node.
 * The walk repeatedly takes the lowest-rank node that still holds items, fires
 * it, and routes its output items into the downstream nodes' entries. The walk
 * is initialized by adding the input batch at the entry node and ends when no
 * node holds items.
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
   * Add `batch` to the work pending at `node`, concatenating with any batch
   * already held there. Creates a new entry when `node` is not yet present.
   * Preserves item order: existing items first, then new items.
   */
  add(node: string, batch: Batch<TState>): void {
    const existing = this.#entries.get(node);
    if (existing !== undefined) {
      this.#entries.set(node, existing.concat(batch));
    } else {
      this.#entries.set(node, batch);
    }
  }

  /**
   * Remove and return the batch pending at `node`.
   * Returns `undefined` when no batch is held there.
   */
  take(node: string): Batch<TState> | undefined {
    const batch = this.#entries.get(node);
    if (batch !== undefined) {
      this.#entries.delete(node);
    }
    return batch;
  }

  /**
   * Return the node with the lowest rank among all nodes that hold items.
   * Ties in rank are broken by the lowest declaration index (provided by
   * `declIndexOf`).
   *
   * Returns the node name, or `null` when no node holds items.
   */
  nextReady(
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

  /** Returns true when no node holds pending work. */
  isEmpty(): boolean {
    return this.#entries.size === 0;
  }

  /** Returns the number of nodes that currently hold pending work. */
  get size(): number {
    return this.#entries.size;
  }

  /**
   * Peek at the batch pending at `node` without removing it.
   * Returns `undefined` when no batch is present.
   */
  peek(node: string): Batch<TState> | undefined {
    return this.#entries.get(node);
  }

  /**
   * Remove and return the batch pending at `node`. Throws when no batch is
   * held there. Use only at call sites that have verified the entry exists
   * (e.g. immediately after `nextReady` returns the name) — the throw is a
   * programming-error guard, not expected control flow.
   */
  takeExpected(node: string): Batch<TState> {
    const batch = this.#entries.get(node);
    if (batch === undefined) {
      throw new Error(`WorkSet.takeExpected: no batch at '${node}'`);
    }
    this.#entries.delete(node);
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
