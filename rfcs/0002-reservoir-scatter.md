# RFC 0002 — Reservoir: scatter's input-batching policy (Phase 2b design)

Status: **Partially built / reframed** · Depends on: RFC 0001, Phase 2a · See `0000-status.md`.
Build status: the **config surface is built & green** (the `reservoir` schema on `ScatterNode`,
the `DAGBuilder.scatter` option, `DAGValidator.validateReservoir`). The **runtime is NOT built**
— a partial scatter-input executor attempt was reverted as broken + superseded. The reservoir's
behavior is now delivered as a **firing policy inside the batch-native walk** (`0003` §3). This
doc's §1 surface stays valid; its §2 "DAG bodies iterate per item" is **superseded by 0003**
(DAG bodies are batch-native). Treat §3–§8 as reference for the firing-policy behavior, realized
per `0003`.

Detailed design for the reservoir. Per RFC 0001 §5 it is **not** a new placement —
it is scatter's input batching policy: scatter pulls a source, an optional
reservoir keys + buffers it, and one body-clone runs per released **batch**.
Absent the config, scatter behaves exactly as today (batch = 1).

## 1. Surface

### Schema (`entities/dag/ScatterNode.ts`)
Add an optional `reservoir` to the scatter node:

```ts
reservoir?: {
  readonly keyField: string;   // accessor path on the item → partition key (string)
  readonly capacity: number;   // release a key's batch at this size (>=1)
  readonly idleMs?: number;    // release a key's partial batch after this much idle
}
```
`keyField` is an accessor path (not a function) so it is JSON-expressible and the
DAG stays serializable — consistent with how scatter already addresses `source`,
`itemKey`, `gather.field` by path. The key is `String(accessor.get(item, keyField))`.

### Builder (`DAGBuilder`)
`.scatter(name, source, { reservoir: { keyField, capacity, idleMs } }, routes)`.
Validation: `capacity >= 1`; `idleMs > 0` when present; `keyField` non-empty.

## 2. Execution model

Today the worker pool pulls one item and dispatches one body-clone per item
(`ScatterWorkerPool.#pullNext` → `executeItem`). With a reservoir, the pool's
**dispatch unit becomes a released batch**:

1. **Pull** one item from the source (unchanged): assign `nextIndex`, push to the
   **durable inbox** *before* dispatch (at-least-once is preserved at the source).
   Annotate the inbox item with its `bufferKey = String(accessor.get(item, keyField))`.
2. **Buffer** the item into `buffers.get(bufferKey)` (in memory). Do **not** dispatch yet.
3. **Release** a key's buffer as one batch when any trigger fires (§3). A released
   batch is dispatched to one worker slot: the worker runs the body over a
   `Batch<N>` of the buffered clone-states. Concurrency bounds in-flight **batches**.

   **Every body accepts `Batch<N>` — uniform contract, no restriction.** Node, DAG,
   and container bodies are substitutable:
   - **node body** → `node.execute(Batch<N>)` (batch-native; vectorizable + LRU).
   - **DAG body** → iterate the single-state walk internally, once per item (the
     same way `ScalarNode` iterates a batch internally), within one worker so the
     N items share its service/LRU caches.
   - **container body** → ship the items (per-item for now).
   All return N per-item results; the gather folds the batch once (§4).

   *Deferred optimization, not a contract requirement:* a true **batch-native walk**
   (the walk partitions a `Batch<N>` at branch nodes and re-merges at joins — where
   every join is an implicit reservoir and the explicit reservoir is the
   capacity-triggered version of that merge) buys vectorization for DAG bodies. It
   is layered later; correctness and node/DAG substitutability hold without it. Hot
   reservoir route processors are authored as **batch nodes** for max throughput.
4. **Ack** at batch granularity: when the batch's clone completes, `reduce` folds
   the whole `Batch<N>` into state once (§4), all N items are removed from the
   inbox and recorded in `ackedResults`, and the checkpoint is written.

With no reservoir config, steps 2–3 collapse to "dispatch immediately" and the
batch is size 1 — byte-identical to today.

## 3. Release triggers (capacity · idle · complete)

- **capacity** — after appending, if `buffers.get(key).size >= capacity`, release
  that key's batch immediately.
- **idle** — when `idleMs` is set, track `lastAppendAt[key]` via the engine's
  `ClockProvider`; a `SchedulerProvider` timer releases a key whose buffer is
  non-empty and idle ≥ `idleMs`. Deterministic under `VirtualClock` in tests.
  (Reuses the same clock/scheduler the engine already injects — no new time source.)
