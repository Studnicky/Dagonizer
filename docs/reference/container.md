---
seeAlso:
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`DagContainerInterface`, `DagTaskInterface`, `DagOutcomeInterface`'
  - text: 'Reference: Channels'
    link: './channels'
    description: '`InMemoryChannel` reference'
  - text: 'Guide: Distribution and cloud'
    link: '../guide/distribution'
    description: 'worker pool patterns and multi-backend dispatch'
  - text: 'Example 12: Worker containers'
    link: '../examples/12-workers'
    description: 'scatter dag-body over a WorkerThreadContainer pool'
  - text: 'Example 13: Multi-backend dispatch'
    link: '../examples/13-multibackend'
    description: 'route to different containers per placement role'
---

# Container

DAG containment infrastructure: pool-owning base, isolate-side host runtime, value types, and instrumentation forwarding. Ships through `@noocodex/dagonizer/container`.

```ts
import {
  DagContainerBase,
  DagContainerError,
  DagContainerOptions,
  DagHost,
  DagOutcome,
  DagTask,
  DEFAULT_SHUTDOWN_GRACE_MS,
  ForwardingInstrumentation,
  TransportErrorCode,
  DAG_CONTAINER_TRANSPORT,
  DAG_CONTAINER_WORKER_DIED,
} from '@noocodex/dagonizer/container';
import type {
  DagOutcomeInterface,
  DagTaskInterface,
  InstrumentationSink,
  PoolEntry,
} from '@noocodex/dagonizer/container';
```

---

## Class: `DagContainerBase<TState, TWorker>`

Abstract pool-owning base for running DAG sub-DAGs in isolates (worker threads, forked child processes, Web Workers). Implements `DagContainerInterface`.

```ts
abstract class DagContainerBase<
  TState extends NodeStateInterface = NodeStateInterface,
  TWorker = unknown,
> implements DagContainerInterface<TState>
```

Subclasses supply the worker type by implementing four abstract seams. The base owns pool growth, semaphore waiting, lazy init, death detection, eviction, and graceful shutdown.

### Constructor

```ts
constructor(options: DagContainerOptions<TState>)
```

`DagContainerOptions<TState>` fields:

| Field | Type | Description |
|-------|------|-------------|
| `instrumentation` | `Instrumentation<TState>` | Observability sink. Pass `new NoopInstrumentation()` to suppress. |
| `poolSize` | `number` | Maximum number of pool entries (workers) to maintain. |
| `init` | `InitMessageShape` | Init payload forwarded to each `DagHost` on first channel use. |
| `shutdownGraceMs` | `number` | Grace period in milliseconds before a shutting-down worker is force-terminated. Pass `DEFAULT_SHUTDOWN_GRACE_MS` (2000 ms) as a baseline. |

`DagContainerBase.defaultOptions` provides ergonomic defaults for `instrumentation` and `shutdownGraceMs`:

```ts
const container = new MyContainer({
  ...DagContainerBase.defaultOptions,
  poolSize: 4,
  init: { registryModule: './my-registry.js', servicesConfig: {} },
});
```

### Abstract seams (subclass implements)

| Method | Responsibility |
|--------|---------------|
| `createEntry(): PoolEntry<TWorker>` | Construct worker + wired channel; `initialized: false`. |
| `attachDeathListeners(entry): void` | Wire death/exit events → `onTransportDeath(entry)`. |
| `terminateWorker(worker): void` | Force-kill the worker. Must not throw. |
| `awaitWorkerExit(worker): Promise<void>` | Resolves when the worker process/thread exits. |

### `runDag(task)`

```ts
async runDag(task: DagTaskInterface<TState, unknown>): Promise<DagOutcomeInterface>
```

Acquired a pool slot, sends the task to the isolate, and waits for the outcome. Must not throw: transport failures and host crashes return collected errors in `DagOutcomeInterface.errors` with `recoverable: false`.

### `destroy()`

```ts
async destroy(): Promise<void>
```

Gracefully shuts down all pool entries. Signals each worker to stop (shutdown message), waits up to `shutdownGraceMs`, then force-terminates any that did not exit. After `destroy()`, `runDag` throws `DagContainerError`.

### `onTransportDeath(entry)`

```ts
protected onTransportDeath(entry: PoolEntry<TWorker>): void
```

Called by subclasses from death-listener callbacks when a worker dies unexpectedly. Marks the entry failed, evicts it from the pool, and resolves any parked `runDag` waiters with an error outcome.

---

