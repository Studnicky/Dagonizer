/**
 * TypedStore: schema-narrowed view over any `StoreInterface`.
 *
 * Wraps a base StoreInterface and exposes get/set/has/delete/update keyed by
 * `Schema` keys. The value type is inferred from `Schema[K]`; callers
 * never specify `<T>` at the call site.
 *
 * `TypedStore` does not implement `StoreInterface` (its `set` signature is
 * narrower than the contract). It is a separate ergonomic surface; use
 * the underlying `StoreInterface` instance directly when you need the
 * heterogeneous contract.
 *
 * `Schema` is constrained so every value type must extend `JsonValueType`.
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

import type { StoreInterface } from '../contracts/StoreInterface.js';
import type { JsonValueType } from '../entities/json.js';

export class TypedStore<Schema extends { [K in keyof Schema]: JsonValueType }> {
  readonly #inner: StoreInterface;

  constructor(inner: StoreInterface) {
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

  /**
   * Access the underlying `StoreInterface` for lifecycle operations (`connect`,
   * `disconnect`, `snapshot`, `restore`) and any other heterogeneous
   * calls that TypedStore does not narrow. The underlying instance is the
   * same object passed to the constructor.
   *
   * @example
   * await typedStore.inner.connect();
   * const snap = await typedStore.inner.snapshot();
   */
  get inner(): StoreInterface { return this.#inner; }
}
