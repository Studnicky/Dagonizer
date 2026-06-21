/**
 * EventLogStore: append-only event-log implementation of BaseStore.
 *
 * Every `set` appends a `{ variant: 'set' }` event; every `delete` appends a
 * `{ variant: 'delete' }` tombstone. `get` resolves the latest value for a key
 * by scanning the log in reverse (O(n) worst-case), suitable for low-churn
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

import type { StoreSnapshotEntryType } from '@studnicky/dagonizer/contracts';
import type { JsonValueType } from '@studnicky/dagonizer/entities';
import { BASE_STORE_DEFAULTS, BaseStore, StoreError, type BaseStoreOptionsType } from '@studnicky/dagonizer/store';
import type { EntityValidatorInterface } from '@studnicky/dagonizer/validation';

// ── Schema ────────────────────────────────────────────────────────────────────

/**
 * JSON Schema 2020-12 for EventLogEntry wire shape.
 * Runtime validator narrows deserialized log lines to this schema before use.
 */
export const EventLogEntrySchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer-store-eventlog/EventLogEntry',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'oneOf': [
    {
      'type': 'object',
      'required': ['variant', 'at', 'key', 'value'],
      'properties': {
        'variant':  { 'type': 'string', 'const': 'set' },
        'at':    { 'type': 'number' },
        'key':   { 'type': 'string' },
        'value': {},
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['variant', 'at', 'key'],
      'properties': {
        'variant': { 'type': 'string', 'const': 'delete' },
        'at':   { 'type': 'number' },
        'key':  { 'type': 'string' },
      },
      'additionalProperties': false,
    },
  ],
} as const;

// ── Discriminated union ───────────────────────────────────────────────────────

/**
 * Append-only log event. Each entry records one write operation.
 *
 * `variant: 'set'`: `value` carries the new value stored under `key`.
 * `variant: 'delete'`: a tombstone; the key is logically absent after this entry.
 *
 * The compile-time type is hand-written rather than derived from
 * `EventLogEntrySchema` via `FromSchema` because `JsonValueType` is a recursive
 * union that JSON Schema's `{}` (any value) maps to `unknown` in
 * `json-schema-to-ts`. `EventLogEntrySchema` governs runtime validation;
 * this type governs compile-time usage — both are required to be structurally
 * consistent and are kept co-located.
 */
export type EventLogEntryType =
  | { readonly variant: 'set';    readonly at: number; readonly key: string; readonly value: JsonValueType }
  | { readonly variant: 'delete'; readonly at: number; readonly key: string };

// ── Local validator ───────────────────────────────────────────────────────────

/**
 * Structural validator for `EventLogEntry` at the file-read JSON ingest
 * boundary. Compiled once at module load; no external runtime dependency.
 *
 * Performs the minimum structural check the discriminated union requires:
 *   - `variant` is `'set'` or `'delete'`
 *   - `at` is a number
 *   - `key` is a string
 *   - `value` is present on `set` entries
 * `additionalProperties` on the stored objects are NOT rejected — the schema
 * allows forward-compat reads. Malformed/missing required fields throw.
 */
const EventLogEntryValidator: EntityValidatorInterface<EventLogEntryType> = {
  is(value): value is EventLogEntryType {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    if (!('at' in value) || typeof value.at !== 'number') return false;
    if (!('key' in value) || typeof value.key !== 'string') return false;
    if (!('variant' in value)) return false;
    if (value.variant === 'set') return 'value' in value;
    if (value.variant === 'delete') return true;
    return false;
  },
  validate(value): EventLogEntryType {
    if (EventLogEntryValidator.is(value)) return value;
    throw new StoreError(
      `invalid EventLogEntry: ${JSON.stringify(value)}`,
      {
        'reason':          'INCOMPATIBLE_SNAPSHOT',
        'expectedType':    'event-log-store',
        'actualType':      'unknown',
        'expectedVersion': 1,
        'actualVersion':   0,
      },
    );
  },
  errors(value): string[] | null {
    if (EventLogEntryValidator.is(value)) return null;
    return [`invalid EventLogEntry shape: variant must be 'set' or 'delete', at must be number, key must be string`];
  },
};

// ── Options ───────────────────────────────────────────────────────────────────

export type EventLogStoreOptionsType = BaseStoreOptionsType & {
  /** Optional file path for log persistence. When omitted, the log is in-memory only. */
  readonly filePath?: string;
  /**
   * Fsync after every append. Default true for durability.
   * Set to false for higher throughput where durability is not critical.
   */
  readonly syncOnAppend?: boolean;
};

