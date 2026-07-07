---
title: 'Core'
description: 'Core execution primitive reference for GatherStrategy, GatherStrategies, OutcomeReducer, OutcomeReducers, gather records, and default reducers.'
seeAlso:
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`StateAccessor`, `NodeInterface`, `ExecuteOptionsType`'
  - text: 'Reference: Dagonizer'
    link: './dagonizer'
    description: 'wires `GatherStrategies.resolve` and `OutcomeReducers.resolve`'
  - text: 'Reference: Entities'
    link: './entities'
    description: '`GatherConfig`, `GatherStrategyName`'
---

# Core

## What It Is

Core contains the pluggable execution primitives behind scatter gather and aggregate routing: `GatherStrategy`, `GatherStrategies`, `OutcomeReducer`, `OutcomeReducers`, gather records, and default reducers.

Use this page when built-in gather or reducer policy does not match the domain merge, ranking, quorum, or routing decision your DAG needs.

## How It Works

Scatter runs isolated clone work. Gather strategies merge clone state back into the parent. Outcome reducers decide which output route the aggregate scatter placement emits.

The JSON-LD placement stores strategy and reducer names; the core registries resolve those names to concrete implementations. That keeps graph documents portable while still allowing domain-specific merge behavior.

## Diagrams, Examples, and Outputs

Core primitives are easiest to see in scatter examples. These pages show strategy and reducer names in real DAG documents:

- [Reference: Contracts](./contracts) - `StateAccessor`, `NodeInterface`, `ExecuteOptionsType`
- [Reference: Dagonizer](./dagonizer) - wires `GatherStrategies.resolve` and `OutcomeReducers.resolve`
- [Reference: Entities](./entities) - `GatherConfig`, `GatherStrategyName`

## What It Lets You Do

The core reference lets applications extend scatter behavior with custom gather strategies and outcome reducers.

Pluggable execution primitives. Ship through `@studnicky/dagonizer/core`.

## Code Samples

The code below covers strategy authoring, registry registration, default gather behavior, outcome reducer behavior, and the contracts those implementations receive.

### Import

```ts twoslash
import {
  GatherStrategy,
  GatherStrategies,
  OutcomeReducer,
  OutcomeReducers,
} from '@studnicky/dagonizer/core';
import type { GatherExecutionType, GatherRecordType, OutcomeRecordType } from '@studnicky/dagonizer/contracts';
```

### GatherStrategy

Abstract class. Subclass and implement `reduce`; optionally override `initial` and `finalize`; register the instance with `GatherStrategies.register`.

```ts twoslash
import { GatherStrategy, GatherStrategies, Batch } from '@studnicky/dagonizer/core';
import type { GatherRecordType } from '@studnicky/dagonizer/contracts';
import type { GatherConfigType } from '@studnicky/dagonizer/entities';
import type { NodeStateInterface } from '@studnicky/dagonizer';
import type { StateAccessorInterface } from '@studnicky/dagonizer/contracts';
// ---cut---
class MyGather extends GatherStrategy {
  readonly name = 'my-gather';
  reduce(
    _config: GatherConfigType,
    _batch: Batch<GatherRecordType<NodeStateInterface>>,
    _state: NodeStateInterface,
    _accessor: StateAccessorInterface,
  ): void {
    // fold clone results into state
  }
}
GatherStrategies.register(new MyGather());
```

The dispatcher resolves a strategy by `name` (the `GatherConfig.strategy` field) and calls `reduce` for each incoming batch of scatter clone results. Strategies mutate `state` in place via `accessor`; the `custom` strategy uses `execution.invoker.invokeNode(name)` in `finalize` to dispatch a registered node back through the engine.

#### `GatherStrategy` contract

| Member | Description |
|--------|-------------|
| `abstract name` | Wire-shape identifier; matches `GatherConfig.strategy`. |
| `retainsRecordsForFinalize` | When `true`, the engine retains every acked record across resume (retained checkpoint). When `false` (default), checkpoint is O(1) with respect to item count. |
| `initial(config, state, accessor)` | Called once per scatter before any clones run. Default: no-op. |
| `abstract reduce(config, batch, state, accessor)` | Fold a batch of clone results into state. Called per-batch during streaming or once with all results for bulk strategies. |
| `finalize(config, execution)` | End-of-gather work after all clones complete. Default: no-op. |

#### GatherRecordType

```ts twoslash
import type { GatherRecordType } from '@studnicky/dagonizer/contracts';
import type { NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
// GatherRecordType carries per-clone results from the scatter loop.
declare const record: GatherRecordType<NodeStateInterface>;
```

| Field | Type | Description |
|-------|------|-------------|
| `index` | `number` | Source array index (scatter-ordered). |
| `item` | `unknown` | Source item, or `undefined` for a singleton scatter. |
| `output` | `string` | Routing output returned by the clone body. |
| `terminalOutcome` | `'completed' \| 'failed' \| null` | Terminal outcome of a DAG body, or `null` for a node body. |
| `cloneState` | `TState` | Live clone state after the body ran. |

Per-clone record produced by the scatter loop. Records are ordered by source index (ascending) and strategies must not re-sort.

#### GatherExecutionType

```ts twoslash
import type { GatherExecutionType } from '@studnicky/dagonizer/contracts';
import type { NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
// GatherExecutionType is the invocation context handed to GatherStrategy.finalize.
declare const execution: GatherExecutionType<NodeStateInterface>;
```

