/**
 * Unit tests for OpfsFoldJournalStore.
 *
 * Uses the shared in-memory DirectoryHandleLikeInterface double from
 * `tests/_support/MemDirectory.ts`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FoldJournalStoreInterface } from '@studnicky/dagonizer';

import { OpfsFoldJournalStore } from '../../src/OpfsFoldJournalStore.js';
import { MemDirectory } from '../_support/MemDirectory.js';

function commitOf(commitId: string, index: number): FoldJournalStoreInterface.CommitType {
  return {
    'commitId': commitId,
    'scatterIri': 'urn:test:scatter',
    'completed': false,
    'progress': {
      'mode': 'bounded',
      'placementName': 'scatter-1',
      'inbox': [],
      'watermark': index,
      'aheadAcked': [],
      'outcomeTally': {},
    },
    'entries': [
      {
        'gatherKey': 'gather-1',
        'record': {
          'source': 'scatter-1',
          'index': index,
          'output': 'completed',
          'terminalOutcome': 'completed',
          'contribution': { 'value': index },
        },
      },
    ],
  };
}

async function readAll(store: OpfsFoldJournalStore, runIri: string): Promise<FoldJournalStoreInterface.CommitType[]> {
  const commits: FoldJournalStoreInterface.CommitType[] = [];
  for await (const commit of store.read(runIri)) commits.push(commit);
  return commits;
}

void describe('OpfsFoldJournalStore', () => {
  void it('reads committed records back in append order', async () => {
    const directory = new MemDirectory();
    const store = new OpfsFoldJournalStore(directory);

    await store.append('urn:test:run', commitOf('commit-1', 0));
    await store.append('urn:test:run', commitOf('commit-2', 1));
    await store.append('urn:test:run', commitOf('commit-3', 2));

    const commits = await readAll(store, 'urn:test:run');
    assert.deepEqual(commits.map((commit) => commit.commitId), ['commit-1', 'commit-2', 'commit-3']);
  });

  void it('treats a repeated commitId as an idempotent success and does not duplicate the record', async () => {
    const directory = new MemDirectory();
    const store = new OpfsFoldJournalStore(directory);

    await store.append('urn:test:run', commitOf('commit-1', 0));
    await store.append('urn:test:run', commitOf('commit-1', 0));
    await store.append('urn:test:run', commitOf('commit-2', 1));

    const commits = await readAll(store, 'urn:test:run');
    assert.deepEqual(commits.map((commit) => commit.commitId), ['commit-1', 'commit-2']);
  });

  void it('isolates commits by run IRI', async () => {
    const directory = new MemDirectory();
    const store = new OpfsFoldJournalStore(directory);

    await store.append('urn:test:run-a', commitOf('commit-a1', 0));
    await store.append('urn:test:run-b', commitOf('commit-b1', 0));
    await store.append('urn:test:run-a', commitOf('commit-a2', 1));

    const runA = await readAll(store, 'urn:test:run-a');
    const runB = await readAll(store, 'urn:test:run-b');
    assert.deepEqual(runA.map((commit) => commit.commitId), ['commit-a1', 'commit-a2']);
    assert.deepEqual(runB.map((commit) => commit.commitId), ['commit-b1']);
  });

  void it('recovers max sequence and committed IDs on restart: a fresh store instance continues idempotency and ordering', async () => {
    const directory = new MemDirectory();
    const first = new OpfsFoldJournalStore(directory);
    await first.append('urn:test:run', commitOf('commit-1', 0));
    await first.append('urn:test:run', commitOf('commit-2', 1));

    const restarted = new OpfsFoldJournalStore(directory);
    await restarted.append('urn:test:run', commitOf('commit-2', 1));
    await restarted.append('urn:test:run', commitOf('commit-3', 2));

    const commits = await readAll(restarted, 'urn:test:run');
    assert.deepEqual(commits.map((commit) => commit.commitId), ['commit-1', 'commit-2', 'commit-3']);
  });

  void it('tolerates a torn commit file: read() skips it without throwing', async () => {
    const directory = new MemDirectory();
    const store = new OpfsFoldJournalStore(directory);
    await store.append('urn:test:run', commitOf('commit-1', 0));

    const tornHandle = await directory.getFileHandle('fold.commit.urn%3Atest%3Arun.00000000000000000099.json', { 'create': true });
    const tornWritable = await tornHandle.createWritable();
    await tornWritable.write('{"commitId":"commit-99","scatterIri":"urn:test');
    await tornWritable.close();

    const commits = await readAll(store, 'urn:test:run');
    assert.deepEqual(commits.map((commit) => commit.commitId), ['commit-1']);
  });

  void it('throws on read() when an intact record has an invalid contract shape', async () => {
    const directory = new MemDirectory();
    const store = new OpfsFoldJournalStore(directory);

    const badHandle = await directory.getFileHandle('fold.commit.urn%3Atest%3Arun.00000000000000000001.json', { 'create': true });
    const badWritable = await badHandle.createWritable();
    await badWritable.write(JSON.stringify({ 'commitId': 'commit-bad', 'notACommit': true }));
    await badWritable.close();

    await assert.rejects(async () => { await readAll(store, 'urn:test:run'); });
  });

  void it('serializes concurrent appends for the same run: no dropped or colliding commits', async () => {
    const directory = new MemDirectory();
    const store = new OpfsFoldJournalStore(directory);

    const commitIds = Array.from({ 'length': 8 }, (_unused, index) => `concurrent-${index}`);
    await Promise.all(commitIds.map((commitId, index) => store.append('urn:test:concurrent-run', commitOf(commitId, index))));

    const commits = await readAll(store, 'urn:test:concurrent-run');
    assert.equal(commits.length, commitIds.length);
    assert.deepEqual(new Set(commits.map((commit) => commit.commitId)), new Set(commitIds));

    // A repeat concurrent append against the same commitIds is idempotent and does not corrupt state.
    await Promise.all(commitIds.map((commitId, index) => store.append('urn:test:concurrent-run', commitOf(commitId, index))));
    const commitsAfterRepeat = await readAll(store, 'urn:test:concurrent-run');
    assert.equal(commitsAfterRepeat.length, commitIds.length);
    assert.deepEqual(new Set(commitsAfterRepeat.map((commit) => commit.commitId)), new Set(commitIds));
  });

  void it('new writes stay O(1) after initialization: append after a completed scan does not rescan the directory', async () => {
    const directory = new MemDirectory();
    const store = new OpfsFoldJournalStore(directory);
    await store.append('urn:test:run', commitOf('commit-1', 0));
    await readAll(store, 'urn:test:run');

    let entriesCalls = 0;
    const originalEntries = directory.entries.bind(directory);
    directory.entries = () => {
      entriesCalls++;
      return originalEntries();
    };

    await store.append('urn:test:run', commitOf('commit-2', 1));
    assert.equal(entriesCalls, 0);
  });
});
