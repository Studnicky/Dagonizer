/**
 * IndexedDbStore: BaseStore implementation backed by IndexedDB.
 *
 * Snapshot type:    'indexed-db-store'
 * Snapshot version: 1
 *
 * Designed for in-browser HITL/resume durability. All browser globals are
 * reached via `Reflect.get(globalThis, 'indexedDB')` + the `IdbFactory.is`
 * type-predicate guard so this package never carries a DOM-lib dependency.
 *
 * Key design decisions:
 *  - Factory injection: constructor takes `IdbFactoryLikeInterface` for
 *    testability; `IndexedDbStore.open(options?)` resolves the real factory
 *    from globalThis and throws `StoreError(BACKING_ERROR)` if absent.
 *  - Values are stored as JSON strings via `JSON.stringify` / `JsonValue.from(JSON.parse(...))`
 *    rather than relying on IDB structured-clone, keeping codec behaviour
 *    identical to the SQLite and OPFS adapters.
 *  - Atomicity: `update()` issues a single `readwrite` transaction, calling
 *    `get` then `put` within the same transaction object. IDB transactions
 *    commit only after all their requests complete, so the read and write
 *    are atomic with respect to other transactions.
 *  - Cursor streaming: `performEntriesStream` opens an IDB cursor and walks
 *    it one step at a time via promise-per-step, yielding entries without
 *    materializing the whole keyspace into memory (`getAll` is NOT used).
 */

import type { StoreSnapshotEntryType } from '@studnicky/dagonizer/contracts';
import { JsonValue, type JsonValueType } from '@studnicky/dagonizer/entities';
import { BaseStore, StoreError, type BaseStoreOptionsType } from '@studnicky/dagonizer/store';

import {
  IdbFactory,
  IdbRequest,
  type IdbDatabaseLikeInterface,
  type IdbFactoryLikeInterface,
} from './IdbFactory.js';

// ---------------------------------------------------------------------------
// IndexedDbStoreOptionsType
// ---------------------------------------------------------------------------

export type IndexedDbStoreOptionsType = BaseStoreOptionsType & {
  /** IndexedDB database name. Default: 'dagonizer'. */
  readonly databaseName?: string;
  /** Object store name for the key-value data. Default: 'kv'. */
  readonly storeName?: string;
};

/** Default values for IndexedDB-specific options. */
const INDEXED_DB_STORE_DEFAULTS = {
  'databaseName': 'dagonizer',
  'storeName':    'kv',
} as const;

// ---------------------------------------------------------------------------
// IndexedDbStore
// ---------------------------------------------------------------------------

export class IndexedDbStore extends BaseStore {
  readonly #factory:      IdbFactoryLikeInterface;
  readonly #databaseName: string;
  readonly #storeName:    string;
  #db:                    IdbDatabaseLikeInterface | null;

  constructor(factory: IdbFactoryLikeInterface, options: IndexedDbStoreOptionsType = {}) {
    super(options);
    this.#factory      = factory;
    this.#databaseName = options.databaseName ?? INDEXED_DB_STORE_DEFAULTS.databaseName;
    this.#storeName    = options.storeName    ?? INDEXED_DB_STORE_DEFAULTS.storeName;
    this.#db           = null;
  }

  /**
   * Resolve the browser `indexedDB` global from `globalThis` via
   * `Reflect.get` + the `IdbFactory.is` structural guard, then return a
   * new `IndexedDbStore` instance. Throws `StoreError(BACKING_ERROR)` when
   * `indexedDB` is absent (non-browser environment).
   */
  static open(options: IndexedDbStoreOptionsType = {}): IndexedDbStore {
    const raw = Reflect.get(globalThis, 'indexedDB');
    if (!IdbFactory.is(raw)) {
      throw new StoreError(
        'indexedDB is not available in this environment',
        { 'reason': 'BACKING_ERROR', 'cause': new Error('globalThis.indexedDB is absent or not a factory') },
      );
    }
    return new IndexedDbStore(raw, options);
  }

