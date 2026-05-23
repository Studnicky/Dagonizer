---
seeAlso:

  - text: 'DAGBuilder'

    link: './builder'
    description: 'typed `inputs` / `outputs` on `.deepDAG()` for compile-time child-state narrowing'

  - text: 'Checkpoint & Resume'

    link: './checkpoint'
    description: 'pair `Checkpoint.capture` with store snapshots to resume shared state alongside parent state'

  - text: 'State accessors'

    link: './state-accessor'
    description: 'how dotted paths resolve on the parent-state side of `stateMapping`'

  - text: 'Subclassing State'

    link: './subclassing'
    description: 'extend `NodeStateBase` for domain-specific parent state'
---

# Shared state

Two complementary mechanisms cross the deep-DAG boundary in Dagonizer. The
right choice depends on the data-flow shape.

## When to use what

| Need | Use | Why |
|---|---|---|
| Sub-DAG produces a value the parent consumes once | `inputs` / `outputs` on `.deepDAG()` | Single-direction, isolated, checkpoint-friendly without extra wiring |
| Sub-DAG needs a parent field as starting input | `inputs` on `.deepDAG()` | Parent field copied into child state before the sub-DAG runs |
| Multiple nodes accumulate growing shared state (agent memory, RAG context, audit log) | `MemoryStore` (or another `Store`) on the services bag | Cross-node and cross-deep-DAG; survives execution boundaries within a run |
| Long-running flow that survives restart | `MemoryStore.snapshot()` via `Checkpoint.capture({ stores })` | Resume captures shared state alongside parent state; stores round-trip through the same checkpoint record |
| Mid-flight introspection by an external observer | `Store` instance held outside the dispatcher | The same instance lives outside the DAG topology; read it concurrently without touching execution |

`stateMapping` (`inputs` / `outputs`) is a field copy at a single boundary.
Use it when the relationship between parent and child is a pure transfer with
a defined input and output.

A `Store` is a live, shared, mutable map. Use it when multiple placements
accumulate to the same structure — a message list, a token budget, an event
log — and that accumulation must persist across sub-DAG boundaries without
threading every value through state-mapping at every hop.

## Concurrency contract for Stores

Every `Store` method returns a `Promise`. There is no sync variant. Always
`await` store calls.

**`update(key, fn)` is atomic within a single store instance.** The callback
receives the current value (or `undefined` when the key is absent) and returns
the new value. Implementations are responsible for delivering this atomicity —
`MemoryStore` overrides `update` to access `#data` without any intermediate
`await`, so no concurrent microtask can interleave between the read and the
write. The base-class default has two `await` points and does not satisfy the
atomicity contract on its own.

**`set + get` is NOT atomic.** If two concurrent paths each call `get` then
`set`, the second write silently discards the first. Use `update` for every
read-modify-write:

```ts
import { MemoryStore } from '@noocodex/dagonizer/store';

const store = new MemoryStore();

// Race condition — two paths increment independently.
// Both read 0, both write 1. Final value: 1 (lost update).
const current = await store.get<number>('counter') ?? 0;
await store.set<number>('counter', current + 1);

// Atomic — update holds the RMW as one indivisible operation.
// Final value: 2.
await store.update<number>('counter', (n) => (n ?? 0) + 1);
await store.update<number>('counter', (n) => (n ?? 0) + 1);
```

**`set` is last-write-wins.** When two concurrent callers call `set` without
coordination, whichever completes last persists. Avoid `set` for any value that
two nodes write independently; use `update` instead.

Stores do not synchronize across process boundaries. The concurrency contract
is per-instance, in-process. Distributed stores are forward-compatible because
the contract is fully async — plugin authors implement cross-process atomicity
inside `update` (single-step backing access, SQL transactions, Redis
WATCH/MULTI, etc.).

## Authoring a custom store

Extend `BaseStore` and implement six `protected abstract` methods plus two
`protected abstract get` accessors. Subclasses **must** override `update` to
satisfy the atomicity contract; the base-class default is a fallback that is
only safe when no concurrent calls touch the same key.

```ts
import type { StoreSnapshotEntry } from '@noocodex/dagonizer/contracts';
import { BaseStore, type BaseStoreOptions } from '@noocodex/dagonizer/store';

export class RedisStore extends BaseStore {
  readonly #client: RedisClient;

  constructor(client: RedisClient, options: BaseStoreOptions = {}) {
    super(options);
    this.#client = client;
  }

  // ── Required accessors ──────────────────────────────────────────────────────

  /** Stable identifier written into every snapshot envelope. */
  protected get snapshotType(): string    { return 'redis-store-v1'; }

  /** Increment when the snapshot shape changes incompatibly. */
  protected get snapshotVersion(): number { return 1; }

  // ── Required hooks ──────────────────────────────────────────────────────────

  protected async performGet<T extends JsonValue>(key: string): Promise<T | undefined> {
    const raw = await this.#client.get(key);
    return raw === null ? undefined : JSON.parse(raw) as T;
  }

  protected async performSet<T extends JsonValue>(key: string, value: T): Promise<void> {
    await this.#client.set(key, JSON.stringify(value));
  }

  protected async performHas(key: string): Promise<boolean> {
    return (await this.#client.exists(key)) === 1;
  }

  protected async performDelete(key: string): Promise<boolean> {
    return (await this.#client.del(key)) === 1;
  }

  protected async performSnapshotEntries(): Promise<readonly StoreSnapshotEntry[]> {
    const keys = await this.#client.keys(this.qualifyKey('*'));
    return Promise.all(keys.map(async (key) => ({
      key,
      value: JSON.parse((await this.#client.get(key)) ?? 'null'),
    })));
  }

  protected async performRestoreEntries(entries: readonly StoreSnapshotEntry[]): Promise<void> {
    await this.#client.flushDb();
    await Promise.all(entries.map(({ key, value }) =>
      this.#client.set(key, JSON.stringify(value)),
    ));
  }

  // ── Atomic update — required override ───────────────────────────────────────

  override async update<T extends JsonValue>(
    key: string,
    fn: (current: T | undefined) => T,
  ): Promise<T> {
    const qualified = this.qualifyKey(key);
    // Use WATCH/MULTI/EXEC or a Lua script to make this atomic on the Redis side.
    return this.#client.atomicRmw(qualified, fn);
  }

  // ── Optional lifecycle ──────────────────────────────────────────────────────

  override async connect(): Promise<void>    { await this.#client.connect(); }
  override async disconnect(): Promise<void> { await this.#client.quit(); }
}
```

