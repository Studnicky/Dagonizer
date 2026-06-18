---
seeAlso:
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`Store`, `StoreSnapshot`, `StoreSnapshotEntry`'
  - text: 'Reference: Checkpoint'
    link: './checkpoint'
    description: '`Checkpoint.capture` and `restoreStores` for store snapshots'
  - text: 'Guide: Shared state'
    link: '../guide/shared-state'
    description: 'decision matrix, concurrency contract, custom-store authoring'
---

# Store

`@noocodex/dagonizer/store`

The store module provides the shared key-value store contract and its
implementations. Stores live in the services bag and survive scatter clone
boundaries within a run. Checkpoint integration snapshots named stores
alongside parent state for deterministic resume.

```ts twoslash
import { BaseStore, MemoryStore, StoreError } from '@noocodex/dagonizer/store';
import type { Snapshottable, Store, StoreSnapshot, StoreSnapshotEntry } from '@noocodex/dagonizer/contracts';
```

---

## Interface: `Snapshottable`

`@noocodex/dagonizer/contracts`

The capability checkpointing depends on: a named container that serializes
itself to a `StoreSnapshot` and rehydrates from one. It declares only two
methods.

```ts twoslash
import type { StoreSnapshot } from '@noocodex/dagonizer/contracts';
// ---cut---
interface Snapshottable {
  snapshot(): Promise<StoreSnapshot>;
  restore(snapshot: StoreSnapshot): Promise<void>;
}
```

| Method | Returns | Description |
|--------|---------|-------------|
| `snapshot()` | `Promise<StoreSnapshot>` | Capture the entire state as a typed envelope. |
| `restore(snapshot)` | `Promise<void>` | Repopulate from a snapshot. Implementations validate `type` and `version` before applying entries. |

`Snapshottable` is decoupled from the key-value surface on purpose.
`Checkpoint.capture(dag, result, { stores })` and `Checkpoint.restoreStores(map)`
take `Record<string, Snapshottable>`, so a non-KV backing (an RDF triple
store, a vector index, an append-only projection) can ride along in a
checkpoint without implementing `get`/`set`/`has`/`delete`/`update`. `Store
extends Snapshottable`, so every `Store` is also `Snapshottable`. The
`StoreSnapshot` / `StoreSnapshotEntry` envelopes live with this capability.

---

## Interface: `Store`

`@noocodex/dagonizer/contracts`

Shared key-value store contract, extending `Snapshottable`. Every method returns
a `Promise`. There is no sync variant; always `await` store calls.

Values are typed per-call via the method's `<T>` parameter. There is no
class-level value generic. A `Store` instance can hold heterogeneous values
under different keys; type narrowing happens at the call site.

```ts twoslash
import type { JsonValue, StoreSnapshot, StoreSnapshotEntry } from '@noocodex/dagonizer/entities';
// ---cut---
interface Snapshottable {
  snapshot(): Promise<StoreSnapshot>;
  restore(snapshot: StoreSnapshot): Promise<void>;
}
interface Store extends Snapshottable {
  get<T extends JsonValue>(key: string): Promise<T | null>;
  set<T extends JsonValue>(key: string, value: T): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  update<T extends JsonValue>(key: string, fn: (current: T | undefined) => T): Promise<T>;
  // snapshot() / restore() inherited from Snapshottable.
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
}
```

| Method | Returns | Description |
|--------|---------|-------------|
| `get(key)` | `Promise<T \| null>` | Return the value at `key`, or `null` when absent. |
| `set(key, value)` | `Promise<void>` | Write `value` at `key`. Last-write-wins. |
| `has(key)` | `Promise<boolean>` | Return `true` when the key exists. |
| `delete(key)` | `Promise<boolean>` | Remove the key. Returns `true` when the key existed. |
| `update(key, fn)` | `Promise<T>` | Atomic read-modify-write. `fn` receives the current value (or `undefined` when absent) and returns the new value. Implementations are responsible for atomicity. |
| `snapshot()` / `restore(snapshot)` | inherited | From `Snapshottable`: capture / repopulate the whole store. |
| `connect?()` | `Promise<void>` | Optional lifecycle hook for stores that hold a connection. |
| `disconnect?()` | `Promise<void>` | Optional lifecycle hook for stores that hold a connection. |

