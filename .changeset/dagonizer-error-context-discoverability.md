---
'@studnicky/dagonizer': minor
---

`DagExecutionContext` gains two static shorthands, `correlationIdOf(signal)` and `dagNameOf(signal)`, for the two well-known reserved context keys — discoverable directly off the class without importing `DagExecutionContextKeys`. `ObservedDag` now uses them internally instead of duplicating the `tryGet` + key lookup. `NodeScheduler` enriches every caught node-firing error's `DAGError.context` with `dagName`, `placementPath`, and (when available) `correlationId`, instead of leaving it `{}`. `LeafExecutor`'s "Unknown node" error now lists up to 5 currently registered node names and points at `dispatcher.registerNode(...)`. `Dagonizer`'s class docs and no-op hook section now point at `ObservedDag` for ready-made structured logging.
