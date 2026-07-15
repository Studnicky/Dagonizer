---
title: 'Checkpoint'
description: 'Checkpoint reference for capturing, serializing, persisting, recalling, and restoring DAG state, cursor positions, and named store snapshots.'
seeAlso:
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`CheckpointStore`, `Snapshottable`, `StoreSnapshotType`, `StoreSnapshotEntryType`'
  - text: 'Reference: Entities'
    link: './entities'
    description: '`CheckpointData`'
  - text: 'Reference: Store'
    link: './store'
    description: '`Store`, `BaseStore`, `MemoryStore`, `StoreError`'
  - text: 'Reference: Validation'
    link: './validation'
    description: '`Validator.checkpoint`'
---

# Checkpoint

## What It Is

The checkpoint surface captures enough information to resume an interrupted DAG run: state, cursor position, lifecycle payload, and optional named store snapshots.

Use this page when a run must survive process exit, browser refresh, worker replacement, human-in-the-loop parking, or any other interruption that should resume deterministically.

## How It Works

`Checkpoint.capture()` builds the record from an execution result and optional named stores. `Checkpoint.load()` parses a persisted record. `Checkpoint.recall()` reads from a checkpoint store. `restoreState()` and `restoreStores()` apply the payload back to runtime objects before `Dagonizer.resume()`.

The checkpoint does not contain node implementations or dispatcher registries. The host must register the DAG and node IRIs before resuming.

## Diagrams, Examples, and Outputs

Checkpoint behavior is easiest to understand through resume examples and store snapshots:

- [Reference: Contracts](./contracts) - `CheckpointStore`, `Snapshottable`, `StoreSnapshotType`, `StoreSnapshotEntryType`
- [Reference: Entities](./entities) - `CheckpointData`
- [Reference: Store](./store) - `Store`, `BaseStore`, `MemoryStore`, `StoreError`
- [Reference: Validation](./validation) - `Validator.checkpoint`

## What It Lets You Do

The checkpoint reference lets applications capture, serialize, persist, recall, and restore interrupted DAG executions.

`@studnicky/dagonizer/checkpoint`

The checkpoint module persists and restores in-flight DAG executions. `Checkpoint.capture()` is the canonical way to build a checkpoint; `Checkpoint.load()` parses a persisted record back into a `Checkpoint` instance. Both work whether or not the run uses named stores.

## Code Samples

The code below covers checkpoint capture, JSON serialization, persistence, recall, state restore, store restore, and the in-memory checkpoint store.

### Import

```ts twoslash
import { Checkpoint, MemoryCheckpointStore } from '@studnicky/dagonizer/checkpoint';
import type { CheckpointRestoreAdapter, CaptureOptionsType } from '@studnicky/dagonizer/checkpoint';
```

---

### Class: `Checkpoint`

`Checkpoint` instances are obtained via `Checkpoint.capture()` (when saving) or `Checkpoint.load()` / `Checkpoint.recall()` (when recalling). Instance methods `toJson`, `persist`, `restoreState`, and `restoreStores` cover the full lifecycle.

```ts twoslash
import { Checkpoint } from '@studnicky/dagonizer/checkpoint';
```

```ts twoslash
import { Checkpoint } from '@studnicky/dagonizer';
```

---

#### `Checkpoint.capture(dagIri, result, options?)`

```ts twoslash
import { Checkpoint } from '@studnicky/dagonizer/checkpoint';
import type { CaptureOptionsType } from '@studnicky/dagonizer/checkpoint';
import type { NodeStateInterface } from '@studnicky/dagonizer';
import { NodeStateBase } from '@studnicky/dagonizer';
import type { ExecutionResultType } from '@studnicky/dagonizer';
// ---cut---
declare function capture<TState extends NodeStateInterface & NodeStateBase>(
  dagIri: string,
  result: ExecutionResultType<TState>,
  options?: CaptureOptionsType,
): Promise<Checkpoint>;
```

Async factory. Builds a `Checkpoint` instance from a DAG reference, execution result, and optional named stores. The DAG reference is expanded to the stored DAG IRI; `result.cursor` is the placement IRI to resume from. Store snapshots run through the shared batch executor; `options.execution` controls snapshot concurrency, throttle, and timing. The instance exposes `.data` (the `CheckpointData` record) and instance methods for the resume side.

