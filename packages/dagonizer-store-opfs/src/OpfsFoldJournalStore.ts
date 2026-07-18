import { Semaphore } from '@studnicky/concurrency/semaphore';
import type { FoldJournalStoreInterface } from '@studnicky/dagonizer';
import { StoreError } from '@studnicky/dagonizer/store';
import { Validator } from '@studnicky/dagonizer/validation';

import { OpfsEnv } from './OpfsEnv.js';
import type { DirectoryHandleLikeInterface } from './OpfsHandle.js';

const SEQ_WIDTH = 20;
const COMMIT_SEQ_PATTERN = /\.(\d+)\.json$/u;

/** Per-run recovery state cached after the one-time intact-record scan. */
type RunStateType = { maxSeq: number; commitIds: Set<string> };

type DirectoryStateType = {
  directory: DirectoryHandleLikeInterface;
  runState: Map<string, RunStateType>;
  appendSemaphore: ReturnType<typeof Semaphore.create>;
};

type EntryIdentifiableDirectoryType = DirectoryHandleLikeInterface & {
  isSameEntry(other: DirectoryHandleLikeInterface): Promise<boolean>;
};

const DIRECTORY_STATE_BY_HANDLE = new WeakMap<DirectoryHandleLikeInterface, Promise<DirectoryStateType>>();
const DIRECTORY_STATES: DirectoryStateType[] = [];
const DIRECTORY_IDENTITY_SEMAPHORE = Semaphore.create({ 'permits': 1 });

function hasEntryIdentity(directory: DirectoryHandleLikeInterface): directory is EntryIdentifiableDirectoryType {
  return 'isSameEntry' in directory && typeof directory.isSameEntry === 'function';
}

async function isSameDirectory(left: DirectoryHandleLikeInterface, right: DirectoryHandleLikeInterface): Promise<boolean> {
  if (left === right) return true;
  if (hasEntryIdentity(left)) return left.isSameEntry(right);
  if (hasEntryIdentity(right)) return right.isSameEntry(left);
  return false;
}

function resolveDirectoryState(directory: DirectoryHandleLikeInterface): Promise<DirectoryStateType> {
  const cached = DIRECTORY_STATE_BY_HANDLE.get(directory);
  if (cached !== undefined) return cached;

  const pending = DIRECTORY_IDENTITY_SEMAPHORE.withPermit(async () => {
    for (const state of DIRECTORY_STATES) {
      if (await isSameDirectory(directory, state.directory)) return state;
    }

    const state: DirectoryStateType = {
      'directory': directory,
      'runState': new Map(),
      'appendSemaphore': Semaphore.create({ 'permits': 1 }),
    };
    DIRECTORY_STATES.push(state);
    return state;
  });
  DIRECTORY_STATE_BY_HANDLE.set(directory, pending);
  return pending;
}

/**
 * FoldJournalStore backed directly by OPFS: one immutable file per committed
 * fold batch (so `append` writes a brand-new file and never touches any
 * existing record). The first `append` for a run scans intact files to recover
 * the max sequence and the set of committed IDs; every subsequent `append`
 * for that run is O(1) — a duplicate `commitId` is
 * resolved from the realm-shared cached set without touching the directory,
 * and a new commit writes exactly one new file.
 */
export class OpfsFoldJournalStore implements FoldJournalStoreInterface {
  readonly #directoryState: Promise<DirectoryStateType>;

  constructor(directory: DirectoryHandleLikeInterface) {
    this.#directoryState = resolveDirectoryState(directory);
  }

  /** Resolves the OPFS root, then gets (or creates) a subdirectory named `dirName`. */
  static async rooted(dirName: string): Promise<OpfsFoldJournalStore> {
    const root = await OpfsEnv.rootDirectory();
    const directory = await root.getDirectoryHandle(dirName, { 'create': true });
    return new OpfsFoldJournalStore(directory);
  }

