---
seeAlso:
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`CheckpointStore`, `Snapshottable`, `StoreSnapshot`, `StoreSnapshotEntry`'
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

`@noocodex/dagonizer/checkpoint`

The checkpoint module persists and restores in-flight DAG executions. `Checkpoint.capture()` is the canonical way to build a checkpoint; `Checkpoint.load()` parses a persisted record back into a `Checkpoint` instance. Both work whether or not the run uses named stores.

---

## Class: `Checkpoint`

`Checkpoint` instances are obtained via `Checkpoint.capture()` (when saving) or `Checkpoint.load()` / `Checkpoint.recall()` (when recalling). Instance methods `toJson`, `persist`, `restoreState`, and `restoreStores` cover the full lifecycle.

```ts
import { Checkpoint } from '@noocodex/dagonizer/checkpoint';
```

```ts
import { Checkpoint } from '@noocodex/dagonizer';
```

---

### `Checkpoint.capture(dagName, result, options?)`

```ts
static async capture<TState extends NodeStateInterface & NodeStateBase>(
  dagName: string,
  result: ExecutionResultInterface<TState>,
  options?: CaptureOptionsInterface,
): Promise<Checkpoint>
```

Async factory. Builds a `Checkpoint` instance from a flow name, execution result, and optional named stores. Snapshots all stores in parallel (via `store.snapshot()`). The instance exposes `.data` (the `CheckpointData` record) and instance methods for the resume side.

Throws `DAGError` when `result.cursor === null` (the DAG completed; nothing to resume).

```ts
import { Checkpoint } from '@noocodex/dagonizer/checkpoint';
import { MemoryStore } from '@noocodex/dagonizer/store';

const memory = new MemoryStore();
// ... nodes write to memory during the run ...
const result = await dispatcher.execute('my-dag', state, { signal: ctl.signal });

if (result.cursor !== null) {
  const ckpt = await Checkpoint.capture('my-dag', result, { stores: { memory } });
  await storage.set(runId, ckpt.toJson());
}
```

Calling `Checkpoint.capture` without a `stores` option (or with an empty map) writes an empty `stores: {}` object. The checkpoint loads and resumes cleanly; `restoreStores` is a no-op when the map is empty.

---

### `Checkpoint.load(raw)`

```ts
static load(raw: unknown): Checkpoint
```

Parse and validate a raw `CheckpointData` object (e.g. from `JSON.parse`) and wrap it in a `Checkpoint` instance. Throws `ValidationError` when the raw value fails schema validation.

```ts
const raw = JSON.parse(await storage.get(runId)) as unknown;
const ckpt = Checkpoint.load(raw);
```

---

### `Checkpoint.recall(store, key)`

```ts
static async recall(store: CheckpointStore, key: string): Promise<Checkpoint | null>
```

Load a checkpoint from a `CheckpointStore` by key. Returns `null` when the store has no entry for the key. Composes `store.load` + `JSON.parse` + `Checkpoint.load`. Throws `ValidationError` when the stored JSON fails schema validation.

```ts
const ckpt = await Checkpoint.recall(store, 'ckpt:my-dag');
if (ckpt !== null) {
  const { dagName, state, cursor } = ckpt.restoreState((snap) => MyState.restore(snap));
  await dispatcher.resume(dagName, state, cursor);
}
```

---

### `ckpt.toJson()`

```ts
toJson(): string
```

Serialize this checkpoint's data to a pretty-printed JSON string. Symmetric counterpart to `JSON.parse` + `Checkpoint.load`.

```ts
const ckpt = await Checkpoint.capture('my-dag', result);
await storage.set('ckpt', ckpt.toJson());
```

---

### `ckpt.persist(store, key)`

```ts
async persist(store: CheckpointStore, key: string): Promise<void>
```

Persist this checkpoint to a `CheckpointStore` under `key`. Composes `toJson` + `store.save`. Throws when the underlying store throws.

```ts
const store = new MemoryCheckpointStore();
const ckpt = await Checkpoint.capture('my-dag', result);
await ckpt.persist(store, 'ckpt:my-dag');
```

---

### `ckpt.restoreState(restoreFn)`

```ts
restoreState<TState extends NodeStateInterface>(
  restoreFn: StateRestoreFnType<TState>,
): RecalledCheckpoint<TState>
```

Rehydrate the state from this checkpoint via the supplied factory. Returns the rehydrated state, dag name, cursor, and execution history. Pass the result to `dispatcher.resume`.

```ts
const raw = JSON.parse(await storage.get(runId)) as unknown;
const ckpt = Checkpoint.load(raw);
const { dagName, state, cursor } = ckpt.restoreState(
  (snap) => MyState.restore(snap),
);
const result = await dispatcher.resume(dagName, state, cursor);
```

Throws `ValidationError` when `ckpt.data.cursor === null`.

`RecalledCheckpoint<TState>` shape:

```ts
interface RecalledCheckpoint<TState> {
  readonly state: TState;
  readonly dagName: string;
  readonly cursor: string;
  readonly executedNodes: readonly string[];
  readonly skippedNodes: readonly string[];
}
```

---

### `ckpt.restoreStores(stores)`

```ts
async restoreStores(stores: Readonly<Record<string, Snapshottable>>): Promise<void>
```

