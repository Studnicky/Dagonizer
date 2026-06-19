# Migrating to the batch contract

Dagonizer's node contract is **batch-native**: a node consumes a `Batch<TState>`
and returns a `RoutedBatchType<TOutput>`. This page is the upgrade checklist from the
older single-item (`execute(state) → NodeOutput`) contract. Most leaf nodes change
a base class and a method name.

## Per-item nodes → `ScalarNode`

A node that processed one state and returned one output is a per-item node.
Extend `ScalarNode` and rename `execute` to `executeOne`:

<<< @/../examples/dags/04-scatter.ts#worker-node

What changed:

- `implements NodeInterface` → `extends ScalarNode`.
- `async execute(state, ctx)` → `protected override async executeOne(state, ctx)` — **the body is unchanged**. The base loops `executeOne` over the batch and groups items by the returned port.
- Drop the `contract` and `timeout` boilerplate that just set the default — `ScalarNode` supplies `EMPTY_CONTRACT_FRAGMENT` and `Timeout.none()`. Keep them (with `override`) only when you set a real value, e.g. `override readonly timeout = Timeout.ofMs(5000)`.
- `validate()` / `destroy()` defaults are inherited; add `override` if you provide your own.

## Batch-native nodes → `MonadicNode`

A node that wants to process the whole batch in one call — to hit a shared LRU
cache across items, vectorize, or fan out / partition — extends `MonadicNode`
(the root) and implements `execute(batch)` directly:

<<< @/../examples/dags/scatter-extensions.ts#monad-node

## The taxonomy direction

`MonadicNode` is the **root** node base (the monad — `execute(batch)`). `ScalarNode`
**extends** `MonadicNode` and adds the per-item `executeOne` loop. If you maintained
a custom node base, point it at the right parent:

- a per-item base → `extends ScalarNode`;
- a batch-native base → `extends MonadicNode`.

`MonadicNode` is exported from the root (`@studnicky/dagonizer`) and `./core`; it is
also re-exported from `./patterns` for co-import with the pattern surface.

## Gather strategies → one fold

The gather contract is now a single fold — `initial → reduce → finalize`. The
`seed` / `apply` / `applyIncremental` methods and `IncrementalGatherStrategy` are
removed:

<<< @/../examples/dags/scatter-extensions.ts#gather-strategy

"Incremental" is a `reduce` over a batch of 1; "all-at-once" is a `reduce` over a
batch of N. The built-in gather **config** (`map` / `append` / `partition` /
`collect` / `discard` / `custom`) is unchanged.

## Removed symbols

| Removed | Replacement |
|---------|-------------|
| `PluralNodeInterface`, the `PLURAL` brand | one contract — `NodeInterface.execute(batch)` |
| `ParallelNode` | `ScatterNode` (scatter + gather is the one fan-out) |
| `IncrementalGatherStrategy`, `GatherStrategy.apply` / `applyIncremental` | `GatherStrategy.reduce` (one fold) |
| `GatherStrategy.seed()` | `GatherStrategy.initial()` |

## Calling a node directly

Tests or nodes that invoked another node's `execute(state)` must pass a batch and
read the routed result:

<<< @/../examples/dags/scatter-extensions.ts#call-node-directly

## Checklist

1. Per-item nodes: `extends ScalarNode`, `execute` → `executeOne`, drop default `contract`/`timeout`.
2. Batch-native nodes: `extends MonadicNode`, implement `execute(batch)`.
3. Custom gather strategies: rewrite to `initial` / `reduce` / `finalize`.
4. Replace removed symbols.
5. Update direct `execute` call sites to `execute(Batch.of(state), ctx)`.
6. `npm run typecheck && npm run lint && npm run test`.
