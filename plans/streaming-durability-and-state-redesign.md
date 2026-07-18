# Streaming Durability and State Contract

Internal framework specification. This is not public documentation.

## 1. Scope

This document defines the current contract for:

- dispatcher, DAG, and scatter-placement configuration
- worker/container graph-state negotiation and batched transfer
- transient state selection
- post-completion graph projection
- scatter watermark persistence
- append-only fold journals and replay
- Cartographer's bounded million-event execution profile

The worker wire contract and durability policy are independent. Wire format
negotiation decides how selected state crosses an isolation boundary. Write
points decide what the host persists or projects after completion.

## 2. Required Invariants

### 2.1 One negotiated graph-transfer contract

`graphStateTransferFormats` is a non-empty, duplicate-free array of supported
format enum values. It is not a boolean and it is not normalized. The sender
advertises its exact configured values, the host returns its independently
configured supported values, and initialization fails when the arrays have no
common format. Execution fails when the request format is not host-advertised.

The required format is:

```ts
type GraphStateTransferFormat = 'application/n-quads';
```

Only the declared enum values are valid. There is no placeholder JSON-LD or
alternate plain-object wire shape.

### 2.2 One transfer per item batch

Every contained DAG request carries:

```ts
type ExecutionRequest = {
  graphState: GraphStateTransfer;
  items: Array<{ id: string; runIri: string }>;
  // task identity, timeout, and response-state selection
};
```

Every contained DAG response carries:

```ts
type ExecutionResponse = {
  graphState: GraphStateTransfer;
  items: Array<{
    id: string;
    runIri: string;
    terminalOutcome: string;
  }>;
  // errors and intermediates
};
```

For an N-item reservoir batch, `GraphStateTransferCodec.inlineTransient()`
encodes one selected state literal per item into one N-Quads document and
computes one integrity hash. Each item is partitioned by its named run graph.
The receiving side verifies and decodes the document once, partitions it by
`runIri`, and restores each item. A single item uses the same path with N=1.

Request item IDs and run IRIs are unique. The N-Quads named-graph set exactly
matches the request item run-IRI set. The response preserves that exact item
identity set and graph set; missing, additional, or duplicate identities and
graphs fail before any state is restored.

Each selected state is represented as one `rdf:JSON` literal with predicate
`dagonizer:TransientStatePayload` in `${runIri}#state`. The typed
`TransientNodeStateType` value exists inside the codec boundary; it is not a
second transport contract.

### 2.3 Selection defines the crossing state surface

`DagTask.inputState` selects the child input surface. Embedded DAG mappings
select their child-side fields. Scatter DAG bodies add the configured item key
and item index metadata.

`ExecutionRequest.responseState` selects the terminal state returned for each
route. Gather strategies declare their parent-facing requirements through
`transientResultSelection()`.

There is no global transient-state selection setting. Selection follows the
placement and gather data contract because only those consumers know which
fields they require.

### 2.4 Full graph projection is post-completion policy

N-Quads worker transfer does not imply full domain-state graph projection.
`FullItemProjection` and `InMemorySnapshot` call `snapshotGraph()` only after a
successful node completion and only when the resolved placement write points
contain the corresponding value.

`NodeEdges` projects fixed-size execution topology facts from dispatcher
bookkeeping. It does not inspect or serialize every domain field.

## 3. Configuration Contract

All serializable DAG policy lives under one `configuration` namespace:

```ts
type DagConfiguration = {
  execution?: {
    batching?: {
      mode?: 'item' | 'reservoir';
      concurrency?: number;
      throttle?: null | {
        concurrencyLimit?: number;
        adaptive?: AdaptiveConfigInput | null;
      };
      reservoir?: null | {
        keyField?: string | null;
        capacity?: number;
        idleMs?: number | null;
      };
    };
  };
  durability?: {
    writePoints?: WritePoint[];
    foldJournalStoreKey?: string | null;
  };
};
```

The same shape applies at these tiers:

1. Dispatcher: `new Dagonizer({ configuration })`
2. DAG: `new DAGBuilder(iri, version, { configuration })`
3. Scatter placement: `builder.scatter(..., { configuration })`

Resolution order is placement, DAG, dispatcher, then canonical defaults.
Omitted scalar and nested object fields inherit independently. A present array
fully replaces the inherited array. `writePoints: []` disables every inherited
write point. A present `null` clears an inherited nullable value.

Canonical defaults are:

```ts
{
  execution: {
    batching: {
      mode: 'item',
      concurrency: 1,
      throttle: null,
      reservoir: null,
    },
  },
  durability: {
    writePoints: ['NodeEdges', 'WatermarkCommit'],
    foldJournalStoreKey: null,
  },
}
```

