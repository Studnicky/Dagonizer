# @noocodex/dagonizer

## [unreleased]

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
