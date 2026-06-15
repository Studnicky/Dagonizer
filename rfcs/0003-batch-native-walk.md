# RFC 0003 — Batch-native walk (the plural executor core)

Status: **Approved, not yet built — THIS IS THE NEXT MAJOR WORK** · Depends on: RFC 0001
(plural-native), Phase 2a (one-fold gather) · Supersedes: RFC 0002 §2 "DAG bodies iterate per
item" (DAG bodies are now batch-native). §10 decisions are resolved. Build per §9 sub-waves,
starting with sub-wave 1 (frontier scheduler, acyclic, size-1 parity exact). Read
`0000-status.md` first.

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

## 2. The model: per-item position, frontier of batches

Today the walk is one `state` and a single `currentNodeName` cursor advancing by
the one route a node returns. Batch-native:

- Each **item** has its own position (which placement it is currently at).
- The walk holds a **frontier**: `Map<placementName, Batch<TState>>` — the items
  waiting at each placement.
- **Seed**: the entrypoint placement's frontier = the input batch.
- **Fire** a placement: run it over its accumulated batch → `RoutedBatch`
  (items partitioned across output ports). For each `port → nextPlacement`, the
  port's sub-batch is **merged** (concat, item-order preserved) into
  `frontier[nextPlacement]`. Items routed to a terminal are collected.
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
  (RFC 0002) is this policy applied at the scatter's seed; the same policy is
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
  placement (a retry), those items **re-enter** that placement's frontier and are
  re-fired on a later iteration, batched together with any fresh items then present.
  Per-item retry budgets (already on state) bound the cycles; an item exceeding its
  budget routes to its salvage/terminal port like today.
- **Termination**: the loop ends when every non-terminal placement's frontier is
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
- **Scatter**: seeds the frontier from a source (`Array`/`Iterable`/`AsyncIterable`),
  optionally via the reservoir firing policy (RFC 0002), and folds terminal-reached
  items with one gather (Phase 2a). Concurrency bounds in-flight fired batches.
- **Gather**: unchanged from Phase 2a — `seed/reduce/finalize`, folding the batches
  that reach terminals.

## 7. Checkpoint / resume

The frontier (`placement → Batch`) plus per-item state is **in-flight state** and is
serialized at checkpoint (RFC 0001 §7, full serialization — each item is
`NodeStateBase`-snapshotable; a frontier entry is a snapshot of its item array).
Resume rebuilds the frontier exactly and continues firing. The scatter inbox/ack
(RFC 0002 §5) composes: the scatter seed re-derives its frontier from the inbox
grouped by key; the walk frontier inside a fired batch is captured per in-flight
batch. Resume is byte-equivalent to an uninterrupted run.

## 8. Impact on Phase 1b

`#runNodeOnState` (the size-1 wrapper) generalizes to **fire-placement-over-batch**:
the five invocation sites and the single-cursor `mainLoop` in `runNodes` are replaced
by the frontier scheduler (§2–§4). Behavior for a size-1 input (today's flows) must
remain byte-identical: one item, one position, the scheduler degenerates to the
single-cursor walk. This is the parity gate — the entire existing core suite stays
green.

## 9. Build order (sub-waves, each keeps the package green)

1. **Frontier scheduler over acyclic DAGs** — replace the single-cursor `mainLoop`
   with the frontier model + drained firing + topo-rank scheduling; size-1 parity is
   byte-identical; multi-item tests over linear + branching + join DAGs (no cycles).
2. **Cycles/retry** — back-edge handling + re-entry batching; port the existing
   retry-loop tests to multi-item; Cartographer-style retry self-edges.
3. **Reservoir as a firing policy** — generalize RFC 0002's `reservoir` from
   scatter-seed-only to any placement; capacity/idle/complete firing; the
   scatter-input case becomes the seed placement's policy.
4. **Embedded-DAG + scatter integration** under the frontier model; gather folds
   terminal batches.
5. **Checkpoint** of the frontier + resume parity; crash-safe multi-item tests.
6. **Viz** — per-firing batch-size on edges; reservoir glyph + per-key fill.

## 10. Resolved design decisions

1. **Drained readiness** — a placement fires when all placements with a forward
   edge to it have empty frontiers AND have fired this pass. Diamonds resolve
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
