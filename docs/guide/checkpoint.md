---
seeAlso:

  - text: 'Persistence'

    link: './persistence'
    description: 'wire `ckpt.persist` / `Checkpoint.recall` to a `CheckpointStore`'

  - text: 'Cancellation'

    link: './cancellation'
    description: 'abort a flow to produce a non-null cursor worth checkpointing'

  - text: 'Subclassing State'

    link: './subclassing'
    description: 'override `snapshotData()` / `restoreData()` for domain fields'
---

# Checkpoint & Resume

Checkpoint persists an in-flight DAG at its current cursor so execution can continue in a later process or after a restart.

## How it works

When a DAG stops early — via cancellation, timeout, or an error — `result.cursor` holds the name of the next node that would have run. Pass that cursor to `Checkpoint.capture()` to build a `Checkpoint` instance, then serialize and store it with `ckpt.toJson()`.

On resume, parse the stored JSON, call `Checkpoint.load(raw)` to get a `Checkpoint` instance, then call `ckpt.restoreState(fn)` to rehydrate the state and cursor, and pass them to `dispatcher.resume()`.

## Cursor and state snapshot

```ts
const ctl = new AbortController();
const result = await dispatcher.execute('my-dag', state, { signal: ctl.signal });

if (result.cursor !== null) {
  // DAG did not complete — checkpoint it.
  const ckpt = await Checkpoint.capture('my-dag', result);
  await db.set('current-checkpoint', ckpt.toJson());
}
```

`Checkpoint.capture()` throws `DAGError` when `result.cursor === null` (the DAG completed — nothing to resume).

## Restoring and resuming

```ts
const raw = JSON.parse(await db.get('current-checkpoint')) as unknown;
const ckpt = Checkpoint.load(raw);
const { dagName, state: restored, cursor } = ckpt.restoreState(
  (snap) => MyState.restore(snap),
);
const result = await dispatcher.resume(dagName, restored, cursor);
```

The argument to `restoreState()` is a factory function that maps the snapshot `JsonObject` to a `TState` instance. This is how domain-specific state is rehydrated.

## `NodeStateBase.snapshot()` and `snapshotData()`

`snapshot()` captures metadata, errors, and warnings. Domain fields are excluded unless the subclass overrides `snapshotData()`:

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

## `snapshotData` / `restoreData` contract

- `snapshotData()` must return a JSON-serializable `JsonObject`. No `undefined` values, no circular references.
- `restoreData(snap)` receives the full merged snapshot (base fields plus domain fields). Call `super.applySnapshot(snap)` when overriding `applySnapshot` directly.
- Lifecycle is intentionally **not** captured — `resume()` starts a fresh lifecycle run from `pending`.

## CheckpointStore — composing with persistence

`CheckpointStore` is the adapter contract for persistence backends. `ckpt.persist(store, key)` and `Checkpoint.recall(store, key)` compose the codec with a store so save/resume becomes a single call per side.

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

`MemoryCheckpointStore` is for tests and demos. Production deployments implement `CheckpointStore` against a database, object store, or filesystem — see [persistence](./persistence.md) for a Postgres reference implementation.

## `toJson` and `Checkpoint.load`

```ts
// Write
const ckpt = await Checkpoint.capture('my-dag', result);
const json = ckpt.toJson(); // JSON.stringify(ckpt.data, null, 2)
await fs.writeFile('checkpoint.json', json);

// Read
const raw = JSON.parse(await fs.readFile('checkpoint.json', 'utf8')) as unknown;
const ckpt2 = Checkpoint.load(raw);
const { dagName, state, cursor } = ckpt2.restoreState((snap) => MyState.restore(snap));
```

`Checkpoint.load()` validates the raw value against `CheckpointDataSchema` (Ajv 2020-12) before touching any fields. An invalid or stale payload throws `ValidationError`.

## Full cycle

```ts
import { Checkpoint, Dagonizer, NodeStateBase } from '@noocodex/dagonizer';
import type { JsonObject } from '@noocodex/dagonizer';

class S extends NodeStateBase {
  count = 0;

  protected override snapshotData(): JsonObject {
    return { count: this.count };
  }

  protected override restoreData(snap: JsonObject): void {
    const c = snap['count'];
    if (typeof c === 'number') this.count = c;
  }
}

// --- First run (interrupted) ---
const ctl = new AbortController();
const s1 = new S();
const exec = dispatcher.execute('count-dag', s1, { signal: ctl.signal });
for await (const node of exec) {
  if (node.nodeName === 'b') ctl.abort(new Error('pause'));
}
const partial = await exec;

// --- Persist ---
const ckpt = await Checkpoint.capture('count-dag', partial);
const stored = ckpt.toJson();

// --- Resume (later, new process) ---
const ckpt2 = Checkpoint.load(JSON.parse(stored) as unknown);
const { dagName, state: s2, cursor } = ckpt2.restoreState((snap) => S.restore(snap));
const final = await dispatcher.resume(dagName, s2, cursor);
console.log(final.state.count);       // count from before + count from after
console.log(final.state.lifecycle.kind); // 'completed'
```
## Related reference

- [Reference: Checkpoint](../reference/checkpoint)
- [Reference: Contracts — `CheckpointStore`](../reference/contracts)
- [Example: Checkpoint Resume](../examples/08-checkpoint)