Throws `DAGError` when `result.cursor === null` (the DAG completed; nothing to resume).

```ts
<<< @/../examples/08-checkpoint.ts#capture
```

Calling `Checkpoint.capture` without a `stores` option (or with an empty map) writes an empty `stores: {}` object. The checkpoint loads and resumes cleanly; `restoreStores` is a no-op when the map is empty.

---

#### `Checkpoint.load(raw)`

```ts twoslash
import { Checkpoint } from '@studnicky/dagonizer/checkpoint';
declare const raw: unknown;
// ---cut---
const checkpoint: Checkpoint = Checkpoint.load(raw);
```

Parse and validate a raw `CheckpointData` object (e.g. from `JSON.parse`) and wrap it in a `Checkpoint` instance. Throws `ValidationError` when the raw value fails schema validation.

```ts
<<< @/../examples/08-checkpoint.ts#recall
```

---

#### `Checkpoint.recall(store, key)`

```ts twoslash
import { Checkpoint } from '@studnicky/dagonizer/checkpoint';
import type { CheckpointStoreInterface } from '@studnicky/dagonizer/contracts';
declare const store: CheckpointStoreInterface;
declare const key: string;
// ---cut---
const checkpoint: Checkpoint | null = await Checkpoint.recall(store, key);
```

Load a checkpoint from a `CheckpointStore` by key. Returns `null` when the store has no entry for the key. Composes `store.load` + `JSON.parse` + `Checkpoint.load`. Throws `ValidationError` when the stored JSON fails schema validation.

```ts
<<< @/../examples/the-archivist/runArchivist.ts#resume-run
```

---

#### `ckpt.toJson()`

```ts twoslash
import type { Checkpoint } from '@studnicky/dagonizer/checkpoint';
declare const ckpt: Checkpoint;
// ---cut---
const json: string = ckpt.toJson();
```

Serialize this checkpoint's data to a pretty-printed JSON string. Symmetric counterpart to `JSON.parse` + `Checkpoint.load`.

```ts
<<< @/../examples/08-checkpoint.ts#persist
```

---

#### `ckpt.persist(store, key)`

```ts twoslash
import type { Checkpoint } from '@studnicky/dagonizer/checkpoint';
import type { CheckpointStoreInterface } from '@studnicky/dagonizer/contracts';
declare const ckpt: Checkpoint;
declare const store: CheckpointStoreInterface;
declare const key: string;
// ---cut---
await ckpt.persist(store, key);
```

Persist this checkpoint to a `CheckpointStore` under `key`. Composes `toJson` + `store.save`. Throws when the underlying store throws.

```ts
<<< @/../examples/08-checkpoint.ts#persist
```

---

#### `ckpt.restoreState(adapter)`

Rehydrate the state from this checkpoint via the supplied adapter. Returns the rehydrated state, DAG IRI, cursor, and execution history. Pass the result to `dispatcher.resume`.

`CheckpointRestoreAdapter<TState>` constructs a graph-backed state instance. For a quick inline factory, wrap a plain function with `CheckpointRestoreAdapter.wrap(fn)` from `@studnicky/dagonizer/checkpoint`:

```ts twoslash
import { Checkpoint, CheckpointRestoreAdapter } from '@studnicky/dagonizer/checkpoint';
import { NodeStateBase } from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';
class MyState extends NodeStateBase {}
declare const ckpt: Checkpoint;
// ---cut---
const { dagName, state, cursor } = await ckpt.restoreState(
  CheckpointRestoreAdapter.wrap(() => new MyState()),
);
```

```ts
<<< @/../examples/08-checkpoint.ts#recall
```

Throws `ValidationError` when `ckpt.data.cursor === null`.

`RecalledCheckpoint<TState>` shape:

