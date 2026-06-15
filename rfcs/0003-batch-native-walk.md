# RFC 0003 — Batch-native walk (the plural executor core)

Status: **In progress — sub-waves 1, 2 & 4 BUILT & GREEN (789 tests); sub-wave 3 (reservoir as a work-set firing policy) next** · Depends on:
RFC 0001 (plural-native), Phase 2a (one-fold gather) · Supersedes: RFC 0002 §2 "DAG bodies
iterate per item" (DAG bodies are now batch-native). §10 decisions are resolved. Build per §9
sub-waves. Sub-wave 1 (work-set scheduler `PlacementRank` + `WorkSet`, acyclic, size-1 parity
byte-identical) is built; `SingleNode` fires batch-native, `ScatterNode`/`EmbeddedDAGNode` stay
size-1 until sub-wave 4. Sub-wave 2 (cycles/retry over multi-item batches) needed no engine
change — SW1's back-edge-excluding rank + re-entrant `add` already subsume it; it is locked by
`tests/unit/batch-walk-cycles.test.ts`. Read `0000-status.md` first.

The walk (`runNodes`) becomes a **batch dataflow**. A DAG processes a `Batch<N>`
natively — partition at nodes, merge at joins — so a DAG body has the exact same
batch contract as a node body, with no per-item fallback. This is the deferred
heart of plural-native, and it unifies routing-as-partition, join-merge, and the
reservoir into one mechanism.

## 1. Why this is required (not optional)

Node/DAG substitutability is a contract, not a nicety: anywhere a node runs, a DAG
must run identically, including over a `Batch<N>`. A node is already batch-native
(`execute(batch) → RoutedBatch`). Phase 1b left the walk single-state, so a DAG
could only fake batches by looping per item — a different execution shape, no
vectorization, and a special case in the reservoir. Making the walk batch-native
removes the exemption and the special case at once.

## 2. The model: per-item position, work set of batches

Today the walk is one `state` and a single `currentNodeName` cursor advancing by
the one route a node returns. Batch-native:

- Each **item** has its own position (which placement it is currently at).
- The walk holds a **work set**: `Map<placementName, Batch<TState>>` — the items
  waiting at each placement.
- **Seed**: the entrypoint placement's work set = the input batch.
- **Fire** a placement: run it over its accumulated batch → `RoutedBatch`
  (items partitioned across output ports). For each `port → nextPlacement`, the
  port's sub-batch is **merged** (concat, item-order preserved) into
  `pending[nextPlacement]`. Items routed to a terminal are collected.
- Repeat until only terminals hold items.

A node fires once over all items currently at it — that is the batching. Items
that branch take different next-placements; items that converge merge at the join.

## 3. Firing policy — the one knob (default vs reservoir)

When does a placement fire its accumulated batch? This is the only real degree of
freedom, and it is where the reservoir lives:

- **drained (default)** — a placement fires when no upstream placement can still
  deliver items to it *in the current pass* (its inbound batch is complete). This
  maximizes coalescing: a join waits for all its feeders, then fires once over the
  merged batch.
- **reservoir** — a placement fires a **per-key** sub-batch as soon as it reaches
  `capacity` (or `idleMs`, or on complete), regardless of whether upstream is
  drained. This is the explicit, latency-bounded merge. `scatter.reservoir`
  (RFC 0002) is this policy applied at the scatter's entry; the same policy is
  expressible on any placement (`placement.reservoir = { keyField, capacity, idleMs }`).

So: **default firing is the implicit reservoir (fire-when-complete); the reservoir
config is fire-at-capacity.** One mechanism, two policies.

## 4. Scheduling with cycles (the hard part)

Firing order must be deterministic and must handle retry self-edges / back-edges:

- Compute a **topological rank** over the DAG's *forward* edges only (back-edges —
  any edge whose target's rank ≤ source's rank, e.g. a retry self-edge — are
  excluded from the rank). Joins get the max rank of their forward feeders.
- **Schedule**: repeatedly fire the **lowest-rank placement that holds items and is
  ready** (per its firing policy). Lowest-rank-first guarantees a feeder fires
  before its join, so the join coalesces maximally before firing.
- **Back-edges / retry**: when a node routes items to a lower-or-equal-rank
  placement (a retry), those items **re-enter** that placement's work set and are
  re-fired on a later iteration, batched together with any fresh items then present.
  Per-item retry budgets (already on state) bound the cycles; an item exceeding its
  budget routes to its salvage/terminal port like today.
- **Termination**: the loop ends when every non-terminal placement's work set is
  empty. Determinism: ties at equal rank break by placement declaration order;
  within a batch, item order is preserved by index.

This keeps batched execution (each placement fires over a batch) correct under the
Cartographer's retry loops and multi-feeder joins.

## 5. Terminals, outcomes, observability

- Items reaching a terminal are collected with that terminal's outcome; the DAG's
  per-item result set is the union. A scatter gather folds these via `reduce`.
- **Distinct batch-firing events** (not the old single-item `onNodeEnd` signature):
  - `onFire(placement, batch, placementPath)` — before a placement fires, carrying
    the input batch (replaces single-item `onNodeStart`).
  - `onFired(placement, routedBatch, placementPath)` — after firing, carrying the
    `RoutedBatch` (per-item routes + states are readable inside, so per-item
    observers fold over `routedBatch` themselves).
  - `onError(placement, error, batch, placementPath)` — a wholesale firing failure
    (§10.2). Per-item errors are normal partitioning to the node's `error` port, not
    an observer event.
  These are new names with explicit batch semantics — the single-item
  `onNodeStart`/`onNodeEnd` are removed, not overloaded (consumers migrate observers
  in Phase 3). One firing → one `onFire`/`onFired` pair carrying N items; the DAG viz
  lights a node per firing with its batch size, strictly more information than today.

