---
title: 'Shared state'
description: 'Store on the services bag for cross-DAG accumulation; TypedStore for narrowed key sets; checkpoint integration; RemoteStore for distributed coordination.'
seeAlso:
  - text: 'DAGBuilder'
    link: './builder'
    description: '`.embeddedDAG()` for embedding a sub-DAG once and `.scatter()` for 1→N fork over a source'
  - text: 'Checkpoint and Resume'
    link: './checkpoint'
    description: 'pair `Checkpoint.capture` with store snapshots to resume shared state alongside parent state'
  - text: 'State accessors'
    link: './state-accessor'
    description: 'how dotted paths resolve on `inputs` and `gather` paths'
  - text: 'Subclassing State'
    link: './subclassing'
    description: 'extend `NodeStateBase` for domain-specific parent state'
---

<script setup lang="ts">
import { DAGBuilder, NodeOutputBuilder, NodeStateBase, EMPTY_CONTRACT_FRAGMENT } from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer/contracts';

interface Services { log: { update: (k: string, fn: (c?: string) => string) => Promise<void> } }

class StepANode implements NodeInterface<NodeStateBase, 'done', Services> {
  readonly name = 'step-a';
  readonly outputs = ['done'] as const;
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  async execute() { return NodeOutputBuilder.of('done'); }
}

class StepBNode implements NodeInterface<NodeStateBase, 'done', Services> {
  readonly name = 'step-b';
  readonly outputs = ['done'] as const;
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  async execute() { return NodeOutputBuilder.of('done'); }
}

class ChildStepNode implements NodeInterface<NodeStateBase, 'done', Services> {
  readonly name = 'child-step';
  readonly outputs = ['done'] as const;
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  async execute() { return NodeOutputBuilder.of('done'); }
}

const childDag = new DAGBuilder('sub-flow', '1')
  .node('child-step', new ChildStepNode(), { done: 'child-end' })
  .terminal('child-end')
  .build();

const parentDag = new DAGBuilder('main-flow', '1')
  .node('step-a', new StepANode(), { done: 'run-child' })
  .embeddedDAG('run-child', 'sub-flow', { success: 'step-b', error: 'step-b' })
  .node('step-b', new StepBNode(), { done: 'end' })
  .terminal('end')
  .build();

const sharedStateRegistry = new Map([['sub-flow', childDag]]);
</script>

# Shared state

Two mechanisms cross the scatter boundary in Dagonizer. The choice depends on the data-flow shape.

## API surface

| Symbol | Source | Role |
|--------|--------|------|
| `Store` | `@noocodex/dagonizer/contracts` | Async key/value contract |
| `BaseStore` | `@noocodex/dagonizer/store` | Abstract base with snapshot/restore plumbing |
| `MemoryStore` | `@noocodex/dagonizer/store` | In-memory reference implementation |
| `TypedStore<Schema>` | `@noocodex/dagonizer/store` | Wrapper that narrows keys and value types |
| `StoreError` | `@noocodex/dagonizer/store` | Discriminated error with `classification.reason` |
| `RemoteStore`, `RemoteStoreEndpoint`, `RemoteStoreLease` | `@noocodex/dagonizer/contracts` | Distributed coordination primitives |

## DAG that exercises shared state

The runnable demo wires a `MemoryStore` onto the services bag of a parent DAG with a scatter sub-DAG child. Both write to the same store:

<DagGraph :dag="parentDag" :embedded-d-a-gs="sharedStateRegistry" :expand-all="true" aria-label="Parent main-flow with embedded sub-flow; both DAGs share one Store via the services bag." />

## When to use what

| Need | Use | Why |
|---|---|---|
| Embed a registered sub-DAG exactly once and transfer specific fields in/out | `inputs` / `outputs` on `.embeddedDAG()` | Single-direction, isolated, checkpoint-friendly without extra wiring |
| Scatter across an array and seed each clone with a parent field | `inputs` option on `.scatter()` (`stateMapping.input`) | Parent field copied into each clone state before the body runs |
| Multiple nodes accumulate growing shared state (agent memory, RAG context, audit log) | `MemoryStore` (or another `Store`) on the services bag | Cross-node and cross-scatter; survives execution boundaries within a run |
| RDF graph patterns (`RecallContextNode`, `RecordFindingsNode`, etc.) need a Store that is also a `TripleStore` | `RdfStore` from `@noocodex/dagonizer-patterns-graph` | Implements both contracts; key-value side reifies as triples; quad side exposes native RDF |
| Known, fixed key set; compile-time safety without explicit `<T>` at every call | `TypedStore<Schema>` wrapping any `Store` | Keys and value types inferred from the schema |
| Long-running flow that survives restart | `MemoryStore.snapshot()` via `Checkpoint.capture({ stores })` | Resume captures shared state alongside parent state |
| Mid-flight introspection by an external observer | `Store` instance held outside the dispatcher | The same instance lives outside the topology; read it concurrently without touching execution |

