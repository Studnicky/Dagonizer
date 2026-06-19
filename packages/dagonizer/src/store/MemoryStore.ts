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
    // Map<string, JsonValueType>.get() returns JsonValueType | undefined; the caller's
    // generic T extends JsonValueType so the narrowing cast is safe by contract.
    const raw       = this.#data.get(qualified) as T | undefined;
    const next      = fn(raw);
    this.#data.set(qualified, next);
    return next;
  }

  protected async performGet<T extends JsonValueType>(key: string): Promise<T | null> {
    const value = this.#data.get(key);
    // Map<string, JsonValueType>.get() returns JsonValueType | undefined; the undefined
    // case is handled by the ternary above; T extends JsonValueType so the cast is safe.
    return value === undefined ? null : (value as T);
  }

  protected async performSet<T extends JsonValueType>(key: string, value: T): Promise<void> {
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
