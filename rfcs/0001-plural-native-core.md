# RFC 0001 — Plural-Native Core

Status: **In progress** · Target: pre-1.0 redesign · Decision: **adopt plural-native execution**
Build status: **Phases 1a, 1b, 2a built & green** (dagonizer package, 756 tests). Phase 2
onward pending. Read `0000-status.md` first for the authoritative state and build order.

> The fundamental unit of work flowing through a DAG is a **batch**.
> A single item is a batch of one. The engine never processes a scalar; it
> processes a batch whose length happens to be 1.

This RFC replaces the item-at-a-time executor and node contract with a
plural-native model. It is a 1.0-defining rewrite of the core, migrated across
every consumer package. We commit to it directly — no transitional item-core +
batch-layer that would be thrown away.

---

## 1. Why

The current core dispatches one item per node call. `Scatter` fans out items and
each clone runs the body one item at a time. Everything we now need is awkward or
impossible on that model:

- **Throughput / vectorization** — per-item dispatch overhead dominates; no
  amortization, no cache locality.
- **Micro-batching at decision points** — "emit the batch of items that need
  GDPR" has no home.
- **Scale (1M events, bounded memory)** — requires streaming batches with
  backpressure, not a materialized item array.
- **Worker offload** — shipping one item per message to a worker is pure
  overhead; batches amortize the bridge.

The unifying insight: **routing is partitioning.** A node consumes a batch and
distributes its items across output ports — some to `needs-gdpr`, some to
`geo-only`. A node's result is `Map<output, Batch>`, not a single route. Once
routing is partitioning, three things we kept treating as separate become one
mechanism:

- **per-item conditional routing** = a node partitioning a batch,
- **micro-batching** = a node that emits batches instead of items,
- **the reservoir** = a node that partitions *over time* by buffering until a
  threshold, then releasing a batch.

This is how high-throughput dataflow engines (Arrow, Spark, Flink) are built. It
is the right shape for this engine.

## 2. Principles

1. **Plural-native.** `Batch<T>` is the unit. `Batch.of(x)` is size 1. No scalar
   path exists in the executor.
2. **Routing is partitioning.** Nodes map a batch to `Map<output, Batch>`.
3. **Items keep identity.** Every item carries a stable id so ordering, gather,
   dedup, and checkpoint cursors are deterministic.
4. **Bounded memory on the hot path.** Streaming sources + reservoirs +
   fixed-size aggregates; in-flight is `concurrency × batchSize + buffers`.
5. **Scalar migration is mechanical.** A `ScalarNode` base adapts a per-item
   `executeOne(item)` into a batch-partitioning `execute(batch)`, so the bulk of
   existing nodes (adapters, tools, embedders) migrate by changing a base class,
   not their logic. Hot-path nodes implement plural `execute` directly.

## 3. Core types (new)

```
Batch<TItem>           ordered collection of items + per-item id; map/filter/
                       partition/concat; Batch.of(x), Batch.empty(), .size
Item<TState>           { id: ItemId; state: TState }   (row-oriented batch)
RoutedBatch<TOut>      ReadonlyMap<TOut, Batch<TItem>>  (a node's partitioned result)
```

**State model: row-oriented batches (decided).** A batch is a collection of
independent per-item states — the natural evolution of today's
scatter-clone-per-item, now N-at-a-time. Shared, cache-bearing services
(geo/country/timezone LRU) live on the services bag, not per item. Each item
keeps the existing `NodeStateBase` snapshot/restore model intact. `Batch.of(x)`
is a one-row batch; the "scalar is a batch of 1" invariant holds with no special
case. Row-oriented is the canonical and only storage; there is no columnar
representation — `ScalarNode` (§4) is mechanical precisely because the unit *is*
a row.

## 4. Node contract (the breaking change)

Today:

```ts
execute(state, context): Promise<NodeOutputInterface<TOutput>>   // one route out
```

Plural-native — **this is the one and only node contract**. `NodeInterface.execute`
*becomes* this signature; there is no second "scalar" contract and no legacy
contract kept alive beside it:

```ts
execute(batch: Batch<TState>, context): Promise<RoutedBatch<TOutput>>
//   the node processes the whole batch and partitions items across output ports
```