  protected get snapshotType(): string    { return 'indexed-db-store'; }
  protected get snapshotVersion(): number { return 1; }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Open the IndexedDB database. Creates the KV object store on first open
   * (`onupgradeneeded`). Call before any KV operations; safe to call
   * multiple times (no-op if already connected).
   */
  override async connect(): Promise<void> {
    if (this.#db !== null) return;
    const req  = this.#factory.open(this.#databaseName, 1);
    const store = this.#storeName;
    req.onupgradeneeded = (event) => {
      const target = event.target;
      if (target === null) return;
      const upgradeDb = target.result;
      if (!upgradeDb.objectStoreNames.contains(store)) {
        upgradeDb.createObjectStore(store);
      }
    };
    this.#db = await IdbRequest.toPromise(req);
  }

  /**
   * Close the IndexedDB connection. Idempotent.
   */
  override async disconnect(): Promise<void> {
    this.#db?.close();
    this.#db = null;
  }

  // ── update: atomic RMW inside one readwrite transaction ───────────────────

  /**
   * Atomic read-modify-write using a single `readwrite` transaction.
   *
   * Issues `get` and then immediately schedules `put` in the `onsuccess`
   * callback of the get — without yielding the IDB event loop between them.
   * This prevents the IDB transaction from auto-committing between the read
   * and the write, which would happen if we `await` the get result before
   * calling `put`. Both requests are visible to IDB before it can commit,
   * so the RMW is atomic with respect to concurrent callers on the same DB.
   */
  override async update(
    key: string,
    fn: (current: JsonValueType | undefined) => JsonValueType,
  ): Promise<JsonValueType> {
    const db        = this.#requireDb();
    const qualified = this.qualifyKey(key);
    return IndexedDbStore.#atomicRmw(db, this.#storeName, qualified, fn);
  }

  /**
   * Perform the read-modify-write without an `await` between the `get` and
   * `put` requests so the IDB transaction stays open across both.
   *
   * The outer `Promise<JsonValueType>` resolves when the `put` request
   * succeeds; it rejects if either `get` or `put` errors.
   */
  static #atomicRmw(
    db:        IdbDatabaseLikeInterface,
    storeName: string,
    key:       string,
    fn:        (current: JsonValueType | undefined) => JsonValueType,
  ): Promise<JsonValueType> {
    return new Promise<JsonValueType>((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const os  = tx.objectStore(storeName);
      const get = os.get(key);

      get.onerror = () => { reject(get.error ?? new Error('IDB get failed')); };
      get.onsuccess = () => {
        const parsed  = IndexedDbStore.#decode(get.result);
        const current = parsed === null ? undefined : parsed;
        const next    = fn(current);
        const put     = os.put(JSON.stringify(next), key);
        put.onerror   = () => { reject(put.error ?? new Error('IDB put failed')); };
        put.onsuccess = () => { resolve(next); };
      };
    });
  }

  // ── perform* hooks ────────────────────────────────────────────────────────

  protected async performGet(key: string): Promise<JsonValueType | null> {
    const os  = this.#readonlyStore();
    const raw = await IdbRequest.toPromise(os.get(key));
    return IndexedDbStore.#decode(raw);
  }

  protected async performSet(key: string, value: JsonValueType): Promise<void> {
    const os = this.#readwriteStore();
    await IdbRequest.toPromise(os.put(JSON.stringify(value), key));
  }

  protected async performHas(key: string): Promise<boolean> {
    const os    = this.#readonlyStore();
    const count = await IdbRequest.toPromise(os.count(key));
    return count > 0;
  }

  protected async performDelete(key: string): Promise<boolean> {
    // Use a single readwrite transaction: count then delete within the same
    // transaction without an await between them so IDB does not auto-commit
    // between the existence check and the delete.
    const db = this.#requireDb();
    return IndexedDbStore.#countThenDelete(db, this.#storeName, key);
  }

