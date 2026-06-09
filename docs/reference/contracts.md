---
seeAlso:
  - text: 'Reference: Core'
    link: './core'
    description: '`GatherStrategy`, `OutcomeReducer` extension classes'
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
  // Core dispatcher contracts
  ChannelInterface,
  CheckpointStore,
  ClockProvider,
  DagContainerInterface,
  DagOutcomeInterface,
  DagTaskInterface,
  Embedder,
  ErrorConstructorType,
  ExecuteOptionsInterface,
  GatherExecution,
  GatherRecord,
  Instrumentation,
  InstrumentationSink,
  LlmAdapter,
  LlmClient,
  MessageChannelInterface,
  NodeInterface,
  NodeInvoker,
  OperationContract,
  OperationContractFragment,
  OutcomeRecord,
  RegistryBundleInterface,
  RegistryModuleInterface,
  RemoteStore,
  RemoteStoreEndpoint,
  RemoteStoreLease,
  RetryPolicyOptionsInterface,
  SchedulerHandle,
  SchedulerProvider,
  Snapshottable,
  StateAccessor,
  Store,
  StoreSnapshot,
  StoreSnapshotEntry,
  SystemInfoInterface,
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

Path resolver used for scatter source reads, state-mapping input copies, and gather writes. Default implementation: `DottedPathAccessor` in `runtime/`. Pass a custom implementation via `new Dagonizer({ accessor })`.

## Instrumentation

```ts
interface Instrumentation<TState extends NodeStateInterface = NodeStateInterface> {
  flowStart(dagName: string, state: TState): void;
  flowEnd(dagName: string, state: TState, result: ExecutionResultInterface<TState>): void;
  nodeStart(dagName: string, nodeName: string, state: TState, placementPath: readonly string[]): void;
  nodeEnd(dagName: string, nodeName: string, output: string | null, state: TState, placementPath: readonly string[]): void;
  phaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState, placementPath: readonly string[]): void;
  phaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState, placementPath: readonly string[]): void;
  contractWarning(message: string): void;
  error(dagName: string, nodeName: string, error: Error, state: TState, placementPath: readonly string[]): void;
}
```

Hook surface the dispatcher invokes at execution boundaries. Plugins (`@noocodex/dagonizer-tracing-otel`, custom metrics exporters) implement this to participate without subclassing `Dagonizer`.

| Hook | Fires |
|---|---|
| `flowStart` | Before the entrypoint node runs |
| `flowEnd` | After the loop drains (terminal or interrupted) |
| `nodeStart` | Before each node's `execute()` call, including placements inside scatter clones and embedded-DAG bodies |
| `nodeEnd` | After the node's result is recorded; `output` is `string \| null` (`null` = no route emitted) |
| `phaseEnter` | Before a pre or post phase placement runs |
| `phaseExit` | After a pre or post phase placement runs |
| `contractWarning` | Non-fatal dangling-write warning from `ContractRegistryValidator` |
| `error` | Any thrown error the dispatcher catches |

`placementPath` is the ordered array of parent embedded-DAG placement names leading to the current node. For top-level nodes it is `[]`; for a node inside an `EmbeddedDAGNode` named `'search'` it is `['search']`. The full node id is `[...placementPath, nodeName].join('/')`.

Implementations must not throw: an exception surfacing through a hook will abort the flow. Wrap any I/O in try/catch internally. Extend `NoopInstrumentation` from `@noocodex/dagonizer/runtime` to override only the hooks you need.

## Snapshottable

```ts
interface Snapshottable {
  snapshot(): Promise<StoreSnapshot>;
  restore(snapshot: StoreSnapshot): Promise<void>;
}
```

The capability checkpointing depends on. `Checkpoint.capture(dag, result, { stores })` and `ckpt.restoreStores(map)` take `Record<string, Snapshottable>`, so a non-KV backing (RDF triple store, vector index) can ride along in a checkpoint without implementing the key-value surface. `Store extends Snapshottable`. The `StoreSnapshot` / `StoreSnapshotEntry` envelopes live with it. See [Store](./store.md) for the envelope shape and `BaseStore`.

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

