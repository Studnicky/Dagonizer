---
seeAlso:
  - text: 'Reference: Core'
    link: './core'
    description: '`GatherStrategy`, `OutcomeReducer` extension classes'
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

Adapter contracts live at the root of `src/contracts/` and ship through `@studnicky/dagonizer/contracts`. Single source of truth: never re-exported from a sibling module.

```ts twoslash
import type {
  // Core dispatcher contracts
  HandoffChannelInterface,
  CheckpointStoreInterface,
  ClockProviderInterface,
  DagContainerInterface,
  EmbedderInterface,
  ErrorConstructorType,
  ExecuteOptionsType,
  GatherExecutionType,
  GatherRecordType,
  LlmAdapterInterface,
  LlmClientInterface,
  MessageChannelInterface,
  NodeInterface,
  NodeInvokerInterface,
  OutcomeRecordType,
  RegistryBundleInterface,
  RegistryModuleInterface,
  RemoteStoreInterface,
  RemoteStoreEndpointType,
  RemoteStoreLeaseType,
  RetryPolicyOptionsType,
  SchedulerProviderInterface,
  SnapshottableInterface,
  StateAccessorInterface,
  StoreInterface,
  StoreSnapshotType,
  StoreSnapshotEntryType,
  SystemInfoInterface,
} from '@studnicky/dagonizer/contracts';

// DagOutcomeType and DagTaskInterface ship through the root barrel
import type {
  DagOutcomeType,
  DagTaskInterface,
} from '@studnicky/dagonizer';
```

## NodeInterface

```ts twoslash
import type { NodeStateInterface, ValidationResultType, NodeContextType } from '@studnicky/dagonizer';
import type { Batch, RoutedBatchType } from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer/contracts';
import { Timeout } from '@studnicky/dagonizer';
// ---cut---
interface NodeInterface<
  TState extends NodeStateInterface = NodeStateInterface,
  TOutput extends string = string,
  TServices = undefined,
> {
  readonly name: string;
  readonly outputs: readonly TOutput[];
  readonly outputSchema: Record<TOutput, SchemaObjectType>;
  readonly timeout: Timeout;
  execute(batch: Batch<TState>, context: NodeContextType<TServices>): Promise<RoutedBatchType<TOutput, TState>>;
  destroy?(): Promise<void>;
  validate?(): ValidationResultType;
}
```

The contract every consumer node implements. Nodes are stateless; they mutate state and route to a named output. They never throw: caught errors route to `'error'` (or whatever the consumer declared).

`outputSchema` is a mandatory per-output-port JSON Schema 2020-12 record describing the state delta each port guarantees. Every declared output port in `outputs` must have an entry. Schemas are partial over state — they validate the fields the node writes; do not set `additionalProperties: false`. `MonadicNode` provides a passthrough default (`{ type: 'object' }` per port); concrete nodes should override with real schemas.

`timeout` is a per-node wall-clock budget expressed as a `Timeout` value (`Timeout.ofMs(n)` or `Timeout.none()`). When set to a non-none value, the engine derives a child `AbortController` from the run's signal and schedules an abort after the budget. On expiry, `NodeTimeoutError` is thrown and the run is marked failed. The `MonadicNode` base class defaults to `Timeout.none()`; nodes that do not extend it should omit the field (treated as `Timeout.none()` by the engine).

## ExecuteOptionsType

```ts twoslash
// ---cut---
interface ExecuteOptionsType {
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
}
```

`Dagonizer.execute` and `Dagonizer.resume` accept this as their third argument. `SignalComposer.compose` folds the two fields into a single signal.

## ClockProviderInterface

```ts twoslash
// ---cut---
interface ClockProviderInterface {
  hrtime(): bigint;
}
```

Backend for the `Clock` singleton. Implement to swap time sources (typically in tests via `VirtualClockProvider` from `@studnicky/dagonizer/testing`).

## SchedulerProviderInterface

```ts twoslash
import type { AbortableOptionsType } from '@studnicky/dagonizer/contracts';
// ---cut---
interface SchedulerProviderInterface {
  after(delayMs: number, options?: AbortableOptionsType): Promise<void>;
  at(atMs: number, options?: AbortableOptionsType): Promise<void>;
  every(intervalMs: number, options?: AbortableOptionsType): AsyncIterable<void>;
  cancelAll(): void;
}
```

`SchedulerProviderInterface` is the backend contract; implement it to swap in a custom scheduler. `Scheduler.current()` returns the active `SchedulerProviderInterface`. Production uses `RealTimeScheduler`; tests install `VirtualScheduler` from `@studnicky/dagonizer/testing`.

