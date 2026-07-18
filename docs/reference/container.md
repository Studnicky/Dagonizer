---
title: 'Container'
description: 'Container execution reference for DagContainerBase, DagHost, DagTask, DagOutcome, shutdown behavior, transport errors, and worker role binding.'
seeAlso:
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`DagContainerInterface`, `DagTaskType`, `DagOutcomeType`'
  - text: 'Reference: Channels'
    link: './channels'
    description: '`InMemoryChannel` reference'
  - text: 'Guide: Distribution and Cloud'
    link: '../guide/distribution'
    description: 'worker pool patterns and multi-backend dispatch'
  - text: 'Example 12: Worker Containers'
    link: '../examples/12-workers'
    description: 'scatter dag-body over a WorkerThreadContainer pool'
  - text: 'Example 13: Multi-Backend Roles'
    link: '../examples/13-multibackend'
    description: 'route to different containers per placement role'
---

# Container

## What It Is

Containers run embedded DAGs or scatter body DAGs outside the parent dispatcher process. A placement declares a logical container role; the host binds that role to a `DagContainerInterface`.

Use this page when worker threads, forked processes, browser workers, service workers, or remote workers should execute sub-DAG work while the parent graph remains canonical JSON-LD.

## How It Works

`DagContainerBase` owns pool lifecycle and task dispatch. `DagHost` is the isolate-side runtime that executes a registered DAG from a `DagTask`. `DagOutcome` carries success, failure, and transport-error results back to the parent while preserving the child DAG boundary, placement path, and terminal state snapshot.

Container roles are names in the DAG document; concrete worker implementations stay in host configuration.

## Diagrams, Examples, and Outputs

Container behavior is visible in the worker examples and the distribution guide:

- [Reference: Contracts](./contracts) - `DagContainerInterface`, `DagTaskType`, `DagOutcomeType`
- [Reference: Channels](./channels) - `InMemoryChannel` reference
- [Guide: Distribution and Cloud](../guide/distribution) - worker pool patterns and multi-backend dispatch
- [Example 12: Worker Containers](../examples/12-workers) - scatter dag-body over a WorkerThreadContainer pool

## What It Lets You Do

The container reference lets applications bind embedded DAGs or scatter body DAGs to isolate-backed execution roles.

DAG containment infrastructure: pool-owning base, isolate-side host runtime, and value types. Ships through `@studnicky/dagonizer/container`.

## Code Samples

The code below covers `DagContainerBase`, `DagHost`, task/outcome shapes, shutdown behavior, transport errors, and worker role binding.

### Import

```ts twoslash
import {
  DagContainerBase,
  DagHost,
  DagOutcome,
  DagTask,
  DEFAULT_SHUTDOWN_GRACE_MS,
  DAG_CONTAINER_TRANSPORT,
  DAG_CONTAINER_WORKER_DIED,
} from '@studnicky/dagonizer/container';
import type { DagContainerOptionsType, PoolEntryType, TransportErrorCode } from '@studnicky/dagonizer/container';
import type { DagOutcomeType } from '@studnicky/dagonizer/contracts';
import type { DagTaskType } from '@studnicky/dagonizer/types';
```

---

### Class: `DagContainerBase<TWorker>`

Abstract pool-owning base for running DAG sub-DAGs in isolates (worker threads, forked child processes, Web Workers). Implements `DagContainerInterface`.

```ts twoslash
import type { DagContainerInterface } from '@studnicky/dagonizer/contracts';
import { DagContainerBase } from '@studnicky/dagonizer/container';
// ---cut---
// abstract class DagContainerBase<TWorker = unknown>
//   implements DagContainerInterface
const _check: typeof DagContainerBase = DagContainerBase;
```

Subclasses supply the worker type by implementing four abstract seams. The base owns pool growth, semaphore waiting, lazy init, death detection, eviction, and graceful shutdown.

#### Constructor

```ts twoslash
import type { DagContainerOptionsType } from '@studnicky/dagonizer/container';
// ---cut---
declare function construct(options: DagContainerOptionsType): void;
```

`DagContainerOptionsType` fields:

| Field | Type | Description |
|-------|------|-------------|
| `poolSize` | `number` | Maximum number of pool entries (workers) to maintain. |
| `init` | `InitMessageShapeType` (minus `graphStateTransferFormats`, `coalesceInstrumentation`, `instrumentationPlacementPathDepth`) | Init payload forwarded to each `DagHost` on first channel use. |
| `shutdownGraceMs` | `number` | Grace period in milliseconds before a shutting-down worker is force-terminated. Pass `DEFAULT_SHUTDOWN_GRACE_MS` (2000 ms) as a baseline. |
| `graphStateTransferFormats` | `readonly GraphStateTransferFormatType[]` (optional) | Accepted graph-state transfer wire formats for this container. Defaults to `DEFAULT_GRAPH_STATE_TRANSFER_FORMATS` when omitted. |

