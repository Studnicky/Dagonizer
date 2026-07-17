import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FoldJournalStoreInterface } from '@studnicky/dagonizer/contracts';
import { StoreError } from '@studnicky/dagonizer/store';
import { IDBFactory } from 'fake-indexeddb';

import type { IdbFactoryLikeInterface } from '../../src/IdbFactory.js';
import { IndexedDbFoldJournalStore } from '../../src/IndexedDbFoldJournalStore.js';

function commit(commitId: string, watermark: number): FoldJournalStoreInterface.CommitType {
  return {
    'commitId': commitId,
    'scatterIri': 'urn:test:scatter',
    'completed': false,
    'progress': {
      'mode': 'bounded',
      'placementName': 'scatter-one',
      'inbox': [],
      'watermark': watermark,
      'aheadAcked': [],
      'outcomeTally': {},
    },
    'entries': [
      {
        'gatherKey': 'gather-one',
        'record': {
          'source': 'scatter-one',
          'index': watermark,
          'output': 'completed',
          'terminalOutcome': 'completed',
          'contribution': { 'value': watermark },
        },
      },
    ],
  };
}

async function storeOnFactory(factory: IdbFactoryLikeInterface): Promise<IndexedDbFoldJournalStore> {
  const store = new IndexedDbFoldJournalStore(factory);
  await store.connect();
  return store;
}

async function readAll(store: IndexedDbFoldJournalStore, runIri: string): Promise<FoldJournalStoreInterface.CommitType[]> {
  const results: FoldJournalStoreInterface.CommitType[] = [];
  for await (const commitEntry of store.read(runIri)) results.push(commitEntry);
  return results;
}

