import { DatabaseSync } from 'node:sqlite';

import type { FoldJournalStoreInterface } from '@studnicky/dagonizer';
import { StoreError } from '@studnicky/dagonizer/store';
import { Validator } from '@studnicky/dagonizer/validation';

type StoredRowType = { readonly seq: number; readonly commit_id: string; readonly payload: string };

/** FoldJournalStore backed by a real SQLite append-only commit log. */
export class SqliteFoldJournalStore implements FoldJournalStoreInterface {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(
      'CREATE TABLE IF NOT EXISTS dagonizer_fold_journal ('
        + 'seq INTEGER PRIMARY KEY AUTOINCREMENT, '
        + 'run_iri TEXT NOT NULL, '
        + 'commit_id TEXT NOT NULL, '
        + 'payload TEXT NOT NULL, '
        + 'UNIQUE(run_iri, commit_id)'
        + ') STRICT',
    );
  }

  async disconnect(): Promise<void> { this.#db.close(); }

  /** Single-row insert; idempotency for a duplicate (run_iri, commit_id) is a no-op via the UNIQUE constraint. */
  async append(runIri: string, commit: FoldJournalStoreInterface.CommitType): Promise<void> {
    this.#db.prepare(
      'INSERT OR IGNORE INTO dagonizer_fold_journal (run_iri, commit_id, payload) VALUES (?, ?, ?)',
    ).run(runIri, commit.commitId, JSON.stringify(commit));
  }

  async *read(runIri: string): AsyncIterable<FoldJournalStoreInterface.CommitType> {
    const rows = this.#db.prepare(
      'SELECT seq, commit_id, payload FROM dagonizer_fold_journal WHERE run_iri = ? ORDER BY seq ASC',
    ).all(runIri);
    for (const row of rows) {
      if (!SqliteFoldJournalStore.isStoredRow(row)) {
        throw new StoreError(
          `Malformed fold journal row for run "${runIri}": expected { seq, commit_id, payload }.`,
          { 'reason': 'BACKING_ERROR', 'cause': new Error('fold journal row shape mismatch') },
        );
      }
      yield SqliteFoldJournalStore.decodeCommit(runIri, row.commit_id, row.payload);
    }
  }

  private static decodeCommit(runIri: string, commitId: string, payload: string): FoldJournalStoreInterface.CommitType {
    let decoded: unknown;
    try {
      decoded = JSON.parse(payload);
    } catch (cause) {
      throw new StoreError(
        `Malformed fold journal payload for run "${runIri}" commit "${commitId}": invalid JSON.`,
        { 'reason': 'BACKING_ERROR', 'cause': cause instanceof Error ? cause : new Error(String(cause)) },
      );
    }
    let commit: FoldJournalStoreInterface.CommitType;
    try {
      commit = Validator.foldJournalCommit.validate(decoded);
    } catch (cause) {
      throw new StoreError(
        `Malformed fold journal payload for run "${runIri}" commit "${commitId}": does not match FoldJournalStoreInterface.CommitType.`,
        { 'reason': 'BACKING_ERROR', 'cause': cause instanceof Error ? cause : new Error(String(cause)) },
      );
    }
    if (commit.commitId !== commitId) {
      throw new StoreError(
        `Malformed fold journal row for run "${runIri}": row key commit "${commitId}" does not match payload commitId "${commit.commitId}".`,
        { 'reason': 'BACKING_ERROR', 'cause': new Error('fold journal commit_id mismatch') },
      );
    }
    return commit;
  }

  private static isStoredRow(value: unknown): value is StoredRowType {
    if (value === null || typeof value !== 'object') return false;
    return 'seq' in value && typeof value.seq === 'number'
      && 'commit_id' in value && typeof value.commit_id === 'string'
      && 'payload' in value && typeof value.payload === 'string';
  }
}
