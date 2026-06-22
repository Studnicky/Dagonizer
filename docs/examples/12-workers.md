---
title: 'Example 12: Worker pool'
description: 'A scatter-dag-body placement bound to a WorkerThreadContainer pool. Each clone runs the sub-DAG in a real worker thread via the DagContainerInterface seam.'
seeAlso:
  - text: 'Guide: Distribution and cloud patterns'
    link: '../guide/distribution'
    description: 'in-fleet containment, registry module contract, pool sizing'
  - text: 'Example 11: Loopback hand-off'
    link: './11-handoff'
    description: 'cross-host state pass-over via DAGHandoff channels'
  - text: 'Phase 04: Scatter scout'
    link: './04-scatter'
    description: 'scatter mechanics: source, body, gather, reduce'
  - text: 'Phase 05: EmbeddedDAGNode composition'
    link: './05-embedded-dags'
    description: 'embedded DAG placements with stateMapping'
  - text: 'Reference: Contracts, DagContainerInterface'
    link: '../reference/contracts'
---

# Example 12: Worker pool

This example runs a scatter-dag-body placement over a real `WorkerThreadContainer` pool from `@studnicky/dagonizer-executor-node`. Each scatter clone's sub-DAG executes in a worker thread; the results are gathered back into the parent state identically to the in-process path.

## Key concept

DAG authoring does not change between the in-process and worker-thread paths. The only difference is the `container` key on the scatter placement and the `containers` option on the dispatcher:

<<< @/../examples/dags/12-workers.ts#parent-dag

The dispatcher resolves `"cpu"` to the bound backend. If `"cpu"` is not bound, the scatter runs in-process and fires `contractWarning`. The scatter inbox / work-queue, gather strategies, and outcome reducer are identical in both cases.

## Container and dispatcher setup

The `WorkerThreadContainer` is constructed with the compiled registry module URL, a registry version string for handshake validation, and a pool size. The pool size can be derived from `NodeSystemInfo.recommendedWorkerCount`:

<<< @/../examples/12-workers.ts#pool-sizing

<<< @/../examples/12-workers.ts#container

The dispatcher receives the container bound to the `"cpu"` role. The scatter placement's `container: "cpu"` tells the engine to route each clone through this backend:

<<< @/../examples/12-workers.ts#dispatcher

## The registry module

Worker threads load a separate Node.js module — the main process's in-memory registry is not accessible across thread boundaries. The registry module exports a `RegistryModuleInterface` default that reconstructs the bundle and services inside the worker from an opaque `servicesConfig` JSON object:

<<< @/../examples/dags/12-workers.registry.ts#registry

**Why a built JS file is required.** Node.js `worker_threads` loads worker scripts from a file URL; TypeScript source files are not directly executable inside a worker. The registry module must be a compiled `.js` file at a path the worker can `import()`. The example's build step compiles `registry.ts` before running. Pass the compiled URL as `registryModule` to `WorkerThreadContainer`.

## Key APIs

| Symbol | Import | Role |
|--------|--------|------|
| `WorkerThreadContainer` | `@studnicky/dagonizer-executor-node` | `DagContainerInterface` over a worker_threads pool |
| `WorkerThreadContainerOptions` | `@studnicky/dagonizer-executor-node` | `registryModule`, `registryVersion`, `servicesConfig`, `poolSize` |
| `NodeSystemInfo` | `@studnicky/dagonizer-executor-node` | Pool sizing: `recommendedWorkerCount(config)` |
| `DagContainerInterface` | `@studnicky/dagonizer/contracts` | Adapter contract: `runDag(task)` |
| `RegistryModuleInterface` | `@studnicky/dagonizer/contracts` | Default export shape loaded by `DagHost` inside each worker |
| `RegistryBundleInterface` | `@studnicky/dagonizer/contracts` | Return type of `instantiate`: bundle, services, version, restoreState |
| `DagonizerOptionsType.containers` | `@studnicky/dagonizer` | Binds logical role strings to backend instances |

## What it demonstrates

- **`container` key on a scatter placement.** A `ScatterNode` with a dag body and `container: "cpu"` delegates each clone's sub-DAG to the bound `WorkerThreadContainer`. Node-body scatter (no `dag` key in `body`) is not containable; validation rejects `container` on a node body.
- **`containers` option.** `new Dagonizer({ containers: { cpu: workerContainer } })` binds the `"cpu"` role. Any scatter or embedded-DAG placement declaring `container: "cpu"` uses this backend.
- **Pool lifecycle.** `WorkerThreadContainer` manages a pool of workers. Workers initialize on first use (sending `init` with the registry module URL and services config) and reuse across requests. Call `await container.destroy()` or `await dispatcher.destroy()` to shut down the pool cleanly.
- **`registryVersion` handshake.** The container sends the `registryVersion` to each worker during `init`. The worker's `DagHost` rejects an `init` message whose version does not match the string from `RegistryModuleInterface.instantiate`. This prevents a stale bundle from executing state from a newer bundle's run.
- **In-process fallback.** Remove the `container` key from the scatter placement (or omit `containers` from the dispatcher options) to run the scatter in-process. The output is byte-identical; no code changes are needed in node implementations.
- **V8 resource limits.** `WorkerThreadContainerOptions.resourceLimits` accepts a `maxOldGenerationSizeMb` cap to prevent runaway heap growth in individual workers.

## Run

```bash
pnpm run example:12
```

Source: [`examples/12-workers.ts`](../../examples/12-workers.ts)

## Other Node.js backends

`@studnicky/dagonizer-executor-node` also exports `ForkContainer` (isolated heap, IPC), `ClusterContainer` (pre-forked cluster workers), and `SpawnContainer` (any executable over NDJSON stdio). All four implement `DagContainerInterface` and accept the same `registryModule` / `registryVersion` / `servicesConfig` options. Swap the backend in the `containers` map with no changes to the DAG or node code.
