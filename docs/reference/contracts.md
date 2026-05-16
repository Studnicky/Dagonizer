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
  execute(state: TState, context: NodeContextInterface<TServices>): Promise<NodeOutputInterface<TOutput>>;
  destroy?(): Promise<void>;
  validate?(): ValidationResult;
}
```

The contract every consumer node implements. Nodes are stateless; they mutate state and route to a named output. They never throw — caught errors route to `'error'` (or whatever the consumer declared).

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

interface SchedulerHandle extends SchedulerProvider {}
```

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
  readonly name: string;
  readonly hardRequired: readonly string[];
  readonly produces: readonly string[];
}
```

Per-operation contract consumed by `FlowDeriver.derive` to compute DAG topology automatically. See [contract-derived flows](../guide/derive.md).

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

## See also

- [Reference: Core](./core) — `ParallelCombiner`, `FanInStrategy` extension classes
- [Reference: Derive](./derive) — uses `OperationContract`
- [Reference: Runtime](./runtime) — default implementations of `ClockProvider`, `SchedulerProvider`, `StateAccessor`
- [Reference: Checkpoint](./checkpoint) — uses `CheckpointStore`

## Related guides

- [Cancellation](../guide/cancellation) — `ExecuteOptionsInterface`
- [Services](../guide/services) — `NodeInterface<TState, TOutput, TServices>`
- [State accessors](../guide/state-accessor) — `StateAccessor`
- [Persistence](../guide/persistence) — `CheckpointStore`
- [Contract-derived flows](../guide/derive) — `OperationContract`
