import { DatabaseSync } from 'node:sqlite';

import type { GraphDeltaRecordType, GraphJournalStoreInterface } from '@studnicky/dagonizer';

/** GraphJournalStore backed by a real SQLite append-only delta log plus a compacted snapshot row. */
export class SqliteGraphJournalStore implements GraphJournalStoreInterface {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec('CREATE TABLE IF NOT EXISTS dagonizer_graph_snapshot (run_iri TEXT PRIMARY KEY, nquads TEXT NOT NULL) STRICT');
    this.#db.exec('CREATE TABLE IF NOT EXISTS dagonizer_graph_log (run_iri TEXT NOT NULL, seq INTEGER NOT NULL, additions TEXT NOT NULL, deletions TEXT NOT NULL, PRIMARY KEY (run_iri, seq)) STRICT');
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> { this.#db.close(); }

  /** Single-row insert into the log table — O(1), no snapshot re-materialization. */
  async append(runIri: string, record: GraphDeltaRecordType): Promise<void> {
    this.#db.prepare(
      'INSERT INTO dagonizer_graph_log (run_iri, seq, additions, deletions) VALUES (?, ?, ?, ?)',
    ).run(runIri, record.seq, record.additions, record.deletions);
  }

  async *readSnapshot(runIri: string): AsyncIterable<string> {
    const snapshot = this.readSnapshotText(runIri);
    if (snapshot !== undefined) yield snapshot;
  }

  async *readLog(runIri: string): AsyncIterable<GraphDeltaRecordType> {
    const rows = this.#db.prepare(
      'SELECT seq, additions, deletions FROM dagonizer_graph_log WHERE run_iri = ? ORDER BY seq ASC',
    ).all(runIri);
    for (const row of rows) if (SqliteGraphJournalStore.isDeltaRow(row)) yield { 'seq': row.seq, 'additions': row.additions, 'deletions': row.deletions };
  }

  readSnapshotText(runIri: string): string | undefined {
    const row = this.#db.prepare('SELECT nquads FROM dagonizer_graph_snapshot WHERE run_iri = ?').get(runIri);
    return SqliteGraphJournalStore.isSnapshotRow(row) ? row.nquads : undefined;
  }

  /** Atomically replace the snapshot row and drop every log row with seq <= throughSeq. */
  async compact(runIri: string, snapshot: AsyncIterable<string>, throughSeq: number): Promise<void> {
    const chunks: string[] = [];
    for await (const chunk of snapshot) chunks.push(chunk);
    const nquads = chunks.join('');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#db.prepare(
        'INSERT INTO dagonizer_graph_snapshot (run_iri, nquads) VALUES (?, ?) ON CONFLICT(run_iri) DO UPDATE SET nquads = excluded.nquads',
      ).run(runIri, nquads);
      this.#db.prepare('DELETE FROM dagonizer_graph_log WHERE run_iri = ? AND seq <= ?').run(runIri, throughSeq);
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  private static isSnapshotRow(value: unknown): value is { readonly nquads: string } {
    return value !== null && typeof value === 'object' && 'nquads' in value && typeof value.nquads === 'string';
  }

  private static isDeltaRow(value: unknown): value is { readonly seq: number; readonly additions: string; readonly deletions: string } {
    if (value === null || typeof value !== 'object') return false;
    return 'seq' in value && typeof value.seq === 'number'
      && 'additions' in value && typeof value.additions === 'string'
      && 'deletions' in value && typeof value.deletions === 'string';
  }
}
