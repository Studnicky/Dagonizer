---
title: 'Migrating to Batch'
description: 'Upgrade single-item node code to the batch-native MonadicNode contract, including local item loops, gather strategy folds, and direct node test calls.'
seeAlso:
  - text: 'Plural-native execution'
    link: './plural-native'
    description: 'mental model for batches, partitioned routing, and the work-set scheduler'
  - text: 'Reference: Nodes'
    link: '../reference/nodes'
    description: 'placement and execution policy reference'
  - text: 'Example: Scatter extensions'
    link: '../examples/scatter-extensions'
    description: 'runnable batch, gather, and reservoir examples'
---

# Migrating to Batch

## What It Is

This is the upgrade guide for node code written around an older single-item mental model. Current Dagonizer nodes are batch-native: a node consumes `Batch<TState>` and returns `RoutedBatchType<TOutput>`.

Most migrations are mechanical. Keep the business logic, move the item loop inside `execute(batch, context)`, partition items by output, and return one routed batch map.

## How It Works

Wrap former per-item logic in a local loop over batch items, collect each item into the output batch it routes to, and return one `RoutedBatchType`. Scatter, reservoirs, gather strategies, and direct node tests all use this same contract.

Every node now lands on the same base contract: `MonadicNode.execute(batch, context)`. Single-item behavior is still supported; it is represented as a batch with one item.

## Diagrams, Examples, and Outputs

Migration is about node implementation shape, so this page uses runnable code snippets rather than a new graph. The topology does not need to change just because a node becomes batch-native.

Use these pages together:

- [Plural-native execution](./plural-native) explains batches, partitioned routing, and the work-set scheduler.
- [Scatter Extensions](../examples/scatter-extensions) demonstrates batch-native nodes, direct node calls, gather strategy folds, and reservoir configuration.
- [The Cartographer](../examples/the-cartographer) shows production-shaped per-item routing inside batch-native nodes.
- [Reference: Nodes](../reference/nodes) documents the placement and execution policy surface.

## What It Lets You Do

### Use when

Use this guide when upgrading node implementations from single-state execution to Dagonizer's batch-native contract. The target shape is one node method that accepts a `Batch<TState>`, partitions items by output, and remains directly testable.

## Code Samples

The snippets below are the migration points you edit in real code: node execution, gather strategies, direct node calls, and tests.

### Per-item nodes → local batch loop

A node that processed one state and returned one output is a per-item node.
Extend `MonadicNode` and keep the item loop inside `execute(batch, context)`:

The Cartographer's `RouteGeoNode` is the runnable version of this pattern. It
loops over the batch locally, partitions items into `has-geo` and `needs-geo`,
and returns a `RoutedBatchType` to the engine:

<<< @/../examples/the-cartographer/nodes/routeGeo.ts#route-geo-node

What changed:

- `implements NodeInterface` → `extends MonadicNode`.
- `async execute(state, ctx)` → `async execute(batch, ctx)` with a local loop over `batch`.
- Drop the `timeout` boilerplate that just sets the default — `MonadicNode` supplies `Timeout.none()`. Keep it (with `override`) only when you set a real value, e.g. `override readonly timeout = Timeout.ofMs(5000)`.
- `validate()` / `destroy()` defaults are inherited; add `override` if you provide your own.

### Batch-native nodes

A node that wants to process the whole batch in one call — to hit a shared LRU
cache across items, vectorize, or fan out / partition — extends `MonadicNode`
(the root) and implements `execute(batch)` directly:

<<< @/../examples/dags/scatter-extensions.ts#monad-node

### The authoring direction

`MonadicNode` is the node base (the monad — `execute(batch, context)`). If you
maintained a custom node base, point it at `MonadicNode` and keep any per-item
loop local to that custom base or to each concrete node.

`MonadicNode` is exported from the root (`@studnicky/dagonizer`) and `./core`; it is
also re-exported from `./patterns` for co-import with the pattern surface.

### Gather strategies → one fold

The gather contract is now a single fold — `initial → reduce → finalize`. The
`seed` / `apply` / `applyIncremental` methods and `IncrementalGatherStrategy` are
removed:

<<< @/../examples/dags/scatter-extensions.ts#gather-strategy

"Incremental" is a `reduce` over a batch of 1; "all-at-once" is a `reduce` over a
batch of N. The built-in gather **config** (`map` / `append` / `partition` /
`collect` / `discard` / `custom`) is unchanged.

### Removed symbols

| Removed | Replacement |
|---------|-------------|
| `PluralNodeInterface`, the `PLURAL` brand | one contract — `NodeInterface.execute(batch)` |
| `ParallelNode` | `ScatterNode` (scatter + gather is the one fan-out) |
| `IncrementalGatherStrategy`, `GatherStrategy.apply` / `applyIncremental` | `GatherStrategy.reduce` (one fold) |
| `GatherStrategy.seed()` | `GatherStrategy.initial()` |

### Calling a node directly

Tests or nodes that invoked another node's `execute(state)` must pass a batch and
read the routed result:

<<< @/../examples/dags/scatter-extensions.ts#call-node-directly

## Details for Nerds

### Checklist

1. Per-item nodes: `extends MonadicNode`, `execute(state, ctx)` → `execute(batch, ctx)` with local routing.
2. Batch-native nodes: `extends MonadicNode`, implement `execute(batch, context)`.
3. Custom gather strategies: rewrite to `initial` / `reduce` / `finalize`.
4. Replace removed symbols.
5. Update direct `execute` call sites to `execute(Batch.of(state), ctx)`.
6. `npm run typecheck && npm run lint && npm run test`.

## Related Concepts

- [Plural-native execution](./plural-native) - mental model for batches, partitioned routing, and the work-set scheduler
- [Reference: Nodes](../reference/nodes) - placement and execution policy reference
- [Example: Scatter extensions](../examples/scatter-extensions) - runnable batch, gather, and reservoir examples
- [Example 14: Gather Strategies](../examples/14-gather-strategies) shows gather strategy behavior on real Cartographer DAGs.
- [Example 15: Incremental Gather](../examples/15-incremental-gather) shows the `reduce`/`finalize` contract.
- [Monadic Node](../examples/monadic-node) shows a small node implementation against the current contract.