**Concurrency:** `update(key, fn)` is atomic within a single store instance.
Implementations are responsible for delivering this. See the `update` note on
`BaseStore` for the requirement. `set + get` is not atomic.

---

## Interface: `StoreSnapshot`

`@noocodex/dagonizer/contracts`

Versioned snapshot envelope returned by `Snapshottable.snapshot()` and consumed
by `Snapshottable.restore()`.

```ts twoslash
import type { StoreSnapshotEntry } from '@noocodex/dagonizer/contracts';
// ---cut---
interface StoreSnapshot {
  readonly version: number;
  readonly type:    string;
  readonly entries: readonly StoreSnapshotEntry[];
}
```

| Field | Description |
|-------|-------------|
| `version` | Snapshot schema version. Plugin authors increment this when the storage shape changes incompatibly. `BaseStore.restore` rejects mismatches with `StoreError(INCOMPATIBLE_SNAPSHOT)`. |
| `type` | Stable identifier for the store implementation (e.g. `'memory-store'`). Set via `BaseStore.snapshotType`. |
| `entries` | Ordered list of key-value pairs at capture time. |

---

## Interface: `StoreSnapshotEntry`

`@noocodex/dagonizer/contracts`

A single entry in a `StoreSnapshot`.

```ts twoslash
import type { JsonValue } from '@noocodex/dagonizer/entities';
// ---cut---
interface StoreSnapshotEntry {
  readonly key:   string;
  readonly value: JsonValue;
}
```

Keys in the snapshot carry the namespace prefix when a namespace is configured.
Restore feeds entries directly back through `performRestoreEntries`; no prefix
stripping is applied. Restore into a store with the same namespace used at
capture time.

---

## Class: `BaseStore`

`@noocodex/dagonizer/store`

Abstract base class every concrete store extends. Owns the snapshot envelope,
the `update` default, optional namespace prefix, and lifecycle no-ops.
Concrete stores implement the `protected abstract` hooks listed below.

```ts twoslash
import { BaseStore } from '@noocodex/dagonizer/store';
import type { BaseStoreOptions } from '@noocodex/dagonizer/store';
// ---cut---
// BaseStore is an abstract class — extend it:
abstract class MyStore extends BaseStore {
  protected constructor(options?: BaseStoreOptions) { super(options); }
}
```

### `BaseStoreOptions`

```ts twoslash
interface BaseStoreOptions {
  readonly namespace?: string;
}
```

`namespace` is an optional key prefix. When set, every key passed to public
methods is prefixed with `${namespace}:${key}` before reaching the `perform*`
hooks. Two stores with different namespaces can share the same physical backing
without collisions.

### Public methods

All public methods delegate to the `perform*` hooks after qualifying the key.

| Method | Description |
|--------|-------------|
| `get(key)` | Delegates to `performGet(qualifiedKey)`. |
| `set(key, value)` | Delegates to `performSet(qualifiedKey, value)`. |
| `has(key)` | Delegates to `performHas(qualifiedKey)`. |
| `delete(key)` | Delegates to `performDelete(qualifiedKey)`. |
| `update(key, fn)` | Default: `performGet` → `fn(current)` → `performSet`. Two `await` points, not atomic on its own. Subclasses **must** override when backing supports a single-step RMW (in-memory direct access, SQL transactions, Redis WATCH/MULTI, etc.). The default is a fallback that is only safe when no concurrent calls touch the same key. |
| `snapshot()` | Calls `performSnapshotEntries()`, then wraps in `{ version: snapshotVersion, type: snapshotType, entries }`. |
| `restore(snapshot)` | Validates `snapshot.type` and `snapshot.version`; throws `StoreError(INCOMPATIBLE_SNAPSHOT)` on mismatch. On match, calls `performRestoreEntries(entries)`. |
| `connect()` | No-op default. Override for connection lifecycle. |
| `disconnect()` | No-op default. Override for connection lifecycle. |

