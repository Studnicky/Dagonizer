---
title: 'Shared state'
description: 'Store injected via node constructors for cross-DAG accumulation; TypedStore for narrowed key sets; checkpoint integration; RemoteStore for distributed coordination.'
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
import { Batch, DAGBuilder, MonadicNode, NodeStateBase, RoutedBatchBuilder } from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

class DoneNode extends MonadicNode<NodeStateBase, 'done'> {
  readonly outputs: readonly 'done'[] = ['done'];

  constructor(readonly name: string) {
    super();
  }

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { done: { type: 'object' } };
  }

  async execute(batch: Batch<NodeStateBase>) {
    return RoutedBatchBuilder.of('done', batch);
  }
}

const childDag = new DAGBuilder('sub-flow', '1')
  .node('child-step', new DoneNode('child-step'), { done: 'child-end' })
  .terminal('child-end')
  .build();

const parentDag = new DAGBuilder('main-flow', '1')
  .node('step-a', new DoneNode('step-a'), { done: 'run-child' })
  .embeddedDAG('run-child', 'sub-flow', { success: 'step-b', error: 'step-b' })
  .node('step-b', new DoneNode('step-b'), { done: 'end' })
  .terminal('end')
  .build();

const sharedStateRegistry = new Map([['sub-flow', childDag]]);
</script>

# Shared state

Two mechanisms cross the scatter boundary in Dagonizer. The choice depends on the data-flow shape.

## API surface

| Symbol | Source | Role |
|--------|--------|------|
| `Store` | `@studnicky/dagonizer/contracts` | Async key/value contract |
| `BaseStore` | `@studnicky/dagonizer/store` | Abstract base with snapshot/restore plumbing |
| `MemoryStore` | `@studnicky/dagonizer/store` | In-memory reference implementation |
| `TypedStore<Schema>` | `@studnicky/dagonizer/store` | Wrapper that narrows keys and value types |
| `StoreError` | `@studnicky/dagonizer/store` | Discriminated error with `classification.reason` |
| `RemoteStore`, `RemoteStoreEndpointType`, `RemoteStoreLeaseType` | `@studnicky/dagonizer/contracts` | Distributed coordination primitives |

## DAG that exercises shared state

The runnable demo creates a `MemoryStore` and passes it into each node's constructor. A parent DAG with an embedded sub-DAG child writes to the same store:

<DagGraph :dag="parentDag" :embedded-d-a-gs="sharedStateRegistry" :expand-all="true" aria-label="Parent main-flow with embedded sub-flow; both DAGs share one Store injected into their nodes' constructors." />

## When to use what

| Need | Use | Why |
|---|---|---|
| Embed a registered sub-DAG exactly once and transfer specific fields in/out | `inputs` / `outputs` on `.embeddedDAG()` | Single-direction, isolated, checkpoint-friendly without extra wiring |
| Scatter across an array and seed each clone with a parent field | `inputs` option on `.scatter()` (`stateMapping.input`) | Parent field copied into each clone state before the body runs |
| Multiple nodes accumulate growing shared state (agent memory, RAG context, audit log) | `MemoryStore` (or another `Store`) injected into each node's constructor | Cross-node and cross-scatter; survives execution boundaries within a run |
| RDF graph patterns (`RecallContextNode`, `RecordFindingsNode`, etc.) need a Store that is also a `TripleStore` | `RdfStore` from `@studnicky/dagonizer-patterns-graph` | Implements both contracts; key-value side reifies as triples; quad side exposes native RDF |
| Known, fixed key set; compile-time safety without explicit `<T>` at every call | `TypedStore<Schema>` wrapping any `Store` | Keys and value types inferred from the schema |
| Long-running flow that survives restart | `MemoryStore.snapshot()` via `Checkpoint.capture({ stores })` | Resume captures shared state alongside parent state |
| Mid-flight introspection by an external observer | `Store` instance held outside the dispatcher | The same instance lives outside the topology; read it concurrently without touching execution |

`inputs` and `outputs` on `.embeddedDAG()` (and `stateMapping.input` on `.scatter()`) are field copies at a single placement boundary. Use them when the relationship between parent and child is a pure point-to-point transfer with a defined input and output.

A `Store` is a live, shared, mutable map. Use it when multiple placements accumulate to the same structure (a message list, a token budget, an event log) and that accumulation must persist across placement boundaries without threading every value through state-mapping options at every hop.

## Constructor wiring

The runnable example creates a `MemoryStore` and passes it into each node's constructor. The same instance is shared across `step-a`, `child-step`, and `step-b`:

<<< @/../examples/dags/10-shared-state.ts#services

<<< @/../examples/10-shared-state.ts#store-init

## Parent and child DAGs

<<< @/../examples/dags/10-shared-state.ts#child-dag

<<< @/../examples/dags/10-shared-state.ts#parent-dag

`step-a`, `child-step`, and `step-b` all call `this.log.update('entries', ...)` against the same constructor-injected store. The resulting `entries` value is `step-a,child-step,step-b`, ordered by execution.

## RdfStore: RDF-backed shared state for graph patterns

`RdfStore` from `@studnicky/dagonizer-patterns-graph` implements both `Store` and `TripleStore`. Plugin authors using the graph node patterns (`RecallContextNode`, `RecordFindingsNode`, `MemoryDigestNode`) pass an `RdfStore` directly as `services.memory`: it satisfies both the pattern's `TripleStore` requirement and the engine's `Store` contract for snapshot/restore.

