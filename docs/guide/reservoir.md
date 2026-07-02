# Reservoir

A **reservoir** is a scatter's keyed input-batching policy. Without it, a scatter
dispatches one source item per body invocation (batch-size-1). With it, the
scatter buffers source items by a key and releases a `Batch<N>` per key — so the
body node runs once over N items, the gather folds the whole batch in a single
`reduce`, and throughput amortizes over the batch.

The reservoir is **not** a new placement: it is `execution.reservoir` — one of
the two `execution.mode` variants on a `ScatterNode` (the other is `'item'`,
the non-reservoir default). `execution.concurrency`, when set alongside
`mode: 'reservoir'`, gates concurrently in-flight **batches** — the same
`Semaphore` concept `mode: 'item'` uses for concurrently in-flight items,
applied at batch instead of item granularity. There is no `throttle` field in
reservoir mode: a per-item `Throttle` does not compose with a batch dispatch
unit whose size varies with capacity/idle/flush triggers; the schema
structurally forbids the combination. See
[`ScatterNode` execution policy](/reference/nodes#execution-policy) for the
full field reference.

## Configuration

<<< @/../examples/dags/scatter-extensions.ts#reservoir-dag

The partition key is `String(accessor.get(item, keyField))`. The reservoir
requires a **node body** (a `{ node }` body, not a sub-DAG or container body) —
the node processes the released `Batch<N>` directly.

## Release triggers

A key's buffer releases as one batch when any of three triggers fires:

- **capacity** — the buffer reaches `capacity` items. The primary trigger; bounds memory.
- **idle** — `idleMs` is set and the key receives no new item for that long. Driven by the engine's swappable `Scheduler`, so it is deterministic under `VirtualScheduler` in tests. Bounds latency for sparse keys.
- **complete** — the source drains; every non-empty buffer flushes as a final partial batch. Always on.

## Exactly-once and crash safety

The reservoir inherits the scatter's durable inbox. Each pulled item enters the
inbox before it is buffered (at-least-once at the source). A released batch acks
atomically: the gather `reduce` folds the whole batch once, all N items leave the
inbox, and the checkpoint is written. On resume the buffers are rebuilt from the
inbox grouped by key, so no item is lost or double-folded. See
[checkpoint and resume](./checkpoint).

## When to use it

- **Throughput** — amortize per-item dispatch and bridge overhead over a batch.
- **Micro-batching at a decision point** — "emit the batch of events that need GDPR review" is a keyed reservoir on the route.
- **Bounded memory on a stream** — a 1k–1M-event source releases fixed-size batches with backpressure instead of materializing everything.

## Visualization

A reservoir-configured scatter renders a distinct glyph. The Mermaid renderer
labels it `▣ <keyField> ×<capacity>` and assigns a `reservoir` class; the
Cytoscape renderer adds a `dag-reservoir` class and a `reservoir` data field. A
consumer animation layer drives the live per-key fill from observer buffer-size
deltas. See [visualization](./visualization).
