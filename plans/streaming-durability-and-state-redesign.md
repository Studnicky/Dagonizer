# Streaming, State Representation & Durable-Resume Redesign

Handoff plan. Written at the end of a long performance-audit session so a fresh
session can continue without re-deriving context. Read this top to bottom before
touching the engine.

---

## 0. Status / where things stand

**Committed** (branch `feature/graph-state-transfer-contract`):
- `614c1701` — batch-native graph-state transfer contract (plural `GraphStateTransfer`,
  combined-per-batch, `runDag`/`runDagBatch` collapsed, single-run codec variants removed).
- `df8606ed` — graph-store + state-layer O(N²) elimination (details in §2).
- `b2281707` — framework `accessor.append` (§2, items 8–9) + this plan document.

**Uncommitted** (green — typecheck 0, lint clean, `packages/dagonizer` 1380 tests,
`examples/the-cartographer` 373 tests, `packages/dagonizer-executor-node` 64 tests,
`packages/dagonizer-executor-web` typecheck/lint clean, all 223 docs Twoslash blocks
type-check, docs site builds 112 pages): **Phases A0, A1, and C below are implemented
and verified. Phase B remains open.** The write-point primitive, the de-RDF'd plain-JSON
transient transfer path, and the canonical/streaming gather unification
(`CanonicalFeedGather` retired in favor of `SourceIntakeGather`) are in the tree with
passing tests. Phase B has contribution-shape, replay, and dedup-by-index groundwork,
including resume/replay coverage in `scatter-resume.test.ts`. `GatherCheckpoint.append`
stores growing contribution arrays in transient metadata, checkpoint persistence writes
the full checkpoint JSON, and no atomic durable-before-watermark batch commit exists. A
changeset (`.changeset/write-point-streaming-durability.md`) documents the breaking surface:
`restoreJsonLd` → `restoreTransientState`, `CheckpointDataType.graph` →
`CheckpointDataType.state.transient`, `DagOutcome.transportError(id, correlationId,
options?)`, `InitMessageShapeType.graphStateTransferFormats` required, `DAGType`/
`ScatterNode` `writePoints`. Commit this work as a checkpoint before continuing Phase B
or starting Phase D.

**Phase D (browser 1M, §8/§9) is still open** — it requires a live DevTools Performance
capture of the browser main thread on a large run, which was not attempted in this pass
(session risk: a 1M run is known to hard-freeze the tab for minutes, per §9 and the
`dagonizer-cartographer-browser-mainthread-freeze` note). A smaller-scale sanity check (not
a substitute for the real capture) is recorded in §9.

**Verification method used this session (keep using it):**
```
# CPU hot frames (scale-invariant; small counts are fine):
node --cpu-prof --cpu-prof-dir=/tmp/p --import tsx \
  examples/the-cartographer/runCartographer.ts --stream --stream-count 400 --recorded
# then aggregate self-time by function from the .cpuprofile.
# Heap: --heap-prof (note: at small N it's dominated by tsx/ESM startup, not runtime).
```
IMPORTANT: the in-process `--stream` CLI runs the sub-DAG on the main thread; the
**browser** runs it in workers, so in-process ≠ browser main thread. The browser 1M
freeze was never profiled with DevTools — still open (see §8).

---

## 1. The core finding (why we're here)

The 400-event in-process stream spends **~75% in the graph store** (`#addToIndex`,
`assert`, `#concreteBucket`, `#removeQuad`, `#projectValue`, `#clearCell`). After
fixing every O(N²)/duplicate-tracking pattern (§2), the shape is unchanged: it is now
**~linear per event** but the constant is dominated by one thing —

**We keep node state as plain JS fields (fast), then on every snapshot re-serialize the
ENTIRE state object into the indexed RDF graph.** See `NodeStateBase.#syncRuntimeFields()`
(≈ line 730): it iterates `Object.keys(this)` and `#write`s every field →
`#clearCell` + `#projectValue` → quads + 3-way indexing. It is a **full re-projection,
not a delta**, and it fires **per transient scatter clone** (for the worker transfer),
not just at durability boundaries.

So at 1M events we do ~1M full-state RDF projections of transient clone state that is
immediately discarded. That is the waste. Persisting transient state into an indexed
triple store is the wrong tool for the hot path.