All six `perform*` hooks receive the *qualified* key (namespace prefix already
applied by `BaseStore`). Call `this.qualifyKey(key)` in the `update` override
to ensure namespace consistency.

The snapshot envelope (`{ version, type, entries }`) is assembled by
`BaseStore.snapshot()`. `BaseStore.restore()` validates `type` and `version`
against `snapshotType` / `snapshotVersion` before calling
`performRestoreEntries`. A mismatch throws `StoreError(INCOMPATIBLE_SNAPSHOT)`.

The `type` string is the stable discriminant for the resume path — include a
version suffix (e.g. `'redis-store-v1'`) so bumping `snapshotVersion` to `2`
lets restore code distinguish old snapshots from new ones by both fields. The
`PassThroughStore` in the test suite is a minimal reference for the complete
hook surface:

```ts
class PassThroughStore extends BaseStore {
  readonly #backing: Record<string, JsonValue>;

  constructor(backing: Record<string, JsonValue>, options: BaseStoreOptions = {}) {
    super(options);
    this.#backing = backing;
  }

  protected get snapshotType(): string    { return 'pass-through-store'; }
  protected get snapshotVersion(): number { return 1; }

  protected async performGet<T extends JsonValue>(key: string): Promise<T | undefined> {
    return this.#backing[key] as T | undefined;
  }

  protected async performSet<T extends JsonValue>(key: string, value: T): Promise<void> {
    this.#backing[key] = value;
  }

  protected async performHas(key: string): Promise<boolean> {
    return Object.prototype.hasOwnProperty.call(this.#backing, key);
  }

  protected async performDelete(key: string): Promise<boolean> {
    if (!Object.prototype.hasOwnProperty.call(this.#backing, key)) return false;
    Reflect.deleteProperty(this.#backing, key);
    return true;
  }

  protected async performSnapshotEntries(): Promise<readonly StoreSnapshotEntry[]> {
    return Object.entries(this.#backing).map(([key, value]) => ({ key, value }));
  }

  protected async performRestoreEntries(entries: readonly StoreSnapshotEntry[]): Promise<void> {
    for (const key of Object.keys(this.#backing)) Reflect.deleteProperty(this.#backing, key);
    for (const { key, value } of entries) this.#backing[key] = value;
  }
}
```

`PassThroughStore` does not override `update`, so it uses the base-class
default (two `await` points). This is acceptable in the test suite where no
concurrent calls touch the same key. Production stores that allow concurrent
access must override `update`.

## Checkpoint integration

`Checkpoint.capture` is the async factory for checkpoints that include named
stores. It accepts a `dagName`, execution `result`, and optional `stores` map.
All stores are snapshotted in parallel.

```ts
import { Checkpoint, MemoryCheckpointStore } from '@noocodex/dagonizer/checkpoint';
import { MemoryStore } from '@noocodex/dagonizer/store';

// --- Save ---
const memory = new MemoryStore();
const audit  = new MemoryStore();

// ... nodes write to memory and audit during the run ...

const result = await dispatcher.execute('my-dag', state, { signal: ctl.signal });

if (result.cursor !== null) {
  const ckpt = await Checkpoint.capture('my-dag', result, {
    stores: { memory, audit },
  });
  await checkpointStore.save(runId, Checkpoint.toJson(ckpt.data));
}

// --- Resume ---
const raw = JSON.parse(await checkpointStore.load(runId)) as unknown;
const ckpt2 = Checkpoint.load(raw);

const freshMemory = new MemoryStore();
const freshAudit  = new MemoryStore();
await ckpt2.restoreStores({ memory: freshMemory, audit: freshAudit });

// Restore parent state and resume.
const { dagName, state: restored, cursor } = ckpt2.restoreState(
  (snap) => MyState.restore(snap),
);
await dispatcher.resume(dagName, restored, cursor);
```

**Failure modes:**

- **Missing store in restore map** — if the checkpoint names a store (e.g.
  `'memory'`) but `restoreStores` receives a map that does not include that
  key, it throws `DAGError` naming the missing stores. Loud failure is
  preferable to silent desync.
- **Incompatible snapshot** — `BaseStore.restore` throws
  `StoreError(INCOMPATIBLE_SNAPSHOT)` when `snapshot.type` or
  `snapshot.version` does not match the store instance's
  `snapshotType` / `snapshotVersion`. Schema migration is the plugin author's
  responsibility; `snapshotVersion` is the hook.
- **Extra stores in restore map** — stores present in the map but absent from
  the checkpoint are a no-op. The consumer added a store that was not tracked
  at capture time; the engine accepts this silently.

Old checkpoints (from v0.10, before stores support) load cleanly.
`CheckpointData.stores` is optional in the schema; `restoreStores` is a no-op
when the field is absent.
## Related reference

- [Reference: Store](../reference/store)
- [Reference: Checkpoint](../reference/checkpoint)
- [Reference: Contracts — `Store`, `StoreSnapshot`, `StoreSnapshotEntry`](../reference/contracts)
