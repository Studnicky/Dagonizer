/**
 * SqliteStore: BaseStore implementation backed by Node's built-in node:sqlite.
 *
 * Snapshot type:    'sqlite-store'
 * Snapshot version: 1
 *
 * Requires Node >= 24 (node:sqlite is stable in Node 23+).
 * No external npm dependencies; only node:sqlite.
 *
 * Atomicity: `update()` uses `BEGIN IMMEDIATE` to acquire a write lock
 * before reading, preventing lost updates under concurrent calls.
 */

import { DatabaseSync } from 'node:sqlite';
import type { DatabaseSyncOptions } from 'node:sqlite';

import type { StoreSnapshotEntryType } from '@studnicky/dagonizer/contracts';
import { JsonValue } from '@studnicky/dagonizer/entities';
import type { JsonValueType } from '@studnicky/dagonizer/entities';
import { BASE_STORE_DEFAULTS, BaseStore, type BaseStoreOptionsType } from '@studnicky/dagonizer/store';

export type SqliteStoreOptionsType = BaseStoreOptionsType & {
  /** SQLite DatabaseSync options (e.g. readOnly). */
  readonly database?: DatabaseSyncOptions;
  /** Table name for the key-value store. Default: 'dagonizer_kv'. */
  readonly tableName?: string;
};

/** Row shape returned by `SELECT value FROM ...` prepared statements. */
type ValueRowType = {
  readonly value: string;
};

/** Row shape returned by `SELECT key, value FROM ...` prepared statements. */
type KvRowType = {
  readonly key: string;
  readonly value: string;
};

/** Structural guards for rows returned by node:sqlite's `.get()` / `.all()`. */
class KvRow {
  static isValue(row: unknown): row is ValueRowType {
    if (row === null || typeof row !== 'object') return false;
    return 'value' in row && typeof row.value === 'string';
  }

  static isFull(row: unknown): row is KvRowType {
    if (!KvRow.isValue(row)) return false;
    return 'key' in row && typeof row.key === 'string';
  }
}

export class SqliteStore extends BaseStore {
  readonly #db: DatabaseSync;
  readonly #tableName: string;

  constructor(path: string, options: SqliteStoreOptionsType = BASE_STORE_DEFAULTS) {
    super(options);
    this.#db = options.database !== undefined
      ? new DatabaseSync(path, options.database)
      : new DatabaseSync(path);
    this.#tableName = options.tableName ?? 'dagonizer_kv';
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.#tableName} (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
    `);
  }

  protected get snapshotType(): string    { return 'sqlite-store'; }
  protected get snapshotVersion(): number { return 1; }

  /** Atomic RMW via SQLite BEGIN IMMEDIATE transaction. */
  override async update<T extends JsonValueType>(
    key: string,
    fn: (current: T | undefined) => T,
  ): Promise<T> {
    const qualified = this.qualifyKey(key);
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const raw = this.#db
        .prepare(`SELECT value FROM ${this.#tableName} WHERE key = ?`)
        .get(qualified);
      const parsed: JsonValueType | null = KvRow.isValue(raw) ? JsonValue.from(JSON.parse(raw.value)) : null;
      const current = this.narrowStored<T>(parsed) ?? undefined;
      const next = fn(current);
      this.#db
        .prepare(
          `INSERT INTO ${this.#tableName} (key, value) VALUES (?, ?)` +
          ` ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(qualified, JSON.stringify(next));
      this.#db.exec('COMMIT');
      return next;
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    }
  }

  protected async performGet(key: string): Promise<JsonValueType | null> {
    const raw = this.#db
      .prepare(`SELECT value FROM ${this.#tableName} WHERE key = ?`)
      .get(key);
    if (!KvRow.isValue(raw)) return null;
    return JsonValue.from(JSON.parse(raw.value));
  }

  protected async performSet(key: string, value: JsonValueType): Promise<void> {
    this.#db
      .prepare(
        `INSERT INTO ${this.#tableName} (key, value) VALUES (?, ?)` +
        ` ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, JSON.stringify(value));
  }

  protected async performHas(key: string): Promise<boolean> {
    const row = this.#db
      .prepare(`SELECT 1 FROM ${this.#tableName} WHERE key = ? LIMIT 1`)
      .get(key);
    return row !== undefined;
  }

  protected async performDelete(key: string): Promise<boolean> {
    const result = this.#db
      .prepare(`DELETE FROM ${this.#tableName} WHERE key = ?`)
      .run(key);
    return result.changes > 0;
  }

  protected async performSnapshotEntries(): Promise<readonly StoreSnapshotEntryType[]> {
    const rows = this.#db
      .prepare(`SELECT key, value FROM ${this.#tableName} ORDER BY key`)
      .all();
    return rows.flatMap((raw) => {
      if (!KvRow.isFull(raw)) return [];
      return [{ 'key': raw.key, 'value': JsonValue.from(JSON.parse(raw.value)) }];
    });
  }

  protected async performRestoreEntries(entries: readonly StoreSnapshotEntryType[]): Promise<void> {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#db.exec(`DELETE FROM ${this.#tableName}`);
      const stmt = this.#db.prepare(
        `INSERT INTO ${this.#tableName} (key, value) VALUES (?, ?)`,
      );
      for (const { key, value } of entries) {
        stmt.run(key, JSON.stringify(value));
      }
      this.#db.exec('COMMIT');
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Close the underlying SQLite connection. */
  override async disconnect(): Promise<void> {
    this.#db.close();
  }
}