## StateAccessorInterface

```ts twoslash
// ---cut---
interface StateAccessorInterface {
  get(state: object, path: string): unknown;
  set(state: object, path: string, value: unknown): void;
}
```

Path resolver used for scatter source reads, state-mapping input copies, and gather writes. Default implementation: `DottedPathAccessor` in `runtime/`. Pass a custom implementation via `new Dagonizer({ accessor })`.

## SnapshottableInterface

```ts twoslash
import type { StoreSnapshotType } from '@studnicky/dagonizer/contracts';
// ---cut---
interface SnapshottableInterface {
  snapshot(): Promise<StoreSnapshotType>;
  restore(snapshot: StoreSnapshotType): Promise<void>;
}
```

The capability checkpointing depends on. `Checkpoint.capture(dag, result, { stores })` and `ckpt.restoreStores(map)` take `Record<string, SnapshottableInterface>`, so a non-KV backing (RDF triple store, vector index) can ride along in a checkpoint without implementing the key-value surface. `StoreInterface extends SnapshottableInterface`. The `StoreSnapshotType` / `StoreSnapshotEntryType` envelopes live with it. See [Store](./store.md) for the envelope shape and `BaseStore`.

## CheckpointStoreInterface

```ts twoslash
// ---cut---
interface CheckpointStoreInterface {
  save(key: string, json: string): Promise<void>;
  load(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}
```

Persistence backend for checkpoints. `ckpt.persist(store, key)` and `Checkpoint.recall(store, key)` compose the codec with the store. Reference impl: `MemoryCheckpointStore`. See [persistence](../guide/persistence.md) for a Postgres example.

## EmbedderInterface

```ts twoslash
// ---cut---
interface EmbedderInterface {
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

Produces a fixed-dimensionality vector for a text input. Plugins implement this (typically by extending `BaseEmbedder` from `@studnicky/dagonizer/adapter`) to swap embedding backends. The adapter cascade pattern applies: register multiple `EmbedderInterface`s, probe at runtime, pick the first available.

| Member | Description |
|---|---|
| `id` | Provider identifier (`'ollama'`, `'gemini-api'`, etc.) |
| `displayName` | Human-readable label for logs and UI |
| `dimensions` | Output vector dimensionality. Consumers verify match against pre-computed corpus embeddings |
| `embed(text)` | Embed a single text, returning a `number[]` of length `dimensions`. Throws `LlmError` on failure |
| `embedBatch(texts)` | Batch convenience. Default in `BaseEmbedder` calls `embed()` in series |
| `probe()` | Quick availability check. Must not throw; returns `false` so a cascade can route around the embedder |
| `connect()` / `disconnect()` | Per-session lifecycle hooks |

## RetryPolicyOptionsType / ErrorConstructorType

```ts twoslash
import { BackoffStrategyType } from '@studnicky/dagonizer';
// ---cut---
type ErrorConstructorType = new (...args: never[]) => Error;

