import type { GraphDeltaRecordType, GraphJournalStoreInterface } from '@studnicky/dagonizer';

import { OpfsEnv } from './OpfsEnv.js';
import type { DirectoryHandleLikeInterface } from './OpfsHandle.js';

const SEQ_WIDTH = 20;
const LOG_SEQ_PATTERN = /\.(\d+)\.json$/u;
const SNAPSHOT_SEQ_PATTERN = /\.(\d+)\.nq$/u;

/** One versioned snapshot file's decoded content. */
type SnapshotRecordType = { readonly seq: number; readonly nquads: string };

/**
 * GraphJournalStore backed directly by OPFS: one file per appended delta
 * (so `append` writes a brand-new file and never touches any existing
 * record), plus one seq-versioned snapshot file per run.
 *
 * The `DirectoryHandleLikeInterface` contract exposes no move/rename, so
 * crash-atomicity is achieved without in-place overwrite: `compact` writes
 * a brand-new versioned snapshot file (never overwriting the current one)
 * and only deletes the superseded files afterward. `readSnapshot` picks the
 * highest-seq snapshot whose content is intact, falling back to the next
 * one down if the highest was torn by a crash mid-compact. Replaying
 * left-over delta records whose seq falls at or below the chosen
 * snapshot's throughSeq is safe because `PersistentGraphDataset` replay is
 * idempotent (quad addition is existence-checked, pattern deletion of an
 * absent quad is a no-op).
 */
export class OpfsGraphJournalStore implements GraphJournalStoreInterface {
  readonly #directory: DirectoryHandleLikeInterface;

