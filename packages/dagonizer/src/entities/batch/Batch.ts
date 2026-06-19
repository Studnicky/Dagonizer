/**
 * Batch: an immutable, ordered collection of `ItemType<TState>` values.
 *
 * Every mutating operation (map, filter, partition, concat) returns a new
 * `Batch` rather than modifying in place. The single private field `#items`
 * is set in the constructor and never reassigned, giving V8 a stable hidden
 * class for every instance.
 */

import type { ItemType, ItemIdType } from './Item.js';

export class Batch<TState> {
  readonly #items: readonly ItemType<TState>[];

  private constructor(items: readonly ItemType<TState>[]) {
    this.#items = items;
  }

  /**
   * Creates a size-1 batch containing a single state value.
   * Uses `'0'` as the default item id when none is provided.
   */
  static of<TState>(state: TState, id: ItemIdType = '0'): Batch<TState> {
    return new Batch<TState>([{ id, state }]);
  }

  /** Creates an empty batch with no items. */
  static empty<TState>(): Batch<TState> {
    return new Batch<TState>([]);
  }

  /** Creates a batch from an existing array of items. Order is preserved. */
  static from<TState>(items: readonly ItemType<TState>[]): Batch<TState> {
    return new Batch<TState>(items);
  }

  /** Number of items in this batch. */
  get size(): number {
    return this.#items.length;
  }

  /**
   * Maps state values through `fn`, preserving item ids and order.
   * Returns a new `Batch<U>` with the transformed states.
   */
  map<U>(fn: (state: TState, id: ItemIdType) => U): Batch<U> {
    const mapped: ItemType<U>[] = new Array(this.#items.length);
    for (let i = 0; i < this.#items.length; i++) {
      const item = this.#items[i] as ItemType<TState>;
      mapped[i] = { 'id': item.id, 'state': fn(item.state, item.id) };
    }
    return new Batch<U>(mapped);
  }

  /**
   * Returns a new batch containing only items for which `fn` returns `true`.
   * Order among retained items is preserved.
   */
  filter(fn: (state: TState, id: ItemIdType) => boolean): Batch<TState> {
    const kept: ItemType<TState>[] = [];
    for (const item of this.#items) {
      if (fn(item.state, item.id)) {
        kept.push(item);
      }
    }
    return new Batch<TState>(kept);
  }

  /**
   * Groups items by the key returned by `fn`, producing a `ReadonlyMap` from
   * key to sub-batch. Item order within each group is preserved.
   */
  partition<K extends string>(
    fn: (state: TState, id: ItemIdType) => K,
  ): ReadonlyMap<K, Batch<TState>> {
    const buckets = new Map<K, ItemType<TState>[]>();
    for (const item of this.#items) {
      const key = fn(item.state, item.id);
      const bucket = buckets.get(key);
      if (bucket !== undefined) {
        bucket.push(item);
      } else {
        buckets.set(key, [item]);
      }
    }
    const result = new Map<K, Batch<TState>>();
    for (const [key, items] of buckets) {
      result.set(key, new Batch<TState>(items));
    }
    return result;
  }

  /**
   * Returns a new batch with `other`'s items appended after this batch's
   * items. Order within each batch is preserved.
   */
  concat(other: Batch<TState>): Batch<TState> {
    return new Batch<TState>([...this.#items, ...other.#items]);
  }

  /** Returns item ids in order. */
  ids(): readonly ItemIdType[] {
    return this.#items.map((item) => item.id);
  }

  /**
   * Returns the item at index `i`.
   * Throws `RangeError` when `i` is out of bounds.
   */
  row(i: number): ItemType<TState> {
    if (i < 0 || i >= this.#items.length) {
      throw new RangeError(`Batch.row(${i}): index out of bounds (size ${this.#items.length})`);
    }
    return this.#items[i] as ItemType<TState>;
  }

  /** Returns all items as a readonly array. */
  items(): readonly ItemType<TState>[] {
    return this.#items;
  }

  /** Iterates over all items in order. */
  [Symbol.iterator](): Iterator<ItemType<TState>> {
    return this.#items[Symbol.iterator]();
  }
}
