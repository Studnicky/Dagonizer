---
title: 'Checkpoint and Resume'
description: 'Checkpoint.capture snapshots an interrupted execution; toJson serializes it; Checkpoint.load + restoreState rehydrates parent state; dispatcher.resume continues from the cursor.'
seeAlso:
  - text: 'Persistence'
    link: './persistence'
    description: 'wire `ckpt.persist` and `Checkpoint.recall` to a `CheckpointStore`'
  - text: 'Cancellation'
    link: './cancellation'
    description: 'abort a flow to produce a non-null cursor worth checkpointing'
  - text: 'Subclassing State'
    link: './subclassing'
    description: 'override `snapshotData()` and `restoreData()` for domain fields'
---

<script setup lang="ts">
import { CytoscapeRenderer } from '@noocodex/dagonizer/viz';
import type { ElementDefinition } from 'cytoscape';
import { DAG_CONTEXT } from '@noocodex/dagonizer';
import type { DAG } from '@noocodex/dagonizer';

const dag: DAG = {
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:count',
  '@type': 'DAG',
  name: 'count',
  version: '1',
  entrypoint: 'a',
  nodes: [
    { '@id': 'urn:noocodex:dag:count/node/a', '@type': 'SingleNode', name: 'a', node: 'inc', outputs: { success: 'b' } },
    { '@id': 'urn:noocodex:dag:count/node/b', '@type': 'SingleNode', name: 'b', node: 'inc', outputs: { success: 'c' } },
    { '@id': 'urn:noocodex:dag:count/node/c', '@type': 'SingleNode', name: 'c', node: 'inc', outputs: { success: null } },
  ],
};

const elements = CytoscapeRenderer.render(dag) as ElementDefinition[];
</script>

# Checkpoint and Resume

`Checkpoint` is the codec: it turns an interrupted `ExecutionResult` into a portable record and back. `dispatcher.resume(dagName, state, cursor)` picks the execution up from the restored cursor. Persistence is the consumer's concern (see [persistence](./persistence)).

## API surface

| Symbol | Source | Role |
|--------|--------|------|
| `Checkpoint.capture(dagName, result, options?)` | `@noocodex/dagonizer/checkpoint` | Async factory: turns a paused execution into a `Checkpoint` |
| `Checkpoint.load(raw)` | `@noocodex/dagonizer/checkpoint` | Schema-validates an unknown value into a `Checkpoint` |
| `Checkpoint.recall(store, key)` | `@noocodex/dagonizer/checkpoint` | Reads + parses + validates from a `CheckpointStore` |
| `ckpt.toJson()` | instance method | Serializes to a JSON string |
| `ckpt.persist(store, key)` | instance method | Writes via a `CheckpointStore` |
| `ckpt.restoreState(fn)` | instance method | Rehydrates `{ dagName, state, cursor }` |
| `ckpt.restoreStores(map)` | instance method | Restores named stores (any `Snapshottable`) from the envelope |
| `dispatcher.resume(dagName, state, cursor)` | `@noocodex/dagonizer` | Resumes the flow at `cursor` |

## DAG that drives the example

A three-node linear DAG. An abort after node `a` leaves `cursor === 'b'`; the resumed run executes `b` and `c` only:

<DagGraph :elements="elements" aria-label="Three-node linear count DAG; abort after a; resume from b." />

## Capturing a partial run

When a DAG stops early (cancellation, timeout, error), `result.cursor` holds the name of the next node that would have run. Pass that to `Checkpoint.capture()`:

<<< @/../examples/08-checkpoint.ts#capture

`Checkpoint.capture()` throws `DAGError` when `result.cursor === null` (the DAG completed, nothing to resume).

## Serializing the checkpoint

<<< @/../examples/08-checkpoint.ts#persist

`ckpt.toJson()` is `JSON.stringify(ckpt.data, null, 2)`. The output is a stable JSON document; persist it however the system stores other JSON: file, database column, object store, etc.

## Loading and rehydrating state

<<< @/../examples/08-checkpoint.ts#recall

`Checkpoint.load(raw)` validates the unknown value against `CheckpointDataSchema` (Ajv 2020-12) before touching any fields. An invalid or stale payload throws `ValidationError`. `ckpt.restoreState(fn)` receives a factory that maps the snapshot `JsonObject` to a `TState` instance; that is the boundary where domain state classes plug in.

## Resuming execution

<<< @/../examples/08-checkpoint.ts#resume

`dispatcher.resume` continues the flow at the cursor and runs the remaining nodes. The dispatcher does not re-execute completed nodes; the recorded `executedNodes` and `skippedNodes` survive the round-trip.

## Named stores ride along

`Checkpoint.capture(dagName, result, { stores })` snapshots named stores into the checkpoint envelope alongside the state, and `ckpt.restoreStores(map)` repopulates fresh instances on resume:

```ts
const ckpt = await Checkpoint.capture('my-dag', result, { stores: { memory } });
// ...persist, then on resume:
const fresh = new MyStore();
await recalled.restoreStores({ memory: fresh });
```

