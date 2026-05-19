---
seeAlso:
  - text: 'Reference: Core'
    link: './core'
    description: '`ParallelCombiner`, `FanInStrategy` extension classes'
  - text: 'Reference: Derive'
    link: './derive'
    description: 'uses `OperationContract`'
  - text: 'Reference: Runtime'
    link: './runtime'
    description: 'default implementations of `ClockProvider`, `SchedulerProvider`, `StateAccessor`'
  - text: 'Reference: Checkpoint'
    link: './checkpoint'
    description: 'uses `CheckpointStore`'
---

# Contracts

Adapter contracts live at the root of `src/contracts/` and ship through `@noocodex/dagonizer/contracts`. Single source of truth — never re-exported from a sibling module.

```ts
import type {
  CheckpointStore,
  ClockProvider,
  ErrorConstructorType,
  ExecuteOptionsInterface,
  NodeInterface,
  OperationContract,
  RetryPolicyOptionsInterface,
  SchedulerHandle,
  SchedulerProvider,
  StateAccessor,
} from '@noocodex/dagonizer/contracts';
```

## NodeInterface

```ts
interface NodeInterface<
  TState extends NodeStateInterface = NodeStateInterface,
  TOutput extends string = string,
  TServices = undefined,
> {
  readonly name: string;
  readonly outputs: readonly TOutput[];
  readonly timeoutMs?: number;
  execute(state: TState, context: NodeContextInterface<TServices>): Promise<NodeOutputInterface<TOutput>>;
  destroy?(): Promise<void>;
  validate?(): ValidationResult;
}
```

The contract every consumer node implements. Nodes are stateless; they mutate state and route to a named output. They never throw — caught errors route to `'error'` (or whatever the consumer declared).

`timeoutMs` is an optional per-node wall-clock budget in milliseconds. When set, the engine derives a child `AbortController` from the run's signal and schedules an abort after `timeoutMs`. On expiry, `NodeTimeoutError` is thrown and the run is marked failed.

## ExecuteOptionsInterface

```ts
interface ExecuteOptionsInterface {
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
}
```

`Dagonizer.execute` and `Dagonizer.resume` accept this as their third argument. `SignalComposer.compose` folds the two fields into a single signal.

## ClockProvider / SchedulerProvider / SchedulerHandle

```ts
interface ClockProvider {
  hrtime(): bigint;
}

interface SchedulerProvider {
  after(delayMs: number, signal?: AbortSignal): Promise<void>;
  at(atMs: number, signal?: AbortSignal): Promise<void>;
  every(intervalMs: number, signal?: AbortSignal): AsyncIterable<void>;
  cancelAll(): void;
}

interface SchedulerHandle {
  after(delayMs: number, signal?: AbortSignal): Promise<void>;
  at(atMs: number, signal?: AbortSignal): Promise<void>;
  every(intervalMs: number, signal?: AbortSignal): AsyncIterable<void>;
  cancelAll(): void;
}
```

`SchedulerProvider` is the backend contract (implement to swap in a custom scheduler). `SchedulerHandle` is the public surface returned by `Scheduler.current()` — same shape, separate type.

Implement these to swap time sources — typically only in tests via `VirtualClockProvider` and `VirtualScheduler` from `@noocodex/dagonizer/testing`.

## StateAccessor

```ts
interface StateAccessor {
  get(state: object, path: string): unknown;
  set(state: object, path: string, value: unknown): void;
}
```

Path resolver used for fan-out source reads, fan-in writes, and sub-DAG state mapping. Default implementation: `DottedPathAccessor` in `runtime/`. Pass a custom implementation via `new Dagonizer({ accessor })`.

## CheckpointStore

```ts
interface CheckpointStore {
  save(key: string, json: string): Promise<void>;
  load(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}
```

Persistence backend for checkpoints. `Checkpoint.persist` and `Checkpoint.recall` compose the codec with the store. Reference impl: `MemoryCheckpointStore`. See [persistence](../guide/persistence.md) for a Postgres example.

## OperationContract

```ts
interface OperationContract {
  readonly name:         string;
  readonly hardRequired: readonly string[];
  readonly produces:     readonly string[];
  readonly outputs:      readonly string[];
}
```

Per-operation contract consumed by `FlowDeriver.derive` to compute DAG topology automatically. `outputs` lists every port the node can emit; every port auto-wires to the next derived stage and `FlowAnnotations.terminals` overrides individual ports. A multi-port node like `['success', 'cached', 'skipped', 'error']` routes uniformly with one contract field instead of N terminal annotations. See [contract-derived flows](../guide/derive.md).

## RetryPolicyOptionsInterface / ErrorConstructorType

```ts
type ErrorConstructorType = new (...args: never[]) => Error;

interface RetryPolicyOptionsInterface {
  readonly maxAttempts?: number;
  readonly strategy?: BackoffStrategyValue;
  readonly baseDelay?: number;
  readonly maxDelay?: number;
  readonly multiplier?: number;
  readonly jitterFactor?: number;
  readonly retryOn?: readonly ErrorConstructorType[];
  readonly abortOn?: readonly ErrorConstructorType[];
}
```

Construction options for `RetryPolicy`. `retryOn` and `abortOn` are checked via `instanceof` — supply error classes, not error names.
## Related guides

⦿ [Cancellation](../guide/cancellation) — `ExecuteOptionsInterface`
⦿ [Services](../guide/services) — `NodeInterface<TState, TOutput, TServices>`
⦿ [State accessors](../guide/state-accessor) — `StateAccessor`
⦿ [Persistence](../guide/persistence) — `CheckpointStore`
⦿ [Contract-derived flows](../guide/derive) — `OperationContract`
