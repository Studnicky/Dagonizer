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

  async get<T extends JsonValueType>(key: string): Promise<T | null> {
    return this.narrowStored<T>(await this.performGet(this.qualifyKey(key)));
  }

  async set<T extends JsonValueType>(key: string, value: T): Promise<void> {
    // `value: T` widens to `JsonValueType` for the type-erased hook — no cast.
    await this.performSet(this.qualifyKey(key), value);
  }

  /**
   * The SINGLE typed-accessor boundary of the entire store layer. A store is
   * type-erased internally — its `perform*` hooks traffic in `JsonValueType`.
   * The generic `T` on `get`/`update` is the CALLER's contract about what they
   * stored under a key; the store cannot re-derive it at runtime, so the one
   * unavoidable cast lives here, in exactly one place. Concrete stores whose
   * `update` override reads the backing store directly (atomic RMW) narrow
   * through this same helper instead of casting in their own override.
   */
  protected narrowStored<T extends JsonValueType>(value: JsonValueType | null): T | null {
    return value as T | null;
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
  abstract update<T extends JsonValueType>(key: string, fn: (current: T | undefined) => T): Promise<T>;

  /**
   * Sequential read-modify-write helper for subclasses that have no native
   * transaction mechanism. NOT atomic: two concurrent `update` calls on the
   * same key can interleave at the two `await` points and lose one write.
   *
   * Call this from your `update` override only when you accept that limitation
   * and document it on your class. Always prefer a native transaction when the
   * backing layer supports one.
   */
  protected async performUpdateRmw<T extends JsonValueType>(key: string, fn: (current: T | undefined) => T): Promise<T> {
    const qualified = this.qualifyKey(key);
    const raw       = this.narrowStored<T>(await this.performGet(qualified));
    const current   = raw === null ? undefined : raw;
    const next      = fn(current);
    await this.performSet(qualified, next);
    return next;
  }

  async snapshot(_options?: AbortableOptionsType): Promise<StoreSnapshotType> {
    const entries = [...await this.performSnapshotEntries()];
    return {
      'version': this.snapshotVersion,
      'type':    this.snapshotType,
      entries,
    };
  }

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
    await this.performRestoreEntries(incoming.entries);
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
  protected abstract performSnapshotEntries(): Promise<readonly StoreSnapshotEntryType[]>;
  protected abstract performRestoreEntries(entries: readonly StoreSnapshotEntryType[]): Promise<void>;

  // ── Internal ────────────────────────────────────────────────────────

  /**
   * Apply the namespace prefix to a key. Subclasses that override `update`
   * for native CAS must use this method to ensure namespace consistency.
   */
  protected qualifyKey(key: string): string {
    return this.#namespace === '' ? key : `${this.#namespace}:${key}`;
  }
}