interface RetryPolicyOptionsType {
  readonly maxAttempts?: number;
  readonly strategy?: BackoffStrategyType;
  readonly baseDelay?: number;
  readonly maxDelay?: number;
  readonly multiplier?: number;
  readonly jitterFactor?: number;
  readonly retryOn?: readonly ErrorConstructorType[];
  readonly abortOn?: readonly ErrorConstructorType[];
}
```

Construction options for `RetryPolicy`. `retryOn` and `abortOn` are checked via `instanceof`. Supply error classes, not error names.

## Store / StoreSnapshotType / StoreSnapshotEntryType

The store contracts ship through `@studnicky/dagonizer/contracts` alongside the
other adapter interfaces. Full documentation (concurrency contract,
`BaseStore` authoring guide, `StoreErrorClassification` taxonomy) lives in
[Reference: Store](./store).

```ts twoslash
import type { StoreInterface, StoreSnapshotType, StoreSnapshotEntryType } from '@studnicky/dagonizer/contracts';
```

See [Shared state](../guide/shared-state) for the decision matrix and usage patterns.

## RemoteStore / RemoteStoreEndpointType / RemoteStoreLeaseType

Extension of `Store` for network-backed or replicated store plugins. Implements
the same `Store` surface plus `endpoint`, `acquireLease`, `releaseLease`, and
`health` for distributed coordination.

```ts twoslash
import type { RemoteStoreInterface, RemoteStoreEndpointType, RemoteStoreLeaseType } from '@studnicky/dagonizer/contracts';
```

See [Reference: Store](./store#interface-remotestore) for the full interface and
[Shared state](../guide/shared-state#distributed-execution--remotestore) for the authoring guide.

## DagContainerInterface

```ts twoslash
import type { DagTaskInterface, DagOutcomeType } from '@studnicky/dagonizer';
import type { ObserverRelayInterface } from '@studnicky/dagonizer/contracts';
// ---cut---
interface DagContainerInterface {
  runDag(task: DagTaskInterface<unknown>, options?: { readonly relay?: ObserverRelayInterface }): Promise<DagOutcomeType>;
  destroy?(): Promise<void>;
}
```

Adapter contract for running an embedded DAG in an isolate (worker thread, forked child, spawned process, Web Worker). Bound to the dispatcher via `DagonizerOptionsType.containers` keyed by logical role name. On a dispatcher with a non-empty `containers` registry, a declared-but-unbound role throws `DAGError` at `registerDAG` time. A pure in-process dispatcher (empty `containers`) treats declared roles as inert and runs every body in-process.

`runDag` must never throw. Transport failures, host crashes, and serialization errors are returned as collected errors in `DagOutcomeType.errors` with `recoverable: false`. The `TServices` parameter on the task is unconstrained (`unknown`) so the interface stays decoupled from the dispatcher's services bag.

`destroy()` is optional. Implement it to release pool resources when the dispatcher shuts down.

## HandoffChannelInterface

```ts twoslash
import type { DAGHandoffType } from '@studnicky/dagonizer';
// ---cut---
interface HandoffChannelInterface {
  publish(handoff: DAGHandoffType): Promise<void>;
  destroy?(): Promise<void>;
}
```

Adapter contract for publishing completed-DAG hand-off envelopes to a downstream transport (queue, message bus, or loopback store). Bound via `DagonizerOptionsType.channels` keyed by terminal placement name. Implementations must not throw out of the dispatcher; any internal transport error is the implementation's responsibility. `InMemoryChannel` in `@studnicky/dagonizer/channels` is the reference implementation.

## MessageChannelInterface

```ts twoslash
import type { BridgeMessageType } from '@studnicky/dagonizer';
// ---cut---
interface MessageChannelInterface {
  send(message: BridgeMessageType): void;
  onMessage(handler: (message: BridgeMessageType) => void): void;
  close(): void;
}
```

Duplex channel contract between a parent dispatcher and a `DagHost`. `send` is fire-and-forget (does not throw). `onMessage` registers the inbound handler (replaces any previous handler). `close` severs both directions; outstanding send calls are silently dropped. Implementations include `LoopbackChannel` (in-memory, for testing), `MessagePortChannel` (worker threads), `IpcChannel` (child process), and `NdjsonChannel` (stdio, polyglot hosts).

## RegistryModuleInterface / RegistryBundleInterface

```ts twoslash
import type { CheckpointRestoreAdapterInterface } from '@studnicky/dagonizer/contracts';
import type { DispatcherBundleType, NodeStateInterface } from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';
// ---cut---
interface RegistryBundleInterface {
  readonly bundle:          DispatcherBundleType<NodeStateInterface, unknown>;
  readonly services:        unknown;
  readonly registryVersion: string;
  readonly restoreState:    CheckpointRestoreAdapterInterface<NodeStateInterface>;
  destroy?():               Promise<void>;
}