The only negotiated content format is `application/n-quads`. Requests and
responses each carry one combined batch transfer. `GraphStateTransferType`
defines five explicit transport envelopes: `inline-nquads`, `graph-ref`,
`shared-endpoint`, `inline-delta-nquads`, and `delta-ref`. The container path
uses `inline-nquads`; store-backed transports require an injected graph-state
transfer store.

`DagContainerBase.defaultOptions` provides an ergonomic default for `shutdownGraceMs`:

```ts twoslash
import { DagContainerBase, DEFAULT_GRAPH_STATE_TRANSFER_FORMATS } from '@studnicky/dagonizer/container';
import type { DagContainerOptionsType, PoolEntryType } from '@studnicky/dagonizer/container';
import type { MessageChannelInterface } from '@studnicky/dagonizer/contracts';
// ---cut---
class MyContainer extends DagContainerBase {
  protected composeEntry(): PoolEntryType<Worker> {
    throw new Error('not implemented');
  }
  protected attachDeathListeners(_entry: PoolEntryType<Worker>): void {}
  protected terminateWorker(_worker: Worker): void {}
  protected awaitWorkerExit(_worker: Worker): Promise<void> { return Promise.resolve(); }
}

const container = new MyContainer({
  ...DagContainerBase.defaultOptions,   // provides shutdownGraceMs default
  poolSize: 4,
  init: {
    registryModule: './my-registry.js',
    registryVersion: '1.0.0',
    servicesConfig: {},
  },
  graphStateTransferFormats: [...DEFAULT_GRAPH_STATE_TRANSFER_FORMATS],
});
```

#### Abstract seams (subclass implements)

| Method | Responsibility |
|--------|---------------|
| `composeEntry(): PoolEntryType<TWorker>` | Construct worker + wired channel; `initialized: false`. |
| `attachDeathListeners(entry): void` | Wire death/exit events → `onTransportDeath(entry)`. |
| `terminateWorker(worker): void` | Force-kill the worker. Must not throw. |
| `awaitWorkerExit(worker): Promise<void>` | Resolves when the worker process/thread exits. |

#### `runDag(task, batch, options?)`

```ts twoslash
import type { Batch, NodeStateInterface } from '@studnicky/dagonizer';
import type { DagTaskType } from '@studnicky/dagonizer/types';
import type { ObserverRelayInterface } from '@studnicky/dagonizer/contracts';
import type { RunResultType } from '@studnicky/dagonizer/container';
// ---cut---
declare function runDag(
  task: DagTaskType,
  batch: Batch<NodeStateInterface>,
  options?: { readonly relay?: ObserverRelayInterface },
): Promise<RunResultType[]>;
```

Runs the non-empty item batch through one child DAG in one transport round trip
and preserves item order. A batch of one uses the same path. The container
encodes all selected input states into one request transfer, restores all
selected response states into the matching batch items, and returns one
`RunResultType` per item. The batch-level `graphState` envelope is not exposed
on any result. Transport failures and host crashes return one unrecoverable
error result per item; `runDag` does not throw.

#### `destroy()`

```ts twoslash
// async destroy(): Promise<void>
declare function destroy(): Promise<void>;
```

Gracefully shuts down all pool entries. Signals each worker to stop (shutdown message), waits up to `shutdownGraceMs`, then force-terminates any that did not exit. After `destroy()`, `runDag` returns per-item transport-error outcomes.

#### `onTransportDeath(entry, code, reason)`

```ts twoslash
import type { PoolEntryType } from '@studnicky/dagonizer/container';
// ---cut---
// protected onTransportDeath(entry: PoolEntryType<TWorker>, code: string, reason: string): void
declare function onTransportDeath<TWorker>(entry: PoolEntryType<TWorker>, code: string, reason: string): void;
```

Called by subclasses from death-listener callbacks when a worker dies unexpectedly. Marks the entry failed, evicts it from the pool, and resolves any parked `runDag` waiters with an error outcome.

---

### Class: `DagHost`

Isolate-side runtime that speaks the `BridgeMessage` protocol over a `MessageChannelInterface`. Instantiated once per isolate, receives `init` / `execute` / `abort` / `shutdown` messages.