// ── Implementation ────────────────────────────────────────────────────────────

export class EventLogStore extends BaseStore {
  readonly #log: EventLogEntryType[];
  readonly #filePath: string;
  readonly #syncOnAppend: boolean;
  #handle: FileHandle | null;

  constructor(options: EventLogStoreOptionsType = BASE_STORE_DEFAULTS) {
    super(options);
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
   * Each line is validated against `EventLogEntrySchema`; malformed or
   * structurally incompatible lines throw a `StoreError(INCOMPATIBLE_SNAPSHOT)`.
   * No-op when `filePath` is empty.
   */
  override async connect(): Promise<void> {
    if (this.#filePath === '') return;
    if (this.#handle !== null) return;
    this.#handle = await open(this.#filePath, 'a+');
    const contents = await this.#handle.readFile({ 'encoding': 'utf8' });
    for (const line of contents.split('\n')) {
      if (line === '') continue;
      // JSON parse is the ingest boundary: file bytes → unknown → validated type.
      const parsed: unknown = JSON.parse(line);
      const entry = EventLogEntryValidator.validate(parsed);
      this.#log.push(entry);
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
   * Atomic read-modify-write. Reads `#log` directly via `#latest()`, with no
   * `await` before the result is computed, then appends the new value.
   * Under JS single-threaded execution the body cannot interleave with another
   * `update()` on the same instance, satisfying the atomicity contract.
   */
  override async update<T extends JsonValueType>(
    key: string,
    fn: (current: T | undefined) => T,
  ): Promise<T> {
    const qualified = this.qualifyKey(key);
    const stored    = this.#latest(qualified);
    const current   = stored === undefined ? undefined : this.narrowStored<T>(stored) ?? undefined;
    const next      = fn(current);
    await this.#append({ 'variant': 'set', 'at': Date.now(), 'key': qualified, 'value': next });
    return next;
  }

  // ── Protected perform* hooks ──────────────────────────────────────────────

  protected async performGet(key: string): Promise<JsonValueType | null> {
    return this.#latest(key) ?? null;
  }

  protected async performSet(key: string, value: JsonValueType): Promise<void> {
    await this.#append({ 'variant': 'set', 'at': Date.now(), 'key': key, 'value': value });
  }

  protected async performHas(key: string): Promise<boolean> {
    return this.#latest(key) !== undefined;
  }

  protected async performDelete(key: string): Promise<boolean> {
    if (!await this.performHas(key)) return false;
    await this.#append({ 'variant': 'delete', 'at': Date.now(), 'key': key });
    return true;
  }

  protected async performSnapshotEntries(): Promise<readonly StoreSnapshotEntryType[]> {
    // Compact: project log forward to a last-write-wins map.
    const latest = new Map<string, JsonValueType>();
    for (const entry of this.#log) {
      if (entry.variant === 'set') latest.set(entry.key, entry.value);
      else                        latest.delete(entry.key);
    }
    return [...latest.entries()].map(([key, value]) => ({ key, value }));
  }

  protected async performRestoreEntries(entries: readonly StoreSnapshotEntryType[]): Promise<void> {
    this.#log.length = 0;
    const at = Date.now();
    for (const { key, value } of entries) {
      this.#log.push({ 'variant': 'set', at, key, value });
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
  log(): readonly EventLogEntryType[] {
    return this.#log;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Scan the log in reverse; return the most-recent value for `key`, or
   * `undefined`. Returns the honest stored type (`JsonValueType | undefined`);
   * callers that expect a narrower `T` apply the boundary cast at their own
   * seam (see `performGet`). `undefined` is the "key absent / tombstoned"
   * sentinel and is part of the contract.
   */
  #latest(key: string): JsonValueType | undefined {
    for (let i = this.#log.length - 1; i >= 0; i -= 1) {
      const entry = this.#log[i];
      if (entry === undefined || entry.key !== key) continue;
      if (entry.variant === 'delete') return undefined;
      return entry.value;
    }
    return undefined;
  }

  /** Append an event to the in-memory log and, if a file handle is open, persist it. */
  async #append(entry: EventLogEntryType): Promise<void> {
    this.#log.push(entry);
    if (this.#handle !== null) {
      await this.#handle.appendFile(JSON.stringify(entry) + '\n');
      if (this.#syncOnAppend) await this.#handle.sync();
    }
  }
}
