# @noocodex/dagonizer

## 0.11.0

### Minor Changes

- 7dc830c: **BREAKING:** The `Checkpoint` API consolidates around `Checkpoint.capture()`,
  `Checkpoint.load()`, `Checkpoint.recall()`, and instance methods. The legacy
  static helpers are removed.

  Migration table:

  | Old                                                                           | New                                                                          |
  | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
  | `const data = Checkpoint.from('dag', result); save(Checkpoint.toJson(data));` | `const ckpt = await Checkpoint.capture('dag', result); save(ckpt.toJson());` |
  | `Checkpoint.restore(raw, fn)`                                                 | `Checkpoint.load(raw).restoreState(fn)`                                      |
  | `await Checkpoint.persist(store, key, data)`                                  | `await ckpt.persist(store, key)`                                             |
  | `await Checkpoint.recall(store, key, fn)`                                     | `const ckpt = await Checkpoint.recall(store, key); ckpt?.restoreState(fn)`   |

  Removed methods:

  - `Checkpoint.from(dagName, result)` — replaced by `Checkpoint.capture` (returns a `Checkpoint` instance with `.data`).
  - `Checkpoint.restore(data, fn)` — replaced by `Checkpoint.load(raw).restoreState(fn)`.
  - `Checkpoint.toJson(data)` (static) — replaced by instance `ckpt.toJson()`.
  - `Checkpoint.persist(store, key, data)` (static, three-arg) — replaced by instance `ckpt.persist(store, key)`.
  - `Checkpoint.recall(store, key, fn)` (three-arg with restore factory) — replaced by `Checkpoint.recall(store, key)` returning `Promise<Checkpoint | null>`.

  (Bump remains minor since the project is pre-1.0; semver allows breaking changes in 0.x minors.)

- 540876f: Promote the DAG terminal endpoint to a first-class placement.

  `TerminalNode` is a new placement kind with `@type: 'TerminalNode'`, a `name`, and `outcome: 'completed' | 'failed'`. The placement ends the flow when reached; the engine reads `outcome` and dispatches `markCompleted()` or `markFailed(...)` on the top-level run.

  `DAGBuilder.terminal(name, outcome?)` is the authoring surface. Default outcome is `'completed'`. Routes may target a terminal placement by name from `.node()`, `.parallel()`, `.fanOut()`, or `.deepDAG()` uniformly.

  Deep-DAG placements may now route any output to `null` (sugar for terminate-completed) or to a named `TerminalNode`. The registration-time null-route ban for deep-DAGs is removed. The `isDeepDag` flag in `runNodes` continues to own lifecycle scoping for nested execution.

  `ExecutionResultInterface` gains `terminalOutcome: 'completed' | 'failed' | null`. The engine sets it when a flow exits through a TerminalNode; it is `null` for null-route exits, error paths, and aborts. The deep-DAG executor reads it from the inner DAG's result to route the parent placement — an inner `TerminalNode(failed)` propagates as `error` on the parent regardless of whether the inner DAG collected NodeError records.

  `DAGDeriverTerminal` becomes a discriminated union. The legacy `{ outcome, target: string | null }` variant is preserved; a new `{ outcome, emit: { name, outcome } }` variant directs the deriver to synthesize a `TerminalNode` placement (deduplicated by name; outcome conflicts and operation-name collisions throw at derive time).

  `MermaidRenderer`, `CytoscapeRenderer`, and `JsonLdRenderer` render TerminalNode placements as discrete graph entities. Mermaid uses a double-circle shape for `outcome: 'completed'` and an asymmetric flag for `'failed'`. Cytoscape emits `data.type === 'terminal'` with `data.outcome` and marks the synthetic END node with `data.synthetic: true`. JSON-LD output uses `@type: 'dag:TerminalNode'` with `dag:outcome`.

- 20ab46d: DeepDAG boundary v0.11. Cross-cutting changes to how data crosses the sub-DAG boundary, plus the foundational `Store` surface for shared mutable state.

  **Typed `stateMapping` on `DAGBuilder.deepDAG`.** New signature `deepDAG<TChildState, TParentState>(name, dagName, routes, options?)`. Options take `inputs` (child key → parent dotted path) and `outputs` (parent dotted path → child dotted path). The `Path<T>` recursive type validates dotted paths against the state shape, with a depth cap of 8 and a fallback to `string` for the default `NodeStateInterface` generic to preserve backward compatibility.

  **`Path<T>` exported from `@noocodex/dagonizer/builder`** — reusable recursive dotted-path type for any state shape.

  **`Store` contract + `BaseStore` abstract class + `MemoryStore` reference impl** in `@noocodex/dagonizer/store`. Modeled on `BaseAdapter`. Methods take `<T extends JsonValue>` with no defaults — callers must specify the value type at every call site; no `unknown` in the API surface. Concurrency contract: `update(key, fn)` is atomic within a single store instance; subclasses must override to satisfy the contract. `MemoryStore` provides a `Map<string, JsonValue>` backing with a synchronous override of `update`.

  **`TypedStore<Schema>` wrapper** for compile-time key-and-value narrowing on known key sets. Wraps any `Store`; keys constrained to `keyof Schema`, value types inferred from `Schema[K]`. Passes snapshot/restore/connect/disconnect through to the underlying store; `.inner` provides access to the wider `Store` contract when needed.

  **`RemoteStore` contract** in `@noocodex/dagonizer/contracts`. Extends `Store` with `endpoint`, `acquireLease`, `releaseLease`, and `health` for distributed execution. No reference implementation yet; the contract is the deliverable. `StoreError` taxonomy extended with `LEASE_DENIED`, `LEASE_EXPIRED`, `UNREACHABLE`.

  **Typed `DAGDeriverSubDAG<TChildState>`.** Mirrors the typed `stateMapping` shape on the contract-derive side. `subDAGs[name]` annotations narrow child-state keys at compile time via a `ChildKey<T>` helper that falls back to `string` for the default generic.

  **Checkpoint integration with named stores.** `Checkpoint.capture(dagName, result, { stores })` snapshots stores in parallel alongside parent state. `Checkpoint.load(raw)` and `Checkpoint.recall(store, key)` return `Checkpoint` instances. `checkpoint.restoreStores({ name: store })` repopulates named stores. `CheckpointDataSchema.stores` is an optional additive field — old checkpoints load with no store data.

  **Subpath exports** added to the package: `./store` (Store classes and the contract for ergonomic single-import).

  **Examples**: `examples/09-terminals.ts` (from prior release) and `examples/10-shared-state.ts` demonstrate the new APIs end-to-end. Both are workspace examples that compile and run via `npm run example:NN`.

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