Reservoir capacity defaults to `100` when reservoir mode is selected.
Reservoir mode requires an effective non-empty `reservoir.keyField`. A
configured throttle requires an effective `concurrencyLimit`.

Configuration resolves once during DAG registration. Execution reads fixed
resolved values and fixed `ReadonlySet<WritePoint>` instances; it does not walk
the inheritance cascade per event. Throttle adaptive fields inherit
independently through the same cascade. Resolved objects, nested objects,
arrays, and sets are detached from caller-owned input and immutable.

## 4. Write Points

Write points are independent enum values:

```ts
type WritePoint =
  | 'NodeEdges'
  | 'FullItemProjection'
  | 'FoldDeltaJournal'
  | 'WatermarkCommit'
  | 'InMemorySnapshot';
```

| Write point | Operation | Cost shape | Durable |
|---|---|---|---|
| `NodeEdges` | Project placement execution and route facts | Fixed per completion | Store-dependent |
| `FullItemProjection` | Project complete item state to the execution graph store | O(projected fields) | Store-dependent |
| `FoldDeltaJournal` | Append fold contributions with scatter progress | Bounded per execution batch | Yes |
| `WatermarkCommit` | Persist bounded scatter cursor/progress | Bounded per execution batch | Yes |
| `InMemorySnapshot` | Project complete item state to the in-memory query store | O(projected fields) | No |

`FoldDeltaJournal` requires `WatermarkCommit`. Registration also requires a
bound journal store and one replayable first-class gather destination for all
non-empty scatter outcomes. `[]`, full projection at scale, and orthogonal
combinations remain valid policy choices.

## 5. Worker Batch Execution

`configuration.execution.batching.mode` determines the scheduler execution
unit:

- `item`: one item per worker operation; `concurrency` limits concurrent items
- `reservoir`: partition by `reservoir.keyField`; release a batch at `capacity`,
  `idleMs`, or source drain; `concurrency` limits concurrent released batches

A multi-item worker payload enters the child scheduler as one `Batch`. The host
maps terminal outcomes back to item IDs and emits one graph-state response for
the complete batch. The dispatcher does not invoke the child DAG separately for
each item in a reservoir payload.

Every reservoir inbox record persists its resolved `bufferKey`. Resume rebuilds
the keyed buffers from that field and rejects persisted reservoir records that
do not carry it.

## 6. Fold Journal Contract

Runtime resources are bound separately from serializable DAG configuration:

```ts
new Dagonizer({
  configuration: {
    durability: {
      writePoints: ['NodeEdges', 'WatermarkCommit', 'FoldDeltaJournal'],
      foldJournalStoreKey: 'durable',
    },
  },
  foldJournalStores: {
    durable: foldJournalStore,
  },
});
```

`FoldJournalStoreInterface.append(runIri, commit)` atomically records:

- one deterministic commit ID
- the scatter IRI
- bounded next scatter progress
- zero or more per-item gather contributions
- whether the scatter is complete

The store resolves `append()` only after the commit is durable. Repeating a
commit ID is an idempotent success. `read(runIri)` yields canonical commits in
append order.

The execution order for one acknowledged item or reservoir batch is:

1. Project gather records and prepare contribution entries.
2. Atomically append contributions and next scatter progress.
3. Apply the gather reduction to parent state once for the projected batch.
4. Publish the live watermark and checkpoint metadata.

A failed append leaves the fold accumulator and live watermark unchanged.
Replay validates every commit, deduplicates contributions by
gather/source/index, validates each contribution against the registered append,
collect, map, or partition strategy and its exact targets, restores active
scatter progress, and ignores progress for scatters with a completion record.
Malformed contributions fail before parent state is mutated.

Adapter lifecycle is explicit:

- IndexedDB: `IndexedDbFoldJournalStore.open({ databaseName })`, `connect()`,
  and `disconnect()`; the default database name is `dagonizer-fold-journal`
- OPFS: `await OpfsFoldJournalStore.rooted(dirName)`; no connection step
- SQLite: `new SqliteFoldJournalStore(path)` and `disconnect()`; schema creation
  is synchronous

The dispatcher does not own adapter connection lifecycle.

## 7. Gather Write Cadence

There is no separate gather batch-size setting. The upstream scatter execution
unit is also the gather write and durability unit:

- item mode prepares, journals, reduces, and checkpoints one item
- reservoir mode prepares all records, appends at most one journal commit,
  reduces once, and checkpoints once for the released batch

This keeps one durability boundary per scheduler batch. A second gather buffer
would create a separate acknowledgement boundary and is outside the contract.

