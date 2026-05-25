# @noocodex/dagonizer

## 0.11.4

### Patch Changes

- a3528ad: `CytoscapeRenderer` emits `data.label` as Title Case (kebab → Title Case with `/` separators preserved). Machine identifiers stay kebab-case; only the rendered display label changes. Archivist example DAG placements renamed to drop `bsf-` / `crl-` namespace prefixes — the embedded-DAG containment already provides the visual namespace.

## 0.11.3

### Patch Changes

- 22491f7: Archivist demo: in-node 30s timeouts + salvage paths on every LLM-calling node so the DAG always completes (no more hangs on slow on-device backends). `rankCandidates` and `decideTools` LLM schemas refactored to emit integer indices into pre-numbered lists instead of full records — token-economy fix delivering ~10–25× speedup on Gemini Nano. Slow-backend warning banner added to the demo when the browser built-in backend is selected without cloud keys.

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
  `Deep*` / `Sub*` identifiers in the public surface — `DeepDAGOptionsInterface`,
  `TypedDeepDAGOptionsInterface`, `DeepDAGNodeInterface`, `DeepDAGNodeSchema`,
  `DAGDeriverSubDAG`, `DAGDeriverAnnotations.subDAGs` — rename to the
  corresponding `Embedded*` / `embeddedDAGs` form. `Validator.deepDAGNode`
  becomes `Validator.embeddedDAGNode`. The `CytoscapeRenderer` option
  `deepDags` renames to `embeddedDAGs`. Existing DAG JSON loaded via
  `Dagonizer.load(json)` must rewrite the `@type` value before it will
  validate. The terminology "deep-DAG" / "sub-DAG" is replaced by
  "embedded-DAG" throughout the prose, JSDoc, and documentation.

### Added

- `PhaseNode` placement — lifecycle-attached pre/post tasks that run
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
- `DAGBuilder.phase(name, 'pre' | 'post', node)` — fluent API for
  declaring lifecycle-attached placements. Does not set the
  entrypoint — phase placements are out-of-band and never the
  main-loop entry.
- `Instrumentation` contract — composable observability surface invoked at
  the same execution boundaries as the protected `on*` subclass hooks.
  Methods: `flowStart`, `flowEnd`, `nodeStart`, `nodeEnd`, `phaseEnter`,
  `phaseExit`, `contractWarning`, `error`. Install a custom
  implementation via `new Dagonizer({ instrumentation })`; defaults to
  a `NoopInstrumentation`. Both surfaces fire — subclass `on*` hooks
  coexist with plugin-supplied instrumentation. Hooks MUST NOT throw;
  thrown errors abort the surrounding flow.
- `NoopInstrumentation` — the default base. Plugins extend it and
  override only the hooks they care about; un-overridden hooks remain
  no-ops, preserving V8 hidden-class stability and zero overhead.
- New exports from the root barrel: `Instrumentation` type and
  `NoopInstrumentation` class. Also re-exported through
  `./contracts` and `./runtime` subpaths.
- `DagonizerOptionsInterface.instrumentation` — optional constructor
  field. When omitted, the dispatcher installs a `NoopInstrumentation`.
- Resumable fan-out — `FanOutNode` records per-item progress under a
  reserved metadata key (`FAN_OUT_PROGRESS_KEY ===
'__dagonizer_fan_out_progress__'`) keyed by placement `name`. On resume,
  items whose indices appear in `completedIndices` are skipped; their
  outputs are rehydrated from the persisted `itemResults` for the
  aggregate-output and fan-in stages. Progress writes happen once per
  batch (not per item) to keep concurrent item promises race-free. The
  placement's entry is cleared before fan-in runs so subsequent re-runs
  of the same fan-out start clean. Index semantics are strict: positions
  refer to the source array at resume time, not at checkpoint time —
  consumers must treat the source as immutable while a fan-out
  checkpoint is live, or clear the entry under
  `FAN_OUT_PROGRESS_KEY[fanOut.name]` before resume when the source has
  changed.
- New exports from the root barrel: `FAN_OUT_PROGRESS_KEY`,
  `FanOutProgress`, `StoredFanOutProgress`.

## 0.10.0

### Minor Changes

- 110fef0: v0.10.0 — Plugin architecture per RFC 0001.

  Main package gains three subpaths: `./adapter`, `./patterns`, `./tool`.
  Eight cloud / on-device adapter packages, three external-service tool
  packages, and three pattern packages ship for the first time. The
  Archivist example consumes them all and demonstrates the canonical
  extension pattern.

  Required-with-defaults + V8 shape stability principles enforced
  across every contract surface.
