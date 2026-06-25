# @studnicky/dagonizer-store-webstorage

Web Storage (`localStorage` / `sessionStorage`) backed `Store` and `CheckpointStore`
for [`@studnicky/dagonizer`](https://github.com/Studnicky/Dagonizer).

No DOM lib required. No external runtime dependencies.

## Ceiling

Web Storage is a synchronous, flat, string-keyed API with a **~5 MB quota** per
origin. It is the simplest durable browser store option — suitable for small
checkpoints, settings, and per-tab ephemeral runs. For larger state or
transactional durability, use `dagonizer-store-indexeddb`.

`update(key, fn)` is atomic within a single call (the backend is synchronous;
no await separates the read from the write), but is **not** concurrency-safe
across independently scheduled tasks.

## Install

```sh
pnpm add @studnicky/dagonizer-store-webstorage
```

## Usage

### Static factories (browser)

```ts
import { WebStorageStore, WebStorageCheckpointStore } from '@studnicky/dagonizer-store-webstorage';

// localStorage — persists across page reloads
const store = WebStorageStore.local({ keyPrefix: 'myapp:', namespace: 'run-1' });

// sessionStorage — cleared when the tab is closed
const ephemeralStore = WebStorageStore.session({ keyPrefix: 'myapp:' });

// Checkpoint store (strings only, per CheckpointStoreInterface)
const ckptStore = WebStorageCheckpointStore.local({ keyPrefix: 'myapp:ckpt:' });
```

### Dependency injection (tests / SSR)

Inject any `StorageLikeInterface` directly — the static factories are convenience
wrappers, not the only path:

```ts
import { WebStorageStore } from '@studnicky/dagonizer-store-webstorage';
import type { StorageLikeInterface } from '@studnicky/dagonizer-store-webstorage';

// In a test: inject an in-memory double.
class FakeStorage implements StorageLikeInterface {
  readonly #data = new Map<string, string>();
  get length() { return this.#data.size; }
  getItem(k: string)           { return this.#data.get(k) ?? null; }
  setItem(k: string, v: string){ this.#data.set(k, v); }
  removeItem(k: string)        { this.#data.delete(k); }
  key(i: number)               { return [...this.#data.keys()][i] ?? null; }
}

const store = new WebStorageStore(new FakeStorage(), { keyPrefix: 'test:' });
await store.set('counter', 0);
await store.update('counter', (n) => (typeof n === 'number' ? n : 0) + 1);
```

### Key namespacing

Two levels of prefix are applied:

| Level | Option | Applied by | Purpose |
|---|---|---|---|
| Storage-level | `keyPrefix` (default `'dagonizer:'`) | `WebStorageStore` | Scope this store in the shared origin keyspace |
| Instance-level | `namespace` (default `''`) | `BaseStore` | Scope keys within one `WebStorageStore` instance |

A key `'counter'` with `keyPrefix: 'myapp:'` and `namespace: 'run-1'` is stored
as `'myapp:run-1:counter'`.

## See also

- [`@studnicky/dagonizer`](https://github.com/Studnicky/Dagonizer) — main package
- `dagonizer-store-indexeddb` — the default browser adapter for HITL/resume durability
- `dagonizer-store-opfs` — Origin Private File System adapter for large state
