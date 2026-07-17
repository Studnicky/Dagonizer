/**
 * IndexedDbFoldJournalStore: FoldJournalStoreInterface backed directly by
 * IndexedDB. Uses a dedicated database (default: 'dagonizer-fold-journal')
 * and dedicated object stores, distinct from the graph journal database, so
 * no schema migration of graph state is ever required.
 *
 * One `append()` call is one `readwrite` transaction (requested with
 * `durability: 'strict'`) spanning three object stores: an idempotency
 * record keyed by an encoded `runIri` + `commitId` (dedup check), a per-run
 * sequence allocator, and the commit record itself keyed by an encoded
 * `runIri` + zero-padded seq (append order). All requests are chained
 * inside `onsuccess` handlers — no `await` between them — so the
 * transaction cannot auto-commit mid-sequence. `append()` resolves only
 * once the transaction's own `oncomplete` fires, never from a request's
 * `onsuccess` — a request can succeed while the transaction still aborts
 * before commit.
 */

import type { FoldJournalStoreInterface } from '@studnicky/dagonizer/contracts';
import { StoreError } from '@studnicky/dagonizer/store';
import { Validator } from '@studnicky/dagonizer/validation';

import { IdbFactory, IdbRequest, type IdbDatabaseLikeInterface, type IdbFactoryLikeInterface } from './IdbFactory.js';

const IDEMPOTENCY_STORE = 'fold_idempotency';
const SEQ_STORE = 'fold_seq';
const COMMIT_STORE = 'fold_commits';
const SEQ_WIDTH = 20;

export type IndexedDbFoldJournalStoreOptionsType = {
  /** IndexedDB database name for the fold journal. Default: 'dagonizer-fold-journal'. */
  readonly databaseName?: string;
};

const INDEXED_DB_FOLD_JOURNAL_DEFAULTS = {
  'databaseName': 'dagonizer-fold-journal',
} as const;

export class IndexedDbFoldJournalStore implements FoldJournalStoreInterface {
  readonly #factory: IdbFactoryLikeInterface;
  readonly #databaseName: string;
  #db: IdbDatabaseLikeInterface | null = null;

  constructor(factory: IdbFactoryLikeInterface, options: IndexedDbFoldJournalStoreOptionsType = {}) {
    this.#factory = factory;
    this.#databaseName = options.databaseName ?? INDEXED_DB_FOLD_JOURNAL_DEFAULTS.databaseName;
  }

  /** Resolve the browser `indexedDB` global from `globalThis` and return a new fold journal store. */
  static open(options: IndexedDbFoldJournalStoreOptionsType = {}): IndexedDbFoldJournalStore {
    const raw = Reflect.get(globalThis, 'indexedDB');
    if (!IdbFactory.is(raw)) {
      throw new StoreError(
        'indexedDB is not available in this environment',
        { 'reason': 'BACKING_ERROR', 'cause': new Error('globalThis.indexedDB is absent or not a factory') },
      );
    }
    return new IndexedDbFoldJournalStore(raw, options);
  }

  async connect(): Promise<void> {
    if (this.#db !== null) return;
    const req = this.#factory.open(this.#databaseName, 1);
    req.onupgradeneeded = (event) => {
      const target = event.target;
      if (target === null) return;
      const upgradeDb = target.result;
      if (!upgradeDb.objectStoreNames.contains(IDEMPOTENCY_STORE)) upgradeDb.createObjectStore(IDEMPOTENCY_STORE);
      if (!upgradeDb.objectStoreNames.contains(SEQ_STORE)) upgradeDb.createObjectStore(SEQ_STORE);
      if (!upgradeDb.objectStoreNames.contains(COMMIT_STORE)) upgradeDb.createObjectStore(COMMIT_STORE);
    };
    this.#db = await IdbRequest.toPromise(req);
  }

  async disconnect(): Promise<void> {
    this.#db?.close();
    this.#db = null;
  }

  /**
   * Atomically persist `commit` for `runIri`. Checks the idempotency record
   * first; a repeated `commitId` resolves without allocating a new sequence
   * or writing a second commit row.
   */
  async append(runIri: string, commit: FoldJournalStoreInterface.CommitType): Promise<void> {
    const db = this.#requireDb();
    await IndexedDbFoldJournalStore.#appendTransaction(db, runIri, commit);
  }

  /** Read committed records for `runIri` in durable append order, structurally validated. */
  async *read(runIri: string): AsyncIterable<FoldJournalStoreInterface.CommitType> {
    const db = this.#requireDb();
    const entries = await IndexedDbFoldJournalStore.#collectCommitEntries(db, IndexedDbFoldJournalStore.#commitPrefix(runIri));
    yield* entries;
  }

  #requireDb(): IdbDatabaseLikeInterface {
    if (this.#db === null) {
      throw new StoreError(
        'IndexedDbFoldJournalStore is not connected; call connect() before any operation',
        { 'reason': 'BACKING_ERROR', 'cause': new Error('fold journal not connected') },
      );
    }
    return this.#db;
  }

