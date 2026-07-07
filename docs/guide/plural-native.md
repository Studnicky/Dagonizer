---
title: 'Plural-Native Execution'
description: 'Batch-native execution model for Dagonizer: nodes partition batches by output port, scatters fan out work, and reservoirs release keyed micro-batches.'
seeAlso:
  - text: 'Migrating to the batch contract'
    link: './migrating-to-batch'
    description: 'upgrade checklist for single-item node code'
  - text: 'Reservoir'
    link: './reservoir'
    description: 'keyed input batching for scatter sources'
  - text: 'Reference: Core'
    link: '../reference/core'
    description: 'Batch, RoutedBatch, gather strategy, and outcome reducer primitives'
---

<script setup lang="ts">
import { reservoirDag as pluralNativeDag } from '../../examples/dags/plural-native.ts';
</script>

# Plural-Native Execution

## What It Is

Dagonizer moves work through a DAG as batches. A single item is just a batch of one; branching means partitioning a batch by output port; joins mean merging pending batches at the same placement. Scatter, gather, retry, checkpoint, and reservoir behavior all build on that one contract.

This page is the mental model for execution. Once you understand that every node receives `Batch<TState>` and returns routed sub-batches, the rest of the engine stops looking like special cases.

## How It Works

Every node receives a `Batch<TState>` and returns routed batches partitioned by output. A single item is represented as a batch of one. Scatter clones, reservoir batches, gather folds, checkpoint progress, and retry semantics all build on that plural-native contract.

The work-set scheduler keeps a `Map<placement, Batch>`. It fires the lowest-rank placement with pending items, merges returned sub-batches into downstream placements, and repeats until the graph drains or the lifecycle exits. A size-1 run follows the same path as a size-N run.

## Diagrams, Examples, and Outputs

The focused runnable module exports a reservoir-backed scatter DAG. The JSON-LD shows the `ScatterNode` placement and reservoir policy; the Mermaid view shows that the topology is still a simple scatter-to-terminal graph.

<<< @/../examples/dags/plural-native.ts#reservoir-scatter

<DagJsonMermaid :dag="pluralNativeDag" title="plural-native reservoir scatter DAG" aria-label="Plural-native reservoir scatter JSON-LD DAG beside Mermaid generated from it." />

For larger runnable contexts:

- [Scatter Extensions](../examples/scatter-extensions) shows batch-native nodes, custom gather, direct node calls, and reservoir authoring.
- [Example 14: Gather Strategies](../examples/14-gather-strategies) shows gather behavior against real Cartographer DAGs.
- [Example 16: Scatter Resume](../examples/16-scatter-resume) shows durable progress over scatter batches.
- [Reservoir](./reservoir) explains keyed input batching for scatter sources.

## What It Lets You Do

### Use when

Use this guide when reasoning about how Dagonizer executes batches, scatter worksets, and reservoir releases. The mental model is useful before writing custom nodes, gather strategies, outcome reducers, or migration code.

## Code Samples

### The batch contract

A node consumes a `Batch<TState>` and returns a `RoutedBatchType<TOutput>`:

<<< @/../examples/dags/plural-native.ts#execute-contract

A `Batch<TState>` is an ordered collection of items, each carrying a stable id
and a per-item `TState`. A `RoutedBatchType<TOutput>` is a `Map<output, Batch>` — the
node's items **partitioned** across its output ports.

**Routing is partitioning.** Three things that look separate are one mechanism:

