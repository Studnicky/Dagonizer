# @noocodex/dagonizer-store-eventlog

Append-only event-log `Store` implementation for [`@noocodex/dagonizer`](https://github.com/Studnicky/Dagonizer).

Every `set` appends a `{ kind: 'set' }` event; every `delete` appends a `{ kind: 'delete' }` tombstone. `get` returns the latest value for a key by scanning the log in reverse. `snapshot()` compacts the log to a last-write-wins map. `restore()` reseeds the log from snapshot entries. Optional file persistence via `node:fs/promises` — no external dependencies.

## Installation

```sh
# within the Dagonizer workspace
pnpm add @noocodex/dagonizer-store-eventlog
```

## Usage

### In-memory mode

```ts
import { EventLogStore } from '@noocodex/dagonizer-store-eventlog';

const store = new EventLogStore();

await store.set<string>('status', 'pending');
await store.set<string>('status', 'running');
console.log(await store.get<string>('status')); // 'running'

await store.delete('status');
console.log(await store.has('status')); // false

// Inspect the full event history.
console.log(store.log());
// [
//   { kind: 'set',    at: ..., key: 'status', value: 'pending' },
//   { kind: 'set',    at: ..., key: 'status', value: 'running' },
//   { kind: 'delete', at: ..., key: 'status' },
// ]
```

### File-backed mode

```ts
import { EventLogStore } from '@noocodex/dagonizer-store-eventlog';

// Write session.
const store = new EventLogStore({ filePath: '/tmp/my-dag.log' });
await store.connect();          // opens file, replays existing entries
await store.set<number>('run', 1);
await store.disconnect();       // flushes and closes the file

// Resume in a new process — same file, same data.
const resumed = new EventLogStore({ filePath: '/tmp/my-dag.log' });
await resumed.connect();
console.log(await resumed.get<number>('run')); // 1
await resumed.disconnect();
```

### Snapshot and restore

```ts
const snap = await store.snapshot();
// { version: 1, type: 'event-log-store', entries: [...] }

const fresh = new EventLogStore();
await fresh.restore(snap);      // throws StoreError if type/version mismatch
```

### Atomic read-modify-write

```ts
await store.update<number>('counter', (c) => (c ?? 0) + 1);
```

`update()` is atomic under JS single-threaded execution: `#latest()` is called synchronously and no `await` precedes the read, so the body cannot interleave with another `update()` on the same instance.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `namespace` | `string` | `''` | Key prefix. Two stores with different namespaces can share the same backing without collisions. |
| `filePath` | `string` | `''` | Path to the append-only log file. Empty string means in-memory only. |
| `syncOnAppend` | `boolean` | `true` | `fsync` after every append for durability. Set to `false` for higher throughput. |

## Event log entry shape

```ts
type EventLogEntry =
  | { readonly kind: 'set';    readonly at: number; readonly key: string; readonly value: JsonValue }
  | { readonly kind: 'delete'; readonly at: number; readonly key: string };
```

`at` is a `Date.now()` millisecond timestamp recorded at append time.

## Links

- [Dagonizer documentation](https://github.com/Studnicky/Dagonizer)
- [`Store` contract](../dagonizer/src/contracts/Store.ts)
- [`BaseStore` abstract base](../dagonizer/src/store/BaseStore.ts)