Per-event sub-DAG nodes write plain fields (verified — e.g. `state.enriched = {...}`,
`state.normalized = {...}` in `examples/the-cartographer/nodes/*.ts`). They are NOT the
cost. The cost is the snapshot→graph projection.

---

## 2. Completed this session (profile-driven cleanup — all green)

Graph store / state layer (`packages/dagonizer`):
1. `InMemoryTopologyStore.clearGraph`/`delete`: full-array scan + per-match `splice`
   → index-driven removal.
2. Merged `#keys` (dedup Set) + `#quads` (Set) into one `Map<key, quad>` — key is dedup
   identity, value is delivery; one allocation.
3. Dropped the `#byObject` index — no query narrows on object-first (verified against
   every `match`/`delete`/`ask` in `NodeStateBase` + `GraphStateQueryService`); `matches()`
   still filters for correctness. Removed a whole Map + 1/4 of index maintenance.
4. `#concreteBucket`: shared empty iterable instead of `?? new Set()` per lookup miss.
5. `assert`/`#removeQuad`: compute each term key once (4× not 8×).
6. `NodeStateBase.#clearCell`: whole-graph O(N²) prefix-scan → subject-indexed subtree
   traversal (descendants are `${cell}/…` and reachable via object edges).
7. Three O(N²) `.find`-in-loop reconciliations (`ScatterDispatch`, `DagContainerBase`,
   `DagHost`) → `Map` lookups; `DagExecutionContext.#clearSubject` `.splice`-in-loop →
   in-place compaction.
8. **Framework `accessor.append`** (uncommitted): added required `append(state, path, value)`
   to `StateAccessorInterface`; `DottedPathAccessor` implements it as an in-place `push`
   (O(1)) sharing a `#resolve` traversal with `set`; the built-in gather strategies
   (`map`/`append`/`partition`/`collect`) use it exclusively — the old
   `set(path, [...existing, value])` copy-append and the `asList` helper are removed.
   Breaking change; changeset `.changeset/state-accessor-append.md`.