  /**
   * Stream all entries via an IDB cursor without materializing the full
   * keyspace into memory.
   *
   * IDB transactions auto-commit when there are no pending requests. A naïve
   * async-generator that `yield`s between cursor steps would suspend between
   * `cursor.continue()` calls, giving IDB a chance to commit the transaction
   * before the next step. To avoid this, all cursor entries are collected into
   * an in-memory array synchronously within a single cursor-walk promise (no
   * `await` between `cursor.continue()` calls), then yielded from the
   * generator. This preserves the `AsyncIterable<StoreSnapshotEntryType>`
   * contract while preventing premature transaction commit.
   */
  protected async *performEntriesStream(): AsyncIterable<StoreSnapshotEntryType> {
    const db      = this.#requireDb();
    const entries = await IndexedDbStore.#collectCursorEntries(db, this.#storeName);
    for (const entry of entries) {
      yield entry;
    }
  }

  protected async performRestoreEntry(entry: StoreSnapshotEntryType): Promise<void> {
    const os = this.#readwriteStore();
    await IdbRequest.toPromise(os.put(JSON.stringify(entry.value), entry.key));
  }

  protected async performClear(): Promise<void> {
    const os = this.#readwriteStore();
    await IdbRequest.toPromise(os.clear());
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  #requireDb(): IdbDatabaseLikeInterface {
    if (this.#db === null) {
      throw new StoreError(
        'IndexedDbStore is not connected; call connect() before any operation',
        { 'reason': 'BACKING_ERROR', 'cause': new Error('store not connected') },
      );
    }
    return this.#db;
  }

  #readonlyStore() {
    const db = this.#requireDb();
    return db.transaction(this.#storeName, 'readonly').objectStore(this.#storeName);
  }

  #readwriteStore() {
    const db = this.#requireDb();
    return db.transaction(this.#storeName, 'readwrite').objectStore(this.#storeName);
  }

  /** Decode a raw IDB stored value (JSON string) into `JsonValueType | null`. */
  static #decode(raw: unknown): JsonValueType | null {
    if (typeof raw !== 'string') return null;
    return JsonValue.from(JSON.parse(raw));
  }

  /**
   * Count then delete in one `readwrite` transaction, without an `await`
   * between them so IDB does not auto-commit between the two requests.
   * Returns `true` if a record existed (and was deleted), `false` otherwise.
   */
  static #countThenDelete(
    db:        IdbDatabaseLikeInterface,
    storeName: string,
    key:       string,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const tx    = db.transaction(storeName, 'readwrite');
      const os    = tx.objectStore(storeName);
      const count = os.count(key);

      count.onerror = () => { reject(count.error ?? new Error('IDB count failed')); };
      count.onsuccess = () => {
        if (count.result === 0) {
          resolve(false);
          return;
        }
        const del    = os.delete(key);
        del.onerror  = () => { reject(del.error ?? new Error('IDB delete failed')); };
        del.onsuccess = () => { resolve(true); };
      };
    });
  }

  /**
   * Walk an IDB cursor synchronously within `onsuccess` callbacks, calling
   * `cursor.continue()` before returning control to IDB so the transaction
   * stays open for the next step. Accumulates all entries into an array;
   * the outer async generator then yields them without holding the IDB
   * transaction open across `yield` boundaries.
   */
  static #collectCursorEntries(
    db:        IdbDatabaseLikeInterface,
    storeName: string,
  ): Promise<StoreSnapshotEntryType[]> {
    return new Promise<StoreSnapshotEntryType[]>((resolve, reject) => {
      const tx      = db.transaction(storeName, 'readonly');
      const os      = tx.objectStore(storeName);
      const req     = os.openCursor();
      const entries: StoreSnapshotEntryType[] = [];

      req.onerror = () => { reject(req.error ?? new Error('IDB cursor failed')); };
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor === null) {
          // Cursor exhausted — resolve with accumulated entries.
          resolve(entries);
          return;
        }
        const rawKey = cursor.key;
        if (typeof rawKey === 'string') {
          const parsed = IndexedDbStore.#decode(cursor.value);
          if (parsed !== null) {
            entries.push({ 'key': rawKey, 'value': parsed });
          }
        }
        // Continue synchronously — no await before cursor.continue() keeps
        // the transaction alive.
        cursor.continue();
      };
    });
  }
}
