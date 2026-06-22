---
seeAlso:
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`StoreInterface`, `StoreSnapshotType`, `StoreSnapshotEntryType`'
  - text: 'Reference: Checkpoint'
    link: './checkpoint'
    description: '`Checkpoint.capture` and `restoreStores` for store snapshots'
  - text: 'Guide: Shared state'
    link: '../guide/shared-state'
    description: 'decision matrix, concurrency contract, custom-store authoring'
---

# Store

`@studnicky/dagonizer/store`

The store module provides the shared key-value store contract and its
implementations. Stores are passed into node constructors and survive scatter
clone boundaries within a run. Checkpoint integration snapshots named stores
alongside parent state for deterministic resume.

```ts twoslash
import { BaseStore, MemoryStore, StoreError } from '@studnicky/dagonizer/store';
import type { SnapshottableInterface, StoreInterface, StoreSnapshotType, StoreSnapshotEntryType } from '@studnicky/dagonizer/contracts';
```

---

## Interface: `SnapshottableInterface`

`@studnicky/dagonizer/contracts`

The capability checkpointing depends on: a named container that serializes
itself to a `StoreSnapshotType` and rehydrates from one. It declares only two
methods.

```ts twoslash
import type { StoreSnapshotType } from '@studnicky/dagonizer/contracts';
// ---cut---
interface SnapshottableInterface {
  snapshot(): Promise<StoreSnapshotType>;
  restore(snapshot: StoreSnapshotType): Promise<void>;
}
```

| Method | Returns | Description |
|--------|---------|-------------|
| `snapshot()` | `Promise<StoreSnapshotType>` | Capture the entire state as a typed envelope. |
| `restore(snapshot)` | `Promise<void>` | Repopulate from a snapshot. Implementations validate `type` and `version` before applying entries. |

`SnapshottableInterface` is decoupled from the key-value surface on purpose.
`Checkpoint.capture(dag, result, { stores })` and `Checkpoint.restoreStores(map)`
take `Record<string, SnapshottableInterface>`, so a non-KV backing (an RDF triple
store, a vector index, an append-only projection) can ride along in a
checkpoint without implementing `get`/`set`/`has`/`delete`/`update`. `StoreInterface
extends SnapshottableInterface`, so every `StoreInterface` is also `SnapshottableInterface`. The
`StoreSnapshotType` / `StoreSnapshotEntryType` envelopes live with this capability.

---

## Interface: `StoreInterface`

`@studnicky/dagonizer/contracts`

Shared key-value store contract, extending `SnapshottableInterface`. Every method returns
a `Promise`. There is no sync variant; always `await` store calls.

Values are typed per-call via the method's `<T>` parameter. There is no
class-level value generic. A `StoreInterface` instance can hold heterogeneous values
under different keys; type narrowing happens at the call site.

```ts twoslash
import type { JsonValueType } from '@studnicky/dagonizer/entities';
import type { StoreSnapshotType, StoreSnapshotEntryType } from '@studnicky/dagonizer/contracts';
// ---cut---
interface SnapshottableInterface {
  snapshot(): Promise<StoreSnapshotType>;
  restore(snapshot: StoreSnapshotType): Promise<void>;
}
interface StoreInterface extends SnapshottableInterface {
  get(key: string): Promise<JsonValueType | null>;
  set(key: string, value: JsonValueType): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  update(key: string, fn: (current: JsonValueType | undefined) => JsonValueType): Promise<JsonValueType>;
  // snapshot() / restore() inherited from SnapshottableInterface.
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
```

| Method | Returns | Description |
|--------|---------|-------------|
| `get(key)` | `Promise<T \| null>` | Return the value at `key`, or `null` when absent. |
| `set(key, value)` | `Promise<void>` | Write `value` at `key`. Last-write-wins. |
| `has(key)` | `Promise<boolean>` | Return `true` when the key exists. |
| `delete(key)` | `Promise<boolean>` | Remove the key. Returns `true` when the key existed. |
| `update(key, fn)` | `Promise<T>` | Atomic read-modify-write. `fn` receives the current value (or `undefined` when absent) and returns the new value. Implementations are responsible for atomicity. |
| `snapshot()` / `restore(snapshot)` | inherited | From `SnapshottableInterface`: capture / repopulate the whole store. |
| `connect?()` | `Promise<void>` | Optional lifecycle hook for stores that hold a connection. |
| `disconnect?()` | `Promise<void>` | Optional lifecycle hook for stores that hold a connection. |

**Concurrency:** `update(key, fn)` is atomic within a single store instance.
Implementations are responsible for delivering this. See the `update` note on
`BaseStore` for the requirement. `set + get` is not atomic.

---

## Interface: `StoreSnapshotType`

`@studnicky/dagonizer/contracts`

Versioned snapshot envelope returned by `SnapshottableInterface.snapshot()` and consumed
by `SnapshottableInterface.restore()`.

