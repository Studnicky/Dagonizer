/**
 * StoreInterface: shared key-value store contract for cross-embedded-DAG state.
 *
 * Every method returns a Promise. This is the only call shape; there is
 * no sync variant. Durable backings (SQLite, network, RDF) await real work;
 * in-memory backings resolve immediately. Consumers always `await`.
 *
 *   StoreInterface contract → BaseStore ┐
 *                              ├─ get/set/has/delete → performGet/performSet/performHas/performDelete
 *                              ├─ update(key, fn)    → atomic read-modify-write
 *                              └─ snapshot/restore   → performEntriesStream/performRestoreEntry/performClear
 *
 * Concurrency contract:
 *   • `update(key, fn)` is atomic within a single store instance. Implementations
 *     are responsible for delivering atomicity (single-step backing access,
 *     SQL transactions, Redis WATCH/MULTI, etc.); the base-class default does
 *     not satisfy this on its own.
 *   • `get + set` is NOT atomic; use `update` when you need read-modify-write.
 *   • `set` is last-write-wins; the store's backing decides what that means
 *     across processes.
 */

import type { JsonValueType } from '../entities/json.js';

import type { SnapshottableInterface } from './SnapshottableInterface.js';

/**
 * Shared key-value store for cross-embedded-DAG state.
 *
 * Plugin authors implement this interface (typically by extending
 * `BaseStore`) to swap the backing without touching DAG topology.
 *
 * The store is type-erased: every value crosses a serialization boundary at
 * `snapshot()` time, so stored values are `JsonValueType` and `get` returns
 * `JsonValueType` (callers narrow with a `typeof`/`Array.isArray` check or a
 * `Validator`). Domain types that aren't JSON-shaped (class instances, Date,
 * Map) serialize to a JSON form before `set` and rehydrate after `get`. For
 * schema-checked typed reads, wrap a store in `TypedStore`, which validates
 * each read against a configured per-key validator — the validator IS the
 * type-guard, so the typed value is produced without a cast.
 */
export interface StoreInterface extends SnapshottableInterface {
  /** Read the value at `key` as `JsonValueType`, or `null` when the key is absent. */
  get(key: string): Promise<JsonValueType | null>;
  /** Write `value` at `key`; last-write-wins. */
  set(key: string, value: JsonValueType): Promise<void>;
  /** True when `key` is present. */
  has(key: string): Promise<boolean>;
  /** Remove `key`; resolves true when a value was removed, false when absent. */
  delete(key: string): Promise<boolean>;

  /**
   * Atomic read-modify-write. The callback receives the current value
   * (or `undefined` when the key is absent) and returns the new value.
   * Both are `JsonValueType`; narrow inside the callback as needed.
   *
   * Permitted callback under the "zero callbacks in topology" rule:
   * this is in-process composition, not dispatch behavior.
   */
  update(key: string, fn: (current: JsonValueType | undefined) => JsonValueType): Promise<JsonValueType>;

  // snapshot() / restore() are inherited from SnapshottableInterface.

  /**
   * Lifecycle hook for stores that hold a connection. Called before first use.
   * Stores with no connection lifecycle implement this as a no-op
   * (the default in `BaseStore`).
   */
  connect(): Promise<void>;

  /**
   * Lifecycle hook for stores that hold a connection. Called on teardown.
   * Stores with no connection lifecycle implement this as a no-op
   * (the default in `BaseStore`).
   */
  disconnect(): Promise<void>;
}
