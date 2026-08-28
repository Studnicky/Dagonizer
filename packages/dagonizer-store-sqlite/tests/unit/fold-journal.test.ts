import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import type { FoldJournalStoreInterface } from '@studnicky/dagonizer';

import { SqliteFoldJournalStore } from '../../src/SqliteFoldJournalStore.js';

const RUN_IRI = 'https://noocodec.dev/runs/fold-journal-test';

function makeCommit(commitId: string, watermark: number): FoldJournalStoreInterface.CommitType {
  return {
    'commitId': commitId,
    'scatterIri': 'https://noocodec.dev/dags/example#scatter',
    'completed': false,
    'progress': {
      'mode': 'bounded',
      'placementName': 'scatter',
      'inbox': [],
      'watermark': watermark,
      'aheadAcked': [],
      'outcomeTally': { 'completed': watermark + 1 },
    },
    'entries': [
      {
        'gatherKey': 'gather-one',
        'record': {
          'index': watermark,
          'source': 'scatter',
          'output': 'default',
          'terminalOutcome': 'completed',
          'contribution': { 'value': watermark },
        },
      },
    ],
  };
}

void describe('SqliteFoldJournalStore', () => {
  void it('reads commits back in append order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dagonizer-fold-journal-'));
    const path = join(dir, 'journal.sqlite');
    const store = new SqliteFoldJournalStore(path);
    try {
      await store.append(RUN_IRI, makeCommit('commit-0', 0));
      await store.append(RUN_IRI, makeCommit('commit-1', 1));
      await store.append(RUN_IRI, makeCommit('commit-2', 2));

      const commits: FoldJournalStoreInterface.CommitType[] = [];
      for await (const commit of store.read(RUN_IRI)) commits.push(commit);

      assert.deepEqual(commits.map((commit) => commit.commitId), ['commit-0', 'commit-1', 'commit-2']);
    } finally {
      await store.disconnect();
      rmSync(dir, { 'recursive': true, 'force': true });
    }
  });

  void it('treats a duplicate commitId for the same run as an idempotent no-op', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dagonizer-fold-journal-'));
    const path = join(dir, 'journal.sqlite');
    const store = new SqliteFoldJournalStore(path);
    try {
      await store.append(RUN_IRI, makeCommit('commit-0', 0));
      await store.append(RUN_IRI, makeCommit('commit-0', 999));

      const commits: FoldJournalStoreInterface.CommitType[] = [];
      for await (const commit of store.read(RUN_IRI)) commits.push(commit);

      assert.equal(commits.length, 1);
      assert.equal(commits[0]?.progress.mode === 'bounded' ? commits[0].progress.watermark : -1, 0);
    } finally {
      await store.disconnect();
      rmSync(dir, { 'recursive': true, 'force': true });
    }
  });

  void it('isolates commits by run IRI', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dagonizer-fold-journal-'));
    const path = join(dir, 'journal.sqlite');
    const otherRunIri = 'https://noocodec.dev/runs/fold-journal-test-other';
    const store = new SqliteFoldJournalStore(path);
    try {
      await store.append(RUN_IRI, makeCommit('commit-0', 0));
      await store.append(otherRunIri, makeCommit('commit-0', 5));

      const commits: FoldJournalStoreInterface.CommitType[] = [];
      for await (const commit of store.read(RUN_IRI)) commits.push(commit);
      const otherCommits: FoldJournalStoreInterface.CommitType[] = [];
      for await (const commit of store.read(otherRunIri)) otherCommits.push(commit);

      assert.equal(commits.length, 1);
      assert.equal(otherCommits.length, 1);
      assert.equal(commits[0]?.progress.mode === 'bounded' ? commits[0].progress.watermark : -1, 0);
      assert.equal(otherCommits[0]?.progress.mode === 'bounded' ? otherCommits[0].progress.watermark : -1, 5);
    } finally {
      await store.disconnect();
      rmSync(dir, { 'recursive': true, 'force': true });
    }
  });

  void it('survives a restart through a fresh store on the same file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dagonizer-fold-journal-'));
    const path = join(dir, 'journal.sqlite');
    const first = new SqliteFoldJournalStore(path);
    let firstDisconnected = false;
    let second: SqliteFoldJournalStore | undefined;
    try {
      await first.append(RUN_IRI, makeCommit('commit-0', 0));
      await first.append(RUN_IRI, makeCommit('commit-1', 1));
      await first.disconnect();
      firstDisconnected = true;

      second = new SqliteFoldJournalStore(path);
      const commits: FoldJournalStoreInterface.CommitType[] = [];
      for await (const commit of second.read(RUN_IRI)) commits.push(commit);

      assert.deepEqual(commits.map((commit) => commit.commitId), ['commit-0', 'commit-1']);
    } finally {
      if (!firstDisconnected) await first.disconnect();
      await second?.disconnect();
      rmSync(dir, { 'recursive': true, 'force': true });
    }
  });

  void it('surfaces a corrupted payload row as a StoreError on read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dagonizer-fold-journal-'));
    const path = join(dir, 'journal.sqlite');
    const store = new SqliteFoldJournalStore(path);
    try {
      await store.append(RUN_IRI, makeCommit('commit-0', 0));

      const raw = new DatabaseSync(path);
      try {
        raw.prepare(
          'INSERT INTO dagonizer_fold_journal (run_iri, commit_id, payload) VALUES (?, ?, ?)',
        ).run(RUN_IRI, 'commit-corrupt', JSON.stringify({ 'notACommit': true }));
      } finally {
        raw.close();
      }

      await assert.rejects(async () => {
        const commits: FoldJournalStoreInterface.CommitType[] = [];
        for await (const commit of store.read(RUN_IRI)) commits.push(commit);
      }, { 'name': 'StoreError' });
    } finally {
      await store.disconnect();
      rmSync(dir, { 'recursive': true, 'force': true });
    }
  });
});
