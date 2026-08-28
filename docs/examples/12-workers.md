---
title: 'Example 12: Worker Containers'
description: 'A scatter-dag-body placement bound to a WorkerThreadContainer pool. Each clone runs the sub-DAG in a real worker thread via the DagContainerInterface seam.'
seeAlso:
  - text: 'Guide: Distribution and Cloud'
    link: '../guide/distribution'
    description: 'in-fleet containment, registry module contract, pool sizing'
  - text: 'Example 11: Operator Hand-Off'
    link: './11-handoff'
    description: 'cross-host state pass-over via DAGHandoff channels'
  - text: 'Example 04: Scatter Scout'
    link: './04-scatter'
    description: 'scatter mechanics: source, body DAG, gather placement, reduce'
  - text: 'Example 05: Embedded DAGs'
    link: './05-embedded-dags'
    description: 'embedded DAG placements with stateMapping'
  - text: 'Reference: Contracts, DagContainerInterface'
    link: '../reference/contracts'
---

<script setup lang="ts">
import { cartographerWorkersDAG } from '../../examples/the-cartographer/dag.ts';
import { streamEventDAG } from '../../examples/the-cartographer/embedded-dags/StreamEventDAG.ts';
</script>

# Example 12: Worker Containers

## Container Role Surface

Worker Containers let a host run a DAG body outside the main execution context while keeping the parent graph unchanged. The Cartographer binds a scatter body to a browser worker pool; the Node companion uses the same container seam for worker-thread style deployments.

The important contract is the role binding: the DAG declares a logical container role, and the host decides which `DagContainerInterface` implementation satisfies that role.

## Worker-backed Scatter Flow

### DAG registration and diagram

The parent DAG declares the container-bound scatter; the worker DAG is the body registered inside the worker-host registry. [The Cartographer](./the-cartographer) applies this directly through its container-role stream processing path.

<DagJsonMermaid :dag="cartographerWorkersDAG" title="Cartographer worker parent DAG" aria-label="Cartographer worker parent JSON-LD DAG beside Mermaid generated from it." />

<DagJsonMermaid :dag="streamEventDAG" title="stream-event worker body DAG" aria-label="Stream-event worker body JSON-LD DAG beside Mermaid generated from it." />

The Cartographer runtime runs a scatter-dag-body placement over a real `WebWorkerContainer` pool from `@studnicky/dagonizer-executor-web`. Each scatter clone's sub-DAG executes in a worker; the results are gathered back into the parent state identically to the in-process path.

### Run

```bash
pnpm run site:dev
```

Visit [The Cartographer](./the-cartographer), click **Run**, and watch `process-stream` execute through the worker-backed body DAG.

## Role Binding Model

The parent placement declares a logical container role. The host binds that role to a `DagContainerInterface` implementation, and the worker loads a registry module that reconstructs the DAG bundle and services inside the isolated context. The dispatcher sends clone tasks to the container, receives outcomes, and applies the same gather and reducer semantics it uses in-process.

This keeps worker adoption incremental. Application authors do not fork their DAG into "local" and "worker" versions; they bind a role when isolation or parallel throughput is needed.

## Code Samples

Read the snippets with the diagrams nearby so the TypeScript behavior, JSON-LD graph shape, and runtime output line up as one contract.

#### Container-bound DAG placement

DAG authoring does not change between the in-process and worker-thread paths. The only difference is the `container` key on the scatter placement and the `containers` option on the dispatcher:

<<< @/../examples/the-cartographer/dag.ts#cartographer-workers-dag

The dispatcher resolves `"cpu"` to the bound backend. If `"cpu"` is not bound, the scatter runs in-process and fires `contractWarning`. The scatter inbox / work-queue, gather strategies, and outcome reducer are identical in both cases.

#### Container and dispatcher setup

The Cartographer runtime constructs registry-backed worker containers and binds them by role. `process-stream` uses `cpu`; the same runtime also binds `io` for the summary embedded DAG.

