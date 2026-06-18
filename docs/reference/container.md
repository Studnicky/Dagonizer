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

DAG containment infrastructure: pool-owning base, isolate-side host runtime, and value types. Ships through `@studnicky/dagonizer/container`.

```ts twoslash
import {
  DagContainerBase,
  DagContainerError,
  DagHost,
  DagOutcome,
  DagTask,
  DEFAULT_SHUTDOWN_GRACE_MS,
  DAG_CONTAINER_TRANSPORT,
  DAG_CONTAINER_WORKER_DIED,
} from '@studnicky/dagonizer/container';
import type { DagContainerOptions, PoolEntry, TransportErrorCode } from '@studnicky/dagonizer/container';
import type {
  DagOutcomeInterface,
  DagTaskInterface,
} from '@studnicky/dagonizer/contracts';
```

---

## Class: `DagContainerBase<TState, TWorker>`

Abstract pool-owning base for running DAG sub-DAGs in isolates (worker threads, forked child processes, Web Workers). Implements `DagContainerInterface`.

```ts twoslash
import type { DagContainerInterface } from '@studnicky/dagonizer/contracts';
import type { NodeStateInterface } from '@studnicky/dagonizer';
import { DagContainerBase } from '@studnicky/dagonizer/container';
// ---cut---
// abstract class DagContainerBase<
//   TState extends NodeStateInterface = NodeStateInterface,
//   TWorker = unknown,
// > implements DagContainerInterface<TState>
const _check: typeof DagContainerBase = DagContainerBase;
```

Subclasses supply the worker type by implementing four abstract seams. The base owns pool growth, semaphore waiting, lazy init, death detection, eviction, and graceful shutdown.

### Constructor

```ts twoslash
import type { DagContainerOptions } from '@studnicky/dagonizer/container';
// ---cut---
declare function construct(options: DagContainerOptions): void;
```

`DagContainerOptions` fields:

| Field | Type | Description |
|-------|------|-------------|
| `poolSize` | `number` | Maximum number of pool entries (workers) to maintain. |
| `init` | `InitMessageShape` | Init payload forwarded to each `DagHost` on first channel use. |
| `shutdownGraceMs` | `number` | Grace period in milliseconds before a shutting-down worker is force-terminated. Pass `DEFAULT_SHUTDOWN_GRACE_MS` (2000 ms) as a baseline. |

`DagContainerBase.defaultOptions` provides an ergonomic default for `shutdownGraceMs`:

```ts twoslash
import { DagContainerBase } from '@studnicky/dagonizer/container';
import type { DagContainerOptions, PoolEntry } from '@studnicky/dagonizer/container';
import type { MessageChannelInterface } from '@studnicky/dagonizer/contracts';
// ---cut---
class MyContainer extends DagContainerBase {
  protected composeEntry(): PoolEntry<Worker> {
    throw new Error('not implemented');
  }
  protected attachDeathListeners(_entry: PoolEntry<Worker>): void {}
  protected terminateWorker(_worker: Worker): void {}
  protected awaitWorkerExit(_worker: Worker): Promise<void> { return Promise.resolve(); }
}

const container = new MyContainer({
  ...DagContainerBase.defaultOptions,   // provides shutdownGraceMs default
  poolSize: 4,
  init: { registryModule: './my-registry.js', registryVersion: '1.0.0', servicesConfig: {} },
});
```

### Abstract seams (subclass implements)

| Method | Responsibility |
|--------|---------------|
| `composeEntry(): PoolEntry<TWorker>` | Construct worker + wired channel; `initialized: false`. |
| `attachDeathListeners(entry): void` | Wire death/exit events → `onTransportDeath(entry)`. |
| `terminateWorker(worker): void` | Force-kill the worker. Must not throw. |
| `awaitWorkerExit(worker): Promise<void>` | Resolves when the worker process/thread exits. |

### `runDag(task)`

```ts twoslash
import type { DagTaskInterface, DagOutcomeInterface } from '@studnicky/dagonizer/contracts';
import type { NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
declare function runDag(task: DagTaskInterface<NodeStateInterface, unknown>): Promise<DagOutcomeInterface>;
```

Acquired a pool slot, sends the task to the isolate, and waits for the outcome. Must not throw: transport failures and host crashes return collected errors in `DagOutcomeInterface.errors` with `recoverable: false`.

### `destroy()`

```ts twoslash
// async destroy(): Promise<void>
declare function destroy(): Promise<void>;
```

Gracefully shuts down all pool entries. Signals each worker to stop (shutdown message), waits up to `shutdownGraceMs`, then force-terminates any that did not exit. After `destroy()`, `runDag` throws `DagContainerError`.

### `onTransportDeath(entry, code, reason)`

```ts twoslash
import type { PoolEntry } from '@studnicky/dagonizer/container';
// ---cut---
// protected onTransportDeath(entry: PoolEntry<TWorker>, code: string, reason: string): void
declare function onTransportDeath<TWorker>(entry: PoolEntry<TWorker>, code: string, reason: string): void;
```

Called by subclasses from death-listener callbacks when a worker dies unexpectedly. Marks the entry failed, evicts it from the pool, and resolves any parked `runDag` waiters with an error outcome.