**No back-compat shims.** The old `execute(state)` signature is removed, not
adapted. Single-item processing is not a separate contract — it is a node that
chooses to **iterate the batch internally**. `ScalarNode` is the authoring base
that factors that loop out; it is a *convenience for writing per-item nodes*, not
a compatibility surface and not a runtime adapter that detects "old" nodes (there
are none):

```ts
abstract class ScalarNode<TState, TOutput, TServices>
  implements NodeInterface<TState, TOutput, TServices> {
  // a node that iterates internally; the base owns the loop + route grouping
  protected abstract executeOne(state: TState, ctx): Promise<NodeOutputInterface<TOutput>>;
  async execute(batch, ctx) { /* loop executeOne over items, group by returned port */ }
}
```

- Per-item nodes extend `ScalarNode` and write `executeOne`. This is the common
  case (LLM/IO leaves, most domain nodes).
- Hot-path nodes (geo-resolve, gdpr, normalize, aggregate) implement `execute`
  directly to process the whole batch and hit shared LRU caches across it.
- There is no `PLURAL` brand and no node-kind detection — every node implements
  one contract, so the executor just calls `node.execute(batch)`.
- `outputs: readonly TOutput[]` is unchanged in spirit — the ports are now the
  partition keys.
- Nodes still never throw; an item that errors is routed to the node's error
  port (its own sub-batch).

## 5. Primitives under the plural model

| Primitive | Plural behavior |
|---|---|
| **Node** | Partitions an input batch to `Map<output, Batch>`. |
| **Scatter** | The one fan primitive. Pulls a source (`Array`/`Iterable`/`AsyncIterable`), optionally **reservoirs** it (keyed batching, below), dispatches one body-clone per **batch** (default batch = 1 item), and folds results with one **gather**. Owns concurrency, container/worker offload, and crash-safe resume. |
| **Reservoir** | NOT a separate placement — the **input batching policy of scatter**. Keys the pulled stream and releases a batch per key at `capacity`/`idle`/`complete`. Changes scatter's dispatch unit from item to keyed batch. Visible in diagrams as a named reservoir element + live fill on the scatter. |
| **Gather** | The one fold (below). `seed → reduce(batch)* → finalize`. No `apply`/`applyIncremental` split. |
| **EmbeddedDAG** | Runs a sub-DAG over a batch; input/output field threading maps batch→batch. |
| **Phase** | Pre/post hooks receive a batch. |
| **Terminal** | A batch reaching a terminal is recorded with per-item outcomes. |

### Reservoir = scatter's input batching policy (not a sibling)

A lone reservoir cannot exist in the single-state walk — there is no stream for
it to buffer. The only stream is scatter's source. And scatter already owns
source-iteration, concurrency, container/worker offload, gather, and crash-safe
resume. So the reservoir is **rolled into scatter** as its batching policy; a
sibling placement would re-implement all of scatter for one new behavior.

```
.scatter(name, source, { reservoir: {
  key:       (item) => string,   // partition key (e.g. the route: needs-gdpr)
  capacity:  number,             // release a key's batch at this size
  idleMs?:   number,             // release a key's batch after this much inactivity
}}, routes)
```

Under plural-native scatter already dispatches `Batch.of(item)` (batch = 1) per
clone; the reservoir is simply the policy that makes the batch **N, keyed**.
Three release triggers, all in scope:
- **capacity** — `buffer[key].size >= capacity` → dispatch that key's batch.
- **idle/time** — `idleMs` set and a key idle that long → release its partial
  batch (driven by `ClockProvider`/`SchedulerProvider`; deterministic under
  `VirtualClock`).
- **complete** — on source exhaustion, all non-empty buffers release as final
  (partial) batches. Always on.

With no `reservoir` config, scatter behaves exactly as today (batch = 1).

### Gather = one fold (no `apply`/`applyIncremental` split)

A gather is a fold over batches. "Incremental" is a batch of 1; "all at once" is
a batch of N — the same `reduce`, not two methods:

```ts
interface GatherStrategy<TAcc, TResult> {
  readonly name: string;
  seed(): TAcc;                                            // initial accumulator
  reduce(acc: TAcc, batch: Batch<TResult>): TAcc | Promise<TAcc>;  // fold a batch (1..N)
  finalize(acc: TAcc, execution): Promise<GatheredValue>;  // produce the result (may invoke a node)
}
```

- Streaming clone results fold via `reduce(acc, Batch.of(result))`; a
  reservoir-released batch folds via `reduce(acc, batch)`; the whole set folds via
  `reduce(acc, fullBatch)` — one path.