`inputs` and `outputs` on `.embeddedDAG()` (and `stateMapping.input` on `.scatter()`) are field copies at a single placement boundary. Use them when the relationship between parent and child is a pure point-to-point transfer with a defined input and output.

A `Store` is a live, shared, mutable map. Use it when multiple placements accumulate to the same structure (a message list, a token budget, an event log) and that accumulation must persist across placement boundaries without threading every value through state-mapping options at every hop.

## Services-bag wiring

The runnable example declares a `Services` interface whose `log` field has type `Store`, then instantiates the dispatcher with a `MemoryStore` bound to that field:

<<< @/../examples/dags/10-shared-state.ts#services

<<< @/../examples/10-shared-state.ts#store-init

## Parent and child DAGs

<<< @/../examples/dags/10-shared-state.ts#child-dag

<<< @/../examples/dags/10-shared-state.ts#parent-dag

`step-a`, `child-step`, and `step-b` all call `context.services.log.update('entries', ...)` against the same store. The resulting `entries` value is `step-a,child-step,step-b`, ordered by execution.

## RdfStore: RDF-backed shared state for graph patterns

`RdfStore` from `@noocodex/dagonizer-patterns-graph` implements both `Store` and `TripleStore`. Plugin authors using the graph node patterns (`RecallContextNode`, `RecordFindingsNode`, `MemoryDigestNode`) pass an `RdfStore` directly as `services.memory`: it satisfies both the pattern's `TripleStore` requirement and the engine's `Store` contract for snapshot/restore.

```ts
import { RdfStore } from '@noocodex/dagonizer-patterns-graph';

const store = new RdfStore();

// Use as a Store: set/get/has/delete/update/snapshot/restore.
await store.set('tokenBudget', 4096);
await store.update<number>('tokenBudget', (n) => (n ?? 0) - 100);

// Use as a TripleStore: assert, ask, select, count, clearGraph, triples.
store.assert(
  { termType: 'NamedNode', value: 'urn:doc:1' },
  { termType: 'NamedNode', value: 'urn:schema:author' },
  { termType: 'Literal',   value: 'Alice' },
);
const rows = store.select({
  predicate: { termType: 'NamedNode', value: 'urn:schema:author' },
  subject: '?doc',
});
```

The Store-side `set(key, value)` reifies as a single triple under `urn:dagonizer:store:{key}`. The subject prefix and value predicate are configurable via `RdfStoreOptions`. No external dependencies; the backing is a plain `Quad[]`.

See `@noocodex/dagonizer-patterns-graph` for `RdfStoreOptions`, subclassing guidance, and snapshot trade-offs.

## TypedStore: narrowing for known key sets

`TypedStore<Schema>` wraps any `Store` and constrains the key and value types to a declared schema. Consumers with a fixed, known key set use `TypedStore` to get inferred types at every call site without specifying `<T>` explicitly. Consumers with dynamic or open-ended keys use `Store` directly.

```ts
import { MemoryStore, TypedStore } from '@noocodex/dagonizer/store';

interface PipelineSchema {
  tokenBudget:  number;
  messages:     string[];
  lastNodeName: string;
}

const inner = new MemoryStore();
const typed = new TypedStore<PipelineSchema>(inner);

await typed.set('tokenBudget', 4096);
const budget = await typed.get('tokenBudget');   // number | null
await typed.update('messages', (msgs) => [...(msgs ?? []), 'hello']);

// TypeScript rejects wrong keys and wrong value types at compile time.
// await typed.set('unknown', 'x');              // TS error: key not in schema
// await typed.set('tokenBudget', 'not a num');  // TS error: expected number
```

`TypedStore` passes `snapshot()`, `restore()`, `connect()`, and `disconnect()` through to the underlying `Store`. Use `.inner` to access the full `Store` interface for operations that need the wider, heterogeneous contract.

```ts
const raw: Store = typed.inner;
await raw.set<boolean>('someFlag', true);
```

