# @studnicky/dagonizer-store-opfs

OPFS-backed `Store` and `CheckpointStore` for [`@studnicky/dagonizer`](https://github.com/Studnicky/Dagonizer).

Uses the Origin Private File System (`navigator.storage.getDirectory()`) — one file per key, async `createWritable` path (works on the main thread), streaming-native iteration via the directory's async entries iterator.

## Install

```sh
pnpm add @studnicky/dagonizer-store-opfs
```

## Usage

```ts
import { OpfsStore, OpfsCheckpointStore } from '@studnicky/dagonizer-store-opfs';

// Resolve a subdirectory under the OPFS root (creates it if absent)
const store = await OpfsStore.rooted('my-dag-data');

await store.set('counter', 0);
await store.update('counter', (n) => (typeof n === 'number' ? n : 0) + 1);
const raw = await store.get('counter'); // 1

// Streaming snapshot
for await (const entry of store.snapshotStream()) {
  console.log(entry.key, entry.value);
}

// Array snapshot / restore
const snap = await store.snapshot();
const fresh = new OpfsStore(directoryHandle);
await fresh.restore(snap);
```

### Dependency injection

Pass a `DirectoryHandleLikeInterface` directly for testing or for consumers who resolve the directory handle themselves:

```ts
import { OpfsStore } from '@studnicky/dagonizer-store-opfs';

const dir = await navigator.storage.getDirectory()
  .then(root => root.getDirectoryHandle('my-data', { create: true }));

const store = new OpfsStore(dir);
```

### Checkpoint store

```ts
const checkpoint = await OpfsCheckpointStore.rooted('my-dag-data');
await checkpoint.save('run-1', JSON.stringify({ step: 3 }));
const json = await checkpoint.load('run-1'); // '{"step":3}'
await checkpoint.delete('run-1');
```

## Worker note

`createSyncAccessHandle` — the synchronous high-throughput OPFS path — is Worker-only (the main thread cannot call it). `OpfsStore` uses the async `createWritable` path which works on both the main thread and Workers. For append-log use-cases that require the synchronous path, run the store inside a Worker and post messages in/out.

## Capacity and use

| Property | Value |
|---|---|
| Persistence | Across reloads (OPFS is durable) |
| Capacity | Large (limited by device storage) |
| I/O model | Async, file-streamed, lazy |
| Concurrency | Per-key Promise chain (within-process serialization) |

Prefer this adapter for large state, append logs, or when IndexedDB is unavailable.

## See also

- [`@studnicky/dagonizer`](https://github.com/Studnicky/Dagonizer): main package docs and API reference.