- Strategies that need all results (top-N, sort, partition) accumulate in
  `reduce` and compute in `finalize`; they buffer by choice, not via a second
  method. `append`/`count` fold without buffering. `collect`'s node call becomes
  `finalize(acc, execution)`.
- `apply` and `applyIncremental` are removed; `IncrementalGatherStrategy`
  collapses into the one `GatherStrategy`.

Items stream in; the reservoir appends each to `buffer[key]`. The buffer is
**in-flight state** and is serialized at checkpoint (§7) — not flushed away.

## 6. Executor / dispatch loop

The loop is batch-oriented end to end:

1. Pull a batch from the source (an `Array`, `Iterable`, or `AsyncIterable` —
   the streaming case yields bounded batches with backpressure to
   `concurrency × batchSize`).
2. Run the batch through the partitioning nodes; sub-batches flow along their
   routes.
3. Reservoirs buffer and release; gather merges; terminals record.
4. Worker containers (`executor-node` / `executor-web`) receive **batches** per
   message — the bridge amortizes over batch size.

Concurrency caps the number of in-flight batches. Memory is bounded by
`concurrency × batchSize + Σ reservoir buffers + fixed-size aggregates`.

## 7. State · checkpoint · streaming

- **Per-item state** travels in the batch; **services** (LRU caches) are shared
  per worker.
- **Checkpoint** at batch boundaries with **full serialization of in-flight
  state**. Reservoir buffers and partially-processed batches are captured into the
  checkpoint (each item is `NodeStateBase`-snapshotable, so a buffer is a snapshot
  of its item array plus the per-key fill counters), and restored exactly on
  resume — no flush-before-checkpoint shortcut, no lost buffered items. Streaming
  generators are not serializable, so the checkpoint also records the **source
  cursor/offset**; resume rebuilds the reservoir buffers from the snapshot and
  replays the source from the recorded cursor. Resume is byte-for-byte equivalent
  to an uninterrupted run.
- **Determinism**: item ids + index ordering make gather and replay
  deterministic regardless of batch boundaries.

## 8. Visualization

- New **reservoir glyph** in the Cytoscape and Mermaid renderers, with a live
  `▣ N / capacity` fill indicator and per-key fill when keyed.
- Edges annotate in-flight batch size; scatter shows fan width. The buffering is
  transparent in the diagram — never hidden node state.

## 9. Consumer migration

There is **one** contract — `execute(batch)`. The change touches every package,
and every package is migrated to it; nothing is kept on a legacy path. The repo
is green **per package** as each is migrated (the workspace-wide `ci` is green
only once the last consumer lands — that is expected for a contract cutover, not
a regression). Order:

1. **dagonizer core** — `Batch`, `RoutedBatch`, `Item`, `NodeInterface.execute`
   becomes batch, `ScalarNode` (per-item authoring base), the plural executor,
   the five existing placements + **Reservoir**. The package's own nodes and
   tests move to the contract; the dagonizer package is green.
2. **executors** (`-executor-node`, `-executor-web`) — batch bridge messages;
   `WebWorkerContainer` / Node worker pool ship batches.
3. **patterns** (`-patterns-flow`, `-patterns-graph`, `-patterns-rag`) — base
   classes implement the batch contract / extend `ScalarNode`.
4. **adapters / tools / embedders** — IO/LLM leaves; almost all extend
   `ScalarNode` (one item per call is correct for an LLM request), so the change
   is renaming `execute(state)` → `executeOne(state)` and extending the base.
5. **examples** (archivist, cartographer) — archivist nodes extend `ScalarNode`;
   cartographer ingest is already array-shaped and the enrichment path is reshaped
   to reservoirs + batch nodes.

`ScalarNode` is how per-item nodes are *authored*, not a shim that keeps an old
contract alive — there is no old contract after wave 1.

## 10. Phases

- **Phase 0** — this RFC, approved.
- **Phase 1** — core types + plural `NodeInterface` + `ScalarNode` + plural
  executor loop, with the five existing placements ported and full core tests
  green. **DONE (1a + 1b).**
- **Phase 2a** — reify gather to `seed/reduce/finalize`. **DONE.** The remaining
  Phase 2 work (reservoir runtime) is delivered as a firing policy inside the
  batch-native walk — see `0003-batch-native-walk.md`.