  /**
   * Keys encode `runIri` and `commitId`/seq with `encodeURIComponent` before
   * joining with a literal `|` delimiter, so no possible `runIri`/`commitId`
   * content can produce a colliding key across two different (runIri, id)
   * pairs (percent-encoding removes `|` from either segment's value space).
   */
  static #idempotencyKey(runIri: string, commitId: string): string {
    return `${encodeURIComponent(runIri)}|${encodeURIComponent(commitId)}`;
  }
  static #commitPrefix(runIri: string): string { return `${encodeURIComponent(runIri)}|`; }
  static #commitKey(runIri: string, seq: number): string { return `${IndexedDbFoldJournalStore.#commitPrefix(runIri)}${String(seq).padStart(SEQ_WIDTH, '0')}`; }

  static #seqOfKey(key: string, prefix: string): number | undefined {
    if (!key.startsWith(prefix)) return undefined;
    const parsed = Number.parseInt(key.slice(prefix.length), 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  static #decodeCommit(raw: unknown): FoldJournalStoreInterface.CommitType {
    if (typeof raw !== 'string') {
      throw new StoreError(
        'fold journal commit record is not a stored string',
        { 'reason': 'BACKING_ERROR', 'cause': new Error('malformed fold journal commit record') },
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new StoreError(
        'fold journal commit record is not valid JSON',
        { 'reason': 'BACKING_ERROR', 'cause': error instanceof Error ? error : new Error('malformed fold journal commit record') },
      );
    }
    try {
      return Validator.foldJournalCommit.validate(parsed);
    } catch (error) {
      throw new StoreError(
        'fold journal commit record failed structural validation',
        { 'reason': 'BACKING_ERROR', 'cause': error instanceof Error ? error : new Error('malformed fold journal commit record') },
      );
    }
  }

  /**
   * Walk the commit store's cursor synchronously within `onsuccess`
   * callbacks (no `await` between `cursor.continue()` calls), collecting
   * every entry whose key carries `prefix`, then sort by seq.
   */
  static #collectCommitEntries(db: IdbDatabaseLikeInterface, prefix: string): Promise<FoldJournalStoreInterface.CommitType[]> {
    return new Promise((resolve, reject) => {
      const store = db.transaction(COMMIT_STORE, 'readonly').objectStore(COMMIT_STORE);
      const req = store.openCursor();
      const rows: Array<{ seq: number; commit: FoldJournalStoreInterface.CommitType }> = [];
      req.onerror = () => { reject(req.error ?? new Error('IDB cursor failed')); };
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor === null) {
          rows.sort((left, right) => left.seq - right.seq);
          resolve(rows.map((row) => row.commit));
          return;
        }
        const rawKey = cursor.key;
        if (typeof rawKey === 'string' && rawKey.startsWith(prefix)) {
          const seq = IndexedDbFoldJournalStore.#seqOfKey(rawKey, prefix);
          if (seq !== undefined) {
            let commit: FoldJournalStoreInterface.CommitType;
            try {
              commit = IndexedDbFoldJournalStore.#decodeCommit(cursor.value);
            } catch (error) {
              reject(error);
              return;
            }
            rows.push({ seq, commit });
          }
        }
        cursor.continue();
      };
    });
  }

  /**
   * One `readwrite` transaction spanning the idempotency, sequence, and
   * commit object stores: read the idempotency record for `commitId`; if
   * present, stop issuing requests and let the transaction auto-commit;
   * otherwise read the current sequence allocator, then put the commit row,
   * the idempotency row, and the advanced allocator — all chained through
   * `onsuccess` handlers so the transaction never auto-commits between the
   * read and the writes. The returned promise settles only from the
   * transaction's own `oncomplete`/`onerror`/`onabort` — never from a
   * request's `onsuccess` — because a request can succeed while the
   * transaction still aborts before commit.
   */
  static #appendTransaction(db: IdbDatabaseLikeInterface, runIri: string, commit: FoldJournalStoreInterface.CommitType): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([IDEMPOTENCY_STORE, SEQ_STORE, COMMIT_STORE], 'readwrite', { 'durability': 'strict' });
      let settled = false;
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error('IDB fold journal append failed'));
      };

      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      tx.onerror = () => { fail(tx.error); };
      tx.onabort = () => { fail(tx.error ?? new Error('IDB fold journal append transaction aborted')); };

      const idempotencyStore = tx.objectStore(IDEMPOTENCY_STORE);
      const seqStore = tx.objectStore(SEQ_STORE);
      const commitStore = tx.objectStore(COMMIT_STORE);

      const idempotencyKey = IndexedDbFoldJournalStore.#idempotencyKey(runIri, commit.commitId);
      const idempotencyGet = idempotencyStore.get(idempotencyKey);
      idempotencyGet.onerror = () => { fail(idempotencyGet.error); };
      idempotencyGet.onsuccess = () => {
        if (idempotencyGet.result !== undefined) {
          // Duplicate commitId: issue no further requests. The transaction
          // has no pending work and auto-commits; `tx.oncomplete` resolves.
          return;
        }

        const seqGet = seqStore.get(runIri);
        seqGet.onerror = () => { fail(seqGet.error); };
        seqGet.onsuccess = () => {
          const currentSeq = typeof seqGet.result === 'number' ? seqGet.result : 0;
          const nextSeq = currentSeq + 1;

          const commitPut = commitStore.put(JSON.stringify(commit), IndexedDbFoldJournalStore.#commitKey(runIri, nextSeq));
          commitPut.onerror = () => { fail(commitPut.error); };
          commitPut.onsuccess = () => {
            const idempotencyPut = idempotencyStore.put(nextSeq, idempotencyKey);
            idempotencyPut.onerror = () => { fail(idempotencyPut.error); };
            idempotencyPut.onsuccess = () => {
              const seqPut = seqStore.put(nextSeq, runIri);
              seqPut.onerror = () => { fail(seqPut.error); };
              // seqPut.onsuccess intentionally does not settle the promise:
              // only tx.oncomplete may resolve, and only fail()/tx.onerror
              // /tx.onabort may reject.
            };
          };
        };
      };
    });
  }
}
