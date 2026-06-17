# Reservoir

A **reservoir** is a scatter's keyed input-batching policy. Without it, a scatter
dispatches one source item per body invocation (batch-size-1). With it, the
scatter buffers source items by a key and releases a `Batch<N>` per key — so the
body node runs once over N items, the gather folds the whole batch in a single
`reduce`, and throughput amortizes over the batch.

The reservoir is **not** a new placement: it is configuration on a `ScatterNode`.

## Configuration

```ts twoslash
import { DAGBuilder, ScalarNode, NodeOutputBuilder } from '@noocodex/dagonizer';
import type { NodeStateInterface, NodeOutputInterface } from '@noocodex/dagonizer';

class ClassifyNode extends ScalarNode<NodeStateInterface, 'success' | 'error'> {
  readonly name = 'classify';
  readonly outputs = ['success', 'error'] as const;
  protected override async executeOne(_state: NodeStateInterface): Promise<NodeOutputInterface<'success' | 'error'>> {
    return NodeOutputBuilder.of('success');
  }
}
const classifyNode = new ClassifyNode();
// ---cut---
declare const builder: DAGBuilder;
builder.scatter('classify', 'events', classifyNode, { 'success': 'persist', 'error': 'salvage' }, {
  reservoir: {
    keyField: 'route',   // accessor path on each source item → the partition key
    capacity: 100,       // release a key's batch at this size (>= 1)
    idleMs: 2000,        // optional: release a key's partial batch after this idle
  },
  gather: { strategy: 'append', target: 'results' },
});
```

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
