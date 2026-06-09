# @noocodex/dagonizer

## [Unreleased]

### Breaking

**Fan-out is now expressed solely via `ScatterNode` + a required `gather`.** `ParallelNode` and all associated surface are removed. The following specific symbols are deleted:

- **`ParallelNode` placement type removed.** DAGs with `'@type': 'ParallelNode'` fail schema validation and dispatch.
- **`ParallelCombine` constant removed.** `import { ParallelCombine } from '@noocodex/dagonizer/constants'` no longer resolves.
- **`ParallelCombiners` registry removed.** `import { ParallelCombiners } from '@noocodex/dagonizer/core'` no longer resolves.
- **`DAGBuilder.parallel()` removed.** Call sites that used `.parallel(name, nodes, combine, routes)` must be rewritten as `.scatter(name, source, body, routes, { gather, reducer })`.
- **`MetadataKey.PARALLEL_OUTPUTS` removed.** The `'parallelOutputs'` metadata key is no longer written by the engine. Migrate consumers reading `state.getMetadata('parallelOutputs')` to the scatter gather result written to the `target` key declared in `GatherConfig`.
- **`NodeType.PARALLEL` removed.** The `'parallel'` node type string is no longer in the schema enum or the `NodeType` const.
- **`DAGDeriverAnnotations.parallels` removed.** The `parallels` annotation key and `DAGDeriverParallel` interface are deleted. Use the `scatters` annotation to express same-depth fan-outs.
- **`Validator.parallelNode` removed.** The per-entity validator for `ParallelNode` is no longer present on the `Validator` class.

**Migration: `ParallelNode` → `ScatterNode`**

A parallel group of N named nodes becomes a `ScatterNode` over an N-element descriptor source with a body node that dispatches on the `currentItem` metadata key:

```ts
// Before (removed):
.parallel('probe-group', ['probe-a', 'probe-b'], 'all-success', { success: 'next', error: null })

// After:
// state.probeDescriptors = ['probe-a', 'probe-b']
.scatter('probe-group', 'probeDescriptors', probeDispatchNode,
  { 'all-success': 'next', 'all-error': null, 'partial': null, 'empty': null },
  {
    gather:  { strategy: 'collect', target: 'probeResults' },
    reducer: 'all-success',
    concurrency: 2,
  },
)
```

One-to-one mapping for `combine` modes:

| Old `combine` | New scatter `reducer` | New scatter `gather.strategy` |
|---|---|---|
| `'all-success'` | `'all-success'` | `'collect'` or `'discard'` |
| `'any-success'` | `'any-success'` | `'collect'` or `'discard'` |
| `'collect'` | `'aggregate'` | `'collect'` (writes per-clone output tokens in source-index order to `target`) |
| side-effect only | `'aggregate'` | `'discard'` (no clone state written back) |

`gather` is required on every `ScatterNode`. Use `{ strategy: 'discard' }` for fan-outs where no clone state flows back to the parent.

### Changed

- **Archivist scout fan-outs converted to scatter.** The `reviews-scatter`, `describe-scatter` (in `the-archivist/dag.ts`), and `book-search-scatter` (in `BookSearchScatterDAG.ts`) fan-outs now use `ScatterNode` with a descriptor source (`state.scoutProviders = ['openlibrary','googlebooks','subject','wikipedia']`), a single `scoutDispatch` body node that dispatches on the `currentItem` metadata key to the matching scout logic, the `scout-merge` gather strategy that flat-merges `candidates` and `failureCause` from all four clone states, and the `any-success` outcome reducer. Concurrency is 4. The four individual per-source node placements are removed; behavior is preserved.
- **`GatherConfig.strategy` is now an open `string`.** The schema constraint was widened from a closed enum (`'append' | 'collect' | ...`) to `{ type: 'string', minLength: 1 }`. Custom gather strategies registered via `GatherStrategies.register(...)` can now be referenced by name in DAG author expressions without a type error. Unknown names are caught at runtime by `GatherStrategies.resolve(name)`.
- **`examples/dags/parallel-combiner.ts` recast as scatter-extension demo.** The `MajorityCombiner`/`ParallelCombiner` half is removed; the file now demonstrates `TopNGatherStrategy` (custom `GatherStrategy`) and `ThresholdReducer` (custom `OutcomeReducer`) as the scatter extension points.
- **`examples/dags/constants-usage.ts`** replaces the `ParallelCombine.ALL_SUCCESS` snippet with `GatherStrategyName.COLLECT` to showcase the current fan-out vocabulary.

### Added