`TypedStore` is a wrapper, not a subclass of `BaseStore`. It does not satisfy the `Store` interface (its `set` signature is narrower). Pass `typed.inner` anywhere a `Store` is expected.

## Concurrency contract for Stores

Every `Store` method returns a `Promise`. There is no sync variant. Always `await` store calls.

**`update(key, fn)` is atomic within a single store instance.** The callback receives the current value (or `undefined` when the key is absent) and returns the new value. Implementations are responsible for delivering this atomicity. `MemoryStore` overrides `update` to access `#data` without any intermediate `await`, so no concurrent microtask can interleave between the read and the write. The base-class default has two `await` points and does not satisfy the atomicity contract on its own.

**`set + get` is NOT atomic.** If two concurrent paths each call `get` then `set`, the second write silently discards the first. Use `update` for every read-modify-write:

```ts
import { MemoryStore } from '@noocodex/dagonizer/store';

const store = new MemoryStore();

// Race: two paths increment independently. Both read 0, both write 1. Final: 1 (lost update).
const current = await store.get<number>('counter') ?? 0;
await store.set<number>('counter', current + 1);

// Atomic: update holds the RMW as one indivisible operation. Final: 2.
await store.update<number>('counter', (n) => (n ?? 0) + 1);
await store.update<number>('counter', (n) => (n ?? 0) + 1);
```

**`set` is last-write-wins.** When two concurrent callers call `set` without coordination, whichever completes last persists. Avoid `set` for any value that two nodes write independently; use `update` instead.

Stores do not synchronize across process boundaries. The concurrency contract is per-instance, in-process. Distributed stores are forward-compatible because the contract is fully async; plugin authors implement cross-process atomicity inside `update` (single-step backing access, SQL transactions, Redis WATCH/MULTI, etc.).

## Authoring a custom store

Extend `BaseStore` and implement six `protected abstract` methods plus two `protected abstract get` accessors. Subclasses must override `update` to satisfy the atomicity contract; the base-class default is a fallback that is safe only when no concurrent calls touch the same key.

```ts
import type { StoreSnapshotEntry } from '@noocodex/dagonizer/contracts';
import { BaseStore, type BaseStoreOptions } from '@noocodex/dagonizer/store';

export class RedisStore extends BaseStore {
  readonly #client: RedisClient;

  constructor(client: RedisClient, options: BaseStoreOptions = {}) {
    super(options);
    this.#client = client;
  }

  protected get snapshotType(): string    { return 'redis-store-v1'; }
  protected get snapshotVersion(): number { return 1; }

  protected async performGet<T extends JsonValue>(key: string): Promise<T | null> {
    const raw = await this.#client.get(key);
    return raw === null ? null : JSON.parse(raw) as T;
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

  override async update<T extends JsonValue>(
    key: string,
    fn: (current: T | undefined) => T,
  ): Promise<T> {
    const qualified = this.qualifyKey(key);
    // Use WATCH/MULTI/EXEC or a Lua script to make this atomic on the Redis side.
    return this.#client.atomicRmw(qualified, fn);
  }

  override async connect(): Promise<void>    { await this.#client.connect(); }
  override async disconnect(): Promise<void> { await this.#client.quit(); }
}
```

All six `perform*` hooks receive the qualified key (namespace prefix already applied by `BaseStore`). Call `this.qualifyKey(key)` in the `update` override to ensure namespace consistency.

The snapshot envelope (`{ version, type, entries }`) is assembled by `BaseStore.snapshot()`. `BaseStore.restore()` validates `type` and `version` against `snapshotType` and `snapshotVersion` before calling `performRestoreEntries`. A mismatch throws `StoreError(INCOMPATIBLE_SNAPSHOT)`.

The `type` string is the stable discriminant for the resume path; include a version suffix (such as `'redis-store-v1'`) so bumping `snapshotVersion` to `2` lets restore code distinguish old snapshots from new ones by both fields.

## Checkpoint integration

`Checkpoint.capture` is the async factory for checkpoints that include named stores. It accepts a `dagName`, execution `result`, and optional `stores` map. All stores are snapshotted in parallel.