### Protected abstract hooks

Plugin authors implement these six methods and two accessors. All keyed
arguments receive the qualified key (namespace prefix already applied).

| Hook | Signature | Description |
|------|-----------|-------------|
| `snapshotType` | `get snapshotType(): string` | Stable identifier written into every snapshot envelope. |
| `snapshotVersion` | `get snapshotVersion(): number` | Schema version. Increment on incompatible shape change. |
| `performGet` | `(qualifiedKey: string) → Promise<T \| undefined>` | Read a single value. |
| `performSet` | `(qualifiedKey: string, value: T) → Promise<void>` | Write a single value. |
| `performHas` | `(qualifiedKey: string) → Promise<boolean>` | Check existence. |
| `performDelete` | `(qualifiedKey: string) → Promise<boolean>` | Remove key; return `true` when it existed. |
| `performSnapshotEntries` | `() → Promise<readonly StoreSnapshotEntry[]>` | Return all entries for the snapshot. |
| `performRestoreEntries` | `(entries: readonly StoreSnapshotEntry[]) → Promise<void>` | Repopulate from entries (clear first, then apply). |

### Protected utility

| Member | Description |
|--------|-------------|
| `qualifyKey(key)` | Apply the namespace prefix. Call this in `update` overrides that bypass the default RMW path. |

---

## Class: `MemoryStore`

`@noocodex/dagonizer/store`

Reference implementation of `BaseStore` backed by a `Map`.

```ts twoslash
import { MemoryStore } from '@noocodex/dagonizer/store';

const store = new MemoryStore();
await store.set<string>('greeting', 'hello');
const v = await store.get<string>('greeting'); // 'hello'
```

### Constructor

```ts twoslash
import { MemoryStore } from '@noocodex/dagonizer/store';
import type { BaseStoreOptions } from '@noocodex/dagonizer/store';
// ---cut---
const opts: BaseStoreOptions = { namespace: 'my-ns' };
const store = new MemoryStore(opts);
```

Accepts the same `BaseStoreOptions` as `BaseStore` (namespace prefix).

### Snapshot type and version

| Field | Value |
|-------|-------|
| `snapshotType` | `'memory-store'` |
| `snapshotVersion` | `1` |

### Atomic `update`

`MemoryStore` overrides `update` to access `#data` directly without any
intermediate `await`. Because the body contains no yield point, no concurrent
microtask can interleave between the read and the write; the
read-modify-write is atomic within the store instance.

```ts twoslash
import { MemoryStore } from '@noocodex/dagonizer/store';
const store = new MemoryStore();
// ---cut---
// Concurrent updates produce no lost writes.
await Promise.all([
  store.update<number>('counter', (n) => (n ?? 0) + 1),
  store.update<number>('counter', (n) => (n ?? 0) + 1),
]);
const v = await store.get<number>('counter'); // → 2
```

---

## Class: `StoreError`

`@noocodex/dagonizer/store`

Error class for store operations. Carries a structured `classification`
object so callers discriminate by `reason` without `instanceof` chains.

```ts twoslash
import { StoreError, MemoryStore } from '@noocodex/dagonizer/store';
import type { StoreSnapshot } from '@noocodex/dagonizer/contracts';
declare const store: MemoryStore;
declare const incompatibleSnapshot: StoreSnapshot;
// ---cut---
try {
  await store.restore(incompatibleSnapshot);
} catch (err) {
  if (err instanceof StoreError && err.classification.reason === 'INCOMPATIBLE_SNAPSHOT') {
    // err.classification.expectedType, .actualType, .expectedVersion, .actualVersion
  }
}
```

