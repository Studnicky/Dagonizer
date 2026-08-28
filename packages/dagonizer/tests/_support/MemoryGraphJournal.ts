import type { GraphDeltaRecordType, GraphJournalStoreInterface } from '../../src/contracts/GraphJournalStore.js';

/**
 * In-memory `GraphJournalStoreInterface` test double: a REAL append-delta
 * log (an array of `GraphDeltaRecordType` per run) plus a separately-tracked
 * snapshot base, so `readLog` genuinely replays what was appended and
 * `compact` genuinely drops the compacted prefix — exercising the same
 * snapshot+log reconstruction path a durable backend would.
 */
export class MemoryGraphJournal implements GraphJournalStoreInterface {
  readonly snapshots = new Map<string, string>();
  readonly logs = new Map<string, GraphDeltaRecordType[]>();
  /** When set, every `append` for this exact call count throws — simulates a durable-write failure. */
  failNextAppend = false;
  appendCount = 0;

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async append(runIri: string, record: GraphDeltaRecordType): Promise<void> {
    this.appendCount += 1;
    if (this.failNextAppend) {
      this.failNextAppend = false;
      throw new Error(`Simulated journal append failure for '${runIri}' seq ${String(record.seq)}`);
    }
    const log = this.logs.get(runIri) ?? [];
    log.push(record);
    this.logs.set(runIri, log);
  }

  async *readSnapshot(runIri: string): AsyncIterable<string> {
    const snapshot = this.snapshots.get(runIri);
    if (snapshot !== undefined) yield snapshot;
  }

  async *readLog(runIri: string): AsyncIterable<GraphDeltaRecordType> {
    yield* this.logs.get(runIri) ?? [];
  }

  async compact(runIri: string, snapshot: AsyncIterable<string>, throughSeq: number): Promise<void> {
    const chunks: string[] = [];
    for await (const chunk of snapshot) chunks.push(chunk);
    this.snapshots.set(runIri, chunks.join(''));
    const log = this.logs.get(runIri) ?? [];
    this.logs.set(runIri, log.filter((record) => record.seq > throughSeq));
  }
}
