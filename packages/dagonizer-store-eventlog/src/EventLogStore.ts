/**
 * EventLogStore — append-only event-log implementation of BaseStore.
 *
 * Every `set` appends a `{ kind: 'set' }` event; every `delete` appends a
 * `{ kind: 'delete' }` tombstone. `get` resolves the latest value for a key
 * by scanning the log in reverse — O(n) worst-case, suitable for low-churn
 * key sets typical of DAG state.
 *
 * `snapshot()` compacts the log to a last-write-wins map and returns the
 * current key-value pairs. `restore()` reseeds the log with a single `set`
 * event per entry; it does NOT rewrite any backing file.
 *
 * `log()` returns the full, uncompacted event log as a readonly view.
 * Callers can inspect every historical write and tombstone for auditing.
 *
 * Snapshot type:    'event-log-store'
 * Snapshot version: 1
 */

import { open, type FileHandle } from 'node:fs/promises';

import { BaseStore, type BaseStoreOptions } from '@noocodex/dagonizer/store';
import type { StoreSnapshotEntry } from '@noocodex/dagonizer/contracts';
import type { JsonValue } from '@noocodex/dagonizer/entities';

// ── Discriminated union ───────────────────────────────────────────────────────

/**
 * Append-only log event. Each entry records one write operation.
 *
 * `kind: 'set'`    — `value` carries the new value stored under `key`.
 * `kind: 'delete'` — a tombstone; the key is logically absent after this entry.
 */
export type EventLogEntry =
  | { readonly kind: 'set';    readonly at: number; readonly key: string; readonly value: JsonValue }
  | { readonly kind: 'delete'; readonly at: number; readonly key: string };

// ── Options ───────────────────────────────────────────────────────────────────

export interface EventLogStoreOptions extends BaseStoreOptions {
  /** Optional file path for log persistence. When omitted, the log is in-memory only. */
  readonly filePath?: string;
  /**
   * Fsync after every append. Default true for durability.
   * Set to false for higher throughput where durability is not critical.
   */
  readonly syncOnAppend?: boolean;
}

// ── Implementation ────────────────────────────────────────────────────────────

export class EventLogStore extends BaseStore {
  readonly #log: EventLogEntry[];
  readonly #filePath: string;
  readonly #syncOnAppend: boolean;
  #handle: FileHandle | null;

  constructor(options: EventLogStoreOptions = {}) {
    super({ 'namespace': options.namespace ?? '' });
    this.#log = [];
    this.#filePath = options.filePath ?? '';
    this.#syncOnAppend = options.syncOnAppend ?? true;
    this.#handle = null;
  }

  protected get snapshotType(): string    { return 'event-log-store'; }
  protected get snapshotVersion(): number { return 1; }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Open the log file (if `filePath` was set) and replay existing entries into
   * the in-memory log. Each line of the file is a JSON-serialized `EventLogEntry`.
   * No-op when `filePath` is empty.
   */
  override async connect(): Promise<void> {
    if (this.#filePath === '') return;
    this.#handle = await open(this.#filePath, 'a+');
    const contents = await this.#handle.readFile({ 'encoding': 'utf8' });
    for (const line of contents.split('\n')) {
      if (line === '') continue;
      // JSON parse IS the JSON ingest boundary — file bytes → runtime type.
      const parsed = JSON.parse(line) as EventLogEntry;
      this.#log.push(parsed);
    }
  }

  /** Close the file handle if one was opened. No-op when in-memory. */
  override async disconnect(): Promise<void> {
    if (this.#handle !== null) {
      await this.#handle.close();
      this.#handle = null;
    }
  }

  // ── Atomic RMW override ───────────────────────────────────────────────────

  /**
   * Atomic read-modify-write. Reads `#log` directly via `#latest()` — no
   * `await` before the result is computed — then appends the new value.
   * Under JS single-threaded execution the body cannot interleave with another
   * `update()` on the same instance, satisfying the atomicity contract.
   */
  override async update<T extends JsonValue>(
    key: string,
    fn: (current: T | undefined) => T,
  ): Promise<T> {
    const qualified = this.qualifyKey(key);
    const current   = this.#latest<T>(qualified);
    const next      = fn(current);
    await this.#append({ 'kind': 'set', 'at': Date.now(), 'key': qualified, 'value': next });
    return next;
  }

  // ── Protected perform* hooks ──────────────────────────────────────────────

  protected async performGet<T extends JsonValue>(key: string): Promise<T | undefined> {
    return this.#latest<T>(key);
  }

  protected async performSet<T extends JsonValue>(key: string, value: T): Promise<void> {
    await this.#append({ 'kind': 'set', 'at': Date.now(), 'key': key, 'value': value });
  }

  protected async performHas(key: string): Promise<boolean> {
    for (let i = this.#log.length - 1; i >= 0; i -= 1) {
      const entry = this.#log[i];
      if (entry === undefined || entry.key !== key) continue;
      return entry.kind === 'set';
    }
    return false;
  }

  protected async performDelete(key: string): Promise<boolean> {
    if (!await this.performHas(key)) return false;
    await this.#append({ 'kind': 'delete', 'at': Date.now(), 'key': key });
    return true;
  }

  protected async performSnapshotEntries(): Promise<readonly StoreSnapshotEntry[]> {
    // Compact: project log forward to a last-write-wins map.
    const latest = new Map<string, JsonValue>();
    for (const entry of this.#log) {
      if (entry.kind === 'set') latest.set(entry.key, entry.value);
      else                      latest.delete(entry.key);
    }
    return [...latest.entries()].map(([key, value]) => ({ key, value }));
  }

  protected async performRestoreEntries(entries: readonly StoreSnapshotEntry[]): Promise<void> {
    this.#log.length = 0;
    const at = Date.now();
    for (const { key, value } of entries) {
      this.#log.push({ 'kind': 'set', at, key, value });
    }
    // Restoring does NOT rewrite the backing file. Connect with a fresh
    // filePath to start a new persisted log from the restored state.
  }

  // ── Audit accessor ────────────────────────────────────────────────────────

  /**
   * Returns the full, uncompacted event log as a readonly view.
   * Includes every set event and every tombstone since construction (or last restore).
   * Useful for auditing, debugging, and deriving metrics from write history.
   */
  log(): readonly EventLogEntry[] {
    return this.#log;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Scan the log in reverse; return the most-recent value for `key`, or `undefined`. */
  #latest<T extends JsonValue>(key: string): T | undefined {
    for (let i = this.#log.length - 1; i >= 0; i -= 1) {
      const entry = this.#log[i];
      if (entry === undefined || entry.key !== key) continue;
      if (entry.kind === 'delete') return undefined;
      return entry.value as T;
    }
    return undefined;
  }

  /** Append an event to the in-memory log and, if a file handle is open, persist it. */
  async #append(entry: EventLogEntry): Promise<void> {
    this.#log.push(entry);
    if (this.#handle !== null) {
      await this.#handle.appendFile(JSON.stringify(entry) + '\n');
      if (this.#syncOnAppend) await this.#handle.sync();
    }
  }
}