9. **Cartographer `CanonicalFeedGather`** (uncommitted): its `reduce` filtered+copied the
   whole growing `canonicalEvents` array per call (`eventsFrom(get(...))` + `[...existing]`)
   → O(N²). Now `accessor.append` per event (dogfoods #8). NOTE: this is the *canonical*
   fan-in topology; the streaming 1M path does NOT use it (see §3), so it doesn't move the
   `--stream` profile — it's a correctness fix for the canonical topology.

Result: 400-event in-process stream **82s → ~12s**; graph-store cost O(N²) → ~linear.

Memory notes written: `dagonizer-perf-hotpath-graphstore`, and the browser-freeze note
`dagonizer-cartographer-browser-mainthread-freeze`.

---

## 3. Two cartographer topologies (why streaming ≠ canonical)

`examples/the-cartographer/dag.ts`:
- **Canonical** (`cartographerDAG`): `intake-gather` = `canonical-feed` (CanonicalFeedGather)
  → materialises all events into a `canonicalEvents` **array** → `scatter('process-stream',
  'canonicalEvents', …)` reads that array. O(N) resident memory.
- **Stream-source**: `intake-gather` = `source-intake` (SourceIntakeGather) → returns a
  **lazy `AsyncIterable` `source-payload` stream** (roundRobin of producer streams) →
  `scatter('process-stream', 'source-payload', …)` pulls one at a time. `canonicalEvents`
  stays empty. Flat memory. This is the 1M path.

Key correction recorded for the next session: **moving events into the in-memory graph
store does NOT save memory** — a quad is referenced by `#quads` + 3 index Sets, so an event
as triples is heavier than one plain object in an array. The graph store only helps memory
if it is a *durable/disk-backed* provider, and even then you trade RAM for per-event I/O.
Streaming (no materialisation) beats both for transient scatter input.

---

## 4. Target architecture (the decision we reached)

**Separate two concerns that are currently conflated by `#syncRuntimeFields`:**

- **Transient state** (per-event / per-clone): flows through the streaming pipeline as
  **plain JS objects**. Crosses the worker boundary as plain/JSON (transient input →
  transient result). NO RDF projection, NO indexing, NO journal. Created, folded, discarded.
- **Durable state** (for resume): a compact, append-only spine — the scatter completion
  watermark + an append-delta fold journal — persisted at real durability boundaries.
  The RDF graph is a *durability/query layer*, not the hot-path state representation.

RDF earns its cost only for durable, queryable, long-lived top-level state and the
append-delta journal — and must be removed from the transient per-clone transfer path.

---

## 5. Checkpoint / resume — how it works today (verified, with file refs)

Three layers already exist and are more Temporal-shaped than the waste suggests:

1. **`CheckpointStoreInterface`** (`src/contracts/CheckpointStoreInterface.ts`) — durable
   blob substrate: `save(key, json)` / `load(key)` / `delete(key)`. Consumer brings the
   backend (file/kv/postgres/redis/s3). Engine ships none. `MemoryCheckpointStore` for tests.

2. **`ScatterCheckpoint`** (`src/checkpoint/ScatterCheckpoint.ts`, `ScatterRunStateType`):
   - **Bounded mode:** `watermarkRef` (highest contiguous completed index) + `aheadAcked`
     (bounded out-of-order window) + `outcomeTally` + `inbox` (remaining items). O(1)-ish in
     item count — the Temporal "which activities are done" cursor.
   - **Retained mode:** `ackedResults`/`ackedByIndex`/`itemOutputs` per item (O(N)) — only
     when a gather's `finalize` needs the full record set (`GatherStrategy.retainsRecordsForFinalize`).
   - Persist/restore around drain in `ScatterExecutor.ts` and `ScatterDispatch.persistCheckpoint()`.

3. **`PersistentGraphDataset` + `GraphJournalStoreInterface`** (`src/graph/PersistentGraphDataset.ts`,
   `src/contracts/GraphJournalStore.ts`): durable graph as **snapshot base + append-delta log**;
   `reopen(runIri, journal)` reconstructs by replaying snapshot + trailing deltas. This is the
   event-sourced primitive we want — it already exists, for the graph, as a single contract
   (there is no separate `src/checkpoint/GraphJournalStore.ts` implementation — one file, in
   `contracts/`). Sibling durable providers: `dagonizer-store-{file,sqlite,indexeddb,opfs,
   webstorage,eventlog}`.

4. **`GatherCheckpoint`** (`src/checkpoint/GatherCheckpoint.ts`): reads/writes `GatherProgressType`
   into state. The fold accumulator itself lives in state fields (e.g. cartographer `insights`
   Map) and is persisted via the snapshot path — this is where the full-projection waste bites.

**The gap:** the durable primitives (compact watermark, append-delta journal) exist, but
the state→graph projection (`#syncRuntimeFields`) is full-snapshot (not delta) and fires
per transient clone. We bypass the append-delta journal in favour of full snapshots.

---

## 6. Requirements for Temporal-grade durable resume

Bar: crash anywhere, resume correctly, lose nothing acked.

R1. **Durable-before-ack, per-batch granularity.** A batch's completions (outputs + fold
    contributions) are committed to durable storage as one fsync BEFORE the batch's watermark
    advances, with per-item logical records inside that single write (D1). A crash mid-batch
    re-runs at most that one in-flight batch — it does not lose anything already committed by
    a prior batch. Batch size = the reservoir capacity already used for in-flight items, so
    this tunes durability/throughput without a second concept to configure.
