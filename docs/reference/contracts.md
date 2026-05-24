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
    description: 'default implementations of the runtime contracts'
  - text: 'Reference: Checkpoint'
    link: './checkpoint'
    description: 'uses `CheckpointStore`'
  - text: 'Reference: Store'
    link: './store'
    description: '`Store`, `BaseStore`, `MemoryStore`, `StoreError`'
---

# Contracts

Adapter contracts live at the root of `src/contracts/` and ship through `@noocodex/dagonizer/contracts`. Single source of truth: never re-exported from a sibling module.

```ts
import type {
  CheckpointStore,
  ClockProvider,
  Embedder,
  ErrorConstructorType,
  ExecuteOptionsInterface,
  Instrumentation,
  NodeInterface,
  OperationContract,
  OperationContractFragment,
  RemoteStore,
  RemoteStoreEndpoint,
  RemoteStoreLease,
  RetryPolicyOptionsInterface,
  SchedulerHandle,
  SchedulerProvider,
  StateAccessor,
  Store,
  StoreSnapshot,
  StoreSnapshotEntry,
} from '@noocodex/dagonizer/contracts';
```

`Chainable` is exported from the root barrel but is not part of `./contracts`. Source: `src/contracts/NodeInterface.ts`.

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
  readonly contract?: OperationContractFragment;
  execute(state: TState, context: NodeContextInterface<TServices>): Promise<NodeOutputInterface<TOutput>>;
  destroy?(): Promise<void>;
  validate?(): ValidationResult;
}
```

The contract every consumer node implements. Nodes are stateless; they mutate state and route to a named output. They never throw: caught errors route to `'error'` (or whatever the consumer declared).

`timeoutMs` is an optional per-node wall-clock budget in milliseconds. When set, the engine derives a child `AbortController` from the run's signal and schedules an abort after `timeoutMs`. On expiry, `NodeTimeoutError` is thrown and the run is marked failed.

`contract` is an optional `OperationContractFragment`. When present, `DAGDeriver.derive({ nodes })` projects the node into a full `OperationContract` using the node's `name` and `outputs`. `Dagonizer.registerDAG` runs `ContractRegistryValidator` against all contract-bearing nodes in the DAG.

## ExecuteOptionsInterface

```ts
interface ExecuteOptionsInterface {
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
}
```

`Dagonizer.execute` and `Dagonizer.resume` accept this as their third argument. `SignalComposer.compose` folds the two fields into a single signal.

## ClockProvider

```ts
interface ClockProvider {
  hrtime(): bigint;
}
```

Backend for the `Clock` singleton. Implement to swap time sources (typically in tests via `VirtualClockProvider` from `@noocodex/dagonizer/testing`).

## SchedulerProvider / SchedulerHandle

```ts
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

`SchedulerProvider` is the backend contract (implement to swap in a custom scheduler). `SchedulerHandle` is the public surface returned by `Scheduler.current()`. Same shape, separate type.

## StateAccessor

```ts
interface StateAccessor {
  get(state: object, path: string): unknown;
  set(state: object, path: string, value: unknown): void;
}
```

Path resolver used for fan-out source reads, fan-in writes, and embedded-DAG state mapping. Default implementation: `DottedPathAccessor` in `runtime/`. Pass a custom implementation via `new Dagonizer({ accessor })`.

## Instrumentation

```ts
interface Instrumentation<TState extends NodeStateInterface = NodeStateInterface> {
  flowStart(dagName: string, state: TState): void;
  flowEnd(dagName: string, state: TState, result: ExecutionResultInterface<TState>): void;
  nodeStart(dagName: string, nodeName: string, state: TState): void;
  nodeEnd(dagName: string, nodeName: string, output: string | undefined, state: TState): void;
  phaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState): void;
  phaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState): void;
  contractWarning(message: string): void;
  error(dagName: string, nodeName: string, error: Error, state: TState): void;
}
```

Hook surface the dispatcher invokes at execution boundaries. Plugins (`@noocodex/dagonizer-tracing-otel`, custom metrics exporters) implement this to participate without subclassing `Dagonizer`.

| Hook | Fires |
|---|---|
| `flowStart` | Before the entrypoint node runs |
| `flowEnd` | After the loop drains (terminal or interrupted) |
| `nodeStart` | Before each node's `execute()` call, including placements inside parallel, fan-out, and embedded-DAG |
| `nodeEnd` | After the node's result is recorded |
| `phaseEnter` | Before a pre or post phase placement runs |
| `phaseExit` | After a pre or post phase placement runs |
| `contractWarning` | Non-fatal dangling-write warning from `ContractRegistryValidator` |
| `error` | Any thrown error the dispatcher catches |

Implementations must not throw: an exception surfacing through a hook will abort the flow. Wrap any I/O in try/catch internally. Extend `NoopInstrumentation` from `@noocodex/dagonizer/runtime` to override only the hooks you need.

## CheckpointStore

