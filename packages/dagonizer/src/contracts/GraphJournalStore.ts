/** One committed append-log entry for a run's graph journal. */
export type GraphDeltaRecordType = {
  /** Monotonic sequence number per `runIri`, starting at 1. */
  readonly seq: number;
  /** Added quads, skolemized, encoded as N-Quads. */
  readonly additions: string;
  /** Removed quads, skolemized, encoded as N-Quads. */
  readonly deletions: string;
};

/** Async durability sink for a synchronous RDF graph working set, as a real append-delta log. */
export interface GraphJournalStoreInterface {
  connect(): Promise<void>;
  /** Append one delta atomically at `record.seq`. */
  append(runIri: string, record: GraphDeltaRecordType): Promise<void>;
  /** Compacted snapshot base as N-Quads lines (may be empty). */
  readSnapshot(runIri: string): AsyncIterable<string>;
  /** Delta records with seq strictly greater than the snapshot base, in ascending seq order. */
  readLog(runIri: string): AsyncIterable<GraphDeltaRecordType>;
  /** Atomically replace the snapshot with `snapshot` and drop log records with seq <= throughSeq. */
  compact(runIri: string, snapshot: AsyncIterable<string>, throughSeq: number): Promise<void>;
  disconnect(): Promise<void>;
}
