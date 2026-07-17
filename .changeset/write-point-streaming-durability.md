---
"@studnicky/dagonizer": major
---

De-RDF the transient scatter-clone transfer path and add a configurable
write-point policy for post-completion durability/query projection.

**Breaking:**

- Transient state crossing the worker/container boundary is now always plain
  JSON (`TransientNodeStateType`), never RDF. `NodeStateBase.restoreJsonLd`
  is removed; use `restoreTransientState(runIri, snapshot)` (paired with the
  existing `snapshotTransientState()`) for the transient path, or
  `snapshotGraph`/`restoreGraph` for the durable RDF graph, which is now a
  post-completion, host-side projection rather than part of the transfer
  codec.
- `CheckpointDataType.graph` (`{ runIri, graphIri, nquads, hash, jsonLd }`) is
  replaced by `CheckpointDataType.state` (`{ runIri, transient }`), where
  `transient` is a `TransientNodeStateType`. `Checkpoint.capture`/`restoreState`
  use the new shape; checkpoints captured before this change are not
  forward-compatible.
- `DagOutcome.transportError` now takes `(id, correlationId, options?)`
  instead of `(correlationId, options?)` — a transport-error outcome is keyed
  to the failing item id, not only the request correlation id.
- `InitMessageShapeType` (and the container/worker init handshake) requires
  `graphStateTransferFormats`. `DagContainerBase` resolves it from
  `options.graphStateTransferFormats` or `DEFAULT_GRAPH_STATE_TRANSFER_FORMATS`
  (now re-exported from `@studnicky/dagonizer/container`).
- `DAGType` gains an optional `writePoints` array (`WritePointType[]`);
  `ScatterNode` gains the same at the placement level. Both cascade from a
  runtime-level `DEFAULT_WRITE_POINTS` default (`['NodeEdges',
  'WatermarkCommit']`), override-not-merge — a DAG or placement-level array
  fully replaces the inherited one, it does not union with it.
  `WritePointPolicy.resolveDag`/`resolvePlacement` resolve the effective set
  at registration time and reject `FoldDeltaJournal` without
  `WatermarkCommit` (structurally unreplayable).

**New:**

- `WritePointType`: `'NodeEdges' | 'FullItemProjection' | 'FoldDeltaJournal' |
  'WatermarkCommit' | 'InMemorySnapshot'` — independent, orthogonal axes for
  what a completed item/batch writes and where: cheap DAG-topology bookkeeping,
  expensive full per-field RDF projection, fold-contribution replay policy,
  the scatter watermark/cursor, and an in-memory queryable
  snapshot. Combinations compose (e.g. `[InMemorySnapshot, WatermarkCommit]`
  is fully supported, not a special case).
- Gather progress records can carry compact fold contributions for replay.
  `GatherCheckpoint.append` accumulates those records in transient metadata,
  and checkpoint persistence still writes the full checkpoint JSON.
- Contribution replay and dedup-by-index provide groundwork for resume without
  double-counting a re-run item. Bounded append-only durable journaling and an
  atomic durable-before-watermark batch commit remain open.

This is the redesign recorded in
`plans/streaming-durability-and-state-redesign.md` (§4–§7): transient
per-clone state is a plain-object hot path with no RDF projection, indexing,
or journal; the graph is a durability/query layer, opted into per DAG or
scatter placement via write points, not the default per-clone transfer
format.