- **`gather` is now required on `ScatterNode`** (schema + builder + validator). Every scatter must declare the merge strategy. The `discard` gather strategy (`{ strategy: 'discard' }`) is the explicit declaration for side-effect-only fan-outs where no clone state flows back to the parent. Existing scatter DAGs with no gather must add `discard` (or the appropriate real merge strategy).
- **`discard` gather strategy** (`GatherStrategies`): a no-op `GatherStrategy` for side-effect-only scatters. `apply` and `applyIncremental` both no-op; nothing is written to parent state. Registered in `GatherStrategies` at module load.
- **`collect` gather strategy** (`GatherStrategies`): collects each clone's output token (or its `field` value when `field` is set) into a target collection on the parent in source-index order. Requires `target`. Mirrors the `CollectCombiner` intent for scatter: per-clone result array keyed by source index, appended in index order.
- **`all-success` outcome reducer** (`OutcomeReducers`): routes `'success'` when every clone output equals `'success'`, otherwise routes `'error'`. Mirrors `AllSuccessCombiner` semantics from `ParallelCombiners`, expressed over scatter clone records. Returns `'error'` for empty record sets.
- **`any-success` outcome reducer** (`OutcomeReducers`): routes `'success'` when at least one clone output equals `'success'`, otherwise routes `'error'`. Mirrors `AnySuccessCombiner` semantics, expressed over scatter clone records. Returns `'error'` for empty record sets.
- **`'collect'` and `'discard'`** added to `GatherStrategySchema.enum` and `GatherStrategyName` const.

### Added

- **`ChannelInterface`** (`./contracts`): adapter contract for publishing completed-DAG hand-off envelopes to a downstream transport. Implementations provide `publish(handoff: DAGHandoff): Promise<void>` and an optional `destroy()`. Channels must not throw out of the dispatcher; the dispatcher wraps every publish call in a try/catch.
- **`DAGHandoff` entity** (`./entities`): JSON Schema 2020-12 envelope (`DAGHandoffSchema`) and `FromSchema`-derived `DAGHandoff` type. A `oneOf` discriminates between `stateSnapshot` (by-value, full `JsonObject`) and `stateSnapshotRef` (by-reference URI string) so exactly one is present. Common fields: `dagName`, `terminalName`, `terminalOutput`, `registryVersion`, `correlationId`, `placementPath`. `additionalProperties: false` on both branches.
- **`InMemoryChannel`** (`./channels`): default loopback `ChannelInterface` implementation. Stores published envelopes in an in-memory array (deep-cloned via `structuredClone` for full serialization fidelity) exposed via `published: readonly DAGHandoff[]`. Extension is by subclass (zero callbacks): override the protected `onPublished(handoff)` hook — awaited after each envelope is recorded — to chain a downstream DAG.
- **`./channels` subpath**: public submodule exporting `InMemoryChannel` and `InMemoryChannelOptions`.
- **`channels` option** on `DagonizerOptionsInterface`: `Readonly<Record<string, ChannelInterface>>` keyed by terminal placement name. When a non-embedded top-level run completes at a terminal whose name is bound in `channels`, the dispatcher builds a `DAGHandoff` envelope (by-value `stateSnapshot`) and calls `channel.publish(handoff)` after `onFlowEnd`/`flowEnd`. Different terminals route to different channels (`done` → queue, `escalate` → DLQ). An unbound terminal leaves the in-process path byte-identical to today. Defaults to `{}`.
- **`registryVersion` option** on `DagonizerOptionsInterface`: registry version string included in every `DAGHandoff` envelope for cross-host version handshake. Defaults to `'0'` when not supplied.
- **`Dagonizer.destroy()` cascades to bound containers and channels**: after destroying every registered node, `destroy()` calls the optional `destroy()` on each bound `DagContainerInterface` (worker/child pools) and then each bound `ChannelInterface`. Teardown order is nodes → containers → channels. This shuts the worker pool that `dispatcher.destroy()` promises to close.
- **Publish failure handling**: if `channel.publish` throws, the dispatcher collects a `HANDOFF_PUBLISH_FAILED` error (recoverable: false) via `state.collectError` and fires `instrumentation.error`. The returned `ExecutionResult` and `terminalOutcome` are unchanged — a failed publish does not rewrite the run result.
- **`Validator.dagHandoff`**: `EntityValidator<DAGHandoff>` compiled from `DAGHandoffSchema` at module load via the existing `Validator.compile(...)` pattern.

