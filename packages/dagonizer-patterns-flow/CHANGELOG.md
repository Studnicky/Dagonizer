# @studnicky/dagonizer-patterns-flow

## [unreleased]

### Minor Changes

- `FlowNode` is parameterized by `<TState, TOutput>` with no `TServices` third parameter. `executeOne` overrides in all built-in subclasses (`ExtractFieldNode`, `PredicateGateNode`, `ReduceNode`, `RespondNode`, `SelectNode`) take `(state, output)` — services are injected via the node constructor and held as instance fields, consistent with the engine-wide constructor-DI pattern.

## 0.27.0

## 0.26.0

## 0.25.0

## 0.24.0

## 0.23.0

## 0.22.0

## 0.21.0

## 0.20.0

## 0.19.0

## 0.17.0

## 0.16.0

## 0.15.0

## 0.14.0

### Minor Changes

- d3a4e7b: Fork, embed, and join are three distinct node types, each with exactly one way to express them. No fan-out API.

  - **Fork** is `ScatterNode` / `.scatter(name, source, body, outputs, options?)`. `source` is required (a fork is always 1→N). `FanOutNode` / `.fanOut()` are removed.
  - **Embed** is `EmbeddedDAGNode` / `.embeddedDAG(name, dagName, outputs, options?)`: invoke a sub-DAG once (cardinality 1) with `stateMapping { input, output }` (`input` seeds the child from the parent, `output` copies child fields back). Distinct from fork; never a flag on `scatter`.
  - **Merge** machinery is `GatherConfig` + the `GatherStrategies` (`map`/`append`/`partition`/`custom`) and `OutcomeReducers` (`aggregate`/`terminal`) registries. `FanInConfig`, `FanInStrategies`/`FanInStrategy`/`FanInExecution` are removed.
  - Renames: `FAN_OUT_PROGRESS_KEY`→`SCATTER_PROGRESS_KEY` (and `FanOutProgress`/`StoredFanOutProgress`→`ScatterProgress`/`StoredScatterProgress`); `MetadataKey.fanInResults`→`gatherResults`; derive `annotations.fanouts`→`annotations.scatters`, `DAGDeriverFanOut`→`DAGDeriverScatter`, `fanInOperation`→`customNode` (the `embeddedDAGs` annotation now renders an `EmbeddedDAGNode`); `@studnicky/dagonizer-patterns-flow`'s `FanInReducerNode`→`MergeReducerNode`.
  - Visualization gains an `embedded-dag` placement type (Cytoscape) / subroutine shape (Mermaid) / `dag:EmbeddedDAGNode` (JSON-LD), distinct from `scatter`.

  `NodeResult.output` is now required and typed `string | null` (`null` = no route emitted; previously optional `string`), and every `NodeResultType` carries a required `intermediateResults` array (`[]` for leaf nodes): one stable result shape, no post-construction mutation. `onNodeEnd` and `Instrumentation.nodeEnd` take `output: string | null` to match.

  One way to seed child state: `ScatterNode` uses `stateMapping.input` (builder option `inputs`) to seed each clone, the same field/orientation as `EmbeddedDAGNode.stateMapping.input`; the old `ScatterNode.projection` field is gone. (Scatter has no `stateMapping.output`: the N→1 merge is `gather`'s job.) `GatherConfig.strategy` references the canonical `GatherStrategy` enum instead of re-declaring it.

  `NodeStateInterface` gains `deleteMetadata(key)`. The `./constants` subpath now resolves (constant value+type pairs: `GatherStrategyName`, `MetadataKey`, `NodeType`, `Output`, `ParallelCombine`, `ScatterOutput`).

  No back-compat shims. Clean breaks, versioned:

  - `DAGDeriver.derive` takes `nodes` (contracts co-located on each node, single source of truth); the standalone `contracts` input is removed.
  - `CheckpointData.stores` is required; checkpoints produced before stores were captured no longer load.
  - The observability hooks (`onNodeStart`/`onNodeEnd`/`onError`) take `placementPath` as a required argument (no `[]` default).
  - `ContractRegistryValidator` treats the entrypoint's `hardRequired` as the flow's ambient external state, so any node may read those keys and multi-root topologies (several roots reading the initial input) validate.
  - `DAGDeriverTerminal` has one way to end and one way to route: `{ outcome, emit }` synthesizes a `TerminalNode` (the only way to end an outcome); `{ outcome, target: string }` routes to an existing placement. The implicit `target: null` end is removed; terminals are explicit.

  Checkpointing depends on a capability, not the key-value surface. The new `Snapshottable` contract (`./contracts`) declares just `snapshot()` / `restore()`; `Store extends Snapshottable`. `StoreSnapshotType` and `StoreSnapshotEntryType` move to `Snapshottable` and are exported only from there (and the `./contracts` / `./store` barrels); `./contracts/Store` no longer re-exports them. `Checkpoint.capture(dag, result, { stores })` and `Checkpoint.restoreStores(stores)` take `Record<string, Snapshottable>`, so a non-KV backing (an RDF triple store, a vector index) can ride along in a checkpoint without implementing `get`/`set`/`has`/`delete`/`update`.

  Retry is a flow shape, not an in-node policy. `NodeStateBase` (the state every consumer extends) gains a retry-attempt concept (`recordAttempt(key)`, `retriesFor(key)`, `clearAttempts(key)`, and `withinRetryBudget(key, maxAttempts)`) keyed by a routing name (typically `context.nodeName`). A node that fails routes to a `retry` output (the DAG loops the edge back, bounded by the counter) or a `salvage` output (budget spent); the loop and the recovery both live in the topology, not inside the node. The counter is part of `snapshot()` (the persistence shape `NodeStateData` adds a `retries` map), so a retry budget survives checkpoint/resume.

  Embedded DAGs nest arbitrarily deep (DAG-in-DAG-in-DAG); cross-kind sub-DAG cycles (embed ↔ scatter) are detected at registration.

  Migration: replace `.fanOut(name, body, outputs, { source, ... })` with `.scatter(name, source, body, outputs, { ... })`; nested-flow invocations keep using `.embeddedDAG()`. Observers reading a node result's `output` now receive `null` (not `undefined`) when no route was emitted.

### Patch Changes

- Updated dependencies [d3a4e7b]
  - @studnicky/dagonizer@0.14.0

## 0.13.2

### Patch Changes

- Updated dependencies [238a94d]
  - @studnicky/dagonizer@0.13.2

## 0.12.0

### Patch Changes

- Updated dependencies [7c0e38a]
- Updated dependencies [3286d07]
  - @studnicky/dagonizer@0.12.0
