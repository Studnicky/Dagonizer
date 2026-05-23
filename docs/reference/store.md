---
seeAlso:

  - text: 'Reference: Contracts — `Store`, `StoreSnapshot`, `StoreSnapshotEntry`'

    link: './contracts'

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
implementations. Stores live in the services bag and survive deep-DAG
boundaries within a run. Checkpoint integration snapshots named stores
alongside parent state for deterministic resume.

```ts
import { BaseStore, MemoryStore, StoreError } from '@noocodex/dagonizer/store';
import type { Store, StoreSnapshot, StoreSnapshotEntry } from '@noocodex/dagonizer/contracts';
```

---

## Interface: `Store`

`@noocodex/dagonizer/contracts`

Shared key-value store contract. Every method returns a `Promise`. There is no
sync variant — always `await` store calls.

Values are typed per-call via the method's `<T>` parameter — there is no
class-level value generic. A `Store` instance can hold heterogeneous values
under different keys; type narrowing happens at the call site.

```ts
interface Store {
  get<T extends JsonValue>(key: string): Promise<T | undefined>;
  set<T extends JsonValue>(key: string, value: T): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  update<T extends JsonValue>(key: string, fn: (current: T | undefined) => T): Promise<T>;
  snapshot(): Promise<StoreSnapshot>;
  restore(snapshot: StoreSnapshot): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
```

| Method | Returns | Description |
|--------|---------|-------------|
| `get(key)` | `Promise<T \| undefined>` | Return the value at `key`, or `undefined` when absent. |
| `set(key, value)` | `Promise<void>` | Write `value` at `key`. Last-write-wins. |
| `has(key)` | `Promise<boolean>` | Return `true` when the key exists. |
| `delete(key)` | `Promise<boolean>` | Remove the key. Returns `true` when the key existed. |
| `update(key, fn)` | `Promise<T>` | Atomic read-modify-write. `fn` receives the current value (or `undefined`) and returns the new value. Implementations are responsible for atomicity. |
| `snapshot()` | `Promise<StoreSnapshot>` | Capture the entire store state as a typed envelope. |
| `restore(snapshot)` | `Promise<void>` | Repopulate from a snapshot. Validates `type` and `version` before applying entries. |
| `connect()` | `Promise<void>` | Optional lifecycle hook for stores that hold a connection. |
| `disconnect()` | `Promise<void>` | Optional lifecycle hook for stores that hold a connection. |

**Concurrency:** `update(key, fn)` is atomic within a single store instance.
Implementations are responsible for delivering this — see the `update` note on
`BaseStore` for the requirement. `set + get` is not atomic.

---

## Interface: `StoreSnapshot`

`@noocodex/dagonizer/contracts`

Versioned snapshot envelope returned by `Store.snapshot()` and consumed by
`Store.restore()`.

```ts
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

```ts
interface StoreSnapshotEntry {
  readonly key:   string;
  readonly value: JsonValue;
}
```

Keys in the snapshot carry the namespace prefix when a namespace is configured.
Restore feeds entries directly back through `performRestoreEntries` — no prefix
stripping is applied; restore into a store with the same namespace used at
capture time.

---

## Class: `BaseStore`

`@noocodex/dagonizer/store`

Abstract base class every concrete store extends. Owns the snapshot envelope,
the `update` default, optional namespace prefix, and lifecycle no-ops.
Concrete stores implement the `protected abstract` hooks listed below.

```ts
import { BaseStore, type BaseStoreOptions } from '@noocodex/dagonizer/store';

abstract class BaseStore implements Store {
  protected constructor(options?: BaseStoreOptions);
}
```

### `BaseStoreOptions`

```ts
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
| `update(key, fn)` | Default: `performGet` → `fn(current)` → `performSet`. Two `await` points — not atomic on its own. Subclasses **must** override when backing supports a single-step RMW (in-memory direct access, SQL transactions, Redis WATCH/MULTI, etc.). The default is a fallback that is only safe when no concurrent calls touch the same key. |
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

```ts
import { MemoryStore } from '@noocodex/dagonizer/store';

const store = new MemoryStore();
await store.set<string>('greeting', 'hello');
const v = await store.get<string>('greeting'); // 'hello'
```

### Constructor

```ts
new MemoryStore(options?: BaseStoreOptions)
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
microtask can interleave between the read and the write — the
read-modify-write is atomic within the store instance.

```ts
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

```ts
import { StoreError } from '@noocodex/dagonizer/store';

try {
  await store.restore(incompatibleSnapshot);
} catch (err) {
  if (err instanceof StoreError && err.classification.reason === 'INCOMPATIBLE_SNAPSHOT') {
    // err.classification.expectedType, .actualType, .expectedVersion, .actualVersion
  }
}
```

### `StoreErrorClassification`

```ts
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
      readonly reason:  'BACKING_ERROR';
      readonly cause: Error;
    };
```

| Reason | When | Extra fields |
|--------|------|-------------|
| `INCOMPATIBLE_SNAPSHOT` | `restore()` called with wrong `type` or `version` | `expectedType`, `actualType`, `expectedVersion`, `actualVersion` |
| `KEY_NOT_FOUND` | Plugin author throws when a required key is absent | `key` |
| `BACKING_ERROR` | Plugin author wraps a backing-level failure | `cause` (optional) |

`BaseStore` throws `INCOMPATIBLE_SNAPSHOT` automatically on type/version
mismatch. `KEY_NOT_FOUND` and `BACKING_ERROR` are available for plugin authors
to classify errors from their backing stores.

---

## Related guides

- [Guide: Shared state](../guide/shared-state)
- [Reference: Checkpoint — `Checkpoint.capture`, `restoreStores`](./checkpoint)
