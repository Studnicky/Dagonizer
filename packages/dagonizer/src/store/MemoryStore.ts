/**
 * MemoryStore: reference implementation of BaseStore backed by a `Map`.
 *
 * Snapshot type:    'memory-store'
 * Snapshot version: 1
 */

import type { StoreSnapshotEntryType } from '../contracts/SnapshottableInterface.js';
import type { JsonValueType } from '../entities/json.js';

import { BaseStore, type BaseStoreOptionsType } from './BaseStore.js';

export class MemoryStore extends BaseStore {
  readonly #data: Map<string, JsonValueType>;

  constructor(options: BaseStoreOptionsType = {}) {
    super(options);
    this.#data = new Map<string, JsonValueType>();
  }

  protected get snapshotType(): string    { return 'memory-store'; }
  protected get snapshotVersion(): number { return 1; }

  /**
   * Atomic read-modify-write. Reads `#data` directly so the body contains
   * no `await` and cannot interleave with another `update` on the same
   * instance. The base-class default uses `performGet` + `performSet`,
   * which has two await points and is not safe under concurrent calls.
   */
  override async update<T extends JsonValueType>(key: string, fn: (current: T | undefined) => T): Promise<T> {
    const qualified = this.qualifyKey(key);
    // Synchronous atomic RMW: read the backing Map directly (no await between
    // read and write). Narrowing goes through the base's single typed-accessor
    // boundary helper — no cast in this override.
    const raw       = this.narrowStored<T>(this.#data.get(qualified) ?? null);
    const next      = fn(raw === null ? undefined : raw);
    this.#data.set(qualified, next);
    return next;
  }

  protected async performGet(key: string): Promise<JsonValueType | null> {
    const value = this.#data.get(key);
    return value === undefined ? null : value;
  }

  protected async performSet(key: string, value: JsonValueType): Promise<void> {
    this.#data.set(key, value);
  }

  protected async performHas(key: string): Promise<boolean> {
    return this.#data.has(key);
  }

  protected async performDelete(key: string): Promise<boolean> {
    return this.#data.delete(key);
  }

  protected async performSnapshotEntries(): Promise<readonly StoreSnapshotEntryType[]> {
    return [...this.#data.entries()].map(([key, value]) => ({
      'key':   key,
      'value': value,
    }));
  }

  protected async performRestoreEntries(entries: readonly StoreSnapshotEntryType[]): Promise<void> {
    this.#data.clear();
    for (const { key, value } of entries) {
      this.#data.set(key, value);
    }
  }
}