- **DAG containment seam**: `container` placement key on `EmbeddedDAGNode` and `ScatterNode` (dag-body only). Attaching `container: 'roleName'` to an embedded-DAG or scatter-dag-body placement routes that sub-DAG to a registered `DagContainerInterface` backend (worker thread, fork, Web Worker, etc.) instead of the in-process engine. `SingleNode`, `ParallelNode`, and scatter node-body placements carry no `container` key and no routing change.
- **`DagContainerInterface`** (`./contracts`): adapter contract for running a whole DAG in an isolate. Implementors provide `runDag(task: DagTaskInterface): Promise<DagOutcomeInterface>` and an optional `destroy()`.
- **`DagTaskInterface` / `DagOutcomeInterface`** (`./contracts`): wire contracts between the dispatcher and container backends. `DagTask` (`./container`) is the engine-side implementation carrying live clone state plus `toRequest()` for wire serialisation.
- **`containers` option** on `DagonizerOptionsInterface`: `Readonly<Record<string, DagContainerInterface<TState>>>`. Roles declared in placements but absent from this map resolve to in-process and emit a `contractWarning`.
- **`ExecutionRequest` / `ExecutionResponse` / `ExecutorIntermediate` entities** (`./entities`): JSON Schema 2020-12 wire shapes for cross-isolate DAG execution; `FromSchema`-derived TypeScript types exported from `./entities` and `./types`.
- **`./container` subpath**: public submodule exporting `DagTask`, `DagHost`, `DagContainerBase`, `ForwardingInstrumentation`, `DagOutcome`, the transport-error codes (`DAG_CONTAINER_TRANSPORT`, `DAG_CONTAINER_WORKER_DIED`), and the `TransportErrorCode` discriminator.
- **`applySnapshot(snapshot: JsonObject): void`** on `NodeStateInterface` and `NodeStateBase`: promoted from `protected` to `public` so container backends can rehydrate terminal state from an `ExecutionResponse.stateSnapshot`.
- **`snapshot(): JsonObject`** on `NodeStateInterface`: made explicit in the interface contract (previously only in the base implementation).
- **`BridgeMessage` protocol** (`./entities`): kind-discriminated oneOf JSON Schema for the parent↔DagHost channel. Parent→host: `init`, `execute`, `abort`, `shutdown`. Host→parent: `ready`, `result`, `intermediate`, `instrumentation`, `error`, `log`. The `execute` branch is DAG-grain only (no `nodeName`, no `kind` discriminant on the request). The `result` branch uses `terminalOutput`. `Validator.bridgeMessage` validates at the channel boundary.
- **`DagHost`** (`./container`): isolate-side runtime. Receives `init` (dynamic-imports registry module, version-handshakes, replies `ready`), `execute` (restores state, runs whole DAG via per-execute `Dagonizer`, streams `intermediate` messages, replies `result`), `abort` (fires per-request `AbortController`), `shutdown` (closes channel). `ForwardingInstrumentation` is constructed per-execute with the request's `placementPath` as `basePath` so forwarded instrumentation messages carry the full composite path.
- **`DagContainerBase`** (`./container`): abstract transport base implementing `DagContainerInterface`. Subclasses provide `acquireChannel()` / `releaseChannel()`. Handles request correlation, abort forwarding, instrumentation re-firing from `instrumentation` BridgeMessages, and transport failure → collected error outcome (never throws). `initializeChannel()` protected helper sends `init` and awaits `ready`.
- **`ForwardingInstrumentation`** (`./container`): `Instrumentation` implementation for DagHost. Suppresses `flowStart`/`flowEnd`; forwards `nodeStart`, `nodeEnd`, `phaseEnter`, `phaseExit`, `contractWarning`, `error` as `instrumentation` BridgeMessages. Takes a required `basePath` positional prepended to all forwarded `placementPath` values (pass `[]` for a top-level host with no parent placement context).
- **`DagOutcome`** (`./container`): static factory (`noun.verb()`) for `DagOutcomeInterface` values. `DagOutcome.transportError(requestId, code?, message?)` builds the collected-error outcome (`terminalOutput: 'failed'` plus one unrecoverable `runDag` `NodeError`) the transport layer returns when a DAG never reaches a terminal. `ChannelDispatch` and `DagContainerBase` are the call sites.
- **`MessageChannelInterface`** (`./contracts`): duplex channel contract (`send`, `onMessage`, `close`).
- **`RegistryModuleInterface` / `RegistryBundleInterface`** (`./contracts`): default-export contract for dynamically-importable registry modules. `createBundle(servicesConfig)` returns a `RegistryBundleInterface` with `bundle`, `services`, `registryVersion`, `restoreState`.
- **`SystemInfoInterface`** (`./contracts`): `recommendedWorkerCount(config)` contract for W3 backends.
- **`RecommendedWorkerCountConfig` entity** (`./entities`): JSON Schema and defaults for worker count heuristics.
- **`LoopbackChannel`** (`./testing`): in-memory duplex channel pair using `structuredClone` + `setImmediate` for full serialization testing. `LoopbackChannel.pair()` returns two connected sides.
- **`ConformanceRegistry`** (`./testing`): DAG-level law fixtures. Body DAGs (`conformance-body-law1`–`law9`) and runner DAGs (`conformance-runner-law1`–`law9`) using `EmbeddedDAGNode` with `stateMapping.output`. Nodes record observations through state (not closures) for snapshot round-trip fidelity. `buildConformanceBundle()` returns the `RegistryBundleInterface` plus `RegistryModuleInterface` default export for DagHost dynamic-import.
- **`DagConformance`** (`./testing`): backend-agnostic conformance law suite (Laws 1–9). `DagConformance.laws(harness)` returns `DagConformanceLawInterface[]` for any `DagConformanceHarnessInterface`. Laws cover: node execute with state surface, state mutation visibility, error collect-and-route, timeout, abort propagation, instrumentation placementPath, scatter checkpoint byte-identity across backends, at-least-once under container failure (Law 8, harness-gated), and state round-trip fixed point. `DagConformanceHarnessInterface` gains optional `createInProcessDispatcher` (Law 7) and `interruptMidScatter` (Law 8) hooks.
- **Scatter dag-body containment** (W4): `executeScatter` in `Dagonizer` routes each scatter item's dag-body through a bound `DagContainerInterface` when `scatter.container` is set and the container resolves to non-null. Node-body scatter items always run inline. Per-ack checkpoint writes (`SCATTER_PROGRESS_KEY`) are byte-identical between in-process and contained paths. `ConformanceRegistry` adds `scatterCounterNode`, `scatterItemBodyDag` (dag-body for scatter law items), and `scatterDag` runner factory with map-gather `{ value → gatheredItems }`.
- **`NodeStateInterface.resetLifecycle()`**: resets the lifecycle discriminated union to `pending`. Called by the dispatcher before re-entering a flow on resume when the prior run ended in a terminal state (failed/cancelled/timed_out) due to a crash or interrupt. Lifecycle is not captured in snapshots; this method is the engine's mechanism for re-entering execution on a state that survived a crash.
- **`DagHost` synthetic-error guard** narrowed: the `DAG_EXECUTION_FAILED` synthetic error is only emitted when `terminalOutcome === null` AND `state.errors.length === 0` AND `lifecycle.kind !== 'completed'`. DAGs that complete without a `TerminalNode` (lifecycle `completed`, `terminalOutcome null`) no longer receive a spurious `recoverable: false` error that caused contained scatter items to route to `'error'` output instead of `'success'`.

