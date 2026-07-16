import type { GraphDeltaRecordType, GraphJournalStoreInterface } from '@studnicky/dagonizer';
import { StoreError } from '@studnicky/dagonizer/store';

import { IdbFactory, IdbRequest, type IdbDatabaseLikeInterface, type IdbFactoryLikeInterface } from './IdbFactory.js';

const SNAPSHOT_STORE = 'graph_snapshot';
const LOG_STORE = 'graph_log';
const SEQ_WIDTH = 20;

export type IndexedDbGraphJournalStoreOptionsType = {
  /** IndexedDB database name for the graph journal. Default: 'dagonizer-graph-journal'. */
  readonly databaseName?: string;
};

const INDEXED_DB_GRAPH_JOURNAL_DEFAULTS = {
  'databaseName': 'dagonizer-graph-journal',
} as const;

/**
 * GraphJournalStore backed directly by IndexedDB: one real object-store row
 * per appended delta (keyed by `runIri` + zero-padded `seq`, so appends are
 * a single `put` — no read-modify-write of any existing record), plus a
 * separate compacted-snapshot object store.
 */
export class IndexedDbGraphJournalStore implements GraphJournalStoreInterface {
  readonly #factory: IdbFactoryLikeInterface;
  readonly #databaseName: string;
  #db: IdbDatabaseLikeInterface | null = null;

  constructor(factory: IdbFactoryLikeInterface, options: IndexedDbGraphJournalStoreOptionsType = {}) {
    this.#factory = factory;
    this.#databaseName = options.databaseName ?? INDEXED_DB_GRAPH_JOURNAL_DEFAULTS.databaseName;
  }

  /** Resolve the browser `indexedDB` global from `globalThis` and return a new journal store. */
  static open(options: IndexedDbGraphJournalStoreOptionsType = {}): IndexedDbGraphJournalStore {
    const raw = Reflect.get(globalThis, 'indexedDB');
    if (!IdbFactory.is(raw)) {
      throw new StoreError(
        'indexedDB is not available in this environment',
        { 'reason': 'BACKING_ERROR', 'cause': new Error('globalThis.indexedDB is absent or not a factory') },
      );
    }
    return new IndexedDbGraphJournalStore(raw, options);
  }

