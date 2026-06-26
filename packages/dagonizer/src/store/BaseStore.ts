/**
 * BaseStore: abstract base every concrete store extends.
 *
 * Owns the snapshot envelope (`{ version, type, entries }`), the default
 * `update` implementation (read-modify-write atop `performGet` + `performSet`),
 * optional namespace prefix, and lifecycle no-ops. Concrete stores implement
 * the `protected abstract perform*` hooks.
 *
 *   StoreInterface contract → BaseStore ┐
 *                              ├─ get/set/has/delete  → qualify key → perform* hook
 *                              ├─ update(key, fn)     → default RMW; override for native CAS
 *                              └─ snapshot / restore  → envelope + StoreError on mismatch
 *
 * Modeled directly on `BaseAdapter` in `src/adapter/BaseAdapter.ts`.
 */

import type { AbortableOptionsType } from '../contracts/AbortableOptionsType.js';
import type { StoreSnapshotType, StoreSnapshotEntryType } from '../contracts/SnapshottableInterface.js';
import type { StoreInterface } from '../contracts/StoreInterface.js';
import type { JsonValueType } from '../entities/json.js';

import { StoreError } from './StoreError.js';

export type BaseStoreOptionsType = {
  /**
   * Key prefix applied to every public-API key before it reaches the
   * `perform*` hooks. Use `''` (the default) for no prefix. Two stores
   * with different namespaces but the same backing coexist without key
   * collisions because the snapshot captures keys in their qualified form.
   */
  namespace?: string;
}

/** Default options. Spread into custom options to fill unset fields. */
export const BASE_STORE_DEFAULTS: Required<BaseStoreOptionsType> = {
  'namespace': '',
};

export abstract class BaseStore implements StoreInterface {
  readonly #namespace: string;

  protected constructor(options: BaseStoreOptionsType = {}) {
    const resolved = { ...BASE_STORE_DEFAULTS, ...options };
    this.#namespace = resolved.namespace;
  }

  /** Subclass identifier; recorded in snapshot envelopes. */
  protected abstract get snapshotType(): string;

  /** Subclass snapshot schema version; increment when storage shape changes. */
  protected abstract get snapshotVersion(): number;

  // ── Public StoreInterface contract (delegates to protected hooks) ─────────────

  async get(key: string): Promise<JsonValueType | null> {
    return this.performGet(this.qualifyKey(key));
  }

  async set(key: string, value: JsonValueType): Promise<void> {
    await this.performSet(this.qualifyKey(key), value);
  }

  async has(key: string): Promise<boolean> {
    return this.performHas(this.qualifyKey(key));
  }

  async delete(key: string): Promise<boolean> {
    return this.performDelete(this.qualifyKey(key));
  }

  /**
   * Atomic read-modify-write. Every concrete subclass MUST implement this
   * method using the storage layer's native transaction or lock mechanism
   * (in-memory direct access, SQL `BEGIN IMMEDIATE`, Redis `WATCH/MULTI`, etc.)
   * to prevent lost updates under concurrent callers.
   *
   * Subclasses that have no native transaction mechanism may call
   * `performUpdateRmw(key, fn)` to delegate to the sequential, non-atomic
   * helper — but they MUST document that their `update` is not concurrency-safe.
   */
  abstract update(key: string, fn: (current: JsonValueType | undefined) => JsonValueType): Promise<JsonValueType>;

  /**
   * Sequential read-modify-write helper for subclasses that have no native
   * transaction mechanism. NOT atomic: two concurrent `update` calls on the
   * same key can interleave at the two `await` points and lose one write.
   *
   * Call this from your `update` override only when you accept that limitation
   * and document it on your class. Always prefer a native transaction when the
   * backing layer supports one.
   */
  protected async performUpdateRmw(key: string, fn: (current: JsonValueType | undefined) => JsonValueType): Promise<JsonValueType> {
    const qualified = this.qualifyKey(key);
    const raw       = await this.performGet(qualified);
    const current   = raw === null ? undefined : raw;
    const next      = fn(current);
    await this.performSet(qualified, next);
    return next;
  }