```ts twoslash
import { DagHost } from '@studnicky/dagonizer/container';
import type { DagHostOptionsType } from '@studnicky/dagonizer/container';
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
| `execute` | Restore state; run the whole DAG by IRI; stream intermediates with placement path context; reply `result`. |
| `abort` | Fire the `AbortController` for that `correlationId`. |
| `shutdown` | Destroy registered nodes; close the channel. |

`DagHostOptionsType` carries no fields; the type exists as a future extension point.

---

### Class: `DagTask`

Value class for `DagTaskType`. Constructed by the dispatcher for each contained DAG execution.

```ts twoslash
import { DagTask } from '@studnicky/dagonizer/container';
// ---cut---
// DagTask implements DagTaskType
const _check: typeof DagTask = DagTask;
```

| Field | Type | Description |
|-------|------|-------------|
| `dagName` | `string` | Registered DAG IRI. |
| `placementPath` | `string[]` | Nesting path from the parent dispatcher, preserved across worker and remote dispatch. |
| `correlationId` | `string` | Dispatcher-monotonic id (no randomness). |
| `timeout` | `Timeout` | Execution budget (`Timeout.none()` when none applies). |
| `state` | `NodeStateInterface` | Live seeded clone for in-process paths (typed at the base contract; the concrete class may differ from the parent dispatcher's `TState`). |
| `inputState` | `TransientNodeStateSelectionType` | State selection forwarded to the child execution. |
| `responseState` | `TransientNodeStateResponseStateType` | Response-state shape the child execution reports back. |
| `context` | `NodeContextType` | Context from the parent execution. |

Constructor arguments are required positional, in the field declaration order above (V8 shape stability); every field is populated at construction, none are optional.

---

### Class: `DagOutcome`

Static factory for `DagOutcomeType` values. Used by containers to build transport-error outcomes when a DAG never ran to a terminal.

```ts twoslash
import { DagOutcome } from '@studnicky/dagonizer/container';
import type { DagOutcomeType } from '@studnicky/dagonizer/contracts';
// ---cut---
// Build a transport-error outcome (item id + correlationId required; code and message optional):
const outcome: DagOutcomeType = DagOutcome.transportError('item-1', 'corr-1');
```

`RunResultType` carries `id` plus the `DagOutcomeType` fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Input item identity used to correlate the batch result. |
| `terminalOutput` | `string` | Per-item child outcome; the host emits `completed`, `failed`, or `awaiting-input`. |
| `errors` | `readonly NodeErrorWireType[]` | Errors collected for this item only. |
| `runIri` | `string` (optional) | Restored item run IRI; absent when no host response exists. |
| `intermediates` | `readonly ExecutorIntermediateType[]` | Per-node results for this item only. |

---

### Const: `DEFAULT_SHUTDOWN_GRACE_MS`

```ts twoslash
import { DEFAULT_SHUTDOWN_GRACE_MS } from '@studnicky/dagonizer/container';
// ---cut---
const _: 2000 = DEFAULT_SHUTDOWN_GRACE_MS;
```

Default grace period in milliseconds before a shutting-down worker is force-terminated. Pass as `shutdownGraceMs` in `DagContainerOptionsType`.

---

### Container errors

Container operations throw `DAGError` with code `DAG_CONTAINER_ERROR`:

```ts twoslash
import { DAGError } from '@studnicky/dagonizer';
// ---cut---
new DAGError('container destroyed', { code: 'DAG_CONTAINER_ERROR' });
```

Thrown when a container operation fails for infrastructure reasons (pool destroyed, semaphore timeout, abort). Distinguished from domain errors by `error.code === 'DAG_CONTAINER_ERROR'`, not by class — `DAGError` is one class for every error kind. See [Reference: Errors](./errors).

---

### Class: `TransportErrorCode`

```ts twoslash
import { DAG_CONTAINER_TRANSPORT, DAG_CONTAINER_WORKER_DIED, TransportErrorCode } from '@studnicky/dagonizer/container';
// ---cut---
const isTransport: boolean = TransportErrorCode.isInfrastructureFailure(DAG_CONTAINER_TRANSPORT);
const isDied: boolean = TransportErrorCode.isInfrastructureFailure(DAG_CONTAINER_WORKER_DIED);
const isOther: boolean = TransportErrorCode.isInfrastructureFailure('domain.someError');
```

`TransportErrorCode` is a static class that groups the two transport-level error code constants and provides a membership predicate. `DAG_CONTAINER_TRANSPORT` signals a serialization or message-bus failure; `DAG_CONTAINER_WORKER_DIED` signals an unexpected isolate crash.

`TransportErrorCode.isInfrastructureFailure(code: string): boolean` — returns `true` when `code` is either `DAG_CONTAINER_TRANSPORT` or `DAG_CONTAINER_WORKER_DIED`. The scatter and embedded-DAG execution branches use this to decide whether to retry (infrastructure failure: leave scatter item un-acked) or ack (the DAG ran to a terminal and routed to its `error` output).

---

## Details for Nerds

Container transport should be boring and explicit: send a `DagTask`, receive a `DagOutcome`, and surface transport failures as container errors. Do not let worker internals leak into the parent DAG document or collapse child DAG topology into a node-level callback.

Role names are deployment configuration. A DAG can declare `container: 'cpu'` or `container: 'io'`; the host decides whether those roles map to worker threads, child processes, browser workers, or remote services.

## Related Concepts

- [Reference: Contracts](./contracts) - `DagContainerInterface`, `DagTaskType`, `DagOutcomeType`
- [Reference: Channels](./channels) - `InMemoryChannel` reference
- [Guide: Distribution and Cloud](../guide/distribution) - worker pool patterns and multi-backend dispatch
- [Example 12: Worker Containers](../examples/12-workers) - scatter dag-body over a WorkerThreadContainer pool
- [Example 13: Multi-Backend Roles](../examples/13-multibackend) - route to different containers per placement role