<<< @/../examples/the-cartographer/app/CartographerRunner.vue#cartographer-browser-containers

#### Worker registry module

Web workers load a separate module — the main thread's in-memory registry is not accessible across the worker boundary. The registry module exports a `RegistryModuleInterface` default that reconstructs the bundle and services inside the worker from an opaque `servicesConfig` JSON object:

<<< @/../examples/the-cartographer/app/cartographerWorkerRegistry.ts#cartographer-worker-registry

The site build emits a separate worker chunk; the runner supplies that module URL to `WebWorkerContainer`.

### Key APIs

| Symbol | Import | Role |
|--------|--------|------|
| `WebWorkerContainer` | `@studnicky/dagonizer-executor-web` | `DagContainerInterface` over a browser Web Worker pool |
| `DagContainerInterface` | `@studnicky/dagonizer/contracts` | Adapter contract: `runDag(task)` |
| `RegistryModuleInterface` | `@studnicky/dagonizer/contracts` | Default export shape loaded by `DagHost` inside each worker |
| `RegistryBundleInterface` | `@studnicky/dagonizer/contracts` | Return type of `instantiate`: bundle, services, version, restoreState |
| `DagonizerOptionsType.containers` | `@studnicky/dagonizer` | Binds logical role strings to backend instances |

## Operational Uses

Worker containers let hosts execute a DAG body in an isolated worker pool while preserving the same parent DAG, state mapping, gather, and lifecycle contracts. They fit browser or Node hosts that need CPU isolation, parallel throughput, crash containment, or a deployment seam for clone-level work.

## Runtime Notes

### Other Node.js backends

`@studnicky/dagonizer-executor-node` exports `WorkerThreadContainer`, `ForkContainer`, `ClusterContainer`, and `SpawnContainer` for Node deployments. The same role-binding model also has a Node companion in `examples/12-workers.ts`; the Cartographer runtime above is the runtime companion for that backend family.

- **`container` key on a scatter placement.** A `ScatterNode` with a dag body and `container: "cpu"` delegates each clone's sub-DAG to the bound `WebWorkerContainer`. Node-body scatter (no `dag` key in `body`) is not containable; validation rejects `container` on a node body.
- **`containers` option.** `new Dagonizer({ containers: { cpu: workerContainer } })` binds the `"cpu"` role. Any scatter or embedded-DAG placement declaring `container: "cpu"` uses this backend.
- **Pool lifecycle.** `WebWorkerContainer` manages a pool of workers. Workers initialize on first use (sending `init` with the registry module URL and services config) and reuse across requests. Call `await container.destroy()` or `await dispatcher.destroy()` to shut down the pool cleanly.
- **`registryVersion` handshake.** The container sends the `registryVersion` to each worker during `init`. The worker's `DagHost` rejects an `init` message whose version does not match the string from `RegistryModuleInterface.instantiate`. This prevents a stale bundle from executing state from a newer bundle's run.
- **In-process execution.** Remove the `container` key from the scatter placement (or omit `containers` from the dispatcher options) to run the scatter in-process. The output is byte-identical; no code changes are needed in node implementations.
- **V8 resource limits.** `WorkerThreadContainerOptions.resourceLimits` accepts a `maxOldGenerationSizeMb` cap to prevent runaway heap growth in individual workers.

## Related Concepts

- [Guide: Distribution and Cloud](../guide/distribution) - in-fleet containment, registry module contract, pool sizing
- [Example 11: Operator Hand-Off](./11-handoff) - cross-host state pass-over via DAGHandoff channels
- [Example 04: Scatter Scout](./04-scatter) - scatter mechanics: source, body DAG, gather placement, reduce
- [Example 05: Embedded DAGs](./05-embedded-dags) - embedded DAG placements with stateMapping
- [Reference: Contracts, DagContainerInterface](../reference/contracts)
