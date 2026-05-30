# @noocodex/dagonizer

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
