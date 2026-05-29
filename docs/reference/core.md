---
seeAlso:

  - text: 'Reference: Contracts'

    link: './contracts'
    description: '`StateAccessor`, `NodeInterface`, `ExecuteOptionsInterface`'

  - text: 'Reference: Dagonizer'

    link: './dagonizer'
    description: 'wires `ParallelCombiners.resolve`, `GatherStrategies.resolve`, and `OutcomeReducers.resolve`'

  - text: 'Reference: Entities'

    link: './entities'
    description: '`GatherConfig`, `ParallelCombine`'
---

# Core

Pluggable execution primitives. Ship through `@noocodex/dagonizer/core`.

```ts
import {
  ParallelCombiner,
  ParallelCombiners,
  GatherStrategy,
  GatherStrategies,
  OutcomeReducer,
  OutcomeReducers,
} from '@noocodex/dagonizer/core';
import type { ParallelResult, GatherExecution, GatherRecord, OutcomeRecord } from '@noocodex/dagonizer/core';
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

- `all-success`. Returns `'success'` iff every node reported `'success'`, else `'error'`.
- `any-success`. Returns `'success'` iff any node reported `'success'`, else `'error'`.
- `collect`. Writes `Record<nodeName, output>` to `state.metadata.parallelOutputs` and returns `'success'`.

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

## GatherStrategy

Abstract class. Subclass and override `apply`; register the instance with `GatherStrategies.register`.

```ts
abstract class GatherStrategy {
  abstract readonly name: string;
  abstract apply<TState extends NodeStateInterface>(
    config: GatherConfig,
    execution: GatherExecution<TState>,
  ): Promise<void>;
}
```

The dispatcher resolves a strategy by `name` (the `GatherConfig.strategy` field) and calls `.apply(...)` once every scatter clone has reported. Strategies mutate `execution.state` in place; the `custom` strategy uses `execution.invokeNode(name)` to dispatch a registered node back through the engine.

### GatherRecord

```ts
interface GatherRecord<TState extends NodeStateInterface> {
  readonly index: number;
  readonly item: unknown;
  readonly output: string;
  readonly terminalOutcome: 'completed' | 'failed' | null;
  readonly cloneState: TState;
}
```

Per-clone record produced by the scatter loop. Carries the source item (or `undefined` for a singleton scatter), the routing output, the terminal outcome of a DAG body (or `null` for a node body), and the live clone state after the body ran.

### GatherExecution

```ts
interface GatherExecution<TState extends NodeStateInterface> {
  readonly state: TState;
  readonly records: ReadonlyArray<GatherRecord<TState>>;
  readonly dagName: string;
  readonly signal: AbortSignal | null;
  readonly accessor: StateAccessor;
  invokeNode(nodeName: string): Promise<void>;
}
```

Per-invocation context handed to the strategy. `state` is the live parent state; `records` carries per-clone results in source-index order; `accessor` is the dispatcher's configured `StateAccessor`.

### Defaults

- `map`. For each `cloneFieldPath → parentPath` in `config.mapping`: one clone writes a scalar; N clones append in source-index order.
- `append`. Flatten the clone's `field` (or the source item when `field` is absent) across all records into `config.target`. Throws `DAGError` when `target` is missing.
- `partition`. For each `[outputToken, path]` in `config.partitions`, append the matching records to that path.
- `custom`. Sets `state.metadata.gatherResults` to the per-clone records (without `cloneState`) and invokes the registered node at `config.customNode` via `execution.invokeNode`.

## GatherStrategies

Static registry.

```ts
class GatherStrategies {
  static register(strategy: GatherStrategy): void;
  static resolve(name: string): GatherStrategy;           // throws DAGError on unknown name
  static list(): readonly string[];
}
```

Same semantics as `ParallelCombiners`. Register replaces last-write-wins on `name`.

## OutcomeReducer

Abstract class. Subclass and override `reduce`; register the instance with `OutcomeReducers.register`.

```ts
abstract class OutcomeReducer {
  abstract readonly name: string;
  abstract reduce(records: ReadonlyArray<OutcomeRecord>): string;
}
```

The dispatcher resolves a reducer by `name` (the `ScatterNode.reducer` field, defaulting to `'aggregate'` when `source` is present and `'terminal'` when absent) and calls `.reduce(records)` after gather completes. Returns an output token that maps to a key in the scatter placement's `outputs` map.

### OutcomeRecord

```ts
interface OutcomeRecord {
  readonly index: number;
  readonly output: string;
  readonly terminalOutcome: 'completed' | 'failed' | null;
}
```

### Defaults

- `aggregate`. Counts records where `output === 'success'`. Returns `'empty'` (no records), `'all-success'` (all succeed), `'all-error'` (none succeed), or `'partial'` (mixed).
- `terminal`. Singleton semantics (no `source`). Routes `'error'` when the single clone's `terminalOutcome === 'failed'` or `output === 'error'`; otherwise routes `'success'`.

## OutcomeReducers

Static registry.

```ts
class OutcomeReducers {
  static register(reducer: OutcomeReducer): void;
  static resolve(name: string): OutcomeReducer;           // throws DAGError on unknown name
  static list(): readonly string[];
}
```

Same semantics as `ParallelCombiners`.

## Related guides

- [DAGBuilder](../guide/builder): placements that use `combine` and `gather.strategy`
- [State accessors](../guide/state-accessor): strategies receive the dispatcher's `accessor`
