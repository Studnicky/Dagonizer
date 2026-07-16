import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DagGraphTerms, PersistentGraphDataset } from '@studnicky/dagonizer';
import { IDBFactory } from 'fake-indexeddb';

import type { IdbFactoryLikeInterface } from '../../src/IdbFactory.js';
import { IndexedDbGraphDatasetProvider } from '../../src/IndexedDbGraphDatasetProvider.js';
import { IndexedDbGraphJournalStore } from '../../src/IndexedDbGraphJournalStore.js';

/** Fresh journal-backed provider on its own IDBFactory. */
async function providerOnFactory(factory: IdbFactoryLikeInterface): Promise<IndexedDbGraphDatasetProvider> {
  const journal = new IndexedDbGraphJournalStore(factory);
  await journal.connect();
  return new IndexedDbGraphDatasetProvider(journal);
}

void describe('IndexedDbGraphDatasetProvider: RDF 1.2 durability', () => {
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
