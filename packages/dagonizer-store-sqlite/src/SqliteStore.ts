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

import type { StoreSnapshotEntry } from '@noocodex/dagonizer/contracts';
import type { JsonValue } from '@noocodex/dagonizer/entities';
import { BaseStore } from '@noocodex/dagonizer/store';
import type { BaseStoreOptions } from '@noocodex/dagonizer/store';

export interface SqliteStoreOptions extends BaseStoreOptions {
  /** SQLite DatabaseSync options (e.g. readOnly). */
  readonly database?: DatabaseSyncOptions;
  /** Table name for the key-value store. Default: 'dagonizer_kv'. */
  readonly tableName?: string;
}

/** Narrow row shape returned by prepared SELECT statements. */
interface KvRow {
  readonly key: string;
  readonly value: string;
}

export class SqliteStore extends BaseStore {
  readonly #db: DatabaseSync;
  readonly #tableName: string;

  constructor(path: string, options: SqliteStoreOptions = { 'namespace': '' }) {
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
  override async update<T extends JsonValue>(
    key: string,
    fn: (current: T | undefined) => T,
  ): Promise<T> {
    const qualified = this.qualifyKey(key);
    let next!: T;
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.#db
        .prepare(`SELECT value FROM ${this.#tableName} WHERE key = ?`)
        .get(qualified) as KvRow | undefined;
      const current = (row === undefined) ? undefined : JSON.parse(row.value) as T;
      next = fn(current);
      this.#db
        .prepare(
          `INSERT INTO ${this.#tableName} (key, value) VALUES (?, ?)` +
          ` ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(qualified, JSON.stringify(next));
      this.#db.exec('COMMIT');
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    }
    return next;
  }

  protected async performGet<T extends JsonValue>(key: string): Promise<T | null> {
    const row = this.#db
      .prepare(`SELECT value FROM ${this.#tableName} WHERE key = ?`)
      .get(key) as KvRow | undefined;
    if (row === undefined) return null;
    return JSON.parse(row.value) as T;
  }

  protected async performSet<T extends JsonValue>(key: string, value: T): Promise<void> {
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

  protected async performSnapshotEntries(): Promise<readonly StoreSnapshotEntry[]> {
    // Foreign-data boundary cast: node:sqlite's `.all()` returns
    // `unknown[]` because the driver can't statically know table schemas.
    // The double-cast through `unknown` is the conventional TS narrowing
    // at this boundary; structurally identical to the `JSON.parse(...) as
    // JsonValue` boundary on the next line. KvRow matches the SELECT
    // projection exactly, so the cast is sound.
    const rows = this.#db
      .prepare(`SELECT key, value FROM ${this.#tableName} ORDER BY key`)
      .all() as unknown as KvRow[];
    return rows.map((row) => ({
      'key':   row.key,
      'value': JSON.parse(row.value) as JsonValue,
    }));
  }

  protected async performRestoreEntries(entries: readonly StoreSnapshotEntry[]): Promise<void> {
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
