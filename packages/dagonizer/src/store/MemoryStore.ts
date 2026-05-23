/**
 * MemoryStore — reference implementation of BaseStore backed by a `Map`.
 *
 * Snapshot type:    'memory-store'
 * Snapshot version: 1
 */

import type { StoreSnapshotEntry } from '../contracts/Store.js';
import type { JsonValue } from '../entities/json.js';

import { BaseStore, type BaseStoreOptions } from './BaseStore.js';

export class MemoryStore extends BaseStore {
  readonly #data: Map<string, JsonValue>;

  constructor(options: BaseStoreOptions = {}) {
    super(options);
    this.#data = new Map<string, JsonValue>();
  }

  protected get snapshotType(): string    { return 'memory-store'; }
  protected get snapshotVersion(): number { return 1; }

  /**
   * Atomic read-modify-write. Reads `#data` directly so the body contains
   * no `await` and cannot interleave with another `update` on the same
   * instance. The base-class default uses `performGet` + `performSet`,
   * which has two await points and is not safe under concurrent calls.
   */
  override async update<T extends JsonValue>(key: string, fn: (current: T | undefined) => T): Promise<T> {
    const qualified = this.qualifyKey(key);
    const current   = this.#data.get(qualified) as T | undefined;
    const next      = fn(current);
    this.#data.set(qualified, next);
    return next;
  }

  protected async performGet<T extends JsonValue>(key: string): Promise<T | undefined> {
    return this.#data.get(key) as T | undefined;
  }

  protected async performSet<T extends JsonValue>(key: string, value: T): Promise<void> {
    this.#data.set(key, value);
  }

  protected async performHas(key: string): Promise<boolean> {
    return this.#data.has(key);
  }

  protected async performDelete(key: string): Promise<boolean> {
    return this.#data.delete(key);
  }

  protected async performSnapshotEntries(): Promise<readonly StoreSnapshotEntry[]> {
    return [...this.#data.entries()].map(([key, value]) => ({
      'key':   key,
      'value': value,
    }));
  }

  protected async performRestoreEntries(entries: readonly StoreSnapshotEntry[]): Promise<void> {
    this.#data.clear();
    for (const { key, value } of entries) {
      this.#data.set(key, value);
    }
  }
}