Both take `Record<string, Snapshottable>`: the capability, not the key-value `Store` surface. A non-KV backing (an RDF triple store, a vector index) checkpoints by implementing `snapshot()` / `restore()` only. A name present in the checkpoint but absent from the restore map throws `DAGError`; an extra name in the map is a no-op. See [Store, `Snapshottable`](../reference/store).

## `NodeStateBase.snapshot()` and `snapshotData()`

`snapshot()` captures metadata, errors, warnings, and the retry budget (`retries`). Domain fields are excluded unless the subclass overrides `snapshotData()`:

```ts
class PipelineState extends NodeStateBase {
  items: string[] = [];
  processedCount = 0;

  protected override snapshotData() {
    return {
      items: [...this.items],
      processedCount: this.processedCount,
    };
  }

  protected override restoreData(snap: JsonObject) {
    const raw = snap['items'];
    if (Array.isArray(raw)) this.items = raw as string[];
    const n = snap['processedCount'];
    if (typeof n === 'number') this.processedCount = n;
  }
}
```

`restoreData` is called by `NodeStateBase.restore(snap)`. The static `restore` method is typed with `this`-polymorphism so subclasses return the correct instance type.

## `snapshotData` and `restoreData` contract

- `snapshotData()` returns a JSON-serializable `JsonObject`. No `undefined` values, no circular references.
- `restoreData(snap)` receives the full merged snapshot (base fields plus domain fields). Call `super.applySnapshot(snap)` when overriding `applySnapshot` directly.
- Lifecycle is intentionally not captured. `resume()` starts a fresh lifecycle run from `pending`.

## CheckpointStore: composing with persistence

`CheckpointStore` is the adapter contract for persistence backends. `ckpt.persist(store, key)` and `Checkpoint.recall(store, key)` compose the codec with a store so save and resume become a single call per side.

```ts
import { Checkpoint, MemoryCheckpointStore } from '@noocodex/dagonizer/checkpoint';

const store = new MemoryCheckpointStore();

const ckpt = await Checkpoint.capture('my-dag', result);
await ckpt.persist(store, 'ckpt:my-dag');

const recalled = await Checkpoint.recall(store, 'ckpt:my-dag');
if (recalled !== null) {
  const { dagName, state, cursor } = recalled.restoreState((snap) => MyState.restore(snap));
  await dispatcher.resume(dagName, state, cursor);
}
```

`MemoryCheckpointStore` is for tests and demos. Production deployments implement `CheckpointStore` against a database, object store, or filesystem (see [persistence](./persistence)).

## Scatter resume: per-item progress

A `ScatterNode` with a `source` records per-item progress on `state.metadata` so a checkpointed run does not re-execute already-completed clones on resume. This matters most for long scatter runs whose items hit external APIs or LLMs: re-running a 200-item batch from the top after a restart would burn quota and waste hours.

### Reserved metadata key

```ts
import { SCATTER_PROGRESS_KEY } from '@noocodex/dagonizer';
// SCATTER_PROGRESS_KEY === '__dagonizer_scatter_progress__'
```

Consumer nodes must not write to this key. It is engine-internal and may be overwritten or cleared between batch boundaries by `executeScatter`.

The stored shape is a record keyed by the scatter placement's `name`, so multiple `ScatterNode` placements in one DAG keep independent progress entries:

```ts
interface ScatterProgress {
  readonly placementName: string;
  readonly completedIndices: readonly number[];
  readonly itemResults: readonly { readonly index: number; readonly output: string }[];
}

type StoredScatterProgress = Readonly<Record<string, ScatterProgress>>;
```

### Lifecycle

1. **On entry**: `executeScatter` reads `state.metadata[SCATTER_PROGRESS_KEY]?.[scatter.name]`. Items whose indices appear in `completedIndices` are skipped; their recorded outputs rehydrate the gather accumulator.
2. **Per-batch write**: after each `Promise.all(batchPromises)` resolves, the dispatcher updates the placement's entry with the batch's completed indices. Writes happen once per batch (not per item) to keep the metadata update serialised across concurrent item promises.
3. **Pre-gather clear**: once every batch drains, the placement's entry is removed before the gather strategy runs. Gather always starts from a clean slate; subsequent re-runs of the same `ScatterNode` (such as inside a loop) do not see stale bookkeeping.

### Index semantics on resume

Indices refer to positions in the source array at the time of resume, not the array as it stood when the checkpoint was captured. If the consumer rewrites the source array between checkpoint and resume, the resumed scatter trusts the persisted indices verbatim; items 0 and 1 are skipped even when the array has been re-sliced or reordered.

Treat the scatter's source array as immutable while a scatter checkpoint is live. If the source must change between runs, clear the entry under `SCATTER_PROGRESS_KEY[scatter.name]` before calling `dispatcher.resume()` so the scatter re-executes every item against the new source.

### Snapshot round-trip

The reserved key rides along with the rest of `state.metadata` through `NodeStateBase.snapshot()` and `restore()`. No extra plumbing in consumer state classes; `snapshotData()` overrides do not need to touch the progress key. `Checkpoint.capture()` and `Checkpoint.load()` both preserve it intact.

## Related reference

- [Reference: Checkpoint](../reference/checkpoint)
- [Reference: Contracts](../reference/contracts)
- [Demo: Phase 08 Checkpoint resume](../examples/08-checkpoint)