## 6. Embedded DAGs, scatter, gather

- **Embedded DAG**: a placement whose firing runs a **sub-walk** (recursion of §2)
  over its accumulated batch, with the existing input/output field threading mapping
  batch→batch. Same machinery, one level down.
- **Scatter**: initializes the work set from a source (`Array`/`Iterable`/`AsyncIterable`),
  optionally via the reservoir firing policy (RFC 0002), and folds terminal-reached
  items with one gather (Phase 2a). Concurrency bounds in-flight fired batches.
- **Gather**: unchanged from Phase 2a — `initial/reduce/finalize`, folding the batches
  that reach terminals.

## 7. Checkpoint / resume

The work set (`placement → Batch`) plus per-item state is **in-flight state** and is
serialized at checkpoint (RFC 0001 §7, full serialization — each item is
`NodeStateBase`-snapshotable; a work set entry is a snapshot of its item array).
Resume rebuilds the work set exactly and continues firing. The scatter inbox/ack
(RFC 0002 §5) composes: the scatter entry re-derives its work set from the inbox
grouped by key; the walk work set inside a fired batch is captured per in-flight
batch. Resume is byte-equivalent to an uninterrupted run.

## 8. Impact on Phase 1b

`#runNodeOnState` (the size-1 wrapper) generalizes to **fire-placement-over-batch**:
the five invocation sites and the single-cursor `mainLoop` in `runNodes` are replaced
by the work-set scheduler (§2–§4). Behavior for a size-1 input (today's flows) must
remain byte-identical: one item, one position, the scheduler degenerates to the
single-cursor walk. This is the parity gate — the entire existing core suite stays
green.

## 9. Build order (sub-waves, each keeps the package green)

1. **work-set scheduler over acyclic DAGs** — replace the single-cursor `mainLoop`
   with the work-set model + drained firing + topo-rank scheduling; size-1 parity is
   byte-identical; multi-item tests over linear + branching + join DAGs (no cycles).
   **BUILT & GREEN** — `src/core/PlacementRank.ts` + `src/core/WorkSet.ts` +
   `#fireSinglePlacement`; 22 new tests incl. the diamond-join coalescing proof.
2. **Cycles/retry** — back-edge handling + re-entry batching; port the existing
   retry-loop tests to multi-item; Cartographer-style retry self-edges.
   **BUILT & GREEN** — no engine change needed (SW1's rank excludes back-edges,
   `WorkSet.add` re-batches re-entrants); locked by `batch-walk-cycles.test.ts`
   (6 tests incl. heterogeneous shrink `[5,4,3,2,1]` and back-edge-into-join).
   **Build order reordered (by decision): sub-wave 4 is built before sub-wave 3**,
   so the reservoir attaches as a firing policy to a real work set placement
   (scatter's entry) rather than the scatter worker pool. The labels are unchanged;
   only the order is 1 → 2 → **4 → 3** → 5 → 6.
4. **Embedded-DAG + scatter integration** under the work-set model; gather folds
   terminal batches. **BUILT & GREEN** — the scheduler's composite block runs the
   existing per-item `executeDAGNode` for each item in the batch and partitions the
   items across output ports by the route each one selects (single-item = internal
   iteration; the sub-walk / scatter machinery is reused unchanged). One
   `onNodeEnd` + one yielded result per firing; size-1 byte-identical. Locked by
   `batch-walk-composite.test.ts` (5 tests: multi-item embedded uniform + split
   outcomes, multi-item scatter per-parent source isolation, size-1 parity). A
   truly vectorized sub-walk (one work set processing a `Batch<N>` in one pass) is
   a later optimization; correctness and substitutability hold via iteration.
3. **Reservoir as a firing policy** — **← next.** Built after SW4. Generalize RFC 0002's
   `reservoir` from scatter-only to any placement; capacity/idle/complete
   firing; the scatter-input case is the entry placement's policy. Wire the
   already-built `scatter.reservoir` config (`keyField`/`capacity`/`idleMs`) to
   the work-set firing policy; idle via the swappable `Scheduler`
   (VirtualScheduler-deterministic); checkpoint-safe per-key buffers.
5. **Checkpoint** of the work set + resume parity; crash-safe multi-item tests.
6. **Viz** — per-firing batch-size on edges; reservoir glyph + per-key fill.

## 10. Resolved design decisions

1. **Drained readiness** — a placement fires when all placements with a forward
   edge to it have empty work sets AND have fired this pass. Diamonds resolve
   correctly (A→B, A→C, B→D, C→D: D fires after B and C drain).
2. **Node errors** — a node `execute(batch)` that *throws* fails that fired batch
   (its items route to the run's failure path); per-item routing to the `error`
   port is normal partitioning, not a failure.
3. **Observability** — distinct batch-firing events `onFire`/`onFired` (+ `onError`)
   carrying the batch / `RoutedBatch` (§5). The single-item `onNodeStart`/`onNodeEnd`
   are removed, not overloaded; consumers migrate observers in Phase 3.
4. **Intra-walk concurrency** — one fired placement at a time, by rank, for v1
   (deterministic). Concurrent firing of independent ready placements is a later
   optimization.
