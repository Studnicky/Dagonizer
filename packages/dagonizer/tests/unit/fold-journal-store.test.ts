import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FoldJournalStoreInterface } from '../../src/contracts/FoldJournalStoreInterface.js';
import { Validator } from '../../src/validation/Validator.js';
import { MemoryFoldJournalStore } from '../_support/MemoryFoldJournalStore.js';

const commit = (commitId: string, index: number): FoldJournalStoreInterface.CommitType => ({
  commitId,
  'scatterIri': 'urn:noocodec:dag:test/node/scatter',
  'completed': false,
  'progress': {
    'mode': 'bounded',
    'placementName': 'urn:noocodec:dag:test/node/scatter',
    'inbox': [],
    'watermark': index + 1,
    'aheadAcked': [],
    'outcomeTally': { 'success': index + 1 },
  },
  'entries': [{
    'gatherKey': 'urn:noocodec:dag:test/node/gather/execution/root',
    'record': {
      'source': 'urn:noocodec:dag:test/node/scatter',
      index,
      'output': 'success',
      'terminalOutcome': 'completed',
      'contribution': { 'value': index },
    },
  }],
});

const readAll = async (store: FoldJournalStoreInterface, runIri: string): Promise<FoldJournalStoreInterface.CommitType[]> => {
  const commits: FoldJournalStoreInterface.CommitType[] = [];
  for await (const entry of store.read(runIri)) commits.push(entry);
  return commits;
};

void describe('MemoryFoldJournalStore', () => {
  void it('uses one canonical commit schema at storage boundaries', () => {
    assert.equal(Validator.foldJournalCommit.is(commit('batch-0', 0)), true);
    assert.equal(Validator.foldJournalCommit.is({
      ...commit('batch-0', 0),
      'entries': [{
        ...commit('batch-0', 0).entries[0],
        'record': {
          ...commit('batch-0', 0).entries[0]?.record,
          'index': null,
        },
      }],
    }), false);
  });

  void it('treats a repeated commitId as one durable append', async () => {
    const store = new MemoryFoldJournalStore();
    await store.append('urn:run:a', commit('batch-0', 0));
    await store.append('urn:run:a', commit('batch-0', 0));

    assert.deepStrictEqual((await readAll(store, 'urn:run:a')).map((entry) => entry.commitId), ['batch-0']);
  });

  void it('reads commits in append order without exposing stored references', async () => {
    const store = new MemoryFoldJournalStore();
    const first = commit('batch-0', 0);
    await store.append('urn:run:a', first);
    await store.append('urn:run:a', commit('batch-1', 1));

    const read = await readAll(store, 'urn:run:a');
    assert.deepStrictEqual(read.map((entry) => entry.commitId), ['batch-0', 'batch-1']);
    assert.notStrictEqual(read[0], first);
    assert.notStrictEqual(read[0]?.entries, first.entries);
  });

  void it('isolates commits by run IRI', async () => {
    const store = new MemoryFoldJournalStore();
    await store.append('urn:run:a', commit('batch-a', 0));
    await store.append('urn:run:b', commit('batch-b', 0));

    assert.deepStrictEqual((await readAll(store, 'urn:run:a')).map((entry) => entry.commitId), ['batch-a']);
    assert.deepStrictEqual((await readAll(store, 'urn:run:b')).map((entry) => entry.commitId), ['batch-b']);
  });
});
