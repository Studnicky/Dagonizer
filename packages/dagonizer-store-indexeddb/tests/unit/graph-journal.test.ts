import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DagGraphTerms, PersistentGraphDataset } from '@studnicky/dagonizer';
import { IDBFactory } from 'fake-indexeddb';

import type {
  IdbDatabaseLikeInterface,
  IdbCursorLikeInterface,
  IdbFactoryLikeInterface,
  IdbObjectStoreLikeInterface,
  IdbOpenRequestLikeType,
  IdbRequestLikeType,
  IdbTransactionLikeInterface,
} from '../../src/IdbFactory.js';
import { IndexedDbGraphDatasetProvider } from '../../src/IndexedDbGraphDatasetProvider.js';
import { IndexedDbGraphJournalStore } from '../../src/IndexedDbGraphJournalStore.js';

/** Fault-injection boundary that aborts the first readwrite transaction after its first put succeeds. */
class AbortOnPutFactory implements IdbFactoryLikeInterface {
  readonly #factory: IdbFactoryLikeInterface;
  #abortNextWrite = true;

  constructor(factory: IdbFactoryLikeInterface) {
    this.#factory = factory;
  }

  open(name: string, version?: number): IdbOpenRequestLikeType {
    return new AbortOnPutOpenRequest(this.#factory.open(name, version), this);
  }

  transaction(
    database: IdbDatabaseLikeInterface,
    names: string | string[],
    mode: 'readonly' | 'readwrite',
    options: { durability?: 'strict' } | undefined,
  ): IdbTransactionLikeInterface {
    const abortOnPut = mode === 'readwrite' && this.#abortNextWrite;
    if (abortOnPut) this.#abortNextWrite = false;
    return new AbortOnPutTransaction(database.transaction(names, mode, options), abortOnPut);
  }
}

/** Open-request adapter that returns database wrappers while preserving the structural IndexedDB boundary. */
class AbortOnPutOpenRequest implements IdbOpenRequestLikeType {
  readonly #source: IdbOpenRequestLikeType;
  readonly #factory: AbortOnPutFactory;
  #database: AbortOnPutDatabase | null = null;
  #onsuccess: (() => void) | null = null;
  #onerror: (() => void) | null = null;
  #onupgradeneeded: ((event: { target: IdbOpenRequestLikeType | null }) => void) | null = null;

  constructor(source: IdbOpenRequestLikeType, factory: AbortOnPutFactory) {
    this.#source = source;
    this.#factory = factory;
    this.#source.onsuccess = () => { this.#onsuccess?.(); };
    this.#source.onerror = () => { this.#onerror?.(); };
    this.#source.onupgradeneeded = () => { this.#onupgradeneeded?.({ 'target': this }); };
  }

