/**
 * Store — shared key-value store contract for cross-deep-DAG state.
 *
 * Every method returns a Promise. This is the only call shape — there is
 * no sync variant. Durable backings (SQLite, network, RDF) await real work;
 * in-memory backings resolve immediately. Consumers always `await`.
 *
 *   Store contract → BaseStore ┐
 *                              ├─ get/set/has/delete → performGet/performSet/performHas/performDelete
 *                              ├─ update(key, fn)    → atomic read-modify-write
 *                              └─ snapshot/restore   → performSnapshotEntries/performRestoreEntries
 *
 * Concurrency contract:
 *   • `update(key, fn)` is atomic within a single store instance. Implementations
 *     are responsible for delivering atomicity (single-step backing access,
 *     SQL transactions, Redis WATCH/MULTI, etc.) — the base-class default does
 *     not satisfy this on its own.
 *   • `get + set` is NOT atomic — use `update` when you need read-modify-write.
 *   • `set` is last-write-wins; the store's backing decides what that means
 *     across processes.
 */

import type { JsonValue } from '../entities/json.js';

/** Entry in a serialized snapshot envelope. */
export interface StoreSnapshotEntry {
  readonly key:   string;
  readonly value: JsonValue;
}

/**
 * Versioned snapshot envelope. Plugin authors writing their own store
 * set `type` to a stable identifier (e.g. 'memory-store-v1') so resume
 * code can refuse incompatible snapshots.
 */
export interface StoreSnapshot {
  readonly version: number;
  readonly type:    string;
  readonly entries: readonly StoreSnapshotEntry[];
}

/**
 * Shared key-value store for cross-deep-DAG state.
 *
 * Plugin authors implement this interface (typically by extending
 * `BaseStore`) to swap the backing without touching DAG topology.
 *
 * Values are typed per-call via the method's `<T extends JsonValue>`
 * parameter — there is no class-level value generic. This keeps stores
 * heterogeneous (one store can hold strings, numbers, and records under
 * different keys) and keeps a `Store` assignable into any
 * `Record<string, Store>` boundary without variance casts.
 *
 * Every value crosses a serialization boundary at `snapshot()` time, so
 * stored values must be `JsonValue`. Domain types that aren't JSON-shaped
 * (class instances, Date, Map) serialize to a JSON form before `set` and
 * rehydrate after `get`.
 *
 * The generic `T` has no default — callers MUST specify the value type
 * at every call site. The engine never uses `unknown` here.
 */
export interface Store {
  get<T extends JsonValue>(key: string): Promise<T | undefined>;
  set<T extends JsonValue>(key: string, value: T): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;

  /**
   * Atomic read-modify-write. The callback receives the current value
   * (or `undefined` when the key is absent) and returns the new value.
   *
   * Permitted callback under the "zero callbacks in topology" rule:
   * this is in-process composition, not dispatch behavior.
   */
  update<T extends JsonValue>(key: string, fn: (current: T | undefined) => T): Promise<T>;

  /** Capture the entire store state as a typed envelope. */
  snapshot(): Promise<StoreSnapshot>;

  /**
   * Repopulate from a snapshot. Implementations validate
   * `snapshot.type` and `snapshot.version` before applying entries.
   */
  restore(snapshot: StoreSnapshot): Promise<void>;

  /** Optional lifecycle hook for stores that hold a connection. */
  connect(): Promise<void>;

  /** Optional lifecycle hook for stores that hold a connection. */
  disconnect(): Promise<void>;
}