```ts twoslash
import type { RecalledCheckpointType } from '@studnicky/dagonizer/checkpoint';
import type { NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
declare const recalled: RecalledCheckpointType<NodeStateInterface>;
const _state: NodeStateInterface = recalled.state;
const _dagIri: string = recalled.dagName;
const _placementIri: string = recalled.cursor;
const _executedNodes: string[] = recalled.executedNodes;
const _skippedNodes: string[] = recalled.skippedNodes;
```

---

#### `ckpt.restoreStores(stores, options?)`

```ts twoslash
import type { Checkpoint } from '@studnicky/dagonizer/checkpoint';
import type { RestoreStoresOptionsType } from '@studnicky/dagonizer/checkpoint';
import type { SnapshottableInterface } from '@studnicky/dagonizer/contracts';
declare const ckpt: Checkpoint;
declare const stores: Readonly<Record<string, SnapshottableInterface>>;
declare const options: RestoreStoresOptionsType;
// ---cut---
await ckpt.restoreStores(stores);
await ckpt.restoreStores(stores, options);
```

Populate each named store from the snapshots in this checkpoint. The keys in `stores` must match the names used when calling `Checkpoint.capture`. The parameter type is `Snapshottable`: any object that implements `snapshot()` / `restore()`. `Store extends Snapshottable`, so every `Store` qualifies; non-KV backends (RDF triple stores, vector indices, append-only logs) participate without implementing `get`/`set`/`has`/`delete`/`update`. `options.execution` controls restore concurrency, throttle, and timing.

```ts
<<< @/../examples/the-archivist/runArchivist.ts#resume-run
```

**Rules:**
- Name in checkpoint but absent from the map → throws `DAGError` naming the missing stores.
- Name in the map but absent from the checkpoint → no-op (the store is not restored).
- Matched pairs → `store.restore(snapshot)` through the shared batch executor; `BaseStore.restore` throws `StoreError(INCOMPATIBLE_SNAPSHOT)` on type/version mismatch.

---

#### `ckpt.data`

```ts twoslash
import type { Checkpoint } from '@studnicky/dagonizer/checkpoint';
import type { CheckpointDataType } from '@studnicky/dagonizer/entities';
declare const ckpt: Checkpoint;
// ---cut---
const data: CheckpointDataType = ckpt.data;
```

The parsed and validated checkpoint record. Serialize with `ckpt.toJson()`.

---

### Interface: `CheckpointRestoreAdapter<TState>`

```ts twoslash
import type { CheckpointRestoreAdapterInterface } from '@studnicky/dagonizer/contracts';
// ---cut---
declare const adapter: CheckpointRestoreAdapterInterface<{ value: number }>;
const _result: { value: number } = adapter.restore();
```

Contract for constructing a graph-backed state instance before `Checkpoint.restoreState()` restores its JSON-LD graph. Wrap a factory with `CheckpointRestoreAdapter.wrap(() => new MyState())`. Ships from `@studnicky/dagonizer/checkpoint`.

---

### Interface: `CaptureOptionsType`

```ts twoslash
import type { CaptureOptionsType } from '@studnicky/dagonizer/checkpoint';
import type { SnapshottableInterface } from '@studnicky/dagonizer/contracts';
import type { BatchExecutionOptionsType } from '@studnicky/dagonizer/types';
// ---cut---
declare const opts: CaptureOptionsType;
const _stores: Record<string, SnapshottableInterface> | undefined = opts.stores;
const _execution: BatchExecutionOptionsType | undefined = opts.execution;
```

| Field | Description |
|-------|-------------|
| `stores` | Named stores to snapshot alongside the state. Any `Snapshottable`: `Store` instances, or any non-KV backing that implements `snapshot()` / `restore()`. Keys become the names in `CheckpointData.stores`; the same keys must be passed to `restoreStores()` on resume. Omit or leave empty for a state-only checkpoint (the `CheckpointData.stores` field is still written as an empty object `{}`). |
| `execution` | Batch execution policy for `store.snapshot()` calls: `concurrency`, optional `throttle`, and optional `timing`. Omit for the default bounded policy. |

---

### Interface: `RestoreStoresOptionsType`

