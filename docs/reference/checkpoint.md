---
seeAlso:

  - text: 'Reference: Contracts — `CheckpointStore`'

    link: './contracts'

  - text: 'Reference: Entities — `CheckpointData`'

    link: './entities'

  - text: 'Reference: Validation — `Validator.checkpoint`'

    link: './validation'
---

# Checkpoint

`@noocodex/dagonizer/checkpoint`

The checkpoint module provides the static utility class for persisting and restoring in-flight DAG executions.

---

## Class: `Checkpoint`

Static class; never instantiated. All methods are static.

```ts
import { Checkpoint } from '@noocodex/dagonizer';
```

---

### `Checkpoint.from(dagName, result)`

```ts
static from<TState extends NodeStateInterface & NodeStateBase>(
  dagName: string,
  result: ExecutionResultInterface<TState>,
): CheckpointData
```

Builds a `CheckpointData` record from a DAG name and an execution result. Throws `DAGError` when `result.cursor === null` (the DAG completed — nothing to resume).

```ts
const result = await dispatcher.execute('my-dag', state, { signal });
if (result.cursor !== null) {
  const data = Checkpoint.from('my-dag', result);
}
```

Internally calls `result.state.snapshot()` to capture the state. Domain-specific fields are included if the state class overrides `snapshotData()`.

---

### `Checkpoint.restore(data, restoreState)`

```ts
static restore<TState extends NodeStateInterface>(
  data: unknown,
  restoreState: StateRestoreFnType<TState>,
): {
  state: TState;
  dagName: string;
  cursor: string;
  executedNodes: string[];
  skippedNodes: string[];
}
```

Validates `data` against `CheckpointDataSchema`, then calls `restoreState(data.state)` to rehydrate the state instance. Returns an object ready to pass to `dispatcher.resume`.

```ts
const parsed = JSON.parse(persisted) as unknown;
const { dagName, state, cursor } = Checkpoint.restore(
  parsed,
  (snap) => MyState.restore(snap),
);
const result = await dispatcher.resume(dagName, state, cursor);
```

Throws `ValidationError` if the raw value does not match `CheckpointDataSchema`.

---

### `Checkpoint.toJson(checkpoint)`

```ts
static toJson(checkpoint: CheckpointData): string
```

Serializes `checkpoint` to a pretty-printed JSON string. Symmetric counterpart to `JSON.parse` + `Checkpoint.restore`.

```ts
const json = Checkpoint.toJson(Checkpoint.from('my-dag', result));
await storage.set('ckpt', json);
```

---

### `Checkpoint.persist(store, key, data)`

```ts
static async persist(store: CheckpointStore, key: string, data: CheckpointData): Promise<void>
```

Persists `data` to a `CheckpointStore` under `key`. Composes `Checkpoint.toJson` with the store's `save`. Throws when the underlying store throws.

```ts
const store = new MemoryCheckpointStore();
await Checkpoint.persist(store, 'ckpt:my-dag', Checkpoint.from('my-dag', result));
```

---

### `Checkpoint.recall(store, key, restoreState)`

```ts
static async recall<TState extends NodeStateInterface>(
  store: CheckpointStore,
  key: string,
  restoreState: StateRestoreFnType<TState>,
): Promise<RecalledCheckpoint<TState> | null>
```

Recalls a checkpoint from a `CheckpointStore`. Returns `null` when no entry exists under `key`; throws `ValidationError` when the stored JSON fails schema validation. Composes the store's `load` with `JSON.parse` and `Checkpoint.restore`.

```ts
const recalled = await Checkpoint.recall(store, 'ckpt:my-dag', (snap) => MyState.restore(snap));
if (recalled !== null) {
  const { dagName, state, cursor } = recalled;
  const result = await dispatcher.resume(dagName, state, cursor);
}
```

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

## Type: `StateRestoreFnType<TState>`

```ts
type StateRestoreFnType<TState extends NodeStateInterface> =
  (snapshot: JsonObject) => TState;
```

Any function that maps a snapshot `JsonObject` to a `TState` instance. The typical form is `(snap) => MyState.restore(snap)`, where `MyState.restore` is inherited from `NodeStateBase`.

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
}
```

The `version` field tracks the wire format, independent of the DAG's own version. Increment `CHECKPOINT_DATA_VERSION` when the shape changes incompatibly.

---

## Const: `CHECKPOINT_DATA_VERSION`

```ts
const CHECKPOINT_DATA_VERSION = '1' as const;
```

Current wire-format version for `CheckpointData`. Written into every checkpoint record and checked during `Checkpoint.restore` validation.

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
await Checkpoint.persist(store, 'ckpt', Checkpoint.from('my-dag', result));
const recalled = await Checkpoint.recall(store, 'ckpt', (snap) => MyState.restore(snap));
```

## Related guides

- [Checkpoint](../guide/checkpoint)
- [Persistence](../guide/persistence)
- [Subclassing State](../guide/subclassing)
