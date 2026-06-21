/**
 * custom-store/dags: demonstrates extending BaseStore for a custom in-process backend.
 *
 * MapStore is a real, runnable implementation backed by a plain JavaScript
 * Map<string, JsonValueType>. It implements all six protected abstract hooks and
 * overrides `update` with a lock-free atomic read-modify-write that is safe
 * because the Map access between read and write contains no `await` — no
 * concurrent microtask can interleave.
 *
 * Swap the Map for Redis, Postgres, or any other backing in production by
 * replacing the Map operations with calls to your storage client. The hook
 * surface (performGet/performSet/performHas/performDelete/
 * performSnapshotEntries/performRestoreEntries) stays identical regardless of
 * the backing.
 *
 * Pure module: no side effects, no dispatcher, no execute.
 * Imported by examples/custom-store.ts (the executable entry point).
 */

// #region custom-store
import type { JsonValueType } from '@studnicky/dagonizer/entities';
import type { StoreSnapshotEntryType } from '@studnicky/dagonizer/store';
import { BaseStore, type BaseStoreOptionsType } from '@studnicky/dagonizer/store';

/**
 * MapStore: a fully functional custom store backed by a plain Map.
 *
 * `update` is atomic within a single instance: the Map read and write are
 * synchronous with no intervening await, so concurrent microtasks cannot
 * interleave between them.
 *
 * In production, swap `this.#data` operations for calls to a Redis, Postgres,
 * or other client. Override `connect`/`disconnect` for connection lifecycle.
 * The snapshot type and version strings are the stable discriminants for the
 * resume path — bump `snapshotVersion` when the storage shape changes.
 */
export class MapStore extends BaseStore {
  readonly #data: Map<string, JsonValueType>;

  constructor(options: BaseStoreOptionsType = {}) {
    super(options);
    this.#data = new Map<string, JsonValueType>();
  }

  protected get snapshotType(): string    { return 'map-store'; }
  protected get snapshotVersion(): number { return 1; }

  /**
   * Atomic read-modify-write. Reads #data directly so the body contains
   * no `await` and cannot interleave with another `update` on the same
   * instance. The base-class default uses performGet + performSet,
   * which has two await points and is not safe under concurrent calls.
   */
  override async update<T extends JsonValueType>(
    key: string,
    fn: (current: T | undefined) => T,
  ): Promise<T> {
    const qualified = this.qualifyKey(key);
    const stored    = this.#data.get(qualified) ?? null;
    const current   = this.narrowStored<T>(stored) ?? undefined;
    const next      = fn(current);
    this.#data.set(qualified, next);
    return next;
  }

  protected async performGet(key: string): Promise<JsonValueType | null> {
    return this.#data.get(key) ?? null;
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
    return [...this.#data.entries()].map(([key, value]) => ({ key, value }));
  }

  protected async performRestoreEntries(entries: readonly StoreSnapshotEntryType[]): Promise<void> {
    this.#data.clear();
    for (const { key, value } of entries) {
      this.#data.set(key, value);
    }
  }
}
// #endregion custom-store