### Fixed

- **`NodeStateBase.clone()` subclass identity**: `clone()` now instantiates the concrete subclass via `this.constructor` rather than hardcoding `new NodeStateBase()`. Domain state survives the `clone()→applySnapshot()` round-trip on embedded-DAG and scatter (including contained/worker) paths without requiring a hand-written `clone()` override in every subclass. The `as TState` cast in `StateMapper.createChild` is now truthful at runtime.

- **EventEmitter listener accumulation on reused pooled workers**: `DagContainerBase.runDag` previously called `channel.onMessage(handler)` on every request, accumulating O(N) transport listeners on a shared channel and triggering Node's `MaxListenersExceededWarning` when a worker handled more than 10 scatter items. Replaced per-request listener registration with `ChannelDispatch` — a single-subscription requestId correlator that installs exactly one `channel.onMessage` handler per channel lifetime and demuxes responses via a `Map<requestId, resolver>`. Channel implementations (`MessagePortChannel`, `IpcChannel`, `NdjsonChannel`, `PostMessageChannel`, `LoopbackChannel`) are updated to enforce replace semantics on `onMessage` (the underlying transport listener is installed once in the constructor; subsequent `onMessage` calls replace the delegated handler, never re-subscribe). A regression test (`channel-correlation.test.ts`) asserts exactly one subscription regardless of request count, correct per-request result correlation, and no cross-talk under out-of-order delivery.

- **Worker/child death no longer hangs the in-flight request (parent backstop, Law 4)**: when a pooled container worker or child died without sending a result or error (terminate, OOM via `resourceLimits`, segfault, `process.exit`, killed tab), nothing failed the pending `ChannelDispatch` entry, so `runDag` hung forever and `executeScatter`'s pool drain never resolved. Added `ChannelDispatch.failAll(code, message)` — settles every pending entry with a transport-error `DagOutcomeInterface` and rejects an in-flight init; the channel-scoped (`requestId: null`) error path is factored to call it, so there is one code path that fails all pending work. `DagContainerBase.failChannel(channel, code, message)` is the protected hook backends call from their transport-death listeners. This is death **detection**, not a blind timer, so legitimately long-running DAGs are never killed. The transport-error codes (`DAG_CONTAINER_TRANSPORT`, `DAG_CONTAINER_WORKER_DIED`) and the `TransportErrorCode.isInfrastructureFailure(code)` discriminator are canonical exports from `./container`.

- **Contained scatter preserves at-least-once on infrastructure failure (Law 8)**: a contained scatter dag-body whose `container.runDag` returned a transport-error outcome (the DAG never ran to a terminal because the worker died or the channel was lost) was previously acked anyway, removed from the inbox, and wiped from the checkpoint — silently losing the item. `executeScatter`'s contained branch now throws an `ExecutionError` when the outcome carries an infrastructure-failure code, so the pool-error path fires, the item is left un-acked, and the throw precedes `ScatterCheckpoint.clear` — a resume on a healthy container reprocesses exactly the lost item. A legitimate body that ran and routed to its `error` output (a real terminal) still acks as before. The cardinality-1 embedded-DAG branch keeps routing an infrastructure failure to its `error` output (never throws), per Law 3.

## 0.17.0

### Minor Changes

- 34b7155: Apply Clean Code manifesto: static classes replace free functions, named constants replace magic numbers, flag arguments replaced with options objects, SRP extractions from Dagonizer core.

  **Breaking removals:** `detectGeminiNano` (→ `GeminiNanoAdapter.detect()`), `decodeToolCallsJson` (→ `ToolCallCodec.decode()`), `classifyHttp` (→ `LlmError.classifyHttp()`), `asNetworkError` (→ `LlmError.fromNetworkError()`).

  **New:** `DAGValidator`, `StateMapper`, `ScatterCheckpoint`, `PlacementUtils`, `ToolCallCodec`, `OpenLibraryDocs`, `BookEntitiesError`, `ExecutionError.fromSignal()`, `GeminiNanoAdapter.detect()`.

## 0.16.0

### Minor Changes