  /**
   * Drain `snapshotStream()` into an array and wrap with the version/type
   * envelope. This is the array-form convenience; the underlying data comes
   * from `performEntriesStream()`.
   */
  async snapshot(options?: AbortableOptionsType): Promise<StoreSnapshotType> {
    const entries: StoreSnapshotEntryType[] = [];
    for await (const entry of this.snapshotStream(options)) {
      entries.push(entry);
    }
    return {
      'version': this.snapshotVersion,
      'type':    this.snapshotType,
      entries,
    };
  }

  /**
   * Replacement restore: validates the envelope type/version, clears the
   * existing keyspace via `performClear()`, then feeds every entry through
   * `performRestoreEntry()`. Semantics: after this call the store contains
   * exactly the entries from `incoming` — keys present before the restore
   * but absent from the snapshot are gone.
   */
  async restore(incoming: StoreSnapshotType, _options?: AbortableOptionsType): Promise<void> {
    if (incoming.type !== this.snapshotType || incoming.version !== this.snapshotVersion) {
      throw new StoreError(
        `incompatible snapshot: expected ${this.snapshotType} v${String(this.snapshotVersion)}, ` +
        `got ${incoming.type} v${String(incoming.version)}`,
        {
          'reason':          'INCOMPATIBLE_SNAPSHOT',
          'expectedType':    this.snapshotType,
          'actualType':      incoming.type,
          'expectedVersion': this.snapshotVersion,
          'actualVersion':   incoming.version,
        },
      );
    }
    await this.performClear();
    for (const entry of incoming.entries) {
      await this.performRestoreEntry(entry);
    }
  }

  /**
   * Stream the entire keyspace lazily via `performEntriesStream()`. Checks
   * `options.signal?.throwIfAborted()` between entries so cancellation is
   * honored for streaming-first callers.
   *
   * This is an additive stream — it does NOT clear state before yielding.
   * Use the array-form `restore()` for replacement semantics.
   */
  async *snapshotStream(options?: AbortableOptionsType): AsyncIterable<StoreSnapshotEntryType> {
    for await (const entry of this.performEntriesStream()) {
      options?.signal?.throwIfAborted();
      yield entry;
    }
  }

  /**
   * Upsert-restore from a stream of entries. Each entry is applied via
   * `performRestoreEntry()`; keys absent from the stream are left untouched.
   * For full replacement semantics call `restore()` (which clears first) or
   * call `performClear()` explicitly before streaming.
   */
  async restoreStream(entries: AsyncIterable<StoreSnapshotEntryType>, options?: AbortableOptionsType): Promise<void> {
    for await (const entry of entries) {
      options?.signal?.throwIfAborted();
      await this.performRestoreEntry(entry);
    }
  }

  /** No-op default. Subclasses with a connection lifecycle override. */
  async connect(): Promise<void> {
    return Promise.resolve();
  }

  /** No-op default. Subclasses with a connection lifecycle override. */
  async disconnect(): Promise<void> {
    return Promise.resolve();
  }

  // ── Plugin author hooks ─────────────────────────────────────────────

  protected abstract performGet(qualifiedKey: string): Promise<JsonValueType | null>;
  protected abstract performSet(qualifiedKey: string, value: JsonValueType): Promise<void>;
  protected abstract performHas(qualifiedKey: string): Promise<boolean>;
  protected abstract performDelete(qualifiedKey: string): Promise<boolean>;

  /**
   * Yield every entry in the backing store as an async stream. Called by
   * `snapshotStream()` and (via drain) by `snapshot()`. Do NOT clear state
   * before or after; this is a read-only operation.
   */
  protected abstract performEntriesStream(): AsyncIterable<StoreSnapshotEntryType>;

  /**
   * Upsert a single entry into the backing store. Called per-entry by
   * `restore()` and `restoreStream()`. Implementations should write or
   * overwrite the entry's key with the entry's value.
   */
  protected abstract performRestoreEntry(entry: StoreSnapshotEntryType): Promise<void>;

  /**
   * Clear all entries from the backing store. Called by `restore()` before
   * writing snapshot entries, so that the array-form restore achieves
   * replacement semantics (keys absent from the snapshot are removed).
   */
  protected abstract performClear(): Promise<void>;

  // ── Internal ────────────────────────────────────────────────────────

  /**
   * Apply the namespace prefix to a key. Subclasses that override `update`
   * for native CAS must use this method to ensure namespace consistency.
   */
  protected qualifyKey(key: string): string {
    return this.#namespace === '' ? key : `${this.#namespace}:${key}`;
  }
}