```ts twoslash
import type { StoreSnapshotEntryType } from '@studnicky/dagonizer/contracts';
// ---cut---
interface StoreSnapshotType {
  readonly version: number;
  readonly type:    string;
  readonly entries: readonly StoreSnapshotEntryType[];
}
```

| Field | Description |
|-------|-------------|
| `version` | Snapshot schema version. Plugin authors increment this when the storage shape changes incompatibly. `BaseStore.restore` rejects mismatches with `StoreError(INCOMPATIBLE_SNAPSHOT)`. |
| `type` | Stable identifier for the store implementation (e.g. `'memory-store'`). Set via `BaseStore.snapshotType`. |
| `entries` | Ordered list of key-value pairs at capture time. |

---

## Interface: `StoreSnapshotEntryType`

`@studnicky/dagonizer/contracts`

A single entry in a `StoreSnapshotType`.

```ts twoslash
import type { JsonValueType } from '@studnicky/dagonizer/entities';
// ---cut---
interface StoreSnapshotEntryType {
  readonly key:   string;
  readonly value: JsonValueType;
}
```

Keys in the snapshot carry the namespace prefix when a namespace is configured.
Restore feeds entries directly back through `performRestoreEntries`; no prefix
stripping is applied. Restore into a store with the same namespace used at
capture time.

---

## Class: `BaseStore`

`@studnicky/dagonizer/store`

Abstract base class every concrete store extends. Owns the snapshot envelope,
the `update` default, optional namespace prefix, and lifecycle no-ops.
Concrete stores implement the `protected abstract` hooks listed below.

```ts twoslash
import { BaseStore } from '@studnicky/dagonizer/store';
import type { BaseStoreOptionsType } from '@studnicky/dagonizer/store';
// ---cut---
// BaseStore is an abstract class — extend it:
abstract class MyStore extends BaseStore {
  protected constructor(options?: BaseStoreOptionsType) { super(options); }
}
```

### `BaseStoreOptionsType`

```ts twoslash
interface BaseStoreOptionsType {
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
| `performSnapshotEntries` | `() → Promise<readonly StoreSnapshotEntryType[]>` | Return all entries for the snapshot. |
| `performRestoreEntries` | `(entries: readonly StoreSnapshotEntryType[]) → Promise<void>` | Repopulate from entries (clear first, then apply). |

### Protected utility

| Member | Description |
|--------|-------------|
| `qualifyKey(key)` | Apply the namespace prefix. Call this in `update` overrides that bypass the default RMW path. |

---

## Class: `MemoryStore`

`@studnicky/dagonizer/store`

Reference implementation of `BaseStore` backed by a `Map`.

```ts twoslash
import { MemoryStore } from '@studnicky/dagonizer/store';

const store = new MemoryStore();
await store.set('greeting', 'hello');
const v = await store.get('greeting'); // 'hello' (JsonValueType | null; narrow with typeof)
```

### Constructor

```ts twoslash
import { MemoryStore } from '@studnicky/dagonizer/store';
import type { BaseStoreOptionsType } from '@studnicky/dagonizer/store';
// ---cut---
const opts: BaseStoreOptionsType = { namespace: 'my-ns' };
const store = new MemoryStore(opts);
```

Accepts the same `BaseStoreOptionsType` as `BaseStore` (namespace prefix).

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
import { MemoryStore } from '@studnicky/dagonizer/store';
const store = new MemoryStore();
// ---cut---
// Concurrent updates produce no lost writes.
await Promise.all([
  store.update('counter', (n) => (typeof n === 'number' ? n : 0) + 1),
  store.update('counter', (n) => (typeof n === 'number' ? n : 0) + 1),
]);
const raw = await store.get('counter');
const v = typeof raw === 'number' ? raw : 0; // → 2
```

---

## Class: `StoreError`

`@studnicky/dagonizer/store`

Error class for store operations. Carries a structured `classification`
object so callers discriminate by `reason` without `instanceof` chains.