  /**
   * Idempotent by `commitId`. Creates a brand-new per-record file — O(1) once
   * the run's state is recovered. A realm-shared single-permit semaphore per
   * directory prevents adapter instances from racing on sequence assignment.
   */
  async append(runIri: string, commit: FoldJournalStoreInterface.CommitType): Promise<void> {
    const directoryState = await this.#directoryState;
    await directoryState.appendSemaphore.withPermit(async () => {
      const state = await this.#stateOf(directoryState, runIri);
      if (state.commitIds.has(commit.commitId)) return;

      const seq = state.maxSeq + 1;
      const handle = await directoryState.directory.getFileHandle(OpfsFoldJournalStore.#commitFileName(runIri, seq), { 'create': true });
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(commit));
      await writable.close();

      state.maxSeq = seq;
      state.commitIds.add(commit.commitId);
    });
  }

  /** Yields structurally validated intact commits in sequence order; a torn write is skipped, not thrown. */
  async *read(runIri: string): AsyncIterable<FoldJournalStoreInterface.CommitType> {
    const directoryState = await this.#directoryState;
    const records = await this.#scan(directoryState.directory, runIri);
    for (const record of records) yield record.commit;
  }

  /** Recovers (or returns the cached) sequence/commitId state for a run — the one-time scan happens at most once per run. */
  async #stateOf(directoryState: DirectoryStateType, runIri: string): Promise<RunStateType> {
    const cached = directoryState.runState.get(runIri);
    if (cached !== undefined) return cached;

    const records = await this.#scan(directoryState.directory, runIri);
    const state: RunStateType = {
      'maxSeq': records.reduce((max, record) => Math.max(max, record.seq), 0),
      'commitIds': new Set(records.map((record) => record.commit.commitId)),
    };
    directoryState.runState.set(runIri, state);
    return state;
  }

  /** Scans every intact record for a run, sorted by sequence. A shape-invalid intact record throws. */
  async #scan(directory: DirectoryHandleLikeInterface, runIri: string): Promise<{ seq: number; commit: FoldJournalStoreInterface.CommitType }[]> {
    const prefix = OpfsFoldJournalStore.#commitPrefix(runIri);
    const records: { seq: number; commit: FoldJournalStoreInterface.CommitType }[] = [];
    for await (const [name, handle] of directory.entries()) {
      if (!name.startsWith(prefix)) continue;
      const seq = OpfsFoldJournalStore.#seqOfCommitFileName(name);
      if (seq === undefined) continue;
      const file = await handle.getFile();
      const commit = OpfsFoldJournalStore.#decodeCommit(await file.text());
      if (commit !== undefined) records.push({ seq, commit });
    }
    records.sort((left, right) => left.seq - right.seq);
    return records;
  }

  /**
   * The `.` delimiter is left unescaped by `encodeURIComponent`, so a dotted
   * run IRI (e.g. `urn:test:run.extra`) could otherwise produce an encoded
   * form that is itself a dotted-prefix of another run's encoded files.
   * Percent-encoding the delimiter dots too keeps every run's prefix free of
   * literal `.` beyond the fixed `fold.commit.` / trailing-seq delimiters,
   * so no encoded run IRI can ever be a prefix of another's.
   */
  static #commitPrefix(runIri: string): string { return `fold.commit.${encodeURIComponent(runIri).replaceAll('.', '%2E')}.`; }
  static #commitFileName(runIri: string, seq: number): string { return `${OpfsFoldJournalStore.#commitPrefix(runIri)}${String(seq).padStart(SEQ_WIDTH, '0')}.json`; }

  static #seqOfCommitFileName(name: string): number | undefined {
    const match = COMMIT_SEQ_PATTERN.exec(name);
    const digits = match?.[1];
    if (digits === undefined) return undefined;
    const parsed = Number.parseInt(digits, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  /**
   * A torn/truncated file (crash mid-append) is an uncommitted append and is
   * skipped, not thrown — only a `JSON.parse` failure qualifies. A
   * syntactically intact record that fails schema validation throws a
   * `StoreError` (`BACKING_ERROR`), since the record is corrupt/foreign data,
   * not a torn write.
   */
  static #decodeCommit(text: string): FoldJournalStoreInterface.CommitType | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return undefined;
    }
    if (!Validator.foldJournalCommit.is(parsed)) {
      throw new StoreError(
        'OpfsFoldJournalStore: intact record has an invalid fold-journal commit shape',
        { 'reason': 'BACKING_ERROR', 'cause': new Error((Validator.foldJournalCommit.errors(parsed) ?? []).join('; ')) },
      );
    }
    return parsed;
  }
}
