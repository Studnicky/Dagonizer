# @noocodex/dagonizer-store-sqlite

SQLite-backed `Store` for [`@noocodex/dagonizer`](https://github.com/Studnicky/Dagonizer) using Node's built-in `node:sqlite` module.

No external npm dependencies. Requires Node >= 24.

## Install

```sh
pnpm add @noocodex/dagonizer-store-sqlite
```

## Usage

```ts
import { SqliteStore } from '@noocodex/dagonizer-store-sqlite';

// In-process SQLite (no filesystem)
const store = new SqliteStore({ path: ':memory:' });

// Persistent file-backed SQLite
const store = new SqliteStore({
  path: './my-dag-store.db',
  namespace: 'run-1',      // optional key prefix
  tableName: 'app_kv',     // optional, default: 'dagonizer_kv'
});

await store.set<number>('counter', 0);
await store.update<number>('counter', (n) => (n ?? 0) + 1);
const value = await store.get<number>('counter'); // 1

// Snapshot / restore
const snap = await store.snapshot();
const fresh = new SqliteStore({ path: ':memory:' });
await fresh.restore(snap);

// Close connection when done
await store.disconnect();
```

## Notes

- `update(key, fn)` is atomic via `BEGIN IMMEDIATE`, safe under concurrent `Promise.all` calls.
- All values are stored as JSON text (`TEXT NOT NULL`) in a `STRICT` SQLite table.
- Snapshot envelopes are typed (`type: 'sqlite-store'`, `version: 1`). `restore()` rejects incompatible envelopes with `StoreError(INCOMPATIBLE_SNAPSHOT)`.

## See also

- [`@noocodex/dagonizer`](https://github.com/Studnicky/Dagonizer): main package docs and API reference.