interface RegistryModuleInterface {
  instantiate(servicesConfig: JsonObjectType): Promise<RegistryBundleInterface>;
}
```

`RegistryModuleInterface` is the default export shape of a registry module loaded by `DagHost` via dynamic import. `instantiate` receives the opaque `servicesConfig` JSON from the `init` message and returns a fully initialised `RegistryBundleInterface`.

`RegistryBundleInterface` bundles the node+DAG registry (`bundle`), the locally constructed services bag (`services`), the semantic version for the init ↔ ready handshake (`registryVersion`), and the state restore factory (`restoreState`). Services never cross the isolate boundary — each isolate constructs its own via its registry module.

## DagOutcomeType

```ts twoslash
import type { NodeErrorWireType, ExecutorIntermediateType } from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';
// ---cut---
interface DagOutcomeType {
  readonly terminalOutput: string;
  readonly errors:         readonly NodeErrorWireType[];
  readonly stateSnapshot:  JsonObjectType | null;
  readonly intermediates:  readonly ExecutorIntermediateType[];
}
```

Result returned by `DagContainerInterface.runDag()` after an embedded DAG completes in an isolate. `terminalOutput` is the routing output the child resolved to. `stateSnapshot` is the terminal child state snapshot (`null` when the container cannot produce one, e.g. transport failure); the parent calls `cloneState.applySnapshot(stateSnapshot)` when non-null. `intermediates` are per-node results forwarded to the parent execution stream.

## DagTaskInterface

```ts twoslash
import type { NodeStateInterface, NodeContextType, ExecutionRequestType, Timeout } from '@studnicky/dagonizer';
// ---cut---
interface DagTaskInterface<TServices = undefined> {
  dagName:        string;
  placementPath:  string[];
  correlationId:  string;
  timeout:        Timeout;
  state:          NodeStateInterface;
  context:        NodeContextType<TServices>;
  toRequest(): ExecutionRequestType;
}
```

Engine-side descriptor of a contained DAG execution. Carries a live seeded child clone (`state`, typed at the `NodeStateInterface` contract because the engine is heterogeneous-state) for the in-process path. Isolating containers call `toRequest()` to snapshot the clone into a wire-safe `ExecutionRequest`. `correlationId` is a dispatcher-monotonic id (no randomness). `timeout` is a `Timeout`; `Timeout.none()` means no per-task budget applies.

## SystemInfoInterface

```ts twoslash
import type { RecommendedWorkerCountConfigType } from '@studnicky/dagonizer';
// ---cut---
interface SystemInfoInterface {
  recommendedWorkerCount(config: RecommendedWorkerCountConfigType): number;
}
```

Host-environment probe for pool sizing recommendations. Implementations are environment-specific (Node `os.availableParallelism()` + `os.totalmem()`; Web `navigator.hardwareConcurrency`). The recommended count follows the quadrascope formula: `clamp(parallelism − mainThreadReservation, fallbackWorkerCount, maximumWorkers)`, optionally further clamped by `memoryPerWorkerBytes`.

## GatherExecutionType / GatherRecordType / OutcomeRecordType

These contracts ship through `@studnicky/dagonizer/contracts` for use by custom gather strategy and outcome reducer implementations. See [Reference: Core](./core) for the full authoring guide.

```ts twoslash
import type { GatherExecutionType, GatherRecordType, OutcomeRecordType } from '@studnicky/dagonizer/contracts';
```

`GatherRecordType<TState>` carries per-clone results from the scatter loop: `index`, `item`, `output`, `terminalOutcome`, and `cloneState`. `GatherExecutionType<TState>` is the invocation context handed to `GatherStrategy.apply`: it provides `records`, the live parent `state`, the `accessor`, and `invoker` (a `NodeInvoker`; used by the `custom` strategy via `invoker.invokeNode(name)`). `OutcomeRecordType` is the per-clone summary handed to `OutcomeReducer.reduce`: `index`, `output`, and `terminalOutcome`.

## LlmAdapterInterface / LlmClientInterface

```ts twoslash
import type { AdapterCapabilitiesType, ChatRequestType, ChatResponseType } from '@studnicky/dagonizer/adapter';
// ---cut---
interface LlmAdapterInterface {
  readonly id:           string;
  readonly displayName:  string;
  readonly capabilities: AdapterCapabilitiesType;
  chat(request: ChatRequestType): Promise<ChatResponseType>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  probe(): Promise<boolean>;
}

interface LlmClientInterface {
  chat(request: ChatRequestType): Promise<ChatResponseType>;
}
```

`LlmAdapterInterface` is the transport contract every LLM provider adapter implements. Provider packages extend `BaseAdapter` from `@studnicky/dagonizer/adapter` to inherit retry and error classification. `LlmClientInterface` is the minimal chat surface pattern bases accept — any `LlmAdapterInterface` satisfies it. Pattern bases that need capability metadata (e.g. tool-call support) accept the full `LlmAdapterInterface` directly.

## NodeInvokerInterface

```ts twoslash
// ---cut---
interface NodeInvokerInterface {
  invokeNode(nodeName: string): Promise<void>;
}
```

Typed contract for dispatching a registered node back through the engine. Lives on `GatherExecutionType.invoker`; used exclusively by `custom` gather strategies to invoke the registered node named in `GatherConfig.customNode`. Custom strategies access it via `execution.invoker.invokeNode(name)`.

## Related guides

- [Cancellation](../guide/cancellation)
- [Services](../guide/services)
- [State accessors](../guide/state-accessor)
- [Persistence](../guide/persistence)
- [Shared state](../guide/shared-state)
- [Observability](../guide/observability)