Use `OperationContractFragment` when co-locating the contract on a node. The deriver reads it from `node.contract` alongside `node.name` and `node.outputs` to derive the full `OperationContract`.

## OperationContract

```ts
interface OperationContract extends OperationContractFragment {
  readonly name:    string;
  readonly outputs: readonly string[];
}
```

Per-operation contract consumed by `DAGDeriver.derive` to compute DAG topology automatically. Extends `OperationContractFragment` with `name` and `outputs`. `outputs` lists every port the node can emit; every port auto-wires to the next derived stage. `DAGDeriverAnnotations.terminals` overrides individual ports. A multi-port node like `['success', 'cached', 'skipped', 'error']` routes uniformly with one contract field instead of N terminal annotations.

**Co-located pattern.** Declare the contract directly on the node so the node is the single source of truth. `DAGDeriver.derive({ nodes })` reads `node.contract` alongside `node.name` and `node.outputs`:

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

See [co-located contracts](../guide/derive.md#co-located-contracts) and [Reference: Derive](./derive).

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

## DagContainerInterface

```ts
interface DagContainerInterface<TState extends NodeStateInterface = NodeStateInterface> {
  runDag(task: DagTaskInterface<TState, unknown>): Promise<DagOutcomeInterface>;
  destroy?(): Promise<void>;
}
```

Adapter contract for running an embedded DAG in an isolate (worker thread, forked child, spawned process, Web Worker). Bound to the dispatcher via `DagonizerOptionsInterface.containers` keyed by logical role name. An unbound role falls back to in-process and fires `onContractWarning`.

`runDag` must never throw. Transport failures, host crashes, and serialization errors are returned as collected errors in `DagOutcomeInterface.errors` with `recoverable: false`. The `TServices` parameter on the task is unconstrained (`unknown`) so the interface stays decoupled from the dispatcher's services bag.

`destroy()` is optional. Implement it to release pool resources when the dispatcher shuts down.

## ChannelInterface

```ts
interface ChannelInterface {
  publish(handoff: DAGHandoff): Promise<void>;
  destroy?(): Promise<void>;
}
```

Adapter contract for publishing completed-DAG hand-off envelopes to a downstream transport (queue, message bus, or loopback store). Bound via `DagonizerOptionsInterface.channels` keyed by terminal placement name. Implementations must not throw out of the dispatcher; any internal transport error is the implementation's responsibility. `InMemoryChannel` in `@noocodex/dagonizer/channels` is the reference implementation.

## MessageChannelInterface

```ts
interface MessageChannelInterface {
  send(message: BridgeMessage): void;
  onMessage(handler: (message: BridgeMessage) => void): void;
  close(): void;
}
```

Duplex channel contract between a parent dispatcher and a `DagHost`. `send` is fire-and-forget (does not throw). `onMessage` registers the inbound handler (replaces any previous handler). `close` severs both directions; outstanding send calls are silently dropped. Implementations include `LoopbackChannel` (in-memory, for testing), `MessagePortChannel` (worker threads), `IpcChannel` (child process), and `NdjsonChannel` (stdio, polyglot hosts).

## RegistryModuleInterface / RegistryBundleInterface

```ts
interface RegistryModuleInterface {
  createBundle(servicesConfig: JsonObject): Promise<RegistryBundleInterface>;
}

interface RegistryBundleInterface {
  readonly bundle:          DispatcherBundle<NodeStateInterface, unknown>;
  readonly services:        unknown;
  readonly registryVersion: string;
  readonly restoreState:    StateRestoreFnType<NodeStateInterface>;
  destroy?():               Promise<void>;
}
```

`RegistryModuleInterface` is the default export shape of a registry module loaded by `DagHost` via dynamic import. `createBundle` receives the opaque `servicesConfig` JSON from the `init` message and returns a fully initialised `RegistryBundleInterface`.

`RegistryBundleInterface` bundles the node+DAG registry (`bundle`), the locally constructed services bag (`services`), the semantic version for the init ↔ ready handshake (`registryVersion`), and the state restore factory (`restoreState`). Services never cross the isolate boundary — each isolate constructs its own via its registry module.

## InstrumentationSink

```ts
interface InstrumentationSink {
  onInstrumentation(msg: BridgeMessage & { kind: 'instrumentation' }): void;
}
```

Adapter contract for receiving forwarded instrumentation messages inside `ChannelDispatch.request()`. `DagContainerBase` constructs one per-request and passes it to `ChannelDispatch.request()`.

## DagOutcomeInterface

```ts
interface DagOutcomeInterface {
  readonly terminalOutput: string;
  readonly errors:         readonly NodeError[];
  readonly stateSnapshot:  JsonObject | null;
  readonly intermediates:  readonly ExecutorIntermediate[];
}
```

Result returned by `DagContainerInterface.runDag()` after an embedded DAG completes in an isolate. `terminalOutput` is the routing output the child resolved to. `stateSnapshot` is the terminal child state snapshot (`null` when the container cannot produce one, e.g. transport failure); the parent calls `cloneState.applySnapshot(stateSnapshot)` when non-null. `intermediates` are per-node results forwarded to the parent execution stream.

## DagTaskInterface

```ts
interface DagTaskInterface<TState extends NodeStateInterface = NodeStateInterface, TServices = undefined> {
  readonly dagName:        string;
  readonly placementPath:  readonly string[];
  readonly correlationId:  string;
  readonly timeoutMs:      number | null;
  readonly state:          TState;
  readonly context:        NodeContextInterface<TServices>;
  toRequest(): ExecutionRequest;
}
```

Engine-side descriptor of a contained DAG execution. Carries a live seeded child clone (`state`) for the in-process path. Isolating containers call `toRequest()` to snapshot the clone into a wire-safe `ExecutionRequest`. `correlationId` is a dispatcher-monotonic id (no randomness). `timeoutMs` is `null` when no budget applies.

## SystemInfoInterface

```ts
interface SystemInfoInterface {
  recommendedWorkerCount(config: RecommendedWorkerCountConfig): number;
}
```

Host-environment probe for pool sizing recommendations. Implementations are environment-specific (Node `os.availableParallelism()` + `os.totalmem()`; Web `navigator.hardwareConcurrency`). The recommended count follows the quadrascope formula: `clamp(parallelism − mainThreadReservation, fallbackWorkerCount, maximumWorkers)`, optionally further clamped by `memoryPerWorkerBytes`.

## GatherExecution / GatherRecord / OutcomeRecord

These contracts ship through `@noocodex/dagonizer/contracts` for use by custom gather strategy and outcome reducer implementations. See [Reference: Core](./core) for the full authoring guide.

```ts
import type { GatherExecution, GatherRecord, OutcomeRecord } from '@noocodex/dagonizer/contracts';
```

`GatherRecord<TState>` carries per-clone results from the scatter loop: `index`, `item`, `output`, `terminalOutcome`, and `cloneState`. `GatherExecution<TState>` is the invocation context handed to `GatherStrategy.apply`: it provides `records`, the live parent `state`, the `accessor`, and `invokeNode` (used by the `custom` strategy). `OutcomeRecord` is the per-clone summary handed to `OutcomeReducer.reduce`: `index`, `output`, and `terminalOutcome`.

## LlmAdapter / LlmClient

```ts
interface LlmAdapter {
  readonly id:           string;
  readonly displayName:  string;
  readonly capabilities: AdapterCapabilities;
  chat(request: ChatRequest): Promise<ChatResponse>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  probe(): Promise<boolean>;
}

interface LlmClient {
  chat(request: ChatRequest): Promise<ChatResponse>;
}
```

`LlmAdapter` is the transport contract every LLM provider adapter implements. Provider packages extend `BaseAdapter` from `@noocodex/dagonizer/adapter` to inherit retry and error classification. `LlmClient` is the minimal chat surface pattern bases accept — any `LlmAdapter` satisfies it. Pattern bases that need capability metadata (e.g. tool-call support) accept the full `LlmAdapter` directly.

## Related guides

- [Cancellation](../guide/cancellation)
- [Services](../guide/services)
- [State accessors](../guide/state-accessor)
- [Persistence](../guide/persistence)
- [Contract-derived flows](../guide/derive)
- [Shared state](../guide/shared-state)
- [Observability](../guide/observability)
