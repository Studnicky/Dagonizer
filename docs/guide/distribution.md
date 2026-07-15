---
title: 'Distribution and Cloud'
description: 'How to scale a Dagonizer deployment across threads, processes, and hosts using DagContainerInterface backends and DAGHandoff channels.'
seeAlso:
  - text: 'Architecture'
    link: '../architecture'
    description: 'execution model, container seam, hand-off binding'
  - text: 'Example 11: Operator Hand-Off'
    link: '../examples/11-handoff'
    description: 'two DAGs chained via InMemoryChannel'
  - text: 'Example 12: Worker Containers'
    link: '../examples/12-workers'
    description: 'scatter-dag-body over a WorkerThreadContainer pool'
  - text: 'Reference: Contracts'
    link: '../reference/contracts'
    description: 'DagContainerInterface, HandoffChannelInterface, RegistryModuleInterface'
---

<script setup lang="ts">
import { cartographerWorkersDAG, streamEventDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Distribution and Cloud

## What It Is

Distribution is how a Dagonizer host moves work across threads, processes, workers, or other hosts without changing the DAG document. The graph still names placements and routes; deployment code binds logical container roles and handoff channels to concrete infrastructure.

There are two scales: in-fleet containment for worker-style isolation, and cross-host handoff for envelope-driven resume on another host.

## How It Works

Distribution is placement-level. A scatter or embedded DAG declares a logical container role, and the host binds that role to a `DagContainerInterface`. Cross-host hand-off serializes state plus cursor into a `DAGHandoff` envelope and lets another host resume the registered DAG.

Dagonizer has two distribution scales. They solve different problems and compose independently.

| Scale | Mechanism | Compute ownership |
|-------|-----------|-------------------|
| **In-fleet containment** | `DagContainerInterface` backends (threads, child processes) | The dispatcher spawns and owns the isolates |
| **Cross-host hand-off** | `DAGHandoff` envelope over a `HandoffChannelInterface` | The envelope travels to a separate host; that host runs the next DAG |

The DAG is always the unit of distribution. A single node never travels to a container or a remote host.

## Diagrams, Examples, and Outputs

The Cartographer worker example shows a parent DAG delegating scatter body work to a worker-bound sub-DAG. Both diagrams below are generated from the runnable worker example:

<DagJsonMermaid :dag="cartographerWorkersDAG" title="Cartographer worker parent DAG" aria-label="Cartographer worker parent JSON-LD DAG beside Mermaid generated from it." />

<DagJsonMermaid :dag="streamEventDAG" title="stream-event worker body DAG" aria-label="Stream-event worker body JSON-LD DAG beside Mermaid generated from it." />

- [Architecture](../architecture) - execution model, container seam, hand-off binding
- [Example 11: Operator Hand-Off](../examples/11-handoff) - two DAGs chained via InMemoryChannel
- [Example 12: Worker Containers](../examples/12-workers) - scatter-dag-body over a WorkerThreadContainer pool
- [Reference: Contracts](../reference/contracts) - DagContainerInterface, HandoffChannelInterface, RegistryModuleInterface

## What It Lets You Do

### Use when

Use distribution when one DAG needs to run across threads, worker processes, or separate hosts without changing the canonical JSON-LD graph. Choose containment for in-fleet isolation; choose hand-off when state and cursor must cross a transport boundary.

## Code Samples

The snippets below show container role binding, registry-module loading, and cross-host handoff envelopes.

## Details for Nerds

### In-fleet containment

An `EmbeddedDAGNode` or `ScatterNode` (dag body) placement declares a logical container role:

<<< @/../examples/dags/12-workers.ts#parent-dag

The deployment binds the logical role to a backend at dispatcher construction:

<<< @/../examples/12-workers.ts#dispatcher

When the dispatcher reaches the `enrich` placement, it delegates the sub-DAG to the `cpu` backend. The child state crosses as a JSON snapshot; the worker runs the sub-DAG to completion; the terminal snapshot is applied in place. The DAG document and node code are identical in both paths. An unbound role runs in-process and fires `contractWarning` so the DAG still runs and the condition is visible.

#### Available Node.js backends

All four backends are in `@studnicky/dagonizer-executor-node`:

| Backend | Transport | When to use |
|---------|-----------|-------------|
| `WorkerThreadContainer` | `MessagePort` (shared memory) | CPU-bound work; fastest startup |
| `ForkContainer` | IPC pipe | Isolated V8 heap per request; Node stdlib available |
| `ClusterContainer` | IPC pipe | Reuse a pre-forked cluster worker pool |
| `SpawnContainer` | NDJSON over stdio | Polyglot isolates; any executable that speaks the wire protocol |

The browser package `@studnicky/dagonizer-executor-web` ships `WebWorkerContainer` over `postMessage`.

#### Pool sizing

`NodeSystemInfo.recommendedWorkerCount(config)` returns a cgroup-aware default based on `os.availableParallelism()` and available memory. Spread `RecommendedWorkerCountConfigDefault` and override only the fields you want to set:

<<< @/../examples/12-workers.ts#pool-sizing

#### The registry module contract

Cross-process containers (fork, cluster, spawn, worker) dynamic-import a registry module inside the isolate to reconstruct the DAG bundle and services without crossing the boundary. The module's default export implements `RegistryModuleInterface`:

<<< @/../examples/dags/12-workers.registry.ts#registry

`registryVersion` must match the string the parent passed to `WorkerThreadContainer` (or the equivalent backend). The `DagHost` inside the worker rejects an `init` message with a mismatched version before accepting any `execute` requests.

A node's dependencies never cross the isolation boundary — the isolate's registry module constructs each node with its dependencies (derived from the init message's `servicesConfig`) inside the isolate. If an isolate requires a network connection, it opens it locally; the parent does not proxy requests.

::: warning Trust boundary
The `registryModule` path passed to a container backend is dynamically imported inside the isolate with full module privileges. Pass only operator-controlled paths. Accepting a `registryModule` value from untrusted input (user data, external queue messages) creates a remote code execution vector.
:::

---

### Cross-host hand-off

When a top-level DAG completes at a terminal placement bound to a `HandoffChannelInterface`, the dispatcher publishes a `DAGHandoff` envelope to that channel. The envelope carries:

- `dagName` — the DAG IRI/CURIE string that just completed
- `terminalName` — the terminal placement label for observability
- `terminalOutput` — the routing output string
- `graphState` — terminal graph-state transfer selected by the negotiated transport strategy
- `registryVersion` — version the receiving host uses for its handshake
- `correlationId` — monotonic dispatcher-assigned identifier for deduplication
- `placementPath` — nesting path for instrumentation

Subclass `InMemoryChannel` and override the protected `onPublished` hook to chain a downstream DAG. `InMemoryChannel` carries no constructor options; passing a callback object is not supported — extension via subclass is the only mechanism. The `11-handoff` example does exactly this: the override restores the envelope state and runs DAG B on a second dispatcher.

<<< @/../examples/11-handoff.ts#channel

The dispatcher binds the channel to a terminal name; reaching that terminal publishes a `DAGHandoff` envelope to it:

<<< @/../examples/11-handoff.ts#dag-a-dispatcher

A terminal not listed in `channels` follows today's behavior — the run completes, no envelope is published. Embedded and contained child DAGs never publish; only the top-level host does. Run the full producer → channel → downstream-host chain with `npx tsx examples/11-handoff.ts`.

A publish failure collects a `HANDOFF_PUBLISH_FAILED` error on the run's state; the returned `ExecutionResult` and `terminalOutcome` are unchanged.

#### Serverless function handler pattern

A serverless function receives a `DAGHandoff` envelope, restores state, runs the DAG to completion, and lets the bound egress channels publish the next envelope. The function itself requires no Dagonizer-specific runtime; it is a plain `Dagonizer` instance.

The egress channel implements `HandoffChannelInterface`. The channel below backs the contract with a real in-process queue — a complete, runnable implementation. Production replaces the array push with an SQS / Pub/Sub / RabbitMQ SDK call; the method signature is identical:

<<< @/../examples/dags/serverless-handler.ts#queue-channel

The handler is envelope-in / envelope-out: verify the version, restore state, build a per-invocation dispatcher with egress channels bound to terminal names, execute:

<<< @/../examples/dags/serverless-handler.ts#handler

This pattern composes with any function-as-a-service platform (AWS Lambda, Cloud Run, Cloudflare Worker). The `serverless-handler` example drives a complete envelope through the handler and observes the downstream envelope land in the queue; run it with `npx tsx examples/serverless-handler.ts`. The dispatcher is constructed, used, and discarded per invocation. There is no persistent scheduler, no long-lived worker, and no agent protocol — Dagonizer is the in-function runtime.

#### External orchestrators (Step Functions, Cloud Workflows, etc.)

When the deployment uses an external state machine (AWS Step Functions, Google Cloud Workflows, Azure Durable Functions), each state maps to one function invocation. The function is envelope-in / envelope-out:

```
[State machine]
   │
   ├─ InvokeA → handler(envelopeA) → channel.publish(envelopeB)
   ├─ InvokeB → handler(envelopeB) → channel.publish(envelopeC)
   └─ InvokeC → handler(envelopeC) → done
```

Dagonizer never compiles a DAG to ASL or workflow YAML. Dagonizer never invokes or manages state machine instances. The state machine is authored by the deployment; Dagonizer is the in-function executor that processes each step's envelope and publishes the next. The boundary is explicit: the orchestrator owns transitions; Dagonizer owns node execution within each step.

#### `registryVersion` handshake

The `registryVersion` field on `DAGHandoff` carries the same guarantee as the bridge protocol used by containers: a receiving host that detects a version mismatch should reject the envelope before executing. This prevents a host running a stale bundle from applying state from a newer bundle's run.

Recommended pattern:
- Publish `registryVersion` from a single constant in the bundle (e.g. `package.json` version or a content hash of the DAG registry).
- Validate on ingress before calling `AppState.restore`.
- On mismatch: route to a DLQ or a manual-review queue, not a silent drop.

#### Idempotent node authoring

Exactly-once delivery is out of scope for Dagonizer's channel contract. At-least-once is the documented delivery guarantee for most queue transports. Node authors are responsible for writing idempotent side effects:

- Upsert records rather than insert-and-fail on duplicate.
- Check for prior completion in state before calling an external API.
- Use `correlationId` from the envelope as an idempotency key when the downstream API supports one.

Dagonizer guarantees graph-envelope fidelity and `correlationId` uniqueness within a dispatcher instance. Delivery semantics above that are a property of the channel transport and the deployment.

#### Trust boundaries

**Graph references.** When a negotiated graph-reference strategy is selected, the receiver fetches the N-Quads graph through the configured graph transfer adapter. The receiver owns endpoint authorization and allowlist responsibility.

**Incoming state from workers.** Graph-state transfers are validated by the graph codec and identity checks before import. Domain accessors still validate values at their application boundary.

---

### Further reading

- [`examples/11-handoff.ts`](../../examples/11-handoff.ts) — two DAGs chained via an in-process loopback channel; companion doc at [`docs/examples/11-handoff.md`](../examples/11-handoff)
- [`examples/12-workers.ts`](../../examples/12-workers.ts) — scatter-dag-body over a real `WorkerThreadContainer` pool with a registry module; companion doc at [`docs/examples/12-workers.md`](../examples/12-workers)

## Related Concepts

- [Architecture](../architecture) - execution model, container seam, hand-off binding
- [Example 11: Operator Hand-Off](../examples/11-handoff) - two DAGs chained via InMemoryChannel
- [Example 12: Worker Containers](../examples/12-workers) - scatter-dag-body over a WorkerThreadContainer pool
- [Example 13: Multi-Backend Roles](../examples/13-multibackend) - worker roles and body DAGs in the Cartographer demo
- [Reference: Contracts](../reference/contracts) - DagContainerInterface, HandoffChannelInterface, RegistryModuleInterface