- 8b47957: Native streaming scatter: unified executor with bounded worker pool, durable-inbox checkpoint, and incremental gather.
- 8b47957: viz: ship a subclassable `CytoscapeGraph` factory, make the visualizer opt-in, and fix self-loop node rendering.

  - **`CytoscapeGraph`** (new, `@noocodex/dagonizer/viz`): given a `DAG`, `await new CytoscapeGraph(cytoscape, container, dag, options).mount()` returns a fully-configured `cytoscape.Core` — elements (via `CytoscapeRenderer`), the canonical stylesheet, the bottom-up dagre `preset` layout, and pan/zoom/box-select defaults. Cytoscape is dependency-injected; protected hooks (`buildElements`, `stylesheet`, `presetLayout`, `interactionDefaults`, `layoutRegistry`, `applyLayout`, `enforceVisibility`, `onReady`) are the extension surface. Ships with `CytoscapeGraphInterface` and `CytoscapeGraphOptions`.
  - **`cytoscape` and `@dagrejs/dagre` are now optional peer dependencies.** The visualizer is opt-in: consumers who do not import `./viz` install neither. `@dagrejs/dagre` was previously a devDependency while `dist/viz/CompositeLayout` imported it at runtime, so external consumers of the cytoscape renderer crashed with `Cannot find module '@dagrejs/dagre'`.
  - **`CompositeLayout.compute` is now `async`** and lazy-imports `@dagrejs/dagre`, so `MermaidRenderer` / `JsonLdRenderer` consumers never load the layout engine. **`CytoscapeRenderer.render` returns elements only** — the `computeLayout` / `layoutOptions` options are removed; positioning is owned by `CompositeLayout` / `CytoscapeGraph`.
  - **Fixed:** DAG nodes carrying a self-loop edge (a `retry` route to self) rendered invisible. The canonical stylesheet used deprecated `width: 'label'` / `height: 'label'` auto-sizing, which left a degenerate size cache on self-loop nodes that cytoscape culled. It now uses explicit numeric node dimensions and a concrete monospace font stack, with a post-layout visibility sweep as a guard.
  - **`PhaseNode` rendering** (6th placement type): all three renderers (`CytoscapeRenderer`, `MermaidRenderer`, `JsonLdRenderer`) now recognize `PhaseNode` placements. `CytoscapeRenderer` emits a node element with `data.type === 'phase'` carrying `data.phase` and `data.node`; the `CytoscapeGraph` stylesheet styles phase nodes with a `barrel` shape and dashed purple border to distinguish them from flow nodes. `MermaidRenderer` emits a stadium-shape node with the `(pre|post)` suffix and no outgoing edges. `JsonLdRenderer` emits a `dag:PhaseNode` entry with `dag:phase` and `dag:node` fields.

## 0.15.0

### Minor Changes

- b5b931f: Audit-driven cleanup across the monorepo (performance, V8 shape, consistency) — every confirmed and advisory finding addressed.

  Core (`@noocodex/dagonizer`):

  - perf: `Scheduler.current()` returns the active provider directly (no per-call wrapper allocation on the node/scatter hot path); `SchedulerProvider` structurally satisfies `SchedulerHandle`, so the public return type is unchanged.
  - perf: gather strategies (`map`/`append`/`partition`) no longer re-sort `execution.records` — records are now documented as an invariant to be source-index ordered (the scatter loop builds them so on every path including resume), eliminating a redundant `.slice().sort()` per gather. `executeScatter` builds the reducer input by iterating the outputs map directly (no intermediate spread).
  - fix(v8-shape): `ToolError.status` is `number | null`, always initialised, so every instance shares one hidden class.
  - consistency: wire-format helpers in `OpenAiCompatibleAdapter` are private methods (no freestanding `toX`/`parseX` functions); removed the forbidden `SearchTool` alias from `./patterns` (use canonical `Tool` from `./tool`).

  Plugin packages: provider adapters' wire-format/error helpers consolidated onto their adapter classes; `StubAdapter` constructor arg `opts`→`options`; redundant `public` modifier dropped; `OpenLibrarySearchTool` populates `notes` provenance consistently with the other tools.

  Tool packages (`-tool-googlebooks`, `-tool-wikipedia`): now re-export the `@noocodex/dagonizer-book-entities` types (`Book`, `Candidate`, `Money`, `CanonicalId`) they expose in their public surface, matching `-tool-openlibrary`.

- a338274: Add `WellFormedValidator` (`./validation`): an opt-in authoring lint that flags hacky/legacy DAG shapes the structural Ajv schema cannot express — bare `null` flow-ends (route to a canonical `TerminalNode` instead), dangling output targets, and malformed scatter/embedded/terminal placements. It returns human-readable violations and is NOT wired into the permissive runtime `registerDAG` (where `null` routes remain a supported natural-end). The repo's flagship example DAGs are gated against it via a new `lint:dags` CI step.

### Patch Changes

- a338274: `registerDAG` now credits the co-located contract of `EmbeddedDAGNode` and `ScatterNode` placements (resolved by placement name), not just `SingleNode` placements. Previously, an operation rendered as an embedded-DAG or scatter placement was dropped from the contract graph, so a downstream node reading its `produces` was wrongly flagged as a dangling read and `registerDAG` threw `DAGError`. Fixes the `examples/derive.ts` embedded-DAG flow, which failed contract validation at registration.

