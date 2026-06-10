/**
 * TypedStore: schema-narrowed view over any `Store`.
 *
 * Wraps a base Store and exposes get/set/has/delete/update keyed by
 * `Schema` keys. The value type is inferred from `Schema[K]`; callers
 * never specify `<T>` at the call site.
 *
 * `TypedStore` does not implement `Store` (its `set` signature is
 * narrower than the contract). It is a separate ergonomic surface; use
 * the underlying `Store` instance directly when you need the
 * heterogeneous contract.
 *
 * `Schema` is constrained so every value type must extend `JsonValue`.
 * Plain interfaces with named keys satisfy this constraint without needing
 * an explicit index signature; only the declared values are checked.
 *
 * @example
 * interface AppSchema {
 *   users: User[];
 *   count: number;
 * }
 * const inner  = new MemoryStore();
 * const typed  = new TypedStore<AppSchema>(inner);
 * await typed.set('count', 42);            // ok
 * const n = await typed.get('count');      // n: number | null
 * await typed.set('count', 'wrong');       // TS error
 */

import type { AbortableOptionsInterface } from '../contracts/AbortableOptionsInterface.js';
import type { StoreSnapshot } from '../contracts/Snapshottable.js';
import type { Store } from '../contracts/Store.js';
import type { JsonValue } from '../entities/json.js';

export class TypedStore<Schema extends { [K in keyof Schema]: JsonValue }> {
  readonly #inner: Store;

  constructor(inner: Store) {
    this.#inner = inner;
  }

  async get<K extends keyof Schema & string>(key: K): Promise<Schema[K] | null> {
    return this.#inner.get<Schema[K]>(key);
  }

  async set<K extends keyof Schema & string>(key: K, value: Schema[K]): Promise<void> {
    await this.#inner.set<Schema[K]>(key, value);
  }

  async has<K extends keyof Schema & string>(key: K): Promise<boolean> {
    return this.#inner.has(key);
  }

  async delete<K extends keyof Schema & string>(key: K): Promise<boolean> {
    return this.#inner.delete(key);
  }

  async update<K extends keyof Schema & string>(
    key: K,
    fn: (current: Schema[K] | undefined) => Schema[K],
  ): Promise<Schema[K]> {
    return this.#inner.update<Schema[K]>(key, fn);
  }

  /** Snapshot/restore pass through to the underlying Store. */
  async snapshot(options?: AbortableOptionsInterface): Promise<StoreSnapshot> { return this.#inner.snapshot(options); }
  async restore(snapshot: StoreSnapshot, options?: AbortableOptionsInterface): Promise<void> { await this.#inner.restore(snapshot, options); }

  /** Connect/disconnect pass through to the underlying Store. */
  async connect(): Promise<void> { await this.#inner.connect(); }
  async disconnect(): Promise<void> { await this.#inner.disconnect(); }

  /** Access the underlying Store for operations TypedStore does not narrow. */
  get inner(): Store { return this.#inner; }
}