Populate each named store from the snapshots in this checkpoint. The keys in `stores` must match the names used when calling `Checkpoint.capture`. The parameter type is `Snapshottable`: any object that implements `snapshot()` / `restore()`. `Store extends Snapshottable`, so every `Store` qualifies; non-KV backends (RDF triple stores, vector indices, append-only logs) participate without implementing `get`/`set`/`has`/`delete`/`update`.

```ts
const freshMemory = new MemoryStore();
await ckpt.restoreStores({ memory: freshMemory });
// freshMemory now contains the state captured at checkpoint time.
```

**Rules:**
- Name in checkpoint but absent from the map → throws `DAGError` naming the missing stores.
- Name in the map but absent from the checkpoint → no-op (the store is not restored).
- Matched pairs → `store.restore(snapshot)` in parallel; `BaseStore.restore` throws `StoreError(INCOMPATIBLE_SNAPSHOT)` on type/version mismatch.

---

### `ckpt.data`

```ts
readonly data: CheckpointData
```

The parsed and validated checkpoint record. Serialize with `ckpt.toJson()`.

---

## Type: `StateRestoreFnType<TState>`

```ts
type StateRestoreFnType<TState extends NodeStateInterface> =
  (snapshot: JsonObject) => TState;
```

Any function that maps a snapshot `JsonObject` to a `TState` instance. The typical form is `(snap) => MyState.restore(snap)`, where `MyState.restore` is inherited from `NodeStateBase`.

---

## Interface: `CaptureOptionsInterface`

```ts
interface CaptureOptionsInterface {
  readonly stores?: Readonly<Record<string, Snapshottable>>;
}
```

| Field | Description |
|-------|-------------|
| `stores` | Named stores to snapshot alongside the state. Any `Snapshottable`: `Store` instances, or any non-KV backing that implements `snapshot()` / `restore()`. Keys become the names in `CheckpointData.stores`; the same keys must be passed to `restoreStores()` on resume. Omit or leave empty for a state-only checkpoint (the `CheckpointData.stores` field is still written as an empty object `{}`). |

---

## Interface: `RecalledCheckpoint<TState>`

```ts
interface RecalledCheckpoint<TState extends NodeStateInterface> {
  readonly state: TState;
  readonly dagName: string;
  readonly cursor: string;
  readonly executedNodes: readonly string[];
  readonly skippedNodes: readonly string[];
}
```

---

## Type: `CheckpointData`

Derived from `CheckpointDataSchema` via `json-schema-to-ts`.

```ts
interface CheckpointData {
  version: '1';
  dagName: string;
  cursor: string | null;
  state: Record<string, unknown>;
  executedNodes: string[];
  skippedNodes: string[];
  stores: Record<string, StoreSnapshot>; // always present; empty object {} when no stores were captured
}
```

`stores` is a required field. `Checkpoint.capture` always writes it: as an empty object `{}` when no stores are passed, or as a keyed map of `StoreSnapshot` envelopes when stores are supplied. `Checkpoint.load` rejects any payload that lacks the field: checkpoints produced before this field was introduced do not load.

`restoreStores` treats an empty `stores` field as a no-op, so state-only checkpoints resume cleanly. Named stores captured at checkpoint time must be supplied by name in the `restoreStores` map; a name present in the checkpoint but absent from the map throws `DAGError`.

The `version` field tracks the wire format, independent of the DAG's own version. Increment `CHECKPOINT_DATA_VERSION` when the shape changes incompatibly.

---

## Const: `CHECKPOINT_DATA_VERSION`

```ts
const CHECKPOINT_DATA_VERSION = '1' as const;
```

Current wire-format version for `CheckpointData`. Written into every checkpoint record and checked during `Checkpoint.load` validation.

---

## Type: `CheckpointDataSchema`

JSON Schema object for `CheckpointData`.

```ts
import { CheckpointDataSchema } from '@noocodex/dagonizer/entities';
console.log(CheckpointDataSchema.$id);
// 'https://noocodex.dev/schemas/dagonizer/CheckpointData'
```

---

## Class: `MemoryCheckpointStore`

In-process `CheckpointStore`. Stores entries in a `Map<string, string>` on the instance. Useful for tests, examples, and ephemeral demo flows. Not for production: the map vanishes when the process exits.

```ts
import { MemoryCheckpointStore } from '@noocodex/dagonizer/checkpoint';
```

### Members

| Member | Description |
|--------|-------------|
| `save(key, json)` | Store `json` under `key`. Overwrites existing entries. |
| `load(key)` | Return the JSON string, or `null` when no entry exists. |
| `delete(key)` | Remove the entry. No-op when missing. |
| `get size()` | Number of entries currently held. Test-only convenience. |

```ts
const store = new MemoryCheckpointStore();
const ckpt = await Checkpoint.capture('my-dag', result);
await ckpt.persist(store, 'ckpt');
const recalled = await Checkpoint.recall(store, 'ckpt');
if (recalled !== null) {
  const { dagName, state, cursor } = recalled.restoreState((snap) => MyState.restore(snap));
}
```

---

## Related guides

- [Checkpoint](../guide/checkpoint)
- [Persistence](../guide/persistence)
- [Shared state](../guide/shared-state)
- [Subclassing State](../guide/subclassing)
