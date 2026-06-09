---
title: 'Distribution and cloud patterns'
description: 'How to scale a Dagonizer deployment across threads, processes, and hosts using DagContainerInterface backends and DAGHandoff channels.'
seeAlso:
  - text: 'Architecture'
    link: '../architecture'
    description: 'execution model, container seam, hand-off binding'
  - text: 'Example 11: loopback hand-off'
    link: '../examples/11-handoff'
    description: 'two DAGs chained via InMemoryChannel'
  - text: 'Example 12: worker pool'
    link: '../examples/12-workers'
    description: 'scatter-dag-body over a WorkerThreadContainer pool'
  - text: 'Reference: Contracts'
    link: '../reference/contracts'
    description: 'DagContainerInterface, ChannelInterface, RegistryModuleInterface'
---

# Distribution and cloud patterns

Dagonizer has two distribution scales. They solve different problems and compose independently.

| Scale | Mechanism | Compute ownership |
|-------|-----------|-------------------|
| **In-fleet containment** | `DagContainerInterface` backends (threads, child processes) | The dispatcher spawns and owns the isolates |
| **Cross-host hand-off** | `DAGHandoff` envelope over a `ChannelInterface` | The envelope travels to a separate host; that host runs the next DAG |

The DAG is always the unit of distribution. A single node never travels to a container or a remote host.

## In-fleet containment

An `EmbeddedDAGNode` or `ScatterNode` (dag body) placement declares a logical container role:

```ts
// DAG document fragment
{
  '@type': 'EmbeddedDAGNode',
  name: 'enrich',
  dag: 'enrichment-pipeline',
  container: 'cpu',             // logical role name
  outputs: { success: 'save', error: 'end-fail' },
}
```

The deployment binds the logical role to a backend at dispatcher construction:

```ts
import { Dagonizer } from '@noocodex/dagonizer';
import { WorkerThreadContainer } from '@noocodex/dagonizer-executor-node';

const dispatcher = new Dagonizer<AppState, AppServices>({
  services,
  containers: {
    cpu: new WorkerThreadContainer({
      registryModule: new URL('./registry.js', import.meta.url).href,
      registryVersion: '1.0.0',
      poolSize: 4,
    }),
  },
});
```

When the dispatcher reaches the `enrich` placement, it delegates the sub-DAG to the `cpu` backend. The child state crosses as a JSON snapshot; the worker runs the sub-DAG to completion; the terminal snapshot is applied in place. The DAG document and node code are identical in both paths. An unbound role falls back to in-process and fires `contractWarning` — the DAG still runs, the degradation is visible.

### Available Node.js backends

All four backends are in `@noocodex/dagonizer-executor-node`:

| Backend | Transport | When to use |
|---------|-----------|-------------|
| `WorkerThreadContainer` | `MessagePort` (shared memory) | CPU-bound work; fastest startup |
| `ForkContainer` | IPC pipe | Isolated V8 heap per request; Node stdlib available |
| `ClusterContainer` | IPC pipe | Reuse a pre-forked cluster worker pool |
| `SpawnContainer` | NDJSON over stdio | Polyglot isolates; any executable that speaks the wire protocol |

The browser package `@noocodex/dagonizer-executor-web` ships `WebWorkerContainer` over `postMessage`.

### Pool sizing

`NodeSystemInfo.recommendedWorkerCount(config)` returns a cgroup-aware default based on `os.availableParallelism()` and available memory. Pass `poolSize` to override.

```ts
import { NodeSystemInfo } from '@noocodex/dagonizer-executor-node';
import { RecommendedWorkerCountConfigDefault } from '@noocodex/dagonizer/entities';

const sysInfo = new NodeSystemInfo();
const poolSize = sysInfo.recommendedWorkerCount({
  ...RecommendedWorkerCountConfigDefault,
  maximumWorkers: 8,
});
```

### The registry module contract

Cross-process containers (fork, cluster, spawn, worker) dynamic-import a registry module inside the isolate to reconstruct the DAG bundle and services without crossing the boundary. The module's default export implements `RegistryModuleInterface`:

```ts
import type { RegistryModuleInterface, RegistryBundleInterface } from '@noocodex/dagonizer/contracts';
import type { JsonObject } from '@noocodex/dagonizer/entities';

// registry.ts — default export consumed by DagHost
const registry: RegistryModuleInterface = {
  async createBundle(servicesConfig: JsonObject): Promise<RegistryBundleInterface> {
    // Wire services from the opaque config the parent passed at init time.
    const db = new DatabaseClient(servicesConfig['dbUrl'] as string);
    const services = { db };

    // Return the bundle, services, version string, and state restore factory.
    return {
      bundle: myDispatcherBundle,
      services,
      registryVersion: '1.0.0',
      restoreState: AppState.restore,
    };
  },
};

export default registry;
```

`registryVersion` must match the string the parent passed to `WorkerThreadContainer` (or the equivalent backend). The `DagHost` inside the worker rejects an `init` message with a mismatched version before accepting any `execute` requests.

Services never cross the isolation boundary — each isolate constructs its own services bag. If an isolate requires a network connection, it opens it locally; the parent does not proxy requests.

---

## Cross-host hand-off

When a top-level DAG completes at a terminal placement bound to a `ChannelInterface`, the dispatcher publishes a `DAGHandoff` envelope to that channel. The envelope carries:

- `dagName` — the name of the DAG that just completed
- `terminalName` — the placement name of the terminal
- `terminalOutput` — the routing output string
- `stateSnapshot` — by-value terminal state (or `stateSnapshotRef` for size-limited transports)
- `registryVersion` — version the receiving host uses for its handshake
- `correlationId` — monotonic dispatcher-assigned identifier for deduplication
- `placementPath` — nesting path for instrumentation