Bounded folds are the streaming durability contract. Gathers that retain every
record for finalization remain in-memory, bounded-input behavior and do not gain
durable large-stream semantics.

## 8. Cartographer Runtime Profile

Cartographer uses the unified lazy producer-feed/source-intake topology. The
process-stream scatter consumes one pull-based `AsyncIterable`; it does not
materialize a canonical event array or maintain a duplicate source mirror.

Browser defaults are runtime-derived and user-configurable:

- workers: `WebSystemInfo.recommendedWorkerCount()` reads hardware concurrency,
  reserves two logical processors, and clamps to the UI-supported `1..32`
- reservoir capacity: `100`
- reservoir idle release: disabled (`null`, represented as `0` in controls)
- presentation flush cadence: `100ms`

The process-stream placement uses `writePoints: []`, so the million-event hot
path does not persist scatter checkpoints or fold journals. The resumable
scenario explicitly selects `WatermarkCommit` and item mode.

The browser presentation surface remains bounded:

- exact processed count
- 200 sampled records
- 8 bounded regional insight buckets for the fixture data
- 100 sampled journeys
- bounded trace and graph-animation buffers

## 9. Verification Gates

Validation runs sequentially across dependency boundaries. Core public `dist`
is built before dependent package tests; dependent tests do not run while a core
pretest removes or rewrites the artifacts they resolve.

Required checks:

```sh
pnpm --filter @studnicky/dagonizer run ci
pnpm --filter @studnicky/dagonizer build
pnpm --filter @studnicky/the-cartographer-example typecheck
pnpm --filter @studnicky/the-cartographer-example test
pnpm --filter @studnicky/the-cartographer-example build
```

Required browser telemetry:

```sh
pnpm --filter @studnicky/the-cartographer-example browser:telemetry -- \
  --total-events 10000 --pool-size 8 --batch-capacity 100 \
  --trace --trace-path /tmp/cartographer-browser-current-10k-trace.json

pnpm --filter @studnicky/the-cartographer-example browser:telemetry -- \
  --total-events 1000000 --pool-size 8 --batch-capacity 100 \
  --timeout-ms 600000
```

Current browser evidence for the codec-backed N-Quads dispatcher path:

- 10,000-event traced run: exact completion in `6,586.141917ms`, zero probe
  stalls, 28 presentation flushes, `1.8678571496691023ms` average flush,
  `3.5ms` maximum flush, `19,127,736` raw terminal heap bytes, and
  `14,856,572` retained terminal heap bytes
- 10,000-event trace: `172,298` events, `42,587,873` bytes, SHA-256
  `cd55a15587187f3ab1f4b0d042bef0a567d6502c09ce08d080f6a75de9068ffb`
- 1,000,000-event run: exact completion in `300,244.944084ms`, zero probe
  stalls, 2,310 presentation flushes, `1.8558874434722967ms` average flush,
  `14.299999952316284ms` maximum flush, `188,550,016` raw terminal heap
  bytes, and `14,739,640` retained terminal heap bytes
- both required runs retain exactly 200 records, 8 insight buckets, and 100
  journeys
- acceptance ceilings are `179,988,348` retained terminal heap bytes and
  `18.2ms` maximum presentation flush

The 10,000-event Chrome CPU trace contains 19 profiles and `32,338.413ms` of
sampled time. `InMemoryTopologyStore` assertion, index, match, and removal
frames account for 37.57% of all sampled time, the dominant mapped framework
cost. `GraphStateTransferCodec` frames account for 0.64%; the shared
`GraphDatasetRevision` SHA-256 and revision frames account for 1.95%. Full
domain-state projection is absent from the Cartographer process-stream
placement because its resolved write-point set is empty.

## 10. Authoritative Locations

- Configuration: `src/entities/configuration/DagConfiguration.ts`
- Registration cascade: `src/dag/DagRegistrar.ts`
- Write-point validation: `src/dag/WritePointPolicy.ts`
- Worker negotiation: `src/container/ChannelDispatch.ts`, `src/container/DagHost.ts`
- Request/response batching: `src/container/DagContainerBase.ts`, `src/container/DagTask.ts`
- N-Quads codec: `src/graph/GraphStateTransferCodec.ts`
- Selection: `src/execution/TransientResultSelection.ts`
- Scheduler batching: `src/execution/NodeScheduler.ts`, `src/execution/ScatterDispatch.ts`
- Fold journal: `src/contracts/FoldJournalStoreInterface.ts`
- Cartographer runtime configuration: `examples/the-cartographer/CartographerBrowserRuntime.ts`
- Cartographer browser controls: `examples/the-cartographer/app/CartographerRunner.vue`