## 0.14.0

### Minor Changes

- d3a4e7b: Fork, embed, and join are three distinct node types, each with exactly one way to express them. No fan-out API.

  - **Fork** is `ScatterNode` / `.scatter(name, source, body, outputs, options?)`. `source` is required (a fork is always 1→N). `FanOutNode` / `.fanOut()` are removed.
  - **Embed** is `EmbeddedDAGNode` / `.embeddedDAG(name, dagName, outputs, options?)`: invoke a sub-DAG once (cardinality 1) with `stateMapping { input, output }` (`input` seeds the child from the parent, `output` copies child fields back). Distinct from fork; never a flag on `scatter`.
  - **Merge** machinery is `GatherConfig` + the `GatherStrategies` (`map`/`append`/`partition`/`custom`) and `OutcomeReducers` (`aggregate`/`terminal`) registries. `FanInConfig`, `FanInStrategies`/`FanInStrategy`/`FanInExecution` are removed.
  - Renames: `FAN_OUT_PROGRESS_KEY`→`SCATTER_PROGRESS_KEY` (and `FanOutProgress`/`StoredFanOutProgress`→`ScatterProgress`/`StoredScatterProgress`); `MetadataKey.fanInResults`→`gatherResults`; derive `annotations.fanouts`→`annotations.scatters`, `DAGDeriverFanOut`→`DAGDeriverScatter`, `fanInOperation`→`customNode` (the `embeddedDAGs` annotation now renders an `EmbeddedDAGNode`); `@noocodex/dagonizer-patterns-flow`'s `FanInReducerNode`→`MergeReducerNode`.
  - Visualization gains an `embedded-dag` placement type (Cytoscape) / subroutine shape (Mermaid) / `dag:EmbeddedDAGNode` (JSON-LD), distinct from `scatter`.

  `NodeResult.output` is now required and typed `string | null` (`null` = no route emitted; previously optional `string`), and every `NodeResultInterface` carries a required `intermediateResults` array (`[]` for leaf nodes): one stable result shape, no post-construction mutation. `onNodeEnd` and `Instrumentation.nodeEnd` take `output: string | null` to match.

  One way to seed child state: `ScatterNode` uses `stateMapping.input` (builder option `inputs`) to seed each clone, the same field/orientation as `EmbeddedDAGNode.stateMapping.input`; the old `ScatterNode.projection` field is gone. (Scatter has no `stateMapping.output`: the N→1 merge is `gather`'s job.) `GatherConfig.strategy` references the canonical `GatherStrategy` enum instead of re-declaring it.

  `NodeStateInterface` gains `deleteMetadata(key)`. The `./constants` subpath now resolves (constant value+type pairs: `GatherStrategyName`, `MetadataKey`, `NodeType`, `Output`, `ParallelCombine`, `ScatterOutput`).

  No back-compat shims. Clean breaks, versioned:

  - `DAGDeriver.derive` takes `nodes` (contracts co-located on each node, single source of truth); the standalone `contracts` input is removed.
  - `CheckpointData.stores` is required; checkpoints produced before stores were captured no longer load.
  - The observability hooks (`onNodeStart`/`onNodeEnd`/`onError`) take `placementPath` as a required argument (no `[]` default).
  - `ContractRegistryValidator` treats the entrypoint's `hardRequired` as the flow's ambient external state, so any node may read those keys and multi-root topologies (several roots reading the initial input) validate.
  - `DAGDeriverTerminal` has one way to end and one way to route: `{ outcome, emit }` synthesizes a `TerminalNode` (the only way to end an outcome); `{ outcome, target: string }` routes to an existing placement. The implicit `target: null` end is removed; terminals are explicit.

  Checkpointing depends on a capability, not the key-value surface. The new `Snapshottable` contract (`./contracts`) declares just `snapshot()` / `restore()`; `Store extends Snapshottable`. `StoreSnapshot` and `StoreSnapshotEntry` move to `Snapshottable` and are exported only from there (and the `./contracts` / `./store` barrels); `./contracts/Store` no longer re-exports them. `Checkpoint.capture(dag, result, { stores })` and `Checkpoint.restoreStores(stores)` take `Record<string, Snapshottable>`, so a non-KV backing (an RDF triple store, a vector index) can ride along in a checkpoint without implementing `get`/`set`/`has`/`delete`/`update`.

  Retry is a flow shape, not an in-node policy. `NodeStateBase` (the state every consumer extends) gains a retry-attempt concept (`recordAttempt(key)`, `retriesFor(key)`, `clearAttempts(key)`, and `withinRetryBudget(key, maxAttempts)`) keyed by a routing name (typically `context.nodeName`). A node that fails routes to a `retry` output (the DAG loops the edge back, bounded by the counter) or a `salvage` output (budget spent); the loop and the recovery both live in the topology, not inside the node. The counter is part of `snapshot()` (the persistence shape `NodeStateData` adds a `retries` map), so a retry budget survives checkpoint/resume.

  Embedded DAGs nest arbitrarily deep (DAG-in-DAG-in-DAG); cross-kind sub-DAG cycles (embed ↔ scatter) are detected at registration.

  Migration: replace `.fanOut(name, body, outputs, { source, ... })` with `.scatter(name, source, body, outputs, { ... })`; nested-flow invocations keep using `.embeddedDAG()`. Observers reading a node result's `output` now receive `null` (not `undefined`) when no route was emitted.

## 0.13.2

### Patch Changes

- 238a94d: Hotfix: align every package in the workspace to 0.13.1 and lockstep them via the new `fixed:` group in `.changeset/config.json`. Eliminates the v0.13.0 release artifact where peer-dep range churn caused most packages to jump to 1.0.0 while the engine itself sat at 0.12.0; the tag `v0.13.0` was correct but the per-package version numbers disagreed. All packages in the `@noocodex/dagonizer*` group now move together; peer ranges restored to `workspace:^0.13.1` across the workspace.

## 0.12.0

### Minor Changes

- 7c0e38a: Archivist demo: embedder cascade exposed as `ArchivistServices.embedder` and used across `recordFindings` (writes embedding triples), `recallCandidates` (cosine-similarity prior-candidate recall with Jaccard fallback), and `rankCandidates` (hybrid composite score with LLM tiebreak on top-3). New anti-hallucination validator runs deterministically before the LLM validator in `compose-retry-loop`, cross-referencing draft named entities against the shortlist. `decideTools` pattern-matches common query shapes and bypasses the LLM for unambiguous tool selection.
- 3286d07: Archivist live-demo polish: PROV-O bridge connects books to run activities (`prov:wasGeneratedBy`, `prov:wasAttributedTo`, `prov:generated`) so the MemoryGraph reads as one connected graph instead of two clusters. Persona rewritten as positive imperatives ("research librarian with global catalog" instead of "small independent bookstore", eliminating the "in stock" inventory framing); all engineer-jargon "shortlist" references replaced with "catalog records" in user-facing strings. DagGraph viewport: smooth synchronous fit with 120ms debounce, parallel nodes coalesce to one zoom-out, user-gesture latch pauses auto-follow until Fit/Center released, reset cancels in-flight animation, horizontal edge labels with taxi-turn 50%, CompositeLayout separations widened. OpenLibrary scout reads typed `author`/`subject`/`isbn` args; `decideTools` deterministic shortcuts detect ISBN-13/10. Embedded-DAG outcome routing tolerates recoverable errors so one rate-limited source doesn't poison the whole subgraph. MemoryGraph label colours match node layer colours. Conversation auto-scrolls when new turns arrive (respects user scroll-up).

## 0.11.4

### Patch Changes

- a3528ad: `CytoscapeRenderer` emits `data.label` as Title Case (kebab → Title Case with `/` separators preserved). Machine identifiers stay kebab-case; only the rendered display label changes. Archivist example DAG placements renamed to drop `bsf-` / `crl-` namespace prefixes; the embedded-DAG containment already provides the visual namespace.

## 0.11.3

### Patch Changes

- 22491f7: Archivist demo: in-node 30s timeouts + salvage paths on every LLM-calling node so the DAG always completes (no more hangs on slow on-device backends). `rankCandidates` and `decideTools` LLM schemas refactored to emit integer indices into pre-numbered lists instead of full records, a token-economy fix delivering ~10–25× speedup on Gemini Nano. Slow-backend warning banner added to the demo when the browser built-in backend is selected without cloud keys.

## 0.11.2

### Patch Changes

- 0789762: `DagGraph` cytoscape stylesheet: compound subgraphs (embedded-DAGs, parallel containers, every `node:parent`) render as `round-hexagon`; fan-out placements render as `concave-hexagon`; edges switch to `round-taxi` with `vee` arrowheads and 12px corner radius. Dagre layout uses `ranker: 'tight-tree'` with centered ranks (no fixed `align`) and `marginx/marginy: 40` so outermost nodes have wrap-around room.

## 0.11.1

### Patch Changes

- 40f8abf: Archivist demo: `rank-candidates` no longer aborts the whole embedded-DAG when its LLM call exceeds the per-node timeout. Signal is propagated through `llm.rankCandidates` so the LLM call is actually cancelled, the default timeout is raised to 90s for on-device backends, and any abort/timeout leaves `state.candidates` intact (with their original scout-supplied scores) so the compose step sees real books instead of an empty shortlist.

## [unreleased]

### Changed

- docs: full site audit and rewrite. Reorders sidebar (Demos before Guide,
  Plugins as its own tier). Replaces Mermaid blocks that depict DAGs with
  `<DagGraph>` driven by `CytoscapeRenderer.render(dag)`; loads code samples
  from `examples/` via VitePress region imports so the source files are
  the documentation source of truth. Renames `reference/operations.md` to
  `reference/nodes.md`. Adds `Phase 10: Shared state` example page.
  Surfaces previously-orphaned `Lifecycle phases` and `Plugins` pages
  in the sidebar. Registers `DagGraph` globally in the theme. Scrubs
  em-dashes and AI-isms across every sidebar-linked page.
- **BREAKING:** Renamed `DeepDAGNode` placement kind to `EmbeddedDAGNode`. The
  JSON-LD discriminator `@type` value changes from `'DeepDAGNode'` to
  `'EmbeddedDAGNode'`. Schema `$id` updates from
  `https://noocodex.dev/schemas/dagonizer/DeepDAGNode` to
  `https://noocodex.dev/schemas/dagonizer/EmbeddedDAGNode`. The
  `DAG_CONTEXT` IRI entry renames to `${NS}EmbeddedDAGNode`. The builder
  method `DAGBuilder.deepDAG()` becomes `DAGBuilder.embeddedDAG()`. All
  `Deep*` / `Sub*` identifiers in the public surface (`DeepDAGOptionsInterface`,
  `TypedDeepDAGOptionsInterface`, `DeepDAGNodeInterface`, `DeepDAGNodeSchema`,
  `DAGDeriverSubDAG`, `DAGDeriverAnnotations.subDAGs`) rename to the
  corresponding `Embedded*` / `embeddedDAGs` form. `Validator.deepDAGNode`
  becomes `Validator.embeddedDAGNode`. The `CytoscapeRenderer` option
  `deepDags` renames to `embeddedDAGs`. Existing DAG JSON loaded via
  `Dagonizer.load(json)` must rewrite the `@type` value before it will
  validate. The terminology "deep-DAG" / "sub-DAG" is replaced by
  "embedded-DAG" throughout the prose, JSDoc, and documentation.

### Added

- `PhaseNode` placement: lifecycle-attached pre/post tasks that run
  around the main DAG loop. `phase: 'pre'` placements execute in DAG
  declaration order before the entrypoint; an error aborts the run
  (lifecycle becomes `failed`, the main loop never executes).
  `phase: 'post'` placements execute in DAG declaration order after the
  main loop drains on every exit path (completion, abort, timeout,
  terminal-failed, node throw); errors are collected as warnings on
  state (code `POST_PHASE_FAILED`) and do not change the already-set
  lifecycle. Pre-phase names appear at the start of
  `ExecutionResult.executedNodes`; post-phase names appear at the end
  (only when the placement completed successfully). The dispatcher
  invokes `Instrumentation.phaseEnter` / `phaseExit` around every phase
  placement.
- New entity exports: `PhaseNodeSchema`, `PhaseNode`,
  `PhaseNodePlacementInterface`. Re-exported through the root barrel
  and the `./entities` subpath. `Validator.phaseNode` available on the
  unified validator.
- `DAGBuilder.phase(name, 'pre' | 'post', node)`: fluent API for
  declaring lifecycle-attached placements. Does not set the
  entrypoint; phase placements are out-of-band and never the
  main-loop entry.
- `Instrumentation` contract: composable observability surface invoked at
  the same execution boundaries as the protected `on*` subclass hooks.
  Methods: `flowStart`, `flowEnd`, `nodeStart`, `nodeEnd`, `phaseEnter`,
  `phaseExit`, `contractWarning`, `error`. Install a custom
  implementation via `new Dagonizer({ instrumentation })`; defaults to
  a `NoopInstrumentation`. Both surfaces fire; subclass `on*` hooks
  coexist with plugin-supplied instrumentation. Hooks MUST NOT throw;
  thrown errors abort the surrounding flow.
- `NoopInstrumentation`: the default base. Plugins extend it and
  override only the hooks they care about; un-overridden hooks remain
  no-ops, preserving V8 hidden-class stability and zero overhead.
- New exports from the root barrel: `Instrumentation` type and
  `NoopInstrumentation` class. Also re-exported through
  `./contracts` and `./runtime` subpaths.
- `DagonizerOptionsInterface.instrumentation`: optional constructor
  field. When omitted, the dispatcher installs a `NoopInstrumentation`.
- Resumable fan-out: `FanOutNode` records per-item progress under a
  reserved metadata key (`FAN_OUT_PROGRESS_KEY ===
'__dagonizer_fan_out_progress__'`) keyed by placement `name`. On resume,
  items whose indices appear in `completedIndices` are skipped; their
  outputs are rehydrated from the persisted `itemResults` for the
  aggregate-output and fan-in stages. Progress writes happen once per
  batch (not per item) to keep concurrent item promises race-free. The
  placement's entry is cleared before fan-in runs so subsequent re-runs
  of the same fan-out start clean. Index semantics are strict: positions
  refer to the source array at resume time, not at checkpoint time;
  consumers must treat the source as immutable while a fan-out
  checkpoint is live, or clear the entry under
  `FAN_OUT_PROGRESS_KEY[fanOut.name]` before resume when the source has
  changed.
- New exports from the root barrel: `FAN_OUT_PROGRESS_KEY`,
  `FanOutProgress`, `StoredFanOutProgress`.

## 0.10.0

### Minor Changes

- 110fef0: v0.10.0: Plugin architecture per RFC 0001.

  Main package gains three subpaths: `./adapter`, `./patterns`, `./tool`.
  Eight cloud / on-device adapter packages, three external-service tool
  packages, and three pattern packages ship for the first time. The
  Archivist example consumes them all and demonstrates the canonical
  extension pattern.

  Required-with-defaults + V8 shape stability principles enforced
  across every contract surface.