  get result(): IdbDatabaseLikeInterface {
    if (this.#database === null) this.#database = new AbortOnPutDatabase(this.#source.result, this.#factory);
    return this.#database;
  }

  get error(): unknown { return this.#source.error; }
  get onsuccess(): (() => void) | null { return this.#onsuccess; }
  set onsuccess(handler: (() => void) | null) { this.#onsuccess = handler; }
  get onerror(): (() => void) | null { return this.#onerror; }
  set onerror(handler: (() => void) | null) { this.#onerror = handler; }
  get onupgradeneeded(): ((event: { target: IdbOpenRequestLikeType | null }) => void) | null { return this.#onupgradeneeded; }
  set onupgradeneeded(handler: ((event: { target: IdbOpenRequestLikeType | null }) => void) | null) { this.#onupgradeneeded = handler; }
}

/** Database adapter that routes transactions through the fault-injection factory. */
class AbortOnPutDatabase implements IdbDatabaseLikeInterface {
  readonly #source: IdbDatabaseLikeInterface;
  readonly #factory: AbortOnPutFactory;

  constructor(source: IdbDatabaseLikeInterface, factory: AbortOnPutFactory) {
    this.#source = source;
    this.#factory = factory;
  }

  get objectStoreNames(): { contains(name: string): boolean } { return this.#source.objectStoreNames; }
  'createObjectStore'(name: string): unknown { return this.#source.createObjectStore(name); }
  close(): void { this.#source.close(); }

  transaction(
    names: string | string[],
    mode: 'readonly' | 'readwrite',
    options?: { durability?: 'strict' },
  ): IdbTransactionLikeInterface {
    return this.#factory.transaction(this.#source, names, mode, options);
  }
}

/** Transaction adapter that preserves completion events and aborts a configured put before commit. */
class AbortOnPutTransaction implements IdbTransactionLikeInterface {
  readonly #source: IdbTransactionLikeInterface & { abort(): void };
  #abortPending: boolean;
  #oncomplete: (() => void) | null = null;
  #onerror: (() => void) | null = null;
  #onabort: (() => void) | null = null;

  constructor(source: IdbTransactionLikeInterface, abortPending: boolean) {
    if (!AbortOnPutTransaction.isAbortable(source)) throw new Error('fault-injection transaction does not support abort()');
    this.#source = source;
    this.#abortPending = abortPending;
    this.#source.oncomplete = () => { this.#oncomplete?.(); };
    this.#source.onerror = () => { this.#onerror?.(); };
    this.#source.onabort = () => { this.#onabort?.(); };
  }

  get error(): unknown { return this.#source.error; }
  get oncomplete(): (() => void) | null { return this.#oncomplete; }
  set oncomplete(handler: (() => void) | null) { this.#oncomplete = handler; }
  get onerror(): (() => void) | null { return this.#onerror; }
  set onerror(handler: (() => void) | null) { this.#onerror = handler; }
  get onabort(): (() => void) | null { return this.#onabort; }
  set onabort(handler: (() => void) | null) { this.#onabort = handler; }

  objectStore(name: string): IdbObjectStoreLikeInterface {
    return new AbortOnPutObjectStore(this.#source.objectStore(name), this);
  }

  abortOnPut(): boolean {
    if (!this.#abortPending) return false;
    this.#abortPending = false;
    return true;
  }

  abort(): void { this.#source.abort(); }

  static isAbortable(transaction: IdbTransactionLikeInterface): transaction is IdbTransactionLikeInterface & { abort(): void } {
    return typeof Reflect.get(transaction, 'abort') === 'function';
  }
}

/** Object-store adapter that triggers the transaction abort after the put request succeeds. */
class AbortOnPutObjectStore implements IdbObjectStoreLikeInterface {
  readonly #source: IdbObjectStoreLikeInterface;
  readonly #transaction: AbortOnPutTransaction;

  constructor(source: IdbObjectStoreLikeInterface, transaction: AbortOnPutTransaction) {
    this.#source = source;
    this.#transaction = transaction;
  }

  get(key: string): IdbRequestLikeType<unknown> { return this.#source.get(key); }
  delete(key: string): IdbRequestLikeType<unknown> { return this.#source.delete(key); }
  count(key: string): IdbRequestLikeType<number> { return this.#source.count(key); }
  clear(): IdbRequestLikeType<unknown> { return this.#source.clear(); }
  openCursor(): IdbRequestLikeType<IdbCursorLikeInterface | null> { return this.#source.openCursor(); }

  put(value: unknown, key: string): IdbRequestLikeType<unknown> {
    const request = this.#source.put(value, key);
    return this.#transaction.abortOnPut()
      ? new AbortOnPutRequest(request, () => { this.#transaction.abort(); })
      : request;
  }
}

/** Request adapter that relays callbacks before aborting the enclosing transaction. */
class AbortOnPutRequest<T> implements IdbRequestLikeType<T> {
  readonly #source: IdbRequestLikeType<T>;
  readonly #afterSuccess: () => void;
  #onsuccess: (() => void) | null = null;
  #onerror: (() => void) | null = null;

  constructor(source: IdbRequestLikeType<T>, afterSuccess: () => void) {
    this.#source = source;
    this.#afterSuccess = afterSuccess;
    this.#source.onsuccess = () => {
      this.#onsuccess?.();
      this.#afterSuccess();
    };
    this.#source.onerror = () => { this.#onerror?.(); };
  }

  get result(): T { return this.#source.result; }
  get error(): unknown { return this.#source.error; }
  get onsuccess(): (() => void) | null { return this.#onsuccess; }
  set onsuccess(handler: (() => void) | null) { this.#onsuccess = handler; }
  get onerror(): (() => void) | null { return this.#onerror; }
  set onerror(handler: (() => void) | null) { this.#onerror = handler; }
}

/** Fresh journal-backed provider on its own IDBFactory. */
async function providerOnFactory(factory: IdbFactoryLikeInterface): Promise<IndexedDbGraphDatasetProvider> {
  const journal = new IndexedDbGraphJournalStore(factory);
  await journal.connect();
  return new IndexedDbGraphDatasetProvider(journal);
}

async function durableChildProviderOnFactory(factory: IdbFactoryLikeInterface): Promise<IndexedDbGraphDatasetProvider> {
  const journal = new IndexedDbGraphJournalStore(factory);
  await journal.connect();
  return new IndexedDbGraphDatasetProvider(journal, { 'durableChildren': true });
}

void describe('IndexedDbGraphDatasetProvider: RDF 1.2 durability', () => {
  void it('keeps root identity stable and children volatile by default', async () => {
    const provider = await providerOnFactory(new IDBFactory());
    const root = provider.root('urn:test:stable-run');
    assert.equal(provider.root('urn:test:stable-run'), root);
    const child = provider.child(
      { 'runIri': 'urn:test:stable-run', 'dagIri': 'urn:test:dag', 'placementIri': 'urn:test:placement' },
      { 'runIri': 'urn:test:stable-run/child', 'dagIri': 'urn:test:dag', 'placementIri': 'urn:test:child' },
    );
    assert.equal(child instanceof PersistentGraphDataset, false);
    assert.equal(child.count({}), 0);
    await provider.disconnect();
  });

  void it('allows durable children as an explicit provider policy', async () => {
    const provider = await durableChildProviderOnFactory(new IDBFactory());
    const child = provider.child(
      { 'runIri': 'urn:test:parent', 'dagIri': 'urn:test:dag', 'placementIri': 'urn:test:placement' },
      { 'runIri': 'urn:test:child', 'dagIri': 'urn:test:dag', 'placementIri': 'urn:test:child-placement' },
    );
    assert.equal(child instanceof PersistentGraphDataset, true);
    await provider.disconnect();
  });

  void it('reopens a graph containing a triple term', async () => {
    const factory = new IDBFactory();
    const quoted = DagGraphTerms.quadTerm({
      'subject': DagGraphTerms.namedNode('urn:test:quoted-s'),
      'predicate': DagGraphTerms.namedNode('urn:test:quoted-p'),
      'object': DagGraphTerms.literal('quoted-o'),
      'graph': DagGraphTerms.defaultGraph(),
    });
    const quad = {
      'subject': DagGraphTerms.namedNode('urn:test:s'),
      'predicate': DagGraphTerms.namedNode('urn:test:p'),
      'object': quoted,
      'graph': DagGraphTerms.defaultGraph(),
    };

    const provider = await providerOnFactory(factory);
    const rootDataset = provider.root('urn:test:run');
    rootDataset.add([quad]);
    assert.ok(rootDataset instanceof PersistentGraphDataset);
    await rootDataset.flush();

    const reopenedProvider = await providerOnFactory(factory);
    const reopened = await reopenedProvider.reopen('urn:test:run');
    assert.ok(reopened);
    assert.equal(reopened.match({ 'object': quoted }).next().done, false);
    await reopenedProvider.disconnect();
  });

  void it('flush-before-close: provider.disconnect() flushes a minted dataset before a fresh provider reopens it', async () => {
    const factory = new IDBFactory();
    const subject = DagGraphTerms.namedNode('urn:test:flush-subject');
    const predicate = DagGraphTerms.namedNode('urn:test:flush-predicate');

    const provider = await providerOnFactory(factory);
    const rootDataset = provider.root('urn:test:flush-run');
    rootDataset.assert(subject, predicate, DagGraphTerms.literal('durable'));
    assert.ok(rootDataset instanceof PersistentGraphDataset);
    // No explicit flush() here — disconnect() alone must flush the pending write-behind journal write.
    await provider.disconnect();

    const restarted = await providerOnFactory(factory);
    const reopened = await restarted.reopen('urn:test:flush-run');
    assert.ok(reopened);
    assert.equal(reopened.count({ 'subject': subject }), 1);
    await restarted.disconnect();
  });

  void it('reopens from durable storage after a simulated restart via readSnapshot+readLog', async () => {
    const factory = new IDBFactory();
    const subject = DagGraphTerms.namedNode('urn:test:restart-subject');
    const predicate = DagGraphTerms.namedNode('urn:test:restart-predicate');

    const provider = await providerOnFactory(factory);
    const rootDataset = provider.root('urn:test:restart-run');
    rootDataset.assert(subject, predicate, DagGraphTerms.literal('one'));
    rootDataset.assert(subject, predicate, DagGraphTerms.literal('two'));
    assert.ok(rootDataset instanceof PersistentGraphDataset);
    await rootDataset.flush();
    await provider.disconnect();

    // A fresh provider on the SAME factory/database simulates a process
    // restart: no in-memory dataset map, so reopen() must reconstruct
    // purely from the durable readSnapshot()/readLog() log.
    const restarted = await providerOnFactory(factory);
    const reopened = await restarted.reopen('urn:test:restart-run');
    assert.ok(reopened);
    assert.equal(reopened.count({ 'subject': subject }), 2);
    await restarted.disconnect();
  });

  void it('rejects an aborted append and reopens without a partial delta record', async () => {
    const factory = new AbortOnPutFactory(new IDBFactory());
    const journal = new IndexedDbGraphJournalStore(factory);
    await journal.connect();

    await assert.rejects(journal.append('urn:test:aborted-run', {
      'seq': 1,
      'additions': '<urn:test:aborted-subject> <urn:test:aborted-predicate> "incomplete" .\n',
      'deletions': '',
    }));
    await journal.disconnect();

    const reopened = new IndexedDbGraphJournalStore(factory);
    await reopened.connect();
    const records = [];
    for await (const record of reopened.readLog('urn:test:aborted-run')) records.push(record);
    assert.equal(records.length, 0);
    await reopened.disconnect();
  });

  void it('blank-node add-then-delete survives an N-Quads reopen round-trip with 0 quads left', async () => {
    const factory = new IDBFactory();
    const blank = { 'termType': 'BlankNode' as const, 'value': 'b0' };
    const predicate = DagGraphTerms.namedNode('urn:test:blank-predicate');
    const object = DagGraphTerms.literal('blank-object');

    const provider = await providerOnFactory(factory);
    const rootDataset = provider.root('urn:test:blank-run');
    rootDataset.assert(blank, predicate, object);
    assert.ok(rootDataset instanceof PersistentGraphDataset);
    await rootDataset.flush();
    rootDataset.delete({ 'subject': blank, predicate, object });
    await rootDataset.flush();
    await provider.disconnect();

    const restarted = await providerOnFactory(factory);
    const reopened = await restarted.reopen('urn:test:blank-run');
    assert.ok(reopened);
    assert.equal(reopened.count({}), 0);
    await restarted.disconnect();
  });

  void it('compaction survives a restart: readSnapshot alone reflects the compacted state', async () => {
    const factory = new IDBFactory();
    const predicate = DagGraphTerms.namedNode('urn:test:compact-predicate');

    const provider = await providerOnFactory(factory);
    const rootDataset = provider.root('urn:test:compact-run');
    rootDataset.assert(DagGraphTerms.namedNode('urn:test:compact-s1'), predicate, DagGraphTerms.literal('one'));
    rootDataset.assert(DagGraphTerms.namedNode('urn:test:compact-s2'), predicate, DagGraphTerms.literal('two'));
    assert.ok(rootDataset instanceof PersistentGraphDataset);
    await rootDataset.flush();
    await rootDataset.compact();
    await provider.disconnect();

    const restarted = await providerOnFactory(factory);
    const reopened = await restarted.reopen('urn:test:compact-run');
    assert.ok(reopened);
    assert.equal(reopened.count({}), 2);
    await restarted.disconnect();
  });
});