## Class: `DagHost`

Isolate-side runtime that speaks the `BridgeMessage` protocol over a `MessageChannelInterface`. Instantiated once per isolate, receives `init` / `execute` / `abort` / `shutdown` messages.

```ts
class DagHost {
  constructor(channel: MessageChannelInterface, options?: DagHostOptions)
  start(): void
}
```

`start()` subscribes to inbound messages. Lifecycle:

| Message | Action |
|---------|--------|
| `init` | Dynamic-import the registry module; call `createBundle`; reply `ready`. |
| `execute` | Restore state; run the whole DAG; stream intermediates; reply `result`. |
| `abort` | Fire the `AbortController` for that `correlationId`. |
| `shutdown` | Destroy registered nodes; close the channel. |

`DagHostOptions` carries no fields; the type exists as a future extension point.

---

## Class: `DagTask`

Value class for `DagTaskInterface`. Constructed by the dispatcher for each contained DAG execution.

```ts
class DagTask<TState extends NodeStateInterface, TServices = undefined>
  implements DagTaskInterface<TState, TServices>
```

| Field | Type | Description |
|-------|------|-------------|
| `dagName` | `string` | Registered DAG name. |
| `placementPath` | `readonly string[]` | Nesting path from the parent dispatcher. |
| `correlationId` | `string` | Dispatcher-monotonic id (no randomness). |
| `timeoutMs` | `number \| null` | Execution budget, or `null` when none applies. |
| `state` | `TState` | Live seeded clone for in-process paths. |
| `context` | `NodeContextInterface<TServices>` | Context from the parent execution. |

`toRequest()` snapshots the clone into a wire-safe `ExecutionRequest` for cross-boundary transports.

---

## Class: `DagOutcome`

Value class for `DagOutcomeInterface`. Returned by `DagContainerBase.runDag`.

```ts
class DagOutcome implements DagOutcomeInterface
```

| Field | Type | Description |
|-------|------|-------------|
| `terminalOutput` | `string` | Routing output the child resolved to. |
| `errors` | `readonly NodeError[]` | Collected errors from the child run. |
| `stateSnapshot` | `JsonObject \| null` | Terminal child state snapshot (`null` on transport failure). |
| `intermediates` | `readonly ExecutorIntermediate[]` | Per-node results forwarded to the parent stream. |

---

## Class: `ForwardingInstrumentation<TState>`

`Instrumentation` implementation that forwards hook invocations as `instrumentation` `BridgeMessage`s over a channel. Used inside `DagHost` to relay observability back to the parent dispatcher.

```ts
class ForwardingInstrumentation<TState extends NodeStateInterface = NodeStateInterface>
  implements Instrumentation<TState>

constructor(channel: MessageChannelInterface, correlationId: string, basePath: readonly string[])
```

`basePath` is prepended to every forwarded `placementPath` so instrumentation from the body DAG carries the full composite path. `flowStart` and `flowEnd` are suppressed (the parent dispatcher owns flow-level hooks).

---

## Const: `DEFAULT_SHUTDOWN_GRACE_MS`

```ts
const DEFAULT_SHUTDOWN_GRACE_MS: 2000
```

Default grace period in milliseconds before a shutting-down worker is force-terminated. Pass as `shutdownGraceMs` in `DagContainerOptions`.

---

## Class: `DagContainerError`

```ts
class DagContainerError extends DAGError
```

Thrown when a container operation fails for infrastructure reasons (pool destroyed, semaphore timeout). Distinguished from domain errors by its class; `instanceof DagContainerError` is the guard.

---

## Enum: `TransportErrorCode`

```ts
const DAG_CONTAINER_TRANSPORT:   'DAG_CONTAINER_TRANSPORT';
const DAG_CONTAINER_WORKER_DIED: 'DAG_CONTAINER_WORKER_DIED';
```

`TransportErrorCode` groups the two transport-level error codes. `DAG_CONTAINER_TRANSPORT` signals a serialization or message-bus failure; `DAG_CONTAINER_WORKER_DIED` signals an unexpected isolate crash.

---

## Related guides

- [Distribution and cloud](../guide/distribution)
- [Example 12: Worker containers](../examples/12-workers)
- [Example 13: Multi-backend dispatch](../examples/13-multibackend)
- [Reference: Contracts](./contracts) — `DagContainerInterface`, `DagTaskInterface`, `DagOutcomeInterface`, `MessageChannelInterface`
- [Reference: Channels](./channels) — `InMemoryChannel`