- **Phase 2 (reservoir runtime + walk)** — the one fan primitive: (a) **reify gather** to
  `seed/reduce/finalize` (remove `apply`/`applyIncremental` and
  `IncrementalGatherStrategy`); (b) add scatter's **reservoir** input-batching
  policy (`scatter.reservoir = { key, capacity, idleMs }`) so the dispatch unit
  is a keyed batch, with capacity/idle/complete release and crash-safe buffer
  state; (c) renderer reservoir glyph + live fill; (d) validation + tests.
  No new placement type — reservoir is scatter config; gather is one fold.
- **Phase 3** — migrate executors → patterns → adapters/tools/embedders; every
  package's tests green.
- **Phase 4** — Cartographer adoption: classify → keyed reservoirs at the
  decision points → batch-aware enrichment with LRU-cached services; async
  streaming source (configurable count 1k–1M, configurable batch size,
  per-format mix, orthogonal compression already landed); web-worker enrichment
  (`executor-web`); throughput + progress + sliding-window + live-insights UI.
- **Phase 5** — docs/concepts: plural-native as a core concept, reservoir guide,
  migration guide; update `architecture.md` / `concepts.md`.

## 11. Resolved decisions

1. **State model** — **row-oriented** batches of per-item states. Columnar is not
   built; the row *is* the unit, which is what makes `ScalarNode` mechanical.
2. **Migration surface** — `ScalarNode` base-class swap for the long tail of leaf
   nodes (adapters, tools, embedders, most pattern/example nodes); hot-path nodes
   hand-write plural `execute`.
3. **Checkpoint** — **full serialization** of reservoir buffers and in-flight
   batches (§7). No flush-before-checkpoint shortcut; no deferral.
4. **Ordering** — gather restores **item-index order** across batches and
   reservoir releases. Deterministic, not arrival-order.
5. **`Batch` API** — `of`, `empty`, `size`, `map`, `filter`, `partition`,
   `concat`, `ids`, `row(i)`. Grows only with a demonstrated need.
6. **Reservoir triggers** — capacity + idle/time + complete, all in scope (§5).

## 12. Impact on work already on this branch

The Cartographer format/compression/normalization redesign already landed (four
intake formats, orthogonal gzip, per-shape normalization sub-DAGs, configurable
per-format mix) is **compatible and retained**: ingest nodes are array-shaped and
migrate cleanly; only the per-event *enrichment* path is reshaped to
reservoirs + batch nodes under the plural model. Nothing there is throwaway.

## 13. Out of scope (by decision, not deferral)

- **Columnar/SoA state** — decided against; the model is row-oriented (§3, §11).
- **Distributed multi-host batch shuffles** beyond the existing cross-host
  handoff transport — a separate transport concern, not part of the execution-
  model rewrite.
- **A SQL / declarative query surface** over the batch model — the engine stays
  imperative-DAG; a query layer, if ever, sits above it.

Everything else discussed (reservoir time/idle triggers, full checkpoint
serialization) is **in scope** per §5/§7/§11.

## 14. Future (post-rewrite): distributed reservoirs by composition

A multi-host shuffle is deliberately **not** a new core primitive — once this
rewrite lands it is something you *compose* from pieces that already exist, by
authoring the DAG intelligently rather than by adding engine machinery:

- **routing-as-partition (§2/§4)** already computes, per item, which key it
  belongs to — that is the partitioner;
- the **handoff transport** (`DAGHandoff` / `HandoffChannelInterface`) already
  moves a partition of work to another host;
- the **reservoir (§5)** already accumulates a key's items into a batch on
  whichever host owns it.

So a distributed shuffle is just: a routing node whose decision is
"*which host owns this key*," handing each key-partition across the handoff
channel to the owning host's reservoir, which buffers and processes locally.
No all-to-all engine subsystem — a key→host routing decision plus a handoff plus
a remote reservoir, all already first-class. The plural model is the enabler; the
"shuffle" is an emergent topology, not a feature.

What a later iteration might add is *ergonomics over that pattern* — a key→host
partitioner helper, or a `.distributedReservoir(...)` convenience that wires the
routing + handoff + remote reservoir in one call — but the mechanism needs
nothing beyond what §2–§7 define. This is why it stays out of the execution-model
phases: there is nothing in the model to change for it, only sugar to add on top
once the model exists.
