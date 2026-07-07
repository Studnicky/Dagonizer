---
title: 'Reservoir'
description: 'Scatter reservoir mode buffers stream items by key and releases bounded batches for higher-throughput fan-out with durable checkpoint resume.'
seeAlso:
  - text: 'Plural-native execution'
    link: './plural-native'
    description: 'batch-native mental model behind reservoir dispatch'
  - text: 'Example 13: Multi-Backend Roles'
    link: '../examples/13-multibackend'
    description: 'Cartographer browser demo using reservoir scatter'
  - text: 'Reference: Nodes'
    link: '../reference/nodes'
    description: 'ScatterNode execution policy fields'
---

<script setup lang="ts">
import { scatterExtensionsDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Reservoir

## What It Is

A reservoir is scatter's keyed input-batching policy. Instead of dispatching one source item per body invocation, a reservoir buffers source items by key and releases bounded `Batch<N>` chunks when capacity, idle time, or source completion says it is time.

Use it when the scatter body should process micro-batches: provider APIs that accept batches, grouped aggregation, streaming fan-out with bounded memory, or resumable work where reissuing already-acknowledged items is unacceptable.

## How It Works

The scatter buffers source items by key until a release condition is met: size, time, flush, or source completion. It then dispatches a batch for that key through the normal scatter body. Checkpoint metadata tracks released and pending work so resume can avoid duplicates.

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

## Diagrams, Examples, and Outputs

The supporting reservoir example exports the exact `ScatterNode` configuration. The JSON-LD shows `execution.mode: "reservoir"`; Mermaid shows that it is still one scatter placement in the DAG.

<DagJsonMermaid :dag="scatterExtensionsDAG" title="scatter-extensions reservoir DAG" aria-label="Scatter extensions reservoir JSON-LD DAG beside Mermaid generated from it." />

- [Plural-native execution](./plural-native) - batch-native mental model behind reservoir dispatch
- [Example 13: Multi-Backend Roles](../examples/13-multibackend) - Cartographer browser demo using reservoir scatter
- [Reference: Nodes](../reference/nodes) - ScatterNode execution policy fields
- [Scatter Extensions](../examples/scatter-extensions) - focused reservoir, gather, and batch-native snippets

## What It Lets You Do

### Use when

Use a reservoir when scatter input is a stream but the body should process keyed micro-batches instead of one item at a time. This is for throughput, batching APIs, grouped aggregation, and resumable fan-out with bounded memory.

## Code Samples

The source below is the reservoir placement from the same DAG rendered above.

## Details for Nerds

### Configuration

<<< @/../examples/dags/scatter-extensions.ts#reservoir-dag

The partition key is `String(accessor.get(item, keyField))`. The reservoir
requires a **node body** (a `{ node }` body, not a sub-DAG or container body) —
the node processes the released `Batch<N>` directly.

### Release triggers

A key's buffer releases as one batch when any of three triggers fires:

- **capacity** — the buffer reaches `capacity` items. The primary trigger; bounds memory.
- **idle** — `idleMs` is set and the key receives no new item for that long. Driven by the engine's swappable `Scheduler`, so it is deterministic under `VirtualScheduler` in tests. Bounds latency for sparse keys.
- **complete** — the source drains; every non-empty buffer flushes as a final partial batch. Always on.

### Exactly-once and crash safety

The reservoir inherits the scatter's durable inbox. Each pulled item enters the
inbox before it is buffered (at-least-once at the source). A released batch acks
atomically: the gather `reduce` folds the whole batch once, all N items leave the
inbox, and the checkpoint is written. On resume the buffers are rebuilt from the
inbox grouped by key, so no item is lost or double-folded. See
[checkpoint and resume](./checkpoint).

### When to use it

- **Throughput** — amortize per-item dispatch and bridge overhead over a batch.
- **Micro-batching at a decision point** — "emit the batch of events that need GDPR review" is a keyed reservoir on the route.
- **Bounded memory on a stream** — a 1k–1M-event source releases fixed-size batches with backpressure instead of materializing everything.

### Visualization

A reservoir-configured scatter renders a distinct glyph. The Mermaid renderer
labels it `▣ <keyField> ×<capacity>` and assigns a `reservoir` class; the
Cytoscape renderer adds a `dag-reservoir` class and a `reservoir` data field. A
application animation layer drives the live per-key fill from observer buffer-size
deltas. See [visualization](./visualization).

## Related Concepts

- [Plural-native execution](./plural-native) - batch-native mental model behind reservoir dispatch
- [Example 13: Multi-Backend Roles](../examples/13-multibackend) - Cartographer browser demo using reservoir scatter
- [Reference: Nodes](../reference/nodes) - ScatterNode execution policy fields
- [Scatter Extensions](../examples/scatter-extensions)
- [Example 17: Async Scatter Source](../examples/17-scatter-async-source) shows the source side of streaming scatter.
- [Example 20: Streaming Execution](../examples/20-streaming) shows live execution observation.
- [The Cartographer](../examples/the-cartographer) is the runnable data-pipeline demo for streaming fan-out.