---

## Class: `DagHost`

Isolate-side runtime that speaks the `BridgeMessage` protocol over a `MessageChannelInterface`. Instantiated once per isolate, receives `init` / `execute` / `abort` / `shutdown` messages.

```ts twoslash
import { DagHost } from '@studnicky/dagonizer/container';
import type { DagHostOptions } from '@studnicky/dagonizer/container';
import type { MessageChannelInterface } from '@studnicky/dagonizer/contracts';
// ---cut---
declare const channel: MessageChannelInterface;
const host = new DagHost(channel);
host.start();
```

`start()` subscribes to inbound messages. Lifecycle:

| Message | Action |
|---------|--------|
| `init` | Dynamic-import the registry module; call `instantiate`; reply `ready`. |
| `execute` | Restore state; run the whole DAG; stream intermediates; reply `result`. |
| `abort` | Fire the `AbortController` for that `correlationId`. |
| `shutdown` | Destroy registered nodes; close the channel. |

`DagHostOptions` carries no fields; the type exists as a future extension point.

---

## Class: `DagTask`

Value class for `DagTaskInterface`. Constructed by the dispatcher for each contained DAG execution.

```ts twoslash
import { DagTask } from '@studnicky/dagonizer/container';
import type { NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
// DagTask<TState extends NodeStateInterface, TServices = undefined>
//   implements DagTaskInterface<TState, TServices>
const _check: typeof DagTask = DagTask;
```

| Field | Type | Description |
|-------|------|-------------|
| `dagName` | `string` | Registered DAG name. |
| `placementPath` | `string[]` | Nesting path from the parent dispatcher. |
| `correlationId` | `string` | Dispatcher-monotonic id (no randomness). |
| `timeout` | `Timeout` | Execution budget (`Timeout.none()` when none applies). |
| `state` | `TState` | Live seeded clone for in-process paths. |
| `context` | `NodeContextInterface<TServices>` | Context from the parent execution. |

`toRequest()` snapshots the clone into a wire-safe `ExecutionRequest` for cross-boundary transports.

---

## Class: `DagOutcome`

Static factory for `DagOutcomeInterface` values. Used by containers to build transport-error outcomes when a DAG never ran to a terminal.

```ts twoslash
import { DagOutcome } from '@studnicky/dagonizer/container';
import type { DagOutcomeInterface } from '@studnicky/dagonizer/contracts';
// ---cut---
// Build a transport-error outcome (correlationId required; code and message optional):
const outcome: DagOutcomeInterface = DagOutcome.transportError('corr-1');
```

`DagOutcomeInterface` fields:

| Field | Type | Description |
|-------|------|-------------|
| `terminalOutput` | `string` | Routing output the child resolved to. |
| `errors` | `readonly NodeError[]` | Collected errors from the child run. |
| `stateSnapshot` | `JsonObject \| null` | Terminal child state snapshot (`null` on transport failure). |
| `intermediates` | `readonly ExecutorIntermediate[]` | Per-node results forwarded to the parent stream. |

---

## Const: `DEFAULT_SHUTDOWN_GRACE_MS`

```ts twoslash
import { DEFAULT_SHUTDOWN_GRACE_MS } from '@studnicky/dagonizer/container';
// ---cut---
const _: 2000 = DEFAULT_SHUTDOWN_GRACE_MS;
```

Default grace period in milliseconds before a shutting-down worker is force-terminated. Pass as `shutdownGraceMs` in `DagContainerOptions`.

---

## Class: `DagContainerError`

```ts twoslash
import { DagContainerError } from '@studnicky/dagonizer/container';
import { DAGError } from '@studnicky/dagonizer';
// ---cut---
const _isSubclass: boolean = DagContainerError.prototype instanceof DAGError;
```

Thrown when a container operation fails for infrastructure reasons (pool destroyed, semaphore timeout). Distinguished from domain errors by its class; `instanceof DagContainerError` is the guard.

---

## Enum: `TransportErrorCode`

```ts twoslash
import { DAG_CONTAINER_TRANSPORT, DAG_CONTAINER_WORKER_DIED } from '@studnicky/dagonizer/container';
import type { TransportErrorCode } from '@studnicky/dagonizer/container';
// ---cut---
const _transport: TransportErrorCode = DAG_CONTAINER_TRANSPORT;
const _died: TransportErrorCode = DAG_CONTAINER_WORKER_DIED;
```

`TransportErrorCode` groups the two transport-level error codes. `DAG_CONTAINER_TRANSPORT` signals a serialization or message-bus failure; `DAG_CONTAINER_WORKER_DIED` signals an unexpected isolate crash.

---

## Related guides

- [Distribution and cloud](../guide/distribution)
- [Example 12: Worker containers](../examples/12-workers)
- [Example 13: Multi-backend dispatch](../examples/13-multibackend)
- [Reference: Contracts](./contracts) — `DagContainerInterface`, `DagTaskInterface`, `DagOutcomeInterface`, `MessageChannelInterface` (canonical import: `@studnicky/dagonizer/contracts`)
- [Reference: Channels](./channels) — `InMemoryChannel`
