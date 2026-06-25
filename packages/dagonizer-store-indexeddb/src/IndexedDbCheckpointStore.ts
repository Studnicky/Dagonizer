/**
 * IndexedDbCheckpointStore: CheckpointStoreInterface backed by IndexedDB.
 *
 * Stores checkpoint JSON strings (produced by `Checkpoint.capture`) in a
 * dedicated IndexedDB object store. Strings only — the codec is JSON-string,
 * per the `CheckpointStoreInterface` contract.
 *
 * Same factory-injection + `static open(options?)` pattern as IndexedDbStore.
 * A separate class and a separate object store (default: 'checkpoints') keeps
 * checkpoint data partitioned from KV data even when both use the same database.
 */

import type { AbortableOptionsType, CheckpointStoreInterface } from '@studnicky/dagonizer/contracts';
import { StoreError } from '@studnicky/dagonizer/store';

import {
  IdbFactory,
  IdbRequest,
  type IdbDatabaseLikeInterface,
  type IdbFactoryLikeInterface,
} from './IdbTypes.js';

// ---------------------------------------------------------------------------
// IndexedDbCheckpointStoreOptionsType
// ---------------------------------------------------------------------------

export type IndexedDbCheckpointStoreOptionsType = {
  /** IndexedDB database name. Default: 'dagonizer-checkpoints'. */
  readonly databaseName?: string;
  /** Object store name for checkpoint strings. Default: 'checkpoints'. */
  readonly storeName?: string;
};

// Each store class manages exactly one object store and creates it in its own
// `onupgradeneeded`. A second store class opening the SAME database at the same
// version never sees `onupgradeneeded` fire, so its object store is missing and
// every transaction throws "object store not found". The checkpoint store
// therefore defaults to its own database, distinct from `IndexedDbStore`'s
// 'dagonizer', so `IndexedDbStore.open()` + `IndexedDbCheckpointStore.open()`
// compose with defaults. Callers that want both in one database must give that
// database a version that creates both stores.
const CHECKPOINT_STORE_DEFAULTS = {
  'databaseName': 'dagonizer-checkpoints',
  'storeName':    'checkpoints',
} as const;

// ---------------------------------------------------------------------------
// IndexedDbCheckpointStore
// ---------------------------------------------------------------------------

export class IndexedDbCheckpointStore implements CheckpointStoreInterface {
  readonly #factory:      IdbFactoryLikeInterface;
  readonly #databaseName: string;
  readonly #storeName:    string;
  #db:                    IdbDatabaseLikeInterface | null;

  constructor(factory: IdbFactoryLikeInterface, options: IndexedDbCheckpointStoreOptionsType = {}) {
    this.#factory      = factory;
    this.#databaseName = options.databaseName ?? CHECKPOINT_STORE_DEFAULTS.databaseName;
    this.#storeName    = options.storeName    ?? CHECKPOINT_STORE_DEFAULTS.storeName;
    this.#db           = null;
  }

  /**
   * Resolve the browser `indexedDB` global from `globalThis` via
   * `Reflect.get` + the `IdbFactory.is` structural guard, then return a
   * new `IndexedDbCheckpointStore`. Throws `StoreError(BACKING_ERROR)` when
   * `indexedDB` is absent (non-browser environment).
   */
  static open(options: IndexedDbCheckpointStoreOptionsType = {}): IndexedDbCheckpointStore {
    const raw = Reflect.get(globalThis, 'indexedDB');
    if (!IdbFactory.is(raw)) {
      throw new StoreError(
        'indexedDB is not available in this environment',
        { 'reason': 'BACKING_ERROR', 'cause': new Error('globalThis.indexedDB is absent or not a factory') },
      );
    }
    return new IndexedDbCheckpointStore(raw, options);
  }

  /**
   * Open the database and create the checkpoint object store if needed.
   * Safe to call multiple times (no-op if already connected).
   */
  async connect(): Promise<void> {
    if (this.#db !== null) return;
    const req   = this.#factory.open(this.#databaseName, 1);
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

  /** Close the IndexedDB connection. Idempotent. */
  async disconnect(): Promise<void> {
    this.#db?.close();
    this.#db = null;
  }

  /**
   * Persist `json` under `key`, overwriting any existing entry.
   */
  async save(key: string, json: string, _options?: AbortableOptionsType): Promise<void> {
    const os = this.#readwriteStore();
    await IdbRequest.toPromise(os.put(json, key));
  }

  /**
   * Read the JSON stored under `key`, or `null` when no entry exists.
   */
  async load(key: string, _options?: AbortableOptionsType): Promise<string | null> {
    const os  = this.#readonlyStore();
    const raw = await IdbRequest.toPromise(os.get(key));
    if (typeof raw !== 'string') return null;
    return raw;
  }

  /**
   * Remove the entry under `key`. No-op when no entry exists.
   */
  async delete(key: string, _options?: AbortableOptionsType): Promise<void> {
    const os = this.#readwriteStore();
    await IdbRequest.toPromise(os.delete(key));
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  #requireDb(): IdbDatabaseLikeInterface {
    if (this.#db === null) {
      throw new StoreError(
        'IndexedDbCheckpointStore is not connected; call connect() before any operation',
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
}