```ts twoslash
import type { RestoreStoresOptionsType } from '@studnicky/dagonizer/checkpoint';
import type { BatchExecutionOptionsType } from '@studnicky/dagonizer/types';
// ---cut---
declare const opts: RestoreStoresOptionsType;
const _execution: BatchExecutionOptionsType | undefined = opts.execution;
```

| Field | Description |
|-------|-------------|
| `execution` | Batch execution policy for `store.restore(snapshot)` calls: `concurrency`, optional `throttle`, and optional `timing`. Omit for the default bounded policy. |

---

### Interface: `RecalledCheckpoint<TState>`

```ts twoslash
import type { RecalledCheckpointType } from '@studnicky/dagonizer/checkpoint';
import type { NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
declare const recalled: RecalledCheckpointType<NodeStateInterface>;
const _state: NodeStateInterface = recalled.state;
const _dagIri: string = recalled.dagName;
const _cursor: string = recalled.cursor;
const _executedNodes: string[] = recalled.executedNodes;
const _skippedNodes: string[] = recalled.skippedNodes;
```

---

### Type: `CheckpointData`

Derived from `CheckpointDataSchema` via `json-schema-to-ts`.

```ts twoslash
import type { CheckpointDataType } from '@studnicky/dagonizer/entities';
// ---cut---
declare const data: CheckpointDataType;
const _dagIri: string = data.dagName;
const _placementIri: string | null = data.cursor;
const _graph = data.graph;
const _executedNodes: string[] = data.executedNodes;
const _skippedNodes: string[] = data.skippedNodes;
const _stores: CheckpointDataType['stores'] = data.stores;
```

`stores` is a required field. `Checkpoint.capture` always writes it: as an empty object `{}` when no stores are passed, or as a keyed map of `StoreSnapshotType` envelopes when stores are supplied. Any checkpoint payload lacking the field is rejected by `Checkpoint.load`.

`restoreStores` treats an empty `stores` field as a no-op, so state-only checkpoints resume cleanly. Named stores captured at checkpoint time must be supplied by name in the `restoreStores` map; a name present in the checkpoint but absent from the map throws `DAGError`.

---

### Type: `CheckpointDataSchema`

JSON Schema object for `CheckpointData`.

```ts twoslash
import { CheckpointDataSchema } from '@studnicky/dagonizer/entities';
// ---cut---
console.log(CheckpointDataSchema.$id);
// 'https://noocodec.dev/schemas/dagonizer/CheckpointData'
```

---

### Class: `MemoryCheckpointStore`

In-process `CheckpointStore`. Stores entries in a `Map<string, string>` on the instance. Useful for tests, examples, and ephemeral demo flows. Not for production: the map vanishes when the process exits.

```ts twoslash
import { MemoryCheckpointStore } from '@studnicky/dagonizer/checkpoint';
```

#### Members

| Member | Description |
|--------|-------------|
| `save(key, json)` | Store `json` under `key`. Overwrites existing entries. |
| `load(key)` | Return the JSON string, or `null` when no entry exists. |
| `delete(key)` | Remove the entry. No-op when missing. |
| `get size()` | Number of entries currently held. Test-only convenience. |

```ts
<<< @/../examples/the-archivist/runArchivist.ts#resume-run
```

---

## Details for Nerds

A checkpoint is only useful with the registered DAG and node IRIs, plus any plugin DAG IRIs, state factories, and stores needed by the saved cursor.

Store snapshots are named. Capture and restore should use stable store names so a persisted checkpoint can rehydrate the intended store instead of a new empty instance.

## Related Concepts

- [Reference: Contracts](./contracts) - `CheckpointStore`, `Snapshottable`, `StoreSnapshotType`, `StoreSnapshotEntryType`
- [Reference: Entities](./entities) - `CheckpointData`
- [Reference: Store](./store) - `Store`, `BaseStore`, `MemoryStore`, `StoreError`
- [Reference: Validation](./validation) - `Validator.checkpoint`
- [Checkpoint and Resume](../guide/checkpoint) - capture and resume flow
- [Checkpoint Persistence](../guide/persistence) - durable checkpoint-store implementations
- [Shared State](../guide/shared-state) - store snapshots and shared state
- [Subclassing State](../guide/subclassing) - state restore requirements