```ts
import { Checkpoint, CheckpointRestoreAdapterFn, MemoryCheckpointStore } from '@noocodex/dagonizer/checkpoint';
import { MemoryStore } from '@noocodex/dagonizer/store';

// Save
const memory = new MemoryStore();
const audit  = new MemoryStore();

const result = await dispatcher.execute('my-dag', state, { signal: ctl.signal });

if (result.cursor !== null) {
  const ckpt = await Checkpoint.capture('my-dag', result, {
    stores: { memory, audit },
  });
  await checkpointStore.save(runId, ckpt.toJson());
}

// Resume
const raw = JSON.parse(await checkpointStore.load(runId)) as unknown;
const ckpt2 = Checkpoint.load(raw);

const freshMemory = new MemoryStore();
const freshAudit  = new MemoryStore();
await ckpt2.restoreStores({ memory: freshMemory, audit: freshAudit });

const { dagName, state: restored, cursor } = ckpt2.restoreState(
  CheckpointRestoreAdapterFn.fromFn((snap) => MyState.restore(snap)),
);
await dispatcher.resume(dagName, restored, cursor);
```

**Failure modes:**

- **Missing store in restore map**: if the checkpoint names a store (e.g. `'memory'`) but `restoreStores` receives a map that does not include that key, it throws `DAGError` naming the missing stores. Loud failure is preferable to silent desync.
- **Incompatible snapshot**: `BaseStore.restore` throws `StoreError(INCOMPATIBLE_SNAPSHOT)` when `snapshot.type` or `snapshot.version` does not match the store instance's `snapshotType` or `snapshotVersion`. Schema migration is the plugin author's responsibility; `snapshotVersion` is the hook.
- **Extra stores in restore map**: stores present in the map but absent from the checkpoint are a no-op. The consumer added a store that was not tracked at capture time; the engine accepts this silently.

`CheckpointData.stores` is required in the schema. Any checkpoint payload lacking the field is rejected by `Checkpoint.load`.

## Distributed execution: `RemoteStore`

`RemoteStore` extends `Store` with three coordination primitives for plugins whose backing lives over the network or is replicated across processes. Local `MemoryStore` and single-node-durable stores implement `Store` directly; plugins that talk over HTTP, gRPC, or WebSocket implement `RemoteStore`.

```ts
import type { RemoteStore } from '@noocodex/dagonizer/contracts';
```

The engine consumes a `RemoteStore` through the `Store` surface. The extra methods are optional coordination hooks available to the dispatcher when distributed execution is active.

### Additional surface

| Method or Property | Description |
|-------------------|-------------|
| `endpoint` | `RemoteStoreEndpoint` with `url` (stable target identifier) and `region` (placement hint; `''` when no region applies). |
| `acquireLease(subject, ttlMs, maxWaitMs)` | Acquire exclusive write authority for `subject` scoped to `ttlMs` ms. Waits up to `maxWaitMs` for an existing holder before throwing `StoreError(LEASE_DENIED)`. |
| `releaseLease(lease)` | Release a previously-acquired lease. Idempotent: releasing an expired lease is a no-op. |
| `health(timeoutMs)` | Health probe. Returns `true` when reachable within `timeoutMs`. Returns `false`, never throws, on transport failure, so the dispatcher can route around an unhealthy store. |

### Authoring a remote store

Extend `BaseStore` and implement `RemoteStore`:

<<< @/../examples/dags/store-remote.ts#remote-store

`region` is required. Stores without a region constraint set it to `''` at construction. All `RemoteStore` fields are concrete types: no `undefined`, no optional properties in the lease or endpoint shapes.

### Error taxonomy for remote failures

Three `StoreErrorClassification` reasons cover remote-specific failure modes:

| Reason | When |
|--------|------|
| `LEASE_DENIED` | `acquireLease` finds an active holder and `maxWaitMs` expires before release. Fields: `subject`, `holder`. |
| `LEASE_EXPIRED` | A write or release is attempted with an already-expired token. Fields: `subject`, `token`. |
| `UNREACHABLE` | Transport failure: endpoint does not respond within the health budget. Fields: `endpoint`, `cause`. |

Discriminate by `reason`:

```ts
import { StoreError } from '@noocodex/dagonizer/store';

try {
  await store.acquireLease('run-abc', 5_000, 1_000);
} catch (err) {
  if (err instanceof StoreError && err.classification.reason === 'LEASE_DENIED') {
    const { subject, holder } = err.classification;
    console.error(`lease for ${subject} held by ${holder}`);
  }
}
```

See [Reference: Store](../reference/store) for the full interface.

## Related reference

- [Reference: Store](../reference/store)
- [Reference: Checkpoint](../reference/checkpoint)
- [Reference: Contracts](../reference/contracts)
- [Demo: Phase 10 shared state](../examples/10-shared-state)