### `StoreErrorClassification`

```ts twoslash
type StoreErrorClassification =
  | {
      readonly reason:           'INCOMPATIBLE_SNAPSHOT';
      readonly expectedType:     string;
      readonly actualType:       string;
      readonly expectedVersion:  number;
      readonly actualVersion:    number;
    }
  | {
      readonly reason: 'KEY_NOT_FOUND';
      readonly key:    string;
    }
  | {
      readonly reason: 'BACKING_ERROR';
      readonly cause:  Error;
    }
  | {
      readonly reason:  'LEASE_DENIED';
      readonly subject: string;
      readonly holder:  string;
    }
  | {
      readonly reason:  'LEASE_EXPIRED';
      readonly subject: string;
      readonly token:   string;
    }
  | {
      readonly reason:    'UNREACHABLE';
      readonly endpoint:  string;
      readonly cause:     Error;
    };
```

| Reason | When | Extra fields |
|--------|------|-------------|
| `INCOMPATIBLE_SNAPSHOT` | `restore()` called with wrong `type` or `version` | `expectedType`, `actualType`, `expectedVersion`, `actualVersion` |
| `KEY_NOT_FOUND` | Plugin author throws when a required key is absent | `key` |
| `BACKING_ERROR` | Plugin author wraps a backing-level failure | `cause` |
| `LEASE_DENIED` | `acquireLease` finds an active holder and `maxWaitMs` expires before it releases | `subject`, `holder` |
| `LEASE_EXPIRED` | A write or release is attempted with a token that has already expired | `subject`, `token` |
| `UNREACHABLE` | Transport failure (endpoint does not respond within the health budget) | `endpoint`, `cause` |

`BaseStore` throws `INCOMPATIBLE_SNAPSHOT` automatically on type/version
mismatch. `KEY_NOT_FOUND` and `BACKING_ERROR` are available for plugin authors
to classify errors from their backing stores. `LEASE_DENIED`, `LEASE_EXPIRED`,
and `UNREACHABLE` are for `RemoteStore` implementations.

---

## Interface: `RemoteStore`

`@noocodex/dagonizer/contracts`

Extension of `Store` for distributed or network-backed implementations.
Plugins that talk over HTTP, gRPC, or WebSocket, or that replicate state
across processes, implement `RemoteStore` rather than `Store` directly.
Single-process and single-node-durable stores implement `Store` directly.

```ts twoslash
import type { RemoteStore, RemoteStoreEndpoint, RemoteStoreLease } from '@noocodex/dagonizer/contracts';
```

```ts twoslash
import type { Store, RemoteStoreEndpoint, RemoteStoreLease } from '@noocodex/dagonizer/contracts';
// ---cut---
interface RemoteStore extends Store {
  readonly endpoint: RemoteStoreEndpoint;
  acquireLease(subject: string, ttlMs: number, maxWaitMs: number): Promise<RemoteStoreLease>;
  releaseLease(lease: RemoteStoreLease): Promise<void>;
  health(timeoutMs: number): Promise<boolean>;
}
```

The engine consumes a `RemoteStore` through the `Store` surface. The extra
methods are observability and coordination primitives the dispatcher uses when
distributed execution is wired in.

### Interface: `RemoteStoreEndpoint`

```ts twoslash
interface RemoteStoreEndpoint {
  readonly url:    string;
  readonly region: string;
}
```

| Field | Description |
|-------|-------------|
| `url` | Stable identifier for the remote endpoint (URL, gRPC target, etc.). |
| `region` | Region/zone hint for placement decisions. Default at construction: `''` (no region constraint). |

`region` is required. Implementations that have no region concept supply `''`.

### Interface: `RemoteStoreLease`