  constructor(directory: DirectoryHandleLikeInterface) { this.#directory = directory; }

  /** Resolves the OPFS root, then gets (or creates) a subdirectory named `dirName`. */
  static async rooted(dirName: string): Promise<OpfsGraphJournalStore> {
    const root = await OpfsEnv.rootDirectory();
    const directory = await root.getDirectoryHandle(dirName, { 'create': true });
    return new OpfsGraphJournalStore(directory);
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  /** Creates a brand-new per-record file — O(1), never rewrites the snapshot or any other delta. */
  async append(runIri: string, record: GraphDeltaRecordType): Promise<void> {
    const handle = await this.#directory.getFileHandle(OpfsGraphJournalStore.#logFileName(runIri, record.seq), { 'create': true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(record));
    await writable.close();
  }

  async *readSnapshot(runIri: string): AsyncIterable<string> {
    const record = await this.#latestIntactSnapshot(runIri);
    if (record === undefined) return;
    yield record.nquads;
  }

  async *readLog(runIri: string): AsyncIterable<GraphDeltaRecordType> {
    const prefix = OpfsGraphJournalStore.#logPrefix(runIri);
    const records: GraphDeltaRecordType[] = [];
    for await (const [name, handle] of this.#directory.entries()) {
      if (!name.startsWith(prefix)) continue;
      const file = await handle.getFile();
      const parsed = OpfsGraphJournalStore.#decodeRecord(await file.text());
      if (parsed !== undefined) records.push(parsed);
    }
    records.sort((left, right) => left.seq - right.seq);
    yield* records;
  }

  /**
   * Writes a brand-new versioned snapshot file (never overwrites the current
   * one), then removes superseded snapshot files (lower throughSeq) and
   * delta files with seq <= throughSeq. A crash before the new snapshot
   * file is fully written leaves the previous versioned snapshot — and
   * every not-yet-deleted delta file — intact.
   */
  async compact(runIri: string, snapshot: AsyncIterable<string>, throughSeq: number): Promise<void> {
    const chunks: string[] = [];
    for await (const chunk of snapshot) chunks.push(chunk);
    const record: SnapshotRecordType = { 'seq': throughSeq, 'nquads': chunks.join('') };
    const snapshotHandle = await this.#directory.getFileHandle(OpfsGraphJournalStore.#snapshotFileName(runIri, throughSeq), { 'create': true });
    const writable = await snapshotHandle.createWritable();
    await writable.write(JSON.stringify(record));
    await writable.close();

    const snapshotPrefix = OpfsGraphJournalStore.#snapshotPrefix(runIri);
    const logPrefix = OpfsGraphJournalStore.#logPrefix(runIri);
    const stale: string[] = [];
    for await (const [name] of this.#directory.entries()) {
      if (name.startsWith(snapshotPrefix)) {
        const seq = OpfsGraphJournalStore.#seqOfSnapshotFileName(name);
        if (seq !== undefined && seq < throughSeq) stale.push(name);
        continue;
      }
      if (name.startsWith(logPrefix)) {
        const seq = OpfsGraphJournalStore.#seqOfLogFileName(name);
        if (seq !== undefined && seq <= throughSeq) stale.push(name);
      }
    }
    for (const name of stale) await this.#directory.removeEntry(name);
  }

  /** Highest-seq snapshot file whose content parses intact, falling back down the seq order on a torn file. */
  async #latestIntactSnapshot(runIri: string): Promise<SnapshotRecordType | undefined> {
    const prefix = OpfsGraphJournalStore.#snapshotPrefix(runIri);
    const candidates: { readonly seq: number; readonly name: string }[] = [];
    for await (const [name] of this.#directory.entries()) {
      if (!name.startsWith(prefix)) continue;
      const seq = OpfsGraphJournalStore.#seqOfSnapshotFileName(name);
      if (seq !== undefined) candidates.push({ seq, name });
    }
    candidates.sort((left, right) => right.seq - left.seq);

    for (const candidate of candidates) {
      const handle = await OpfsGraphJournalStore.#tryGetFileHandle(this.#directory, candidate.name);
      if (handle === undefined) continue;
      const file = await handle.getFile();
      const decoded = OpfsGraphJournalStore.#decodeSnapshot(await file.text());
      if (decoded !== undefined) return decoded;
    }
    return undefined;
  }

  static #logPrefix(runIri: string): string { return `graph.log.${encodeURIComponent(runIri)}.`; }
  static #logFileName(runIri: string, seq: number): string { return `${OpfsGraphJournalStore.#logPrefix(runIri)}${String(seq).padStart(SEQ_WIDTH, '0')}.json`; }
  static #snapshotPrefix(runIri: string): string { return `graph.snapshot.${encodeURIComponent(runIri)}.`; }
  static #snapshotFileName(runIri: string, throughSeq: number): string { return `${OpfsGraphJournalStore.#snapshotPrefix(runIri)}${String(throughSeq).padStart(SEQ_WIDTH, '0')}.nq`; }

  static #seqOfLogFileName(name: string): number | undefined { return OpfsGraphJournalStore.#seqOfPattern(LOG_SEQ_PATTERN, name); }
  static #seqOfSnapshotFileName(name: string): number | undefined { return OpfsGraphJournalStore.#seqOfPattern(SNAPSHOT_SEQ_PATTERN, name); }

  static #seqOfPattern(pattern: RegExp, name: string): number | undefined {
    const match = pattern.exec(name);
    const digits = match?.[1];
    if (digits === undefined) return undefined;
    const parsed = Number.parseInt(digits, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  static #isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  static #isDeltaRecord(value: unknown): value is GraphDeltaRecordType {
    if (!OpfsGraphJournalStore.#isObject(value)) return false;
    return typeof value['seq'] === 'number' && typeof value['additions'] === 'string' && typeof value['deletions'] === 'string';
  }

  static #isSnapshotRecord(value: unknown): value is SnapshotRecordType {
    if (!OpfsGraphJournalStore.#isObject(value)) return false;
    return typeof value['seq'] === 'number' && typeof value['nquads'] === 'string';
  }

  /** Tolerant decode: a torn/partial delta file (crash mid-append) is an uncommitted append — dropped, not thrown. */
  static #decodeRecord(text: string): GraphDeltaRecordType | undefined {
    try {
      const parsed: unknown = JSON.parse(text);
      return OpfsGraphJournalStore.#isDeltaRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  /** Tolerant decode: a torn/partial snapshot file (crash mid-compact) is treated as absent, not thrown. */
  static #decodeSnapshot(text: string): SnapshotRecordType | undefined {
    try {
      const parsed: unknown = JSON.parse(text);
      return OpfsGraphJournalStore.#isSnapshotRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  static async #tryGetFileHandle(directory: DirectoryHandleLikeInterface, name: string): Promise<Awaited<ReturnType<DirectoryHandleLikeInterface['getFileHandle']>> | undefined> {
    try {
      return await directory.getFileHandle(name);
    } catch (error) {
      if (error instanceof Error && error.name === 'NotFoundError') return undefined;
      throw error;
    }
  }
}
