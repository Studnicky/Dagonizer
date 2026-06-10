/**
 * BaseStore: abstract base every concrete store extends.
 *
 * Owns the snapshot envelope (`{ version, type, entries }`), the default
 * `update` implementation (read-modify-write atop `performGet` + `performSet`),
 * optional namespace prefix, and lifecycle no-ops. Concrete stores implement
 * the `protected abstract perform*` hooks.
 *
 *   Store contract → BaseStore ┐
 *                              ├─ get/set/has/delete  → qualify key → perform* hook
 *                              ├─ update(key, fn)     → default RMW; override for native CAS
 *                              └─ snapshot / restore  → envelope + StoreError on mismatch
 *
 * Modeled directly on `BaseAdapter` in `src/adapter/BaseAdapter.ts`.
 */

import type { StoreSnapshot, StoreSnapshotEntry } from '../contracts/Snapshottable.js';
import type { Store } from '../contracts/Store.js';
import type { JsonValue } from '../entities/json.js';

import { StoreError } from './StoreError.js';

export interface BaseStoreOptions {
  /**
   * Key prefix applied to every public-API key before it reaches the
   * `perform*` hooks. Use `''` (the default) for no prefix. Two stores
   * with different namespaces but the same backing coexist without key
   * collisions because the snapshot captures keys in their qualified form.
   */
  readonly namespace: string;
}

/** Default options. Spread into custom options to fill unset fields. */
export const BASE_STORE_DEFAULTS: BaseStoreOptions = {
  'namespace': '',
};

export abstract class BaseStore implements Store {
  readonly #namespace: string;

  protected constructor(options: BaseStoreOptions = BASE_STORE_DEFAULTS) {
    this.#namespace = options.namespace;
  }

  /** Subclass identifier; recorded in snapshot envelopes. */
  protected abstract get snapshotType(): string;

  /** Subclass snapshot schema version; increment when storage shape changes. */
  protected abstract get snapshotVersion(): number;

  // ── Public Store contract (delegates to protected hooks) ─────────────

  async get<T extends JsonValue>(key: string): Promise<T | null> {
    return this.performGet<T>(this.qualifyKey(key));
  }

  async set<T extends JsonValue>(key: string, value: T): Promise<void> {
    await this.performSet<T>(this.qualifyKey(key), value);
  }

  async has(key: string): Promise<boolean> {
    return this.performHas(this.qualifyKey(key));
  }

  async delete(key: string): Promise<boolean> {
    return this.performDelete(this.qualifyKey(key));
  }

  /**
   * Default read-modify-write. NOT atomic on its own; there are two
   * `await` points (`performGet`, `performSet`) where another `update`
   * on the same key can interleave. Subclasses MUST override when they
   * back a storage layer that supports a single-step RMW (in-memory
   * direct access, SQL transactions, Redis WATCH/MULTI, etc.).
   *
   * The override is required to satisfy the `Store.update` atomicity
   * contract; consumers should not rely on the default.
   */
  async update<T extends JsonValue>(key: string, fn: (current: T | undefined) => T): Promise<T> {
    const qualified = this.qualifyKey(key);
    const raw       = await this.performGet<T>(qualified);
    const current   = raw === null ? undefined : raw;
    const next      = fn(current);
    await this.performSet<T>(qualified, next);
    return next;
  }

  async snapshot(): Promise<StoreSnapshot> {
    const entries = await this.performSnapshotEntries();
    return {
      'version': this.snapshotVersion,
      'type':    this.snapshotType,
      entries,
    };
  }

  async restore(incoming: StoreSnapshot): Promise<void> {
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

  protected abstract performGet<T extends JsonValue>(qualifiedKey: string): Promise<T | null>;
  protected abstract performSet<T extends JsonValue>(qualifiedKey: string, value: T): Promise<void>;
  protected abstract performHas(qualifiedKey: string): Promise<boolean>;
  protected abstract performDelete(qualifiedKey: string): Promise<boolean>;
  protected abstract performSnapshotEntries(): Promise<readonly StoreSnapshotEntry[]>;
  protected abstract performRestoreEntries(entries: readonly StoreSnapshotEntry[]): Promise<void>;

  // ── Internal ────────────────────────────────────────────────────────

  /**
   * Apply the namespace prefix to a key. Subclasses that override `update`
   * for native CAS must use this method to ensure namespace consistency.
   */
  protected qualifyKey(key: string): string {
    return this.#namespace === '' ? key : `${this.#namespace}:${key}`;
  }
}
