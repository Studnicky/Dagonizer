---
"@studnicky/dagonizer": major
"@studnicky/dagonizer-store-indexeddb": minor
"@studnicky/dagonizer-store-opfs": minor
"@studnicky/dagonizer-store-sqlite": minor
---

Add a codec-backed batched N-Quads worker contract and configurable
post-completion durability/query projection.

**Breaking:**

- Worker/container requests and responses carry one negotiated
  `GraphStateTransferType` for the entire item batch. The required format is
  `application/n-quads`; each item contributes one selected transient-state
  `rdf:JSON` literal in its named run graph. `GraphStateTransferCodec` performs
  one encode, integrity hash, decode, and partition operation per batch.
  `NodeStateBase.restoreJsonLd` is removed; graph restore uses the codec-backed
  transfer contract and `restoreTransientState(runIri, snapshot)` applies the
  decoded selected state.
- `CheckpointDataType.graph` (`{ runIri, graphIri, nquads, hash, jsonLd }`) is
  replaced by `CheckpointDataType.state` (`{ runIri, transient }`), where
  `transient` is a `TransientNodeStateType`. `Checkpoint.capture`/`restoreState`
  use the required state shape. Graph-shaped checkpoint payloads fail schema
  validation; there is no alternate checkpoint parser.
- `DagOutcome.transportError` now takes `(id, correlationId, options?)`
  instead of `(correlationId, options?)` — a transport-error outcome is keyed
  to the failing item id, not only the request correlation id.
- `DagTaskType` requires `inputState: TransientNodeStateSelectionType`,
  and the `DagTask` constructor accepts it immediately before `responseState`.
  `DagContainerBase` owns the only wire-request composition path and snapshots
  every batch item through this selection. Task request composition is
  removed.
  Embedded placements select the child-side keys in `stateMapping.input`;
  scatter DAG bodies add the configured item metadata key and `itemIndex`.
- `InitMessageShapeType` and the container/worker handshake require a
  non-empty, duplicate-free `graphStateTransferFormats` enum array. The host
  stores and advertises exactly the configured values; unsupported requested
  formats fail before execution. Container configuration exposes the array
  once at `DagContainerOptionsType.graphStateTransferFormats`; the internal
  init identity does not duplicate it.
- Dispatcher, DAG, and scatter placement policy use one namespaced
  `configuration` shape. `configuration.execution.batching` controls item or
  reservoir execution. `configuration.durability` controls write points and
  fold-journal binding. Omitted fields inherit from placement to DAG to
  dispatcher to canonical defaults. A present `writePoints` array fully
  replaces the inherited array, including `[]`.
- `DagContainerInterface.runDag(task, batch, options?)` returns one
  `RunResultType` per input item. Completed, failed, and awaiting-input siblings
  retain independent outcomes, errors, intermediates, and restored state across
  the host/channel seam. The batch graph transfer remains internal to the
  container and is absent from item outcomes.

**New:**

- `WritePointType`: `'NodeEdges' | 'FullItemProjection' | 'FoldDeltaJournal' |
  'WatermarkCommit' | 'InMemorySnapshot'` — independent, orthogonal axes for
  what a completed item/batch writes and where: cheap DAG-topology bookkeeping,
  expensive full per-field RDF projection, fold-contribution replay policy,
  the scatter watermark/cursor, and an in-memory queryable
  snapshot. Combinations compose (e.g. `[InMemorySnapshot, WatermarkCommit]`
  is fully supported, not a special case).
- `FoldJournalStoreInterface` defines the append-only commit contract for one
  atomic batch of fold contributions and bounded scatter progress. The host
  appends each commit before publishing its fold or watermark, deduplicates
  replay by gather/source/index, and records scatter completion before clearing
  live progress.
- Canonical durability defaults are `writePoints: ['NodeEdges',
  'WatermarkCommit']` and `foldJournalStoreKey: null`. `FoldDeltaJournal`
  requires `WatermarkCommit`, an explicit key bound in the dispatcher's
  `foldJournalStores`, and one replayable gather bound to the originating
  scatter source.
- SQLite, IndexedDB, and OPFS packages provide durable fold-journal stores with
  idempotent commit IDs, append ordering, restart recovery, and canonical
  commit validation at their storage boundaries.

The worker boundary uses the N-Quads transfer contract independently from
durability policy. Full domain-state graph projection remains a host-side,
post-completion write point and is not implied by worker transfer.