R2. **Append-only, not snapshot.** Persist deltas `(index → output, fold-contribution)`
    appended to a log; do NOT re-serialize whole state per checkpoint. Bounded write per unit.
    (Journal supports this; the state layer doesn't yet.)
R3. **Dedup-by-index replay; idempotency is the consumer's contract, not the framework's.**
    Resume = load watermark + inbox remainder, replay the journal to rebuild the accumulator,
    re-run ONLY incomplete items, and **dedup by index** (`seenIndices`/watermark) so a
    re-run item is never folded twice. The framework guarantees the fold is never
    double-counted; it makes NO guarantee about a node's external side effects being safe to
    repeat — Dagonizer is a framework, not a product, and node authors who perform
    side-effecting work own the idempotency of that side effect themselves (D2).
R4. **Bounded checkpoint.** watermark + bounded ahead-acked + a **bounded accumulator**.
    Bounded folds (insights) are fine; an unbounded "retain every result" gather is O(N) and
    is a small-N convenience only — durable/streaming runs contract to bounded folds (D3).
R5. **Transient ≠ durable, unconditionally.** Clone state crossing the worker boundary is
    plain JSON — no RDF, no journal, no exceptions. This is an invariant, not a configuration
    point: no write-point setting (§7) ever changes the wire transfer format. Durability and
    graph projection attach only AFTER the host receives the plain completion result, from
    data the host already holds (§7).

---

## 7. Design decisions (resolved) + the write-point configuration model

D1–D4 are pinned. **Dagonizer is a framework, not a product**: where a decision is a policy
tradeoff (not a correctness question), the framework exposes the knob and the consumer picks
— it does not bake in one answer for everyone.

D1. **Durability granularity: per-batch fsync, per-item logical records** (R1). Amortised I/O;
    a crash re-runs at most one in-flight batch. Batch size = reservoir capacity — no second
    concept to configure.
D2. **Item idempotency: not the framework's call.** The framework guarantees dedup-by-index
    at the fold (R3) so a re-run item is never double-counted. It does NOT require node
    executions to be idempotent, because it cannot know whether a given node has external
    side effects. A consumer running side-effecting nodes under a durability policy that
    re-runs incomplete batches on resume owns the consequences of that combination; the
    framework's job is to make the policy space explicit (§7.1), not to arbitrate it.
D3. **Unbounded gathers: bounded folds are the durable/streaming contract** (R4). "Retain
    every result" stays a small-N, in-memory convenience with no durability guarantee — it is
    not promoted to a store-backed, streamed-at-scale feature. This matches where the codebase
    already leans (`accessor.append` is O(1) fold-in, not collect-and-store-out) and avoids
    building pagination/streamed-readback machinery for a case cartographer's streaming
    topology (§3) already sidesteps by never materialising in the first place.
D4. **Scope of the RDF graph: durability/query layer only, never the transient transfer
    format — and this is an invariant, not a configuration point** (R5). See §7.1: every
    write-point option operates on data the host already holds AFTER a completion crosses
    the worker boundary as plain JSON. No write point, at any setting, changes what crosses
    that boundary.

### 7.1 Write points — what gets configured

The five things that can happen after an item/batch completes are independent axes (some
durable, some not; some structural, some full-fidelity), not tiers of one setting — hence an
**array of enum values**, not a single level:

| Write point | Source of truth | Cost | Durable? |
|---|---|---|---|
| `NodeEdges` | Dispatcher/host control-flow bookkeeping (node identity, edge, item index — data the host already has from executing the DAG, no state inspection needed) | Cheap, fixed per completion | No (unless paired with a durable graph store) |
| `FullItemProjection` | The plain completion result payload, field-level (today's `#syncRuntimeFields`, performed post-hoc by the host — not during transfer) | Expensive, O(fields) per item | No (unless paired with a durable graph store) |
| `FoldDeltaJournal` | The fold contribution for a completed item | Bounded, append-only | Yes |
| `WatermarkCommit` | The scatter checkpoint cursor (watermark/inbox/ackedByIndex) | Bounded | Yes |
| `InMemorySnapshot` | Same projection as `NodeEdges`/`FullItemProjection`, target is RAM not a durable backend | Same as whichever projection feeds it | No, by design (query-only) |

**The DAG is already a graph between nodes — `NodeEdges` is not a new schema.** It is the
DAG's own topology, instantiated per run: which edge fired, for which item, in what order.
The dispatcher/host derives this from execution bookkeeping it already holds before it even
looks at the completion payload, so it is always cheap and never requires touching the
transient transfer path.

**Every write point is a post-completion host-side projection, never a variant of the wire
transfer.** The host receives a plain completion result (always — R5), and write points
decide what the host does with it afterward. `FullItemProjection` (the renamed, opt-in
version of today's expensive default) does not mean the transfer becomes RDF; it means the
host performs the expensive per-field projection itself, once, after receiving the plain
result. This is the fix for the tension in an earlier draft of this plan, which implied a
write point could pull RDF back into the per-clone transfer format — it cannot, and no
setting is designed to.

**Combinations are genuinely orthogonal**, not mutually exclusive tiers: `InMemorySnapshot`
+ `WatermarkCommit` together (in-memory queryable state AND durable resume simultaneously)
is a fully supported combination, not a special case.

Two example profiles this design targets directly:
- **Archivist**: `[InMemorySnapshot]` — wants a live, queryable graph of recent state for
  recall; no resume/crash-durability requirement.
- **Cartographer** (streaming topology): `[NodeEdges, WatermarkCommit]` — cheap lineage for
  the SPARQL-queryable DAG shape, durable resume, no full per-item field projection.

### 7.2 Configuration shape — cascading, override-not-merge

Three levels, each either inherits (field absent) or fully replaces the array (no
partial-merge/union semantics — enum-set merge ambiguity, `child adds to parent` vs
`child narrows parent`, is exactly the kind of optional-field tax the project's
required-with-defaults rule already pushes against):

1. **Runtime-level** — a module-level `DEFAULT_WRITE_POINTS` constant, the fleet-wide
   default for consumers who never think about this.
2. **DAG-level** (on `DAGType` / DAG registration) — the common override point. This is
   where Archivist's and Cartographer's profiles above are set.
3. **Scatter-placement-level** — scatter is where the per-item hot path actually lives, so
   a placement may need its own override distinct from the rest of its DAG (e.g. a DAG that
   is `[NodeEdges, WatermarkCommit]` overall but sets `[]` on its single highest-volume
   scatter, while a low-volume scatter elsewhere in the same DAG keeps richer projection).

**No per-node-type level.** Nodes (`NodeInterface`) are stateless and reusable across DAGs;
baking a write-point set into the node class would make the same node behave differently
per registration context anyway — which just relocates the DAG/placement-level config onto
the wrong object. The DAG/placement is what makes the durability tradeoff; the node does not.

**Resolved at registration, not per-event** — matches the dispatch-map-over-
switch / V8-monomorphism conventions already in the codebase): each DAG/placement compiles
its inherited-or-overridden array into a fixed `Set<WritePoint>` (or bitmask) once, at
registration time. The hot path does a cheap membership check against that fixed set — it
never walks/re-evaluates an array per completion.

### 7.3 Validation: structural incoherence vs. policy choice

The framework validates combinations that are **structurally unreplayable**, not ones that
are merely a policy tradeoff it disagrees with:
- ⊥ **Reject**: `FoldDeltaJournal` without `WatermarkCommit` — deltas exist with no cursor
  bounding replay; this is broken, not a tradeoff.
- ✓ **Allow, no pushback**: `[]` (no durability at all, accept full-restart-on-crash),
  `FullItemProjection` at scale (accept the per-item cost), any orthogonal combination of
  the five points. These are the consumer's calls to make and live with.

**No backward-compatibility shim.** The new default (`[NodeEdges, WatermarkCommit]`) ships
as the runtime default immediately; there is no legacy full-projection-everywhere fallback
preserved for existing consumers. This is a breaking change with a changeset, in line with
the project's latest-only conventions — never a dual-path compatibility mode.

---

## 8. Implementation phases (§7 pinned — ready to dispatch)

Phases A0, A1, and C are implemented and verified (see §0). Phases B and D are open.

Phase A0 — **Implemented: write-point primitive.** `WritePoint` enum (§7.1) + the cascading
  config
  (runtime default constant / DAG-level / scatter-placement-level, override-not-merge,
  §7.2), resolved to a fixed `Set<WritePoint>` at registration time. Registration-time
  validation rejects `FoldDeltaJournal` without `WatermarkCommit` (§7.3). No behavior change
  yet — this phase only makes the policy configurable and checkable.
Phase A1 — **Implemented: de-RDF the transient transfer path.** Confirmed call sites
  (verified against current `HEAD`): `ScatterDispatch.executeBatch`
  (`src/execution/ScatterDispatch.ts:734,752`)
  → `DagContainerBase.runDag` → `#composeRequest` (`src/container/DagContainerBase.ts:275-366`,
  the `snapshotJsonLd`/`snapshotGraph` calls at 364/366) — once per transient clone in the
  batch — mirrored on the response side by `DagHost.#composeResponseGraph`
  (`src/container/DagHost.ts:497,504`). Both become plain-object transfer, unconditionally
  (R5) — this is no longer gated on a write-point check; it never was meant to be one.
  `#syncRuntimeFields` (`NodeStateBase.ts:730`) and its `snapshotGraph`/`snapshotJsonLd`/
  `snapshotGraphDelta` callers (≈273-298) move to being invoked ONLY by the host, post-
  completion, when `FullItemProjection` is in the resolved write-point set for that
  DAG/placement — never inside the transfer codec. Wire `NodeEdges` as the default
  post-completion projection (from dispatcher bookkeeping, §7.1), gated on the same set.
  Re-profile with the new default (`[NodeEdges, WatermarkCommit]`) — expect the ~75%
  graph-store cost to collapse; re-profile again with `FullItemProjection` enabled to confirm
  it reproduces today's cost/fidelity as the explicit opt-in.
Phase B — **Open: incremental fold durability.** Contribution-shape, replay, and
  dedup-by-index groundwork is present, but `GatherCheckpoint.append` stores growing
  contribution arrays in transient metadata and checkpoint persistence writes the full
  checkpoint JSON. Replace full-state snapshot of gather accumulators
  with append-delta records `(index, output, contribution)` to the journal at ack boundaries
  (R1/R2), gated on `FoldDeltaJournal`/`WatermarkCommit` being in the resolved set. Bounded
  folds stay small (R4); verify resume replays correctly and dedups by index (R3) — including
  the case where a re-run item's node has non-idempotent side effects, which the framework
  does not attempt to prevent (D2).
Phase C — **Implemented: unify canonical + streaming** per D3 — retire `CanonicalFeedGather`'s
  materialise-into-array fan-in in favour of the streaming pattern; bounded-fold contract
  applies uniformly across both topologies once unified.
Phase D — **Open: browser 1M** (§9): with the transient path de-RDF'd, re-drive the
  browser demo and profile the MAIN THREAD via DevTools (the engine wins so far speed the
  worker/in-process path but were never proven to unfreeze the tab).

Every phase: `npm run typecheck`, `npm run lint --max-warnings 0`, full `npm test`
(compiled tree — pretest rebuilds dist; do NOT `tsx --test` on source, it path-resolves the
conformance registry wrong and gives spurious INIT_FAILED). Rebuild `dist` before any browser
test (the demo loads `dist`, not src).

---

## 9. Still open / unverified

- **Browser 1M freeze**: NOT profiled on the actual browser main thread. All engine wins were
  measured in-process (sub-DAG on main thread) or via Node proxies. The browser runs the
  sub-DAG in workers, so its main-thread freeze is a separate, still-unpinned cost (candidates:
  the transient-clone graph-state transfer serialization on the dispatcher thread, the
  observability relay, Vue/Cytoscape rendering). Get a DevTools Performance capture of a
  *completing* small run before claiming the freeze is fixed.
- **`InsightsFoldGather`** `offsets`/`timezones`/`jurisdictions` use `array + .includes()`
  dedup (should be `Set`) — left as-is: K (distinct values) is bounded to dozens so it's
  O(bounded) not O(N²), and converting risks the accumulator's checkpoint serialization.
  Revisit if the accumulator representation changes in Phase B.

---

## 10. Fast navigation

- State projection / the waste: `packages/dagonizer/src/NodeStateBase.ts`
  (`#syncRuntimeFields` ≈ 730, `#write` ≈ 488, `#projectValue` ≈ 544, `#clearCell` ≈ 523,
  `snapshotGraph`/`snapshotJsonLd`/`snapshotGraphDelta` ≈ 273–298).
- Graph store: `packages/dagonizer/src/graph/InMemoryTopologyStore.ts`.
- Accessor: `packages/dagonizer/src/contracts/StateAccessorInterface.ts`,
  `packages/dagonizer/src/runtime/DottedPathAccessor.ts`.
- Gather strategies: `packages/dagonizer/src/core/GatherStrategies.ts`.
- Scatter/gather execution: `packages/dagonizer/src/execution/{ScatterDispatch,ScatterExecutor,
  NodeScheduler,ReservoirBuffer}.ts`.
- Checkpoint: `packages/dagonizer/src/checkpoint/*`, `src/contracts/CheckpointStoreInterface.ts`,
  `src/contracts/GraphJournalStore.ts`, `src/graph/PersistentGraphDataset.ts`.
- Container transfer (batch-native): `packages/dagonizer/src/container/{DagContainerBase,DagHost,
  ChannelDispatch,DagTask}.ts`, `src/graph/GraphStateTransferCodec.ts`.
- Cartographer topology + gathers: `examples/the-cartographer/dag.ts`,
  `examples/the-cartographer/core/{CanonicalFeedGather,SourceIntakeGather,InsightsFoldGather,
  GeoWeightedFusionGather}.ts`.