```ts twoslash
import { StoreError, MemoryStore } from '@studnicky/dagonizer/store';
import type { StoreSnapshotType } from '@studnicky/dagonizer/contracts';
declare const store: MemoryStore;
declare const incompatibleSnapshot: StoreSnapshotType;
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
and `UNREACHABLE` are for `RemoteStoreInterface` implementations.

---

## Interface: `RemoteStoreInterface`

`@studnicky/dagonizer/contracts`

Extension of `StoreInterface` for distributed or network-backed implementations.
Plugins that talk over HTTP, gRPC, or WebSocket, or that replicate state
across processes, implement `RemoteStoreInterface` rather than `StoreInterface` directly.
Single-process and single-node-durable stores implement `StoreInterface` directly.

```ts twoslash
import type { RemoteStoreInterface, RemoteStoreEndpointType, RemoteStoreLeaseType } from '@studnicky/dagonizer/contracts';
```

```ts twoslash
import type { StoreInterface, RemoteStoreEndpointType, RemoteStoreLeaseType } from '@studnicky/dagonizer/contracts';
// ---cut---
interface RemoteStoreInterface extends StoreInterface {
  readonly endpoint: RemoteStoreEndpointType;
  acquireLease(subject: string, ttlMs: number, maxWaitMs: number): Promise<RemoteStoreLeaseType>;
  releaseLease(lease: RemoteStoreLeaseType): Promise<void>;
  health(timeoutMs: number): Promise<boolean>;
}
```

The engine consumes a `RemoteStoreInterface` through the `StoreInterface` surface. The extra
methods are observability and coordination primitives the dispatcher uses when
distributed execution is wired in.

### Interface: `RemoteStoreEndpointType`

```ts twoslash
interface RemoteStoreEndpointType {
  readonly url:    string;
  readonly region: string;
}
```

| Field | Description |
|-------|-------------|
| `url` | Stable identifier for the remote endpoint (URL, gRPC target, etc.). |
| `region` | Region/zone hint for placement decisions. Default at construction: `''` (no region constraint). |

`region` is required. Implementations that have no region concept supply `''`.

### Interface: `RemoteStoreLeaseType`

```ts twoslash
interface RemoteStoreLeaseType {
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
| `endpoint` | `RemoteStoreEndpointType` | Endpoint descriptor; surfaces in observability and placement decisions. |
| `acquireLease(subject, ttlMs, maxWaitMs)` | `Promise<RemoteStoreLeaseType>` | Acquire exclusive write authority for `subject` with a lifetime of `ttlMs` ms. Waits up to `maxWaitMs` for an active holder to release before throwing `StoreError(LEASE_DENIED)`. |
| `releaseLease(lease)` | `Promise<void>` | Release a previously-acquired lease. Idempotent: releasing an already-expired lease is a no-op. |
| `health(timeoutMs)` | `Promise<boolean>` | Health probe. Returns `true` when the endpoint is reachable and the backing responds within `timeoutMs`. Implementations must not throw on transport failure: return `false` so the dispatcher can route around an unhealthy store. |

### Implementing `RemoteStoreInterface`

Extend `BaseStore` and implement the three additional methods plus the
`endpoint` property:

```ts
<<< @/../examples/dags/store-remote.ts#remote-store
```

---

## Class: `TypedStore<Schema>`

`@studnicky/dagonizer/store`

Schema-narrowed wrapper over any `StoreInterface`. Constrains keys to the declared
`Schema` and infers the value type from `Schema[K]`. Callers never specify
`<T>` at the call site.

`TypedStore` does not implement the `StoreInterface` contract (its `set` signature is
narrower). Use `.inner` to access the underlying `StoreInterface` when you need the
wider, heterogeneous contract.

```ts
<<< @/../examples/the-archivist/memory/TypedRunStore.ts#typed-store
```

### Constructor

```ts twoslash
import { TypedStore, MemoryStore } from '@studnicky/dagonizer/store';
import { Validator } from '@studnicky/dagonizer';
// ---cut---
interface MySchema { count: number; label: string; }
const CountSchema = { '$id': 'urn:docs:MySchema/count', 'type': 'number' } as const;
const LabelSchema = { '$id': 'urn:docs:MySchema/label', 'type': 'string' } as const;
const store = new TypedStore<MySchema>(new MemoryStore(), {
  count: Validator.compile<MySchema['count']>(CountSchema),
  label: Validator.compile<MySchema['label']>(LabelSchema),
});
```

`Schema` must be a `Record<string, JsonValueType>`: every value type must be JSON-serializable.

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `get(key)` | `Promise<Schema[K] \| null>` | Return the value at `key`, type inferred from `Schema[K]`, or `null` when absent. |
| `set(key, value)` | `Promise<void>` | Write `value` at `key`. `value` must be `Schema[K]`. |
| `has(key)` | `Promise<boolean>` | Return `true` when the key exists. |
| `delete(key)` | `Promise<boolean>` | Remove the key. Returns `true` when the key existed. |
| `update(key, fn)` | `Promise<Schema[K]>` | Atomic read-modify-write. `fn` receives `Schema[K] \| undefined`, returns `Schema[K]`. |
| `snapshot()` | `Promise<StoreSnapshotType>` | Pass-through to the underlying `StoreInterface`. |
| `restore(snapshot)` | `Promise<void>` | Pass-through to the underlying `StoreInterface`. |
| `connect()` | `Promise<void>` | Pass-through to the underlying `StoreInterface`. |
| `disconnect()` | `Promise<void>` | Pass-through to the underlying `StoreInterface`. |
| `.inner` | `StoreInterface` | The underlying `StoreInterface` instance for un-narrowed operations. |

All key parameters are constrained to `keyof Schema & string`. TypeScript
rejects keys absent from the schema and values of the wrong type at compile
time.

---

## Related guides

- [Guide: Shared state](../guide/shared-state)
- [Reference: Checkpoint](./checkpoint): `Checkpoint.capture`, `restoreStores`