- per-item conditional routing — a node sends some items to `needs-gdpr`, others to `geo-only`;
- micro-batching — a node that emits batches instead of items;
- the [reservoir](#the-reservoir) — a node that partitions *over time*, buffering until a threshold.

## Details for Nerds

### The node taxonomy

Every node descends from one root. You pick the local implementation shape by
how you want to write the work, not by what the engine does:

| Shape | You implement | Use for |
|------|---------------|---------|
| **Batch-native `MonadicNode`** | `execute(batch, context)` as one whole-batch transform | hot-path nodes that process the whole batch at once (shared LRU caches, vectorized work) |
| **Per-item `MonadicNode`** | `execute(batch, context)` with a local item loop | item-oriented logic where each state routes independently |

`MonadicNode` is the minimum viable node — it supplies `timeout` / `validate` / `destroy` defaults and leaves `name`, `outputs`, `outputSchema`, and `execute` abstract. Concrete nodes must implement all four. `outputSchema` is an abstract getter (`abstract get outputSchema(): Record<TOutput, SchemaObjectType>`) that declares a per-port JSON Schema fragment describing the state delta the node writes when routing to that port; the compiler enforces its presence on every subclass.
A single item is still a batch of one; per-item routing is a local loop that builds a `RoutedBatchType`.

The Cartographer's `RouteGeoNode` is the runnable example: it receives a whole batch, routes each item to `has-geo` or `needs-geo`, and returns a routed batch map for the scheduler to merge into downstream placements.

<<< @/../examples/the-cartographer/nodes/routeGeo.ts#route-geo-node

### How a DAG processes a batch: the work-set walk

A DAG is substitutable with a node — given a `Batch<N>`, it processes it natively.
The executor is a **work-set scheduler**:

- The **work set** is `Map<placement, Batch>` — the items waiting at each node.
- It is initialized with the input batch at the entrypoint.
- Each step **fires** the lowest-rank node that holds items: run it over its
  accumulated batch, then **merge** each output port's sub-batch into the
  downstream node's pending work. Items reaching a terminal are collected.
- **Rank** is a topological order over forward edges (back-edges — retry
  self-edges — are excluded). Lowest-rank-first means a join *coalesces*: it waits
  for all its feeders to drain, then fires once over the merged batch.

A node fires once over all the items currently at it — that is the batching.
Items that branch take different next-nodes; items that converge merge at the
join. For a size-1 input the work set holds one item at one node and the walk
degenerates to a simple cursor — identical to single-item execution.

**Retry is a flow shape.** A node routes a `retry` output back to an earlier (or
self) placement; those items re-enter that node's pending work and re-fire on a
later pass, re-batched with whatever else is there. The per-item retry budget
lives on state (`withinRetryBudget`) and bounds the loop.

### The reservoir

A scatter's source can be batched by a **reservoir** — its keyed input-batching
policy. Instead of dispatching one item at a time, it buffers items by a key and
releases a `Batch<N>` per key when one of three triggers fires:

- **capacity** — the key's buffer reaches `capacity`;
- **idle** — the key has been idle for `idleMs` (driven by the swappable scheduler);
- **complete** — the source drains, flushing every partial buffer.

<<< @/../examples/dags/plural-native.ts#reservoir-scatter

The body node then runs once over each released batch, and the gather folds the
whole batch in a single `reduce`. With no `reservoir` config the dispatch unit is
batch-size-1 — exactly the default behavior. See the [reservoir guide](./reservoir).

### Checkpoint and Resume

In-flight state is fully serialized. For a multi-item run, the work set
(per-node item-state snapshots) is captured into state metadata on interruption
and rebuilt exactly on resume. A scatter's durable inbox composes with it. Resume
is byte-equivalent to an uninterrupted run; a size-1 run uses the cursor model
unchanged. See [checkpoint and resume](./checkpoint).

### Migrating existing nodes

Upgrading from the single-item contract? See [Migrating to the batch
contract](./migrating-to-batch) — most leaf nodes change a base class and a method
name, nothing more.

## Related Concepts

- [Migrating to the batch contract](./migrating-to-batch) - upgrade checklist for single-item node code
- [Reservoir](./reservoir) - keyed input batching for scatter sources
- [Reference: Core](../reference/core) - Batch, RoutedBatch, gather strategy, and outcome reducer primitives
- [Example 04: Scatter Scout](../examples/04-scatter) shows fan-out over worksets.
- [Example 14: Gather Strategies](../examples/14-gather-strategies) shows parent-state folds.
- [Example 16: Scatter Resume](../examples/16-scatter-resume) shows durable progress over scatter batches.
