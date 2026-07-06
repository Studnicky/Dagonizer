# Migrating to the batch contract

Dagonizer's node contract is **batch-native**: a node consumes a `Batch<TState>`
and returns a `RoutedBatchType<TOutput>`. This page is the upgrade checklist from the
older single-item (`execute(state) → NodeOutput`) contract. Every node now lands on
the same base contract: `MonadicNode.execute(batch, context)`.

## Per-item nodes → local batch loop

A node that processed one state and returned one output is a per-item node.
Extend `MonadicNode` and keep the item loop inside `execute(batch, context)`:

```ts
class ClassifyNode extends MonadicNode<MyState, 'match' | 'skip'> {
  readonly name = 'classify';
  readonly outputs: readonly ('match' | 'skip')[] = ['match', 'skip'];

  override get outputSchema(): Record<'match' | 'skip', SchemaObjectType> {
    return MonadicNode.permissiveSchema(this.outputs);
  }

  async execute(batch: Batch<MyState>, context: NodeContextType): Promise<RoutedBatchType<'match' | 'skip', MyState>> {
    const routed: Array<readonly ['match' | 'skip', Batch<MyState>]> = [];
    for (const item of batch) {
      const output = await classify(item.state, context.signal);
      routed.push([output, Batch.from([item])]);
    }
    return RoutedBatch.create(routed);
  }
}
```

What changed:

- `implements NodeInterface` → `extends MonadicNode`.
- `async execute(state, ctx)` → `async execute(batch, ctx)` with a local loop over `batch`.
- Drop the `timeout` boilerplate that just sets the default — `MonadicNode` supplies `Timeout.none()`. Keep it (with `override`) only when you set a real value, e.g. `override readonly timeout = Timeout.ofMs(5000)`.
- `validate()` / `destroy()` defaults are inherited; add `override` if you provide your own.

## Batch-native nodes

A node that wants to process the whole batch in one call — to hit a shared LRU
cache across items, vectorize, or fan out / partition — extends `MonadicNode`
(the root) and implements `execute(batch)` directly:

<<< @/../examples/dags/scatter-extensions.ts#monad-node

## The authoring direction

`MonadicNode` is the node base (the monad — `execute(batch, context)`). If you
maintained a custom node base, point it at `MonadicNode` and keep any per-item
loop local to that custom base or to each concrete node.

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

1. Per-item nodes: `extends MonadicNode`, `execute(state, ctx)` → `execute(batch, ctx)` with local routing.
2. Batch-native nodes: `extends MonadicNode`, implement `execute(batch, context)`.
3. Custom gather strategies: rewrite to `initial` / `reduce` / `finalize`.
4. Replace removed symbols.
5. Update direct `execute` call sites to `execute(Batch.of(state), ctx)`.
6. `npm run typecheck && npm run lint && npm run test`.
