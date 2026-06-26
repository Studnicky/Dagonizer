/**
 * EventLogStore: Node file-persistence layer over AppendLogStore.
 *
 * Extends the isomorphic `AppendLogStore` with optional file persistence.
 * When `filePath` is set, `connect()` dynamically imports `node:fs/promises`
 * (never a top-level import) and opens the log file for append + read.
 * Existing entries are replayed into the in-memory log. Each subsequent
 * write is appended to the file and optionally fsynced.
 *
 * In-memory-only usage (no `filePath`) is identical to `AppendLogStore` and
 * works in any JS environment. File persistence requires Node.js >= 24.
 *
 * `log()` returns the full, uncompacted event log as a readonly view.
 * `events()` streams the append log as an `AsyncIterable<EventLogEntryType>`.
 *
 * Snapshot type:    'event-log-store'
 * Snapshot version: 1
 */

import type { JsonValueType } from '@studnicky/dagonizer/entities';
import { BASE_STORE_DEFAULTS } from '@studnicky/dagonizer/store';

import { AppendLogStore, EventLogEntryValidator, type AppendLogStoreOptionsType, type EventLogEntryType } from './AppendLogStore.js';

// ── Types for the dynamically-imported node:fs/promises FileHandle ───────────

/** Minimal subset of `node:fs/promises` `FileHandle` used by this module. */
interface FileHandleContractInterface {
  readFile(options: { encoding: 'utf8' }): Promise<string>;
  appendFile(data: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** Minimal subset of the `node:fs/promises` module surface used here. */
interface FsPromisesContractInterface {
  open(path: string, flags: string): Promise<FileHandleContractInterface>;
}

/**
 * Structural guard for the dynamically-imported `node:fs/promises` module.
 * Narrows `unknown → FsPromisesContractInterface` by checking the `open`
 * member is a callable. Zero `as` casts: `isObject` narrows to
 * `Record<string, unknown>` first; the function-type check uses that narrowed
 * type directly.
 */
class FsPromises {
  private constructor() { /* static class */ }

  private static isObject(x: unknown): x is Record<string, unknown> {
    return typeof x === 'object' && x !== null;
  }

  static is(x: unknown): x is FsPromisesContractInterface {
    if (!FsPromises.isObject(x)) return false;
    return typeof x['open'] === 'function';
  }
}

// ── Options ───────────────────────────────────────────────────────────────────

export type EventLogStoreOptionsType = AppendLogStoreOptionsType & {
  /** Optional file path for log persistence. When omitted, the log is in-memory only. */
  readonly filePath?: string;
  /**
   * Fsync after every append. Default true for durability.
   * Set to false for higher throughput where durability is not critical.
   */
  readonly syncOnAppend?: boolean;
};

// ── Implementation ────────────────────────────────────────────────────────────

export class EventLogStore extends AppendLogStore {
  readonly #filePath: string;
  readonly #syncOnAppend: boolean;
  #handle: FileHandleContractInterface | null;

  constructor(options: EventLogStoreOptionsType = BASE_STORE_DEFAULTS) {
    super(options);
    this.#filePath = options.filePath ?? '';
    this.#syncOnAppend = options.syncOnAppend ?? true;
    this.#handle = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Open the log file (if `filePath` was set) and replay existing entries into
   * the in-memory log. Each line of the file is a JSON-serialized `EventLogEntry`.
   * Each line is validated against `EventLogEntryValidator`; malformed or
   * structurally incompatible lines throw a `StoreError(INCOMPATIBLE_SNAPSHOT)`.
   * No-op when `filePath` is empty.
   *
   * `node:fs/promises` is imported dynamically here — never at the top level —
   * so the in-memory path pulls zero `node:*` into the static module graph.
   */
  override async connect(): Promise<void> {
    if (this.#filePath === '') return;
    if (this.#handle !== null) return;

    // Dynamic import keeps node:fs/promises out of the static module graph.
    // Narrow via structural guard — no `as` cast needed.
    const imported: unknown = await import('node:fs/promises');
    if (!FsPromises.is(imported)) {
      throw new Error('node:fs/promises did not expose an `open` function — unexpected environment');
    }
    this.#handle = await imported.open(this.#filePath, 'a+');

    const contents = await this.#handle.readFile({ 'encoding': 'utf8' });
    for (const line of contents.split('\n')) {
      if (line === '') continue;
      // JSON parse is the ingest boundary: file bytes → unknown → validated type.
      const parsed: unknown = JSON.parse(line);
      const entry = EventLogEntryValidator.validate(parsed);
      // Replay via the parent's in-memory-only append (no file side-effect).
      await this.replayEntry(entry);
    }
  }

  /** Close the file handle if one was opened. No-op when in-memory. */
  override async disconnect(): Promise<void> {
    if (this.#handle !== null) {
      await this.#handle.close();
      this.#handle = null;
    }
  }

  // ── Append override ───────────────────────────────────────────────────────

  /**
   * Appends the entry to the in-memory log (via super) and, if a file handle
   * is open, persists it to the log file.
   */
  protected override async appendEntry(entry: EventLogEntryType): Promise<void> {
    await super.appendEntry(entry);
    if (this.#handle !== null) {
      await this.#handle.appendFile(JSON.stringify(entry) + '\n');
      if (this.#syncOnAppend) await this.#handle.sync();
    }
  }

  // ── Atomic RMW override ───────────────────────────────────────────────────

  /**
   * Atomic read-modify-write. Reads the log directly via `latest()`, with no
   * `await` before the result is computed, then appends the new value.
   * Under JS single-threaded execution the body cannot interleave with another
   * `update()` on the same instance, satisfying the atomicity contract.
   */
  override async update(
    key: string,
    fn: (current: JsonValueType | undefined) => JsonValueType,
  ): Promise<JsonValueType> {
    const qualified = this.qualifyKey(key);
    const stored    = this.latest(qualified);
    const current   = stored === undefined ? undefined : stored;
    const next      = fn(current);
    await this.appendEntry({ 'variant': 'set', 'at': Date.now(), 'key': qualified, 'value': next });
    return next;
  }

  // ── Replay helper ─────────────────────────────────────────────────────────

  /**
   * Replay a raw log entry into the in-memory log during `connect()` without
   * triggering a file write. Both 'set' and 'delete' variants are replayed
   * faithfully via the parent class's in-memory-only append path.
   */
  private async replayEntry(entry: EventLogEntryType): Promise<void> {
    await super.appendEntry(entry);
  }
}
