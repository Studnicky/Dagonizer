# Plural-native execution

The fundamental unit of work flowing through a DAG is a **batch**. A single item
is a batch of one; the engine never processes a scalar specially. This page is
the mental model behind the executor — read it once and the rest of the API falls
into place.

## The batch contract

A node consumes a `Batch<TState>` and returns a `RoutedBatch<TOutput>`:

<<< @/../examples/dags/plural-native.ts#execute-contract

A `Batch<TState>` is an ordered collection of items, each carrying a stable id
and a per-item `TState`. A `RoutedBatch<TOutput>` is a `Map<output, Batch>` — the
node's items **partitioned** across its output ports.

**Routing is partitioning.** Three things that look separate are one mechanism:

- per-item conditional routing — a node sends some items to `needs-gdpr`, others to `geo-only`;
- micro-batching — a node that emits batches instead of items;
- the [reservoir](#the-reservoir) — a node that partitions *over time*, buffering until a threshold.

## The node taxonomy

Every node descends from one root. You pick the authoring base by how you want to
write the work, not by what the engine does:

| Base | You implement | Use for |
|------|---------------|---------|
| **`MonadicNode`** (the root — the monad) | `execute(batch)` directly | batch-native / hot-path nodes that process the whole batch at once (shared LRU caches, vectorized work) |
| **`ScalarNode`** (extends `MonadicNode`) | `executeOne(state)` | the common per-item node; the base loops `executeOne` over the batch and groups by port |

`MonadicNode` is the minimum viable node — it supplies `name` / `outputs` /
`contract` / `timeout` / `validate` / `destroy` and leaves `execute` abstract.
`ScalarNode` is the per-item specialization: "a scalar is a batch of one."

<<< @/../examples/dags/plural-native.ts#node-taxonomy

## How a DAG processes a batch: the work-set walk

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

## The reservoir

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

## Checkpoint and resume

In-flight state is fully serialized. For a multi-item run, the work set
(per-node item-state snapshots) is captured into state metadata on interruption
and rebuilt exactly on resume. A scatter's durable inbox composes with it. Resume
is byte-equivalent to an uninterrupted run; a size-1 run uses the cursor model
unchanged. See [checkpoint and resume](./checkpoint).

## Migrating existing nodes

Upgrading from the single-item contract? See [Migrating to the batch
contract](./migrating-to-batch) — most leaf nodes change a base class and a method
name, nothing more.