void describe('IndexedDbFoldJournalStore', () => {
  void it('append() persists commits and read() yields them in append order', async () => {
    const store = await storeOnFactory(new IDBFactory());
    await store.append('urn:test:run-order', commit('commit-1', 0));
    await store.append('urn:test:run-order', commit('commit-2', 1));
    await store.append('urn:test:run-order', commit('commit-3', 2));

    const results = await readAll(store, 'urn:test:run-order');
    assert.deepEqual(results.map((entry) => entry.commitId), ['commit-1', 'commit-2', 'commit-3']);
    await store.disconnect();
  });

  void it('append() treats a repeated commitId as an idempotent success without a duplicate row', async () => {
    const store = await storeOnFactory(new IDBFactory());
    await store.append('urn:test:run-idempotent', commit('commit-1', 0));
    await store.append('urn:test:run-idempotent', commit('commit-1', 0));
    await store.append('urn:test:run-idempotent', commit('commit-2', 1));

    const results = await readAll(store, 'urn:test:run-idempotent');
    assert.deepEqual(results.map((entry) => entry.commitId), ['commit-1', 'commit-2']);
    await store.disconnect();
  });

  void it('isolates commits by run IRI', async () => {
    const store = await storeOnFactory(new IDBFactory());
    await store.append('urn:test:run-a', commit('commit-a1', 0));
    await store.append('urn:test:run-b', commit('commit-b1', 0));
    await store.append('urn:test:run-a', commit('commit-a2', 1));

    const runA = await readAll(store, 'urn:test:run-a');
    const runB = await readAll(store, 'urn:test:run-b');
    assert.deepEqual(runA.map((entry) => entry.commitId), ['commit-a1', 'commit-a2']);
    assert.deepEqual(runB.map((entry) => entry.commitId), ['commit-b1']);
    await store.disconnect();
  });

  void it('restart through a fresh instance on the same factory/database reads the durable log', async () => {
    const factory = new IDBFactory();
    const store = await storeOnFactory(factory);
    await store.append('urn:test:run-restart', commit('commit-1', 0));
    await store.append('urn:test:run-restart', commit('commit-2', 1));
    await store.disconnect();

    const restarted = await storeOnFactory(factory);
    const results = await readAll(restarted, 'urn:test:run-restart');
    assert.deepEqual(results.map((entry) => entry.commitId), ['commit-1', 'commit-2']);

    // Idempotency and sequence allocation must also survive the restart.
    await restarted.append('urn:test:run-restart', commit('commit-2', 1));
    await restarted.append('urn:test:run-restart', commit('commit-3', 2));
    const afterRestart = await readAll(restarted, 'urn:test:run-restart');
    assert.deepEqual(afterRestart.map((entry) => entry.commitId), ['commit-1', 'commit-2', 'commit-3']);
    await restarted.disconnect();
  });

  void it('throws StoreError when a stored commit record fails structural validation', async () => {
    // Write through the real store, then poison the durable row in-place
    // (same transaction, same connection — no cross-connection IDB commit
    // timing to race) to simulate on-disk corruption, then verify read()
    // rejects with StoreError.
    const factory = new IDBFactory();
    const store = await storeOnFactory(factory);
    await store.append('urn:test:run-malformed', commit('commit-1', 0));

    await new Promise<void>((resolve, reject) => {
      const req = factory.open('dagonizer-fold-journal', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('fold_commits', 'readwrite');
        const os = tx.objectStore('fold_commits');
        const poisonedKey = `${encodeURIComponent('urn:test:run-malformed')}|00000000000000000001`;
        const put = os.put(JSON.stringify({ 'garbage': true }), poisonedKey);
        put.onerror = () => { reject(put.error ?? new Error('poison put failed')); };
        put.onsuccess = () => {
          const verify = os.get(poisonedKey);
          verify.onerror = () => { reject(verify.error ?? new Error('poison verify failed')); };
          verify.onsuccess = () => { resolve(); };
        };
      };
      req.onerror = () => { reject(req.error ?? new Error('poison open failed')); };
    });

    await assert.rejects(
      async () => { for await (const _entry of store.read('urn:test:run-malformed')) { /* drain */ } },
      StoreError,
    );
    await store.disconnect();
  });

  void it('append() only resolves once the write is durably committed, visible to a brand-new store instance on the same factory', async () => {
    const factory = new IDBFactory();
    const store = await storeOnFactory(factory);
    await store.append('urn:test:run-durable', commit('commit-1', 0));

    // No disconnect() on `store` — a second, independent store instance
    // opened on the same factory must already see the committed row,
    // proving append() did not resolve before the transaction committed.
    const second = await storeOnFactory(factory);
    const results = await readAll(second, 'urn:test:run-durable');
    assert.deepEqual(results.map((entry) => entry.commitId), ['commit-1']);

    await store.disconnect();
    await second.disconnect();
  });

  void it('throws StoreError when a stored commit record is not valid JSON', async () => {
    const factory = new IDBFactory();
    const store = await storeOnFactory(factory);
    await store.append('urn:test:run-badjson', commit('commit-1', 0));

    await new Promise<void>((resolve, reject) => {
      const req = factory.open('dagonizer-fold-journal', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('fold_commits', 'readwrite');
        const os = tx.objectStore('fold_commits');
        const poisonedKey = `${encodeURIComponent('urn:test:run-badjson')}|00000000000000000001`;
        const put = os.put('not-valid-json{{{', poisonedKey);
        put.onerror = () => { reject(put.error ?? new Error('poison put failed')); };
        put.onsuccess = () => { resolve(); };
      };
      req.onerror = () => { reject(req.error ?? new Error('poison open failed')); };
    });

    await assert.rejects(
      async () => { for await (const _entry of store.read('urn:test:run-badjson')) { /* drain */ } },
      StoreError,
    );
    await store.disconnect();
  });

  void it('throws StoreError when operations run before connect()', async () => {
    const store = new IndexedDbFoldJournalStore(new IDBFactory());
    await assert.rejects(
      async () => store.append('urn:test:run-unconnected', commit('commit-1', 0)),
      StoreError,
    );
  });
});
