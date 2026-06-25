/**
 * AppendLogStore: isomorphic in-memory append-log core.
 *
 * Browser-safe: imports zero `node:*` modules. Every `set` appends a
 * `{ variant: 'set' }` event; every `delete` appends a
 * `{ variant: 'delete' }` tombstone. `get` resolves the latest value for a key
 * by scanning the log in reverse (O(n) worst-case), suitable for low-churn
 * key sets typical of DAG state.
 *
 * `snapshot()` compacts the log to a last-write-wins map and returns the
 * current key-value pairs. `restore()` reseeds the log with a single `set`
 * event per entry.
 *
 * `log()` returns the full, uncompacted event log as a readonly view.
 * `events()` streams the append log as an `AsyncIterable<EventLogEntryType>`
 * for streaming-first auditing without materializing the full array.
 *
 * Snapshot type:    'event-log-store'
 * Snapshot version: 1
 */

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
export const EventLogEntryValidator: EntityValidatorInterface<EventLogEntryType> = {
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

export type AppendLogStoreOptionsType = BaseStoreOptionsType;

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Isomorphic in-memory append-log store. Browser-safe: no `node:*` imports.
 *
 * Extend this class in browser environments. For Node file persistence,
 * use `EventLogStore` which adds a dynamic `node:fs/promises` import behind
 * its `connect()` lifecycle method.
 */
export class AppendLogStore extends BaseStore {
  readonly #log: EventLogEntryType[];

  constructor(options: AppendLogStoreOptionsType = BASE_STORE_DEFAULTS) {
    super(options);
    this.#log = [];
  }

  protected get snapshotType(): string    { return 'event-log-store'; }
  protected get snapshotVersion(): number { return 1; }

  // ── Atomic RMW override ───────────────────────────────────────────────────

  /**
   * Atomic read-modify-write. Reads `#log` directly via `#latest()`, with no
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

  // ── Protected perform* hooks ──────────────────────────────────────────────

  protected async performGet(key: string): Promise<JsonValueType | null> {
    return this.latest(key) ?? null;
  }

  protected async performSet(key: string, value: JsonValueType): Promise<void> {
    await this.appendEntry({ 'variant': 'set', 'at': Date.now(), 'key': key, 'value': value });
  }

  protected async performHas(key: string): Promise<boolean> {
    return this.latest(key) !== undefined;
  }

  protected async performDelete(key: string): Promise<boolean> {
    if (!await this.performHas(key)) return false;
    await this.appendEntry({ 'variant': 'delete', 'at': Date.now(), 'key': key });
    return true;
  }

  protected async *performEntriesStream(): AsyncIterable<StoreSnapshotEntryType> {
    // Compact: project log forward to a last-write-wins map, then stream entries.
    const compacted = new Map<string, JsonValueType>();
    for (const entry of this.#log) {
      if (entry.variant === 'set') compacted.set(entry.key, entry.value);
      else                        compacted.delete(entry.key);
    }
    for (const [key, value] of compacted) {
      yield { key, value };
    }
  }

  protected async performRestoreEntry(entry: StoreSnapshotEntryType): Promise<void> {
    const at = Date.now();
    this.#log.push({ 'variant': 'set', at, 'key': entry.key, 'value': entry.value });
    // Restoring does NOT rewrite any backing file. Connect with a fresh
    // filePath to start a new persisted log from the restored state.
  }

  protected async performClear(): Promise<void> {
    this.#log.length = 0;
  }

  // ── Audit accessors ───────────────────────────────────────────────────────

  /**
   * Returns the full, uncompacted event log as a readonly view.
   * Includes every set event and every tombstone since construction (or last restore).
   * Useful for auditing, debugging, and deriving metrics from write history.
   */
  log(): readonly EventLogEntryType[] {
    return this.#log;
  }

  /**
   * Yields every entry in the append log as an `AsyncIterable<EventLogEntryType>`.
   * The stream reflects the full, uncompacted log including tombstones — useful
   * for streaming-first auditing without materializing the entire array.
   * Entries are yielded in append order (oldest first).
   */
  async *events(): AsyncIterable<EventLogEntryType> {
    for (const entry of this.#log) {
      yield entry;
    }
  }

  // ── Protected helpers (accessible to subclasses) ──────────────────────────

  /**
   * Scan the log in reverse; return the most-recent value for `key`, or
   * `undefined`. `undefined` is the "key absent / tombstoned" sentinel.
   */
  protected latest(key: string): JsonValueType | undefined {
    for (let i = this.#log.length - 1; i >= 0; i -= 1) {
      const entry = this.#log[i];
      if (entry === undefined || entry.key !== key) continue;
      if (entry.variant === 'delete') return undefined;
      return entry.value;
    }
    return undefined;
  }

  /**
   * Append an event to the in-memory log. Subclasses may override to also
   * persist the entry to a backing store.
   */
  protected async appendEntry(entry: EventLogEntryType): Promise<void> {
    this.#log.push(entry);
  }
}