| Field | Type | Description |
|-------|------|-------------|
| `state` | `TState` | Live parent state object (mutated in place by the strategy). |
| `records` | `GatherRecordType<TState>[]` | Per-clone records in source-index order. |
| `dagName` | `string` | Name of the enclosing DAG. |
| `signal` | `AbortSignal \| null` | Active abort signal, or `null` when none. |
| `accessor` | `StateAccessor` | The dispatcher's configured state accessor. |
| `invoker` | `NodeInvoker` | The only way for `custom` strategies to dispatch a registered node back through the engine. |

#### Defaults

- `map`. For each `cloneFieldPath → parentPath` in `config.mapping`: one clone writes a scalar; N clones append in source-index order.
- `append`. Flatten the clone's `field` (or the source item when `field` is absent) across all records into `config.target`. Throws `DAGError` when `target` is missing.
- `partition`. For each `[outputToken, path]` in `config.partitions`, append the matching records to that path.
- `collect`. Collect each clone's output token (or `field` value when `field` is set) into `config.target` in source-index order. Throws `DAGError` when `target` is missing.
- `discard`. No-op. Nothing is written to parent state. Use for side-effect-only fan-outs where no clone state flows back.
- `custom`. Sets `state.metadata.gatherResults` to the per-clone records (without `cloneState`) and invokes the registered node at `config.customNode` via `execution.invoker.invokeNode`.

### GatherStrategies

Static registry.

```ts twoslash
import { GatherStrategies } from '@studnicky/dagonizer/core';
// ---cut---
const names: readonly string[] = GatherStrategies.list();
```

| Method | Description |
|--------|-------------|
| `register(strategy)` | Register a strategy. Throws `DAGError` when a strategy with the same `name` is already registered. Use `replace()` for intentional overrides. |
| `replace(strategy)` | Explicitly replace an existing registration without throwing. Use for test-time or plugin-override substitution. |
| `resolve(name)` | Return the strategy by name. Throws `DAGError` when not registered. |
| `list()` | Names of every registered strategy, in registration order. |
| `unregister(name)` | Remove a strategy by name. No-op when absent. Used in test `afterEach` to undo `register` calls. |
| `reset()` | Restore the registry to the built-in strategies, discarding application-registered entries. |

### OutcomeReducer

Abstract class. Subclass and implement `reduce`; register the instance with `OutcomeReducers.register`.

```ts twoslash
import { OutcomeReducer, OutcomeReducers } from '@studnicky/dagonizer/core';
import type { OutcomeRecordType } from '@studnicky/dagonizer/contracts';
// ---cut---
class MyReducer extends OutcomeReducer {
  readonly name = 'my-reducer';
  reduce(records: ReadonlyArray<OutcomeRecordType>): string {
    return records.every((r) => r.output === 'success') ? 'all-success' : 'partial';
  }
}
OutcomeReducers.register(new MyReducer());
```

The dispatcher resolves a reducer by `name` (the `ScatterNode.reducer` field, defaulting to `'aggregate'` when `source` is present and `'terminal'` when absent) and calls `.reduce(records)` after gather completes. Returns an output token that maps to a key in the scatter placement's `outputs` map.

#### OutcomeRecordType

```ts twoslash
import type { OutcomeRecordType } from '@studnicky/dagonizer/contracts';
// ---cut---
// OutcomeRecordType carries per-clone summary for routing.
declare const record: OutcomeRecordType;
```

| Field | Type | Description |
|-------|------|-------------|
| `index` | `number` | Source array index. |
| `output` | `string` | Routing output returned by the clone body. |
| `terminalOutcome` | `'completed' \| 'failed' \| null` | Terminal outcome of a DAG body, or `null` for a node body. |

#### Defaults

- `aggregate`. Counts records where `output === 'success'`. Returns `'empty'` (no records), `'all-success'` (all succeed), `'all-error'` (none succeed), or `'partial'` (mixed).
- `terminal`. Singleton semantics (no `source`). Routes `'error'` when the single clone's `terminalOutcome === 'failed'` or `output === 'error'`; otherwise routes `'success'`.
- `all-success`. Routes `'success'` when every clone output equals `'success'`; otherwise routes `'error'`. Returns `'error'` for empty record sets.
- `any-success`. Routes `'success'` when at least one clone output equals `'success'`; otherwise routes `'error'`. Returns `'error'` for empty record sets.

### OutcomeReducers

Static registry.

```ts twoslash
import { OutcomeReducers } from '@studnicky/dagonizer/core';
// ---cut---
const names: readonly string[] = OutcomeReducers.list();
```

| Method | Description |
|--------|-------------|
| `register(reducer)` | Register a reducer. Throws `DAGError` when a reducer with the same `name` is already registered. |
| `resolve(name)` | Return the reducer by name. Throws `DAGError` when not registered. |
| `list()` | Names of every registered reducer, in registration order. |

## Details for Nerds

Custom gather strategies receive the execution accessor and gather records, not the dispatcher internals. Custom outcome reducers receive aggregate outcome records and return a route token. Both extension points are named registry entries so JSON-LD can reference them without serializing implementation code.

Call `reset()` in tests when a suite registers custom strategies or reducers and needs to restore the built-ins for the next case.

## Related Concepts

- [Reference: Contracts](./contracts) - `StateAccessor`, `NodeInterface`, `ExecuteOptionsType`
- [Reference: Dagonizer](./dagonizer) - wires `GatherStrategies.resolve` and `OutcomeReducers.resolve`
- [Reference: Entities](./entities) - `GatherConfig`, `GatherStrategyName`
- [DAGBuilder](../guide/builder) - placements that use `gather.strategy` and `reducer`
- [State Accessors](../guide/state-accessor) - strategies receive the dispatcher's accessor
- [Example: Scatter Extensions](../examples/scatter-extensions) - custom gather and reducer registration in runnable code
