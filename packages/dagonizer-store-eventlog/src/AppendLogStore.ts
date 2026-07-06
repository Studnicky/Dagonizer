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

import { Clock as SubstrateClock, RealTimeClockProvider } from '@studnicky/clock';
import type { StoreSnapshotEntryType } from '@studnicky/dagonizer/contracts';
import type { JsonValueType } from '@studnicky/dagonizer/entities';
import { BASE_STORE_DEFAULTS, BaseStore, StoreError, type BaseStoreOptionsType } from '@studnicky/dagonizer/store';
import { type EntityValidatorInterface, Validator } from '@studnicky/dagonizer/validation';

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

const CompiledEventLogEntryValidator = Validator.compile<EventLogEntryType>(EventLogEntrySchema);

/**
 * Schema-backed validator for `EventLogEntry` at the file-read JSON ingest
 * boundary. Invalid persisted entries surface as store snapshot incompatibility.
 */
export const EventLogEntryValidator: EntityValidatorInterface<EventLogEntryType> = {
  is(value): value is EventLogEntryType {
    return CompiledEventLogEntryValidator.is(value);
  },
  validate(value): EventLogEntryType {
    if (CompiledEventLogEntryValidator.is(value)) return value;
    const errors = CompiledEventLogEntryValidator.errors(value) ?? ['invalid EventLogEntry shape'];
    throw new StoreError(
      `invalid EventLogEntry: ${errors.join('; ')}`,
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
    return CompiledEventLogEntryValidator.errors(value);
  },
};

// ── Options ───────────────────────────────────────────────────────────────────

export type AppendLogStoreOptionsType = BaseStoreOptionsType & {
  /**
   * Clock used for persisted event `at` timestamps. Defaults to a real
   * epoch-ms substrate clock; tests may inject a virtual provider.
   */
  readonly clock?: SubstrateClock;
};

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Isomorphic in-memory append-log store. Browser-safe: no `node:*` imports.
 *
 * Extend this class in browser environments. For Node file persistence,
 * use `EventLogStore` which adds a dynamic `node:fs/promises` import behind
 * its `connect()` lifecycle method.
 */
export class AppendLogStore extends BaseStore {
  readonly #clock: SubstrateClock;
  readonly #log: EventLogEntryType[];

  constructor(options: AppendLogStoreOptionsType = BASE_STORE_DEFAULTS) {
    super(options);
    this.#clock = options.clock ?? SubstrateClock.create(RealTimeClockProvider.create());
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
    await this.appendEntry({ 'variant': 'set', 'at': this.eventTimestamp(), 'key': qualified, 'value': next });
    return next;
  }

  // ── Protected perform* hooks ──────────────────────────────────────────────

  protected async performGet(key: string): Promise<JsonValueType | null> {
    return this.latest(key) ?? null;
  }

  protected async performSet(key: string, value: JsonValueType): Promise<void> {
    await this.appendEntry({ 'variant': 'set', 'at': this.eventTimestamp(), 'key': key, 'value': value });
  }

  protected async performHas(key: string): Promise<boolean> {
    return this.latest(key) !== undefined;
  }

  protected async performDelete(key: string): Promise<boolean> {
    if (!await this.performHas(key)) return false;
    await this.appendEntry({ 'variant': 'delete', 'at': this.eventTimestamp(), 'key': key });
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
    const at = this.eventTimestamp();
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

  /** Epoch-ms timestamp for event-log entries. */
  protected eventTimestamp(): number {
    return this.#clock.now();
  }

  /**
   * Append an event to the in-memory log. Subclasses may override to also
   * persist the entry to a backing store.
   */
  protected async appendEntry(entry: EventLogEntryType): Promise<void> {
    this.#log.push(entry);
  }
}
