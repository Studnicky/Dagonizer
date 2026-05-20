---
seeAlso:

  - text: 'Reference: Contracts'

    link: './contracts'
    description: '`StateAccessor`, `NodeInterface`, `ExecuteOptionsInterface`'

  - text: 'Reference: Dagonizer'

    link: './dagonizer'
    description: 'wires `ParallelCombiners.resolve` and `FanInStrategies.resolve`'

  - text: 'Reference: Entities'

    link: './entities'
    description: '`FanInConfig`, `ParallelCombine`'
---

# Core

Pluggable execution primitives. Ship through `@noocodex/dagonizer/core`.

```ts
import {
  ParallelCombiner,
  ParallelCombiners,
  FanInStrategy,
  FanInStrategies,
} from '@noocodex/dagonizer/core';
import type { ParallelResult, FanInExecution } from '@noocodex/dagonizer/core';
```

## ParallelCombiner

Abstract class. Subclass and override `combine`; register the instance with `ParallelCombiners.register`.

```ts
abstract class ParallelCombiner {
  abstract readonly name: string;
  abstract combine(
    outputs: readonly string[],
    results: readonly ParallelResult[],
    state: NodeStateInterface,
  ): string;
}

interface ParallelResult {
  readonly opResult: { readonly output: string };
  readonly node: { readonly name: string };
}
```

The dispatcher resolves a combiner by `name` (the placement's `combine` field) and calls `.combine(...)` once every concurrent node has reported. Combiners may mutate `state` (e.g. via `state.setMetadata(...)`) to expose per-node data to downstream nodes.

### Defaults

- `all-success` — returns `'success'` iff every node reported `'success'`, else `'error'`.
- `any-success` — returns `'success'` iff any node reported `'success'`, else `'error'`.
- `collect` — writes `Record<nodeName, output>` to `state.metadata.parallelOutputs` and returns `'success'`.

## ParallelCombiners

Static registry.

```ts
class ParallelCombiners {
  static register(combiner: ParallelCombiner): void;
  static resolve(name: string): ParallelCombiner;          // throws DAGError on unknown name
  static list(): readonly string[];
}
```

`register` is last-write-wins on `name`. `resolve` throws `DAGError` when the combiner is not registered.

## FanInStrategy

Abstract class. Subclass and override `apply`; register the instance with `FanInStrategies.register`.

```ts
abstract class FanInStrategy {
  abstract readonly name: string;
  abstract apply<TState extends NodeStateInterface>(
    config: FanInConfig,
    execution: FanInExecution<TState>,
  ): Promise<void>;
}
```

The dispatcher resolves a strategy by `name` (the `FanInConfig.strategy` field) and calls `.apply(...)` once every fan-out item has reported. Strategies mutate `execution.state` in place; the `custom` strategy uses `execution.invokeNode(name)` to dispatch a registered node back through the engine.

### FanInExecution

```ts
interface FanInExecution<TState extends NodeStateInterface> {
  readonly state: TState;
  readonly results: ReadonlyMap<string, readonly unknown[]>;
  readonly dagName: string;
  readonly signal: AbortSignal | null;
  readonly accessor: StateAccessor;
  invokeNode(nodeName: string): Promise<void>;
}
```

Per-invocation context handed to the strategy. `state` is the live node state; `results` carries per-output buckets keyed by the output the worker reported; `accessor` is the dispatcher's configured `StateAccessor`.

### Defaults

- `append` — flatten every result bucket and append to the path at `config.target`. Throws `DAGError` if `target` is missing.
- `partition` — for each `[output, path]` in `config.partitions`, append the matching bucket to that path.
- `custom` — sets `state.metadata.fanInResults` to `Object.fromEntries(execution.results)` and invokes the registered node at `config.customNode` via `execution.invokeNode`.

## FanInStrategies

Static registry.

```ts
class FanInStrategies {
  static register(strategy: FanInStrategy): void;
  static resolve(name: string): FanInStrategy;             // throws DAGError on unknown name
  static list(): readonly string[];
}
```

Same semantics as `ParallelCombiners`.
## Related guides

- [DAGBuilder](../guide/builder) — placements that use `combine` and `fanIn.strategy`
- [State accessors](../guide/state-accessor) — strategies receive the dispatcher's `accessor`
