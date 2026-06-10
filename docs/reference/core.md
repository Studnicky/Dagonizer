---
seeAlso:

  - text: 'Reference: Contracts'

    link: './contracts'
    description: '`StateAccessor`, `NodeInterface`, `ExecuteOptionsInterface`'

  - text: 'Reference: Dagonizer'

    link: './dagonizer'
    description: 'wires `GatherStrategies.resolve` and `OutcomeReducers.resolve`'

  - text: 'Reference: Entities'

    link: './entities'
    description: '`GatherConfig`, `GatherStrategyName`'
---

# Core

Pluggable execution primitives. Ship through `@noocodex/dagonizer/core`.

```ts
import {
  GatherStrategy,
  GatherStrategies,
  OutcomeReducer,
  OutcomeReducers,
} from '@noocodex/dagonizer/core';
import type { GatherExecution, GatherRecord, OutcomeRecord } from '@noocodex/dagonizer/core';
```

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

The dispatcher resolves a strategy by `name` (the `GatherConfig.strategy` field) and calls `.apply(...)` once every scatter clone has reported. Strategies mutate `execution.state` in place; the `custom` strategy uses `execution.invoker.invokeNode(name)` to dispatch a registered node back through the engine.

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
  readonly invoker: NodeInvoker;
}
```

Per-invocation context handed to the strategy. `state` is the live parent state; `records` carries per-clone results in source-index order; `accessor` is the dispatcher's configured `StateAccessor`; `invoker` carries `invokeNode(nodeName)` for the `custom` strategy.

### Defaults

- `map`. For each `cloneFieldPath → parentPath` in `config.mapping`: one clone writes a scalar; N clones append in source-index order.
- `append`. Flatten the clone's `field` (or the source item when `field` is absent) across all records into `config.target`. Throws `DAGError` when `target` is missing.
- `partition`. For each `[outputToken, path]` in `config.partitions`, append the matching records to that path.
- `collect`. Collect each clone's output token (or `field` value when `field` is set) into `config.target` in source-index order. Throws `DAGError` when `target` is missing.
- `discard`. No-op. Nothing is written to parent state. Use for side-effect-only fan-outs where no clone state flows back.
- `custom`. Sets `state.metadata.gatherResults` to the per-clone records (without `cloneState`) and invokes the registered node at `config.customNode` via `execution.invoker.invokeNode`.

## GatherStrategies

Static registry.

```ts
class GatherStrategies {
  static register(strategy: GatherStrategy): void;
  static resolve(name: string): GatherStrategy;           // throws DAGError on unknown name
  static list(): readonly string[];
}
```

Last-write-wins on `name`. `resolve` throws `DAGError` when the strategy is not registered.

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
- `all-success`. Routes `'success'` when every clone output equals `'success'`; otherwise routes `'error'`. Returns `'error'` for empty record sets.
- `any-success`. Routes `'success'` when at least one clone output equals `'success'`; otherwise routes `'error'`. Returns `'error'` for empty record sets.

## OutcomeReducers

Static registry.

```ts
class OutcomeReducers {
  static register(reducer: OutcomeReducer): void;
  static resolve(name: string): OutcomeReducer;           // throws DAGError on unknown name
  static list(): readonly string[];
}
```

Last-write-wins on `name`. `resolve` throws `DAGError` when the reducer is not registered.

## Related guides

- [DAGBuilder](../guide/builder): placements that use `gather.strategy` and `reducer`
- [State accessors](../guide/state-accessor): strategies receive the dispatcher's `accessor`
- [Reference: Entities](./entities#constant-valuetype-pairs): `GatherStrategyName`, `ScatterOutput`, and `MetadataKey` are exported from `@noocodex/dagonizer/constants`