- **complete** — when the source drains *and* the pool is quiescing, flush every
  non-empty buffer as a final (partial) batch, then run the outcome reducer.

Release ordering is deterministic: capacity releases in append order; the
complete-flush releases keys in first-seen order; idle releases in clock order.

## 4. Gather fold at batch granularity (exactly-once for free)

Phase 2a made `reduce(config, batch, state, accessor)` fold a `Batch<1..N>`. The
fold is invoked **at ack**. So:

- A released batch acks once → `reduce(config, Batch<N>, state)` folds all N items
  exactly once. (Today's per-item path is the N=1 case.)
- A batch that was dispatched but **crashed before ack** was never folded; on
  resume its items are still in the inbox (unacked), re-buffer, re-release, and
  fold once. **Exactly-once folding is tied to ack**, which the existing model
  already guarantees — the reservoir inherits it unchanged.

`finalize` is unchanged: after all batches ack, it runs once over the full record
set (synthetic records for prior-run acked items are reconstructed as today).

## 5. Checkpoint & resume — buffer = inbox grouped by key

The buffer needs **no separate persisted structure**. It is a derived view of the
durable inbox:

- **Persisted shape change** — extend `ScatterInboxItem` with `bufferKey?: string`
  (the only schema addition). `ackedResults` is unchanged (still per-item: when a
  batch acks, it appends N per-item acked records, so prior-run behavior and the
  outcome reducer are untouched).
- **On resume** — restore inbox + ackedResults as today, then **rebuild buffers by
  grouping the restored inbox items by `bufferKey`**. Re-release any group already
  at capacity; the rest wait for capacity/idle/complete. Acked items are not in the
  inbox and were already folded (no replay) — unchanged.
- **In-flight-at-crash batches** — their items are unacked, hence still in the
  inbox, hence re-buffered and reprocessed. At-least-once on the body, exactly-once
  on the fold (§4). No new bookkeeping (`releasedBatches` log) is required — the
  inbox + ack flow already encodes "unacked ⇒ reprocess."

This is the load-bearing simplification: keyed batching adds **one optional field**
to the persisted inbox and otherwise reuses the existing crash-safe machinery.

## 6. Outcome routing

Unchanged. Each released batch's items still record per-item `output` into
`itemOutputs` (the body's terminal outcome applies to all items in the batch, or
per-item if the body partitions — both already supported). The outcome reducer
(`aggregate`/`terminal`) folds `itemOutputs` to one route exactly as today.

## 7. Visualization

- A reservoir-configured scatter renders a **reservoir glyph** with a live,
  per-key **fill indicator** (`▣ key: 3.2k / 5k`) on the scatter placement, in both
  `CytoscapeRenderer` and `MermaidRenderer`. The fill is driven by the existing
  observer hooks (buffer size deltas), not a new animation loop.
- Released batches pulse the scatter→body edge with the batch size.

## 8. Tests

- **capacity** — scatter a 1,000-item source with `capacity: 100`, single key:
  assert 10 body invocations each receiving `Batch<100>` (instrument the body to
  record `batch.size`).
- **keyed** — items across 3 keys: assert each key releases its own batches at
  capacity; assert no cross-key mixing.
- **idle** — sparse source under `VirtualClock`: advance time past `idleMs` with a
  partial buffer; assert the partial batch releases.
- **complete-flush** — source drains with partial buffers across keys: assert each
  flushes once.
- **gather exactly-once** — `append` gather over a reservoir: assert the target
  field contains every item exactly once (no double-fold), batch and resume.
- **crash-safe** — checkpoint mid-run (some batches acked, one buffer partial, one
  batch in-flight); resume; assert no item lost or double-folded, final state
  equals an uninterrupted run.
- **no-reservoir parity** — every existing scatter test still passes (batch = 1).

## 9. Non-goals (this RFC)

- Cross-key release ordering guarantees beyond "deterministic under a fixed clock."
- Per-key concurrency limits (concurrency stays global over in-flight batches).
- Weighted/byte-size capacity (count-based only; size-based is a later option).

## 10. Build order (Phase 2b sub-waves)

1. **Schema + builder + validation** for `reservoir` (no behavior yet).
2. **Pool buffering + capacity/complete release** + batch ack/reduce; `bufferKey`
   on inbox; resume rebuild. Core tests (capacity, keyed, complete-flush,
   exactly-once, crash-safe, parity).
3. **Idle trigger** via Clock/Scheduler + `VirtualClock` test.
4. **Viz** (reservoir glyph + fill) in both renderers + tests.

Each sub-wave keeps the dagonizer package green.