The Store side exposes `set`, `get`, `has`, `delete`, `update`, `snapshot`, and `restore`. The TripleStore side exposes `assert`, `ask`, `select`, `count`, `clearGraph`, and `triples`. The Store-side `set(key, value)` reifies as a single triple under `urn:dagonizer:store:{key}`. The subject prefix and value predicate are configurable via `RdfStoreOptions`. No external dependencies; the backing is a plain `Quad[]`.

Pattern nodes that need a `TripleStore` accept it as a constructor argument. See `@studnicky/dagonizer-patterns-graph` for `RdfStoreOptions`, subclassing guidance, and snapshot trade-offs.

## TypedStore: narrowing for known key sets

`TypedStore<Schema>` wraps any `Store` and constrains the key and value types to a declared schema. Consumers with a fixed, known key set use `TypedStore` to get inferred types at every call site without specifying `<T>` explicitly. Consumers with dynamic or open-ended keys use `Store` directly.

<<< @/../examples/dags/10-shared-state.ts#typed-store

`TypedStore` is a wrapper, not a subclass of `BaseStore`. It does not satisfy the `Store` interface (its `set` signature is narrower). Pass `typed.inner` anywhere a `Store` is expected.

## Concurrency contract for Stores

Every `Store` method returns a `Promise`. There is no sync variant. Always `await` store calls.

**`update(key, fn)` is atomic within a single store instance.** The callback receives the current value (or `undefined` when the key is absent) and returns the new value. Implementations are responsible for delivering this atomicity. `MemoryStore` overrides `update` to access `#data` without any intermediate `await`, so no concurrent microtask can interleave between the read and the write. The base-class default has two `await` points and does not satisfy the atomicity contract on its own.

**`set + get` is NOT atomic.** If two concurrent paths each call `get` then `set`, the second write silently discards the first. Use `update` for every read-modify-write:

<<< @/../examples/dags/10-shared-state.ts#store-concurrency

**`set` is last-write-wins.** When two concurrent callers call `set` without coordination, whichever completes last persists. Avoid `set` for any value that two nodes write independently; use `update` instead.

Stores do not synchronize across process boundaries. The concurrency contract is per-instance, in-process. Distributed stores are forward-compatible because the contract is fully async; plugin authors implement cross-process atomicity inside `update` (single-step backing access, SQL transactions, Redis WATCH/MULTI, etc.).

## Authoring a custom store

Extend `BaseStore` and implement six `protected abstract` methods plus two `protected abstract get` accessors. Subclasses must override `update` to satisfy the atomicity contract; the base-class default is a fallback that is safe only when no concurrent calls touch the same key.

<<< @/../examples/dags/custom-store.ts#custom-store

`MapStore` is backed by a real `Map<string, JsonValueType>`. Its `update` override reads and writes `#data` synchronously — no `await` between the read and the write — so no concurrent microtask can interleave. In production, swap the `Map` operations for calls to a Redis, Postgres, or any other storage client; the six `perform*` hooks stay identical regardless of backing.

All six `perform*` hooks receive the qualified key (namespace prefix already applied by `BaseStore`). Call `this.qualifyKey(key)` in the `update` override to ensure namespace consistency.

The snapshot envelope (`{ version, type, entries }`) is assembled by `BaseStore.snapshot()`. `BaseStore.restore()` validates `type` and `version` against `snapshotType` and `snapshotVersion` before calling `performRestoreEntries`. A mismatch throws `StoreError(INCOMPATIBLE_SNAPSHOT)`.

The `type` string is the stable discriminant for the resume path; include a version suffix (such as `'redis-store-v1'`) so bumping `snapshotVersion` to `2` lets restore code distinguish old snapshots from new ones by both fields.

## Checkpoint integration

`Checkpoint.capture` is the async factory for checkpoints that include named stores. It accepts a `dagName`, execution `result`, and optional `stores` map. All stores are snapshotted in parallel.

<<< @/../examples/10-shared-state.ts#store-checkpoint

**Failure modes:**

- **Missing store in restore map**: if the checkpoint names a store (e.g. `'memory'`) but `restoreStores` receives a map that does not include that key, it throws `DAGError` naming the missing stores. Loud failure is preferable to silent desync.
- **Incompatible snapshot**: `BaseStore.restore` throws `StoreError(INCOMPATIBLE_SNAPSHOT)` when `snapshot.type` or `snapshot.version` does not match the store instance's `snapshotType` or `snapshotVersion`. Schema migration is the plugin author's responsibility; `snapshotVersion` is the hook.
- **Extra stores in restore map**: stores present in the map but absent from the checkpoint are a no-op. The consumer added a store that was not tracked at capture time; the engine accepts this silently.

`CheckpointData.stores` is required in the schema. Any checkpoint payload lacking the field is rejected by `Checkpoint.load`.

## Distributed execution: `RemoteStore`

`RemoteStore` extends `Store` with three coordination primitives for plugins whose backing lives over the network or is replicated across processes. Local `MemoryStore` and single-node-durable stores implement `Store` directly; plugins that talk over HTTP, gRPC, or WebSocket implement `RemoteStore`. Import it from `@studnicky/dagonizer/contracts`.

The engine consumes a `RemoteStore` through the `Store` surface. The extra methods are optional coordination hooks available to the dispatcher when distributed execution is active.

### Additional surface

| Method or Property | Description |
|-------------------|-------------|
| `endpoint` | `RemoteStoreEndpointType` with `url` (stable target identifier) and `region` (placement hint; `''` when no region applies). |
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

<<< @/../examples/dags/10-shared-state.ts#store-error-discrimination

See [Reference: Store](../reference/store) for the full interface.

## Related reference

- [Reference: Store](../reference/store)
- [Reference: Checkpoint](../reference/checkpoint)
- [Reference: Contracts](../reference/contracts)
- [Demo: Phase 10 shared state](../examples/10-shared-state)