```ts
import { Dagonizer, InMemoryChannel } from '@noocodex/dagonizer';

const channel = new InMemoryChannel({
  onPublish: async (handoff) => {
    // Restore state on the receiving side and run the continuation DAG.
    const state = AppState.restore(handoff.stateSnapshot);
    await downstreamDispatcher.execute('continuation-dag', state);
  },
});

const dispatcher = new Dagonizer<AppState, AppServices>({
  services,
  channels: {
    done: channel,       // publishes when the 'done' terminal is reached
    escalate: dlqChannel,  // different terminals can bind different channels
  },
});
```

A terminal not listed in `channels` follows today's behavior — the run completes, no envelope is published. Embedded and contained child DAGs never publish; only the top-level host does.

A publish failure collects a `HANDOFF_PUBLISH_FAILED` error on the run's state; the returned `ExecutionResult` and `terminalOutcome` are unchanged.

### Serverless function handler pattern

A serverless function receives a `DAGHandoff` envelope, restores state, runs the DAG to completion, and lets the bound egress channels publish the next envelope. The function itself requires no Dagonizer-specific runtime; it is a plain `Dagonizer` instance.

```ts
import { Dagonizer } from '@noocodex/dagonizer';
import type { ChannelInterface } from '@noocodex/dagonizer/contracts';
import type { DAGHandoff } from '@noocodex/dagonizer/entities';

import { AppState } from './state.js';
import { buildServices } from './services.js';

// A transport-specific channel stub — implement `publish` with your SDK call.
class SqsChannel implements ChannelInterface {
  async publish(handoff: DAGHandoff): Promise<void> {
    // Insert your SQS / PubSub / SNS SDK call here.
    // Example: await sqsClient.send(new SendMessageCommand({ ... }));
    // Core never imports a cloud SDK; this is your deployment code.
    void handoff; // remove this line when wiring the real SDK
  }
}

// Function handler (e.g. AWS Lambda, Cloud Run, Cloudflare Worker):
export async function handler(envelope: DAGHandoff): Promise<void> {
  // 1. Verify version before executing.
  if (envelope.registryVersion !== REGISTRY_VERSION) {
    throw new Error(`Version mismatch: expected ${REGISTRY_VERSION}, got ${envelope.registryVersion}`);
  }

  // 2. Restore state from the envelope.
  const state = AppState.restore(envelope.stateSnapshot);

  // 3. Construct the dispatcher with egress channels bound to terminal names.
  const services = buildServices();
  const dispatcher = new Dagonizer<AppState, typeof services>({
    services,
    channels: {
      done:     new SqsChannel(),   // publishes to the downstream queue
      escalate: new SqsChannel(),   // routes failures to a DLQ
    },
  });

  // Register DAGs and nodes.
  dispatcher.registerBundle(myBundle);

  // 4. Execute. The channel publishes after the terminal is reached.
  await dispatcher.execute(envelope.dagName, state);
}
```

This pattern composes with any function-as-a-service platform. The dispatcher is constructed, used, and discarded per invocation. There is no persistent scheduler, no long-lived worker, and no agent protocol — Dagonizer is the in-function runtime.

### External orchestrators (Step Functions, Cloud Workflows, etc.)

When the deployment uses an external state machine (AWS Step Functions, Google Cloud Workflows, Azure Durable Functions), each state maps to one function invocation. The function is envelope-in / envelope-out:

```
[State machine]
   │
   ├─ InvokeA → handler(envelopeA) → channel.publish(envelopeB)
   ├─ InvokeB → handler(envelopeB) → channel.publish(envelopeC)
   └─ InvokeC → handler(envelopeC) → done
```

Dagonizer never compiles a DAG to ASL or workflow YAML. Dagonizer never invokes or manages state machine instances. The state machine is authored by the deployment; Dagonizer is the in-function executor that processes each step's envelope and publishes the next. The boundary is explicit: the orchestrator owns transitions; Dagonizer owns node execution within each step.

### `registryVersion` handshake

The `registryVersion` field on `DAGHandoff` carries the same guarantee as the bridge protocol used by containers: a receiving host that detects a version mismatch should reject the envelope before executing. This prevents a host running a stale bundle from applying state from a newer bundle's run.

Recommended pattern:
- Publish `registryVersion` from a single constant in the bundle (e.g. `package.json` version or a content hash of the DAG registry).
- Validate on ingress before calling `AppState.restore`.
- On mismatch: route to a DLQ or a manual-review queue, not a silent drop.

### Idempotent node authoring

Exactly-once delivery is out of scope for Dagonizer's channel contract. At-least-once is the documented delivery guarantee for most queue transports. Node authors are responsible for writing idempotent side effects:

- Upsert records rather than insert-and-fail on duplicate.
- Check for prior completion in state before calling an external API.
- Use `correlationId` from the envelope as an idempotency key when the downstream API supports one.

Dagonizer guarantees envelope fidelity (a `stateSnapshot` round-trip is a fixed point) and `correlationId` uniqueness within a dispatcher instance. Delivery semantics above that are a property of the channel transport and the deployment.

---

## Further reading

- [`examples/11-handoff.ts`](../../examples/11-handoff.ts) — two DAGs chained via an in-process loopback channel; companion doc at [`docs/examples/11-handoff.md`](../examples/11-handoff)
- [`examples/12-workers.ts`](../../examples/12-workers.ts) — scatter-dag-body over a real `WorkerThreadContainer` pool with a registry module; companion doc at [`docs/examples/12-workers.md`](../examples/12-workers)