```ts
interface CheckpointStore {
  save(key: string, json: string): Promise<void>;
  load(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}
```

Persistence backend for checkpoints. `ckpt.persist(store, key)` and `Checkpoint.recall(store, key)` compose the codec with the store. Reference impl: `MemoryCheckpointStore`. See [persistence](../guide/persistence.md) for a Postgres example.

## Embedder

```ts
interface Embedder {
  readonly id: string;
  readonly displayName: string;
  readonly dimensions: number;
  embed(text: string): Promise<readonly number[]>;
  embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
  probe(): Promise<boolean>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
```

Produces a fixed-dimensionality vector for a text input. Plugins implement this (typically by extending `BaseEmbedder` from `@noocodex/dagonizer/adapter`) to swap embedding backends. The adapter cascade pattern applies: register multiple `Embedder`s, probe at runtime, pick the first available.

| Member | Description |
|---|---|
| `id` | Provider identifier (`'ollama'`, `'gemini-api'`, etc.) |
| `displayName` | Human-readable label for logs and UI |
| `dimensions` | Output vector dimensionality. Consumers verify match against pre-computed corpus embeddings |
| `embed(text)` | Embed a single text, returning a `number[]` of length `dimensions`. Throws `LlmError` on failure |
| `embedBatch(texts)` | Batch convenience. Default in `BaseEmbedder` calls `embed()` in series |
| `probe()` | Quick availability check. Must not throw; returns `false` so a cascade can route around the embedder |
| `connect()` / `disconnect()` | Per-session lifecycle hooks |

## OperationContractFragment

```ts
interface OperationContractFragment {
  readonly hardRequired: readonly string[];
  readonly produces:     readonly string[];
}
```

The deriver-only fields of an `OperationContract`. Lives on `NodeInterface.contract` so a node carries its own data-flow declaration. The node's `name` and `outputs` fields complete the full `OperationContract` surface; the fragment carries only the fields `DAGDeriver` uses to wire edges.

Use `OperationContractFragment` when co-locating the contract on a node. Use the full `OperationContract` for the standalone `contracts` array passed to `DAGDeriver.derive`.

## OperationContract

```ts
interface OperationContract extends OperationContractFragment {
  readonly name:    string;
  readonly outputs: readonly string[];
}
```

Per-operation contract consumed by `DAGDeriver.derive` to compute DAG topology automatically. Extends `OperationContractFragment` with `name` and `outputs`. `outputs` lists every port the node can emit; every port auto-wires to the next derived stage. `DAGDeriverAnnotations.terminals` overrides individual ports. A multi-port node like `['success', 'cached', 'skipped', 'error']` routes uniformly with one contract field instead of N terminal annotations.

**Co-located pattern.** Declare the contract directly on the node so the node is the single source of truth:

```ts
import type { NodeInterface, OperationContractFragment } from '@noocodex/dagonizer/contracts';

const fetchNode: NodeInterface = {
  name: 'fetch',
  outputs: ['success', 'cached', 'error'],
  contract: {
    hardRequired: ['url'],
    produces:     ['raw'],
  } satisfies OperationContractFragment,
  async execute(state, ctx) {
    // ...
    return { output: 'success' };
  },
};
```

Pass the node registry to `DAGDeriver.derive({ nodes })` instead of a separate `contracts` array. See [co-located contracts](../guide/derive.md#co-located-contracts) and [Reference: Derive](./derive).

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

Construction options for `RetryPolicy`. `retryOn` and `abortOn` are checked via `instanceof`. Supply error classes, not error names.

## Store / StoreSnapshot / StoreSnapshotEntry

The store contracts ship through `@noocodex/dagonizer/contracts` alongside the
other adapter interfaces. Full documentation (concurrency contract,
`BaseStore` authoring guide, `StoreErrorClassification` taxonomy) lives in
[Reference: Store](./store).

```ts
import type { Store, StoreSnapshot, StoreSnapshotEntry } from '@noocodex/dagonizer/contracts';
```

See [Shared state](../guide/shared-state) for the decision matrix and usage patterns.

## RemoteStore / RemoteStoreEndpoint / RemoteStoreLease

Extension of `Store` for network-backed or replicated store plugins. Implements
the same `Store` surface plus `endpoint`, `acquireLease`, `releaseLease`, and
`health` for distributed coordination.

```ts
import type { RemoteStore, RemoteStoreEndpoint, RemoteStoreLease } from '@noocodex/dagonizer/contracts';
```

See [Reference: Store](./store#interface-remotestore) for the full interface and
[Shared state](../guide/shared-state#distributed-execution--remotestore) for the authoring guide.

## Related guides

- [Cancellation](../guide/cancellation)
- [Services](../guide/services)
- [State accessors](../guide/state-accessor)
- [Persistence](../guide/persistence)
- [Contract-derived flows](../guide/derive)
- [Shared state](../guide/shared-state)
- [Observability](../guide/observability)