  async connect(): Promise<void> {
    if (this.#db !== null) return;
    const req = this.#factory.open(this.#databaseName, 1);
    req.onupgradeneeded = (event) => {
      const target = event.target;
      if (target === null) return;
      const upgradeDb = target.result;
      if (!upgradeDb.objectStoreNames.contains(SNAPSHOT_STORE)) upgradeDb.createObjectStore(SNAPSHOT_STORE);
      if (!upgradeDb.objectStoreNames.contains(LOG_STORE)) upgradeDb.createObjectStore(LOG_STORE);
    };
    this.#db = await IdbRequest.toPromise(req);
  }

  async disconnect(): Promise<void> {
    this.#db?.close();
    this.#db = null;
  }

  /** Single `put` into the log store — O(1), never touches the snapshot or any other delta. */
  async append(runIri: string, record: GraphDeltaRecordType): Promise<void> {
    const db = this.#requireDb();
    const store = db.transaction(LOG_STORE, 'readwrite').objectStore(LOG_STORE);
    await IdbRequest.toPromise(store.put(JSON.stringify(record), IndexedDbGraphJournalStore.#logKey(runIri, record.seq)));
  }

  async *readSnapshot(runIri: string): AsyncIterable<string> {
    const db = this.#requireDb();
    const store = db.transaction(SNAPSHOT_STORE, 'readonly').objectStore(SNAPSHOT_STORE);
    const raw = await IdbRequest.toPromise(store.get(runIri));
    if (typeof raw === 'string') yield raw;
  }

  async *readLog(runIri: string): AsyncIterable<GraphDeltaRecordType> {
    const db = this.#requireDb();
    const entries = await IndexedDbGraphJournalStore.#collectLogEntries(db, IndexedDbGraphJournalStore.#logPrefix(runIri));
    yield* entries;
  }

  /** Atomically replace the snapshot row and drop every log row with seq <= throughSeq, in one readwrite transaction. */
  async compact(runIri: string, snapshot: AsyncIterable<string>, throughSeq: number): Promise<void> {
    const chunks: string[] = [];
    for await (const chunk of snapshot) chunks.push(chunk);
    const db = this.#requireDb();
    await IndexedDbGraphJournalStore.#compactTransaction(db, runIri, chunks.join(''), throughSeq);
  }

  #requireDb(): IdbDatabaseLikeInterface {
    if (this.#db === null) {
      throw new StoreError(
        'IndexedDbGraphJournalStore is not connected; call connect() before any operation',
        { 'reason': 'BACKING_ERROR', 'cause': new Error('journal not connected') },
      );
    }
    return this.#db;
  }

  static #logPrefix(runIri: string): string { return `${runIri}\u0000`; }
  static #logKey(runIri: string, seq: number): string { return `${IndexedDbGraphJournalStore.#logPrefix(runIri)}${String(seq).padStart(SEQ_WIDTH, '0')}`; }

  static #seqOfKey(key: string, prefix: string): number | undefined {
    if (!key.startsWith(prefix)) return undefined;
    const parsed = Number.parseInt(key.slice(prefix.length), 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  static #isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  static #isDeltaRecord(value: unknown): value is GraphDeltaRecordType {
    if (!IndexedDbGraphJournalStore.#isObject(value)) return false;
    return typeof value['seq'] === 'number' && typeof value['additions'] === 'string' && typeof value['deletions'] === 'string';
  }

  static #decodeRecord(raw: unknown): GraphDeltaRecordType | undefined {
    if (typeof raw !== 'string') return undefined;
    const parsed: unknown = JSON.parse(raw);
    return IndexedDbGraphJournalStore.#isDeltaRecord(parsed) ? parsed : undefined;
  }

  /**
   * Walk the log store's cursor synchronously within `onsuccess` callbacks
   * (no `await` between `cursor.continue()` calls, matching the pattern
   * `IndexedDbStore` uses elsewhere so the transaction never auto-commits
   * mid-walk), collecting every entry whose key carries `prefix`.
   */
  static #collectLogEntries(db: IdbDatabaseLikeInterface, prefix: string): Promise<GraphDeltaRecordType[]> {
    return new Promise((resolve, reject) => {
      const store = db.transaction(LOG_STORE, 'readonly').objectStore(LOG_STORE);
      const req = store.openCursor();
      const entries: GraphDeltaRecordType[] = [];
      req.onerror = () => { reject(req.error ?? new Error('IDB cursor failed')); };
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor === null) {
          entries.sort((left, right) => left.seq - right.seq);
          resolve(entries);
          return;
        }
        const rawKey = cursor.key;
        if (typeof rawKey === 'string' && rawKey.startsWith(prefix)) {
          const parsed = IndexedDbGraphJournalStore.#decodeRecord(cursor.value);
          if (parsed !== undefined) entries.push(parsed);
        }
        cursor.continue();
      };
    });
  }

  /**
   * Put the compacted snapshot, then walk and delete every stale log entry
   * for `runIri`, all within one `readwrite` transaction spanning both
   * object stores. Delete requests are fired without awaiting their
   * `onsuccess` before `cursor.continue()` (same no-await-mid-transaction
   * pattern as `IndexedDbStore`); completion is tracked via a pending-count
   * so the promise settles only once every queued delete has resolved.
   */
  static #compactTransaction(db: IdbDatabaseLikeInterface, runIri: string, nquads: string, throughSeq: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([SNAPSHOT_STORE, LOG_STORE], 'readwrite');
      const snapshotStore = tx.objectStore(SNAPSHOT_STORE);
      const logStore = tx.objectStore(LOG_STORE);
      let pendingDeletes = 0;
      let cursorDone = false;
      let settled = false;
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error('IDB graph compaction failed'));
      };
      const finish = (): void => {
        if (settled || !cursorDone || pendingDeletes > 0) return;
        settled = true;
        resolve();
      };

      const put = snapshotStore.put(nquads, runIri);
      put.onerror = () => { fail(put.error); };
      put.onsuccess = () => {
        const prefix = IndexedDbGraphJournalStore.#logPrefix(runIri);
        const cursorReq = logStore.openCursor();
        cursorReq.onerror = () => { fail(cursorReq.error); };
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor === null) {
            cursorDone = true;
            finish();
            return;
          }
          const rawKey = cursor.key;
          if (typeof rawKey === 'string') {
            const seq = IndexedDbGraphJournalStore.#seqOfKey(rawKey, prefix);
            if (seq !== undefined && seq <= throughSeq) {
              pendingDeletes += 1;
              const del = logStore.delete(rawKey);
              del.onerror = () => { fail(del.error); };
              del.onsuccess = () => { pendingDeletes -= 1; finish(); };
            }
          }
          cursor.continue();
        };
      };
    });
  }
}
