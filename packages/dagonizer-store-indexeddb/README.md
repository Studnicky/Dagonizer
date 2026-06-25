# @studnicky/dagonizer-store-indexeddb

IndexedDB-backed `Store` and `CheckpointStore` for [`@studnicky/dagonizer`](https://github.com/Studnicky/Dagonizer).

The durable default for in-browser HITL/resume. Large capacity, async,
cursor-streamed, transactional — the correct choice whenever you need
checkpoint durability across browser reloads.

## Install

```sh
pnpm add @studnicky/dagonizer-store-indexeddb
```

## Usage: browser (static factory)

```ts
import { IndexedDbStore, IndexedDbCheckpointStore } from '@studnicky/dagonizer-store-indexeddb';

// Resolves globalThis.indexedDB via Reflect.get + structural guard.
// Throws StoreError(BACKING_ERROR) in non-browser environments.
const store = IndexedDbStore.open({ databaseName: 'my-app', storeName: 'kv' });
await store.connect();

await store.set('counter', 0);
await store.update('counter', (n) => (typeof n === 'number' ? n : 0) + 1);
const value = await store.get('counter'); // 1

// Snapshot the full keyspace (cursor-streamed, no getAll)
const snap = await store.snapshot();

// Restore from snapshot (replacement semantics — clears first)
const fresh = IndexedDbStore.open({ databaseName: 'my-app', storeName: 'kv-v2' });
await fresh.connect();
await fresh.restore(snap);

await store.disconnect();

// Checkpoint store — persists JSON strings from Checkpoint.capture()
const ckpt = IndexedDbCheckpointStore.open();
await ckpt.connect();
await ckpt.save('run-1', '{"step":3}');
const json = await ckpt.load('run-1'); // '{"step":3}'
await ckpt.disconnect();
```

## Usage: inject a factory (tests)

```ts
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbStore } from '@studnicky/dagonizer-store-indexeddb';

const store = new IndexedDbStore(new IDBFactory(), { storeName: 'kv' });
await store.connect();
await store.set('x', 42);
await store.disconnect();
```

## Design notes

- **No DOM lib.** The `indexedDB` global is reached via `Reflect.get(globalThis, 'indexedDB')` and narrowed with a structural type-predicate guard (`IdbFactory.is`). All IndexedDB API shapes are defined as minimal structural interfaces in `IdbTypes.ts` — no `lib: ["DOM"]` anywhere.
- **Cursor-streamed snapshot.** `performEntriesStream` walks an `IDBCursor` one entry at a time, bridging the event-driven `onsuccess` loop to async iteration via a per-step promise. `getAll` is not used.
- **Transactional update.** `update(key, fn)` opens a single `readwrite` transaction and issues `get` then `put` within it. IDB auto-commits the transaction after all its requests complete, so no other transaction can interleave between the read and the write.
- **JSON-string codec.** Values are stored as `JSON.stringify(value)` and read back via `JsonValue.from(JSON.parse(raw))`. This keeps codec behaviour identical to the SQLite and OPFS adapters and avoids relying on IDB structured-clone for arbitrary `JsonValueType`.

## See also

- [`@studnicky/dagonizer`](https://github.com/Studnicky/Dagonizer): main package docs and API reference.
- `store-webstorage`: simpler ~5 MB synchronous alternative for small checkpoints.
- `store-opfs`: high-capacity file-streamed alternative via Origin Private File System.