```ts twoslash
interface RemoteStoreLease {
  readonly token:     string;
  readonly expiresAt: number;
  readonly subject:   string;
}
```

Opaque lease token returned by `acquireLease`. Consumers treat `token` as
opaque; the store validates it on `releaseLease` and on writes when
leasing is enforced.

| Field | Description |
|-------|-------------|
| `token` | Opaque string the store recognises on `releaseLease` and write checks. |
| `expiresAt` | Monotonic ms timestamp the lease expires at (exclusive). |
| `subject` | Scope of the lease (e.g. a key namespace or DAG run id). |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `endpoint` | `RemoteStoreEndpoint` | Endpoint descriptor; surfaces in observability and placement decisions. |
| `acquireLease(subject, ttlMs, maxWaitMs)` | `Promise<RemoteStoreLease>` | Acquire exclusive write authority for `subject` with a lifetime of `ttlMs` ms. Waits up to `maxWaitMs` for an active holder to release before throwing `StoreError(LEASE_DENIED)`. |
| `releaseLease(lease)` | `Promise<void>` | Release a previously-acquired lease. Idempotent: releasing an already-expired lease is a no-op. |
| `health(timeoutMs)` | `Promise<boolean>` | Health probe. Returns `true` when the endpoint is reachable and the backing responds within `timeoutMs`. Implementations must not throw on transport failure: return `false` so the dispatcher can route around an unhealthy store. |

### Implementing `RemoteStore`

Extend `BaseStore` and implement the three additional methods plus the
`endpoint` property:

```ts
<<< @/../examples/dags/store-remote.ts#remote-store
```

---

## Class: `TypedStore<Schema>`

`@noocodex/dagonizer/store`

Schema-narrowed wrapper over any `Store`. Constrains keys to the declared
`Schema` and infers the value type from `Schema[K]`. Callers never specify
`<T>` at the call site.

`TypedStore` does not implement the `Store` contract (its `set` signature is
narrower). Use `.inner` to access the underlying `Store` when you need the
wider, heterogeneous contract.

```ts
<<< @/../examples/the-archivist/memory/TypedRunStore.ts#typed-store
```

### Constructor

```ts twoslash
import { TypedStore, MemoryStore } from '@noocodex/dagonizer/store';
import type { JsonValue } from '@noocodex/dagonizer/entities';
// ---cut---
interface MySchema { count: number; label: string; }
const store = new TypedStore<MySchema>(new MemoryStore());
```

`Schema` must be a `Record<string, JsonValue>`: every value type must be JSON-serializable.

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `get(key)` | `Promise<Schema[K] \| null>` | Return the value at `key`, type inferred from `Schema[K]`, or `null` when absent. |
| `set(key, value)` | `Promise<void>` | Write `value` at `key`. `value` must be `Schema[K]`. |
| `has(key)` | `Promise<boolean>` | Return `true` when the key exists. |
| `delete(key)` | `Promise<boolean>` | Remove the key. Returns `true` when the key existed. |
| `update(key, fn)` | `Promise<Schema[K]>` | Atomic read-modify-write. `fn` receives `Schema[K] \| undefined`, returns `Schema[K]`. |
| `snapshot()` | `Promise<StoreSnapshot>` | Pass-through to the underlying Store. |
| `restore(snapshot)` | `Promise<void>` | Pass-through to the underlying Store. |
| `connect()` | `Promise<void>` | Pass-through to the underlying Store. |
| `disconnect()` | `Promise<void>` | Pass-through to the underlying Store. |
| `.inner` | `Store` | The underlying Store instance for un-narrowed operations. |

All key parameters are constrained to `keyof Schema & string`. TypeScript
rejects keys absent from the schema and values of the wrong type at compile
time.

---

## Related guides

- [Guide: Shared state](../guide/shared-state)
- [Reference: Checkpoint](./checkpoint): `Checkpoint.capture`, `restoreStores`
