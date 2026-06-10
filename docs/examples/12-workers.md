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

This example runs a scatter-dag-body placement over a real `WorkerThreadContainer` pool from `@noocodex/dagonizer-executor-node`. Each scatter clone's sub-DAG executes in a worker thread; the results are gathered back into the parent state identically to the in-process path.

## Key concept

DAG authoring does not change between the in-process and worker-thread paths. The only difference is the `container` key on the scatter placement and the `containers` option on the dispatcher:

```ts
// DAG document fragment — identical in both paths.
// Adding 'container: "cpu"' activates the worker path for each clone.
{
  '@type': 'ScatterNode',
  name: 'process-items',
  source: 'items',
  body: { dag: 'item-pipeline' },
  container: 'cpu',   // logical role; bound to WorkerThreadContainer at dispatch time
  gather: 'append',
  outputs: { success: 'save', error: 'end-fail' },
}
```

The dispatcher resolves `"cpu"` to the bound backend. If `"cpu"` is not bound, the scatter runs in-process and fires `contractWarning`. The scatter inbox / work-queue, gather strategies, and outcome reducer are identical in both cases.

## The registry module

Worker threads load a separate Node.js module — the main process's in-memory registry is not accessible across thread boundaries. The registry module exports a `RegistryModuleInterface` default that reconstructs the bundle and services inside the worker from an opaque `servicesConfig` JSON object:

```ts
// registry.ts — loaded by DagHost inside the worker via dynamic import
import type {
  RegistryModuleInterface,
  RegistryBundleInterface,
} from '@noocodex/dagonizer/contracts';
import type { JsonObject } from '@noocodex/dagonizer/entities';

import { myBundle } from './bundle.js';
import { AppState } from './state.js';
import { buildServices } from './services.js';

const registry: RegistryModuleInterface = {
  async createBundle(servicesConfig: JsonObject): Promise<RegistryBundleInterface> {
    const services = buildServices(servicesConfig);
    return {
      bundle: myBundle,
      services,
      registryVersion: '1.0.0',
      restoreState: AppState.restore,
    };
  },
};

export default registry;
```

**Why a built JS file is required.** Node.js `worker_threads` loads worker scripts from a file URL; TypeScript source files are not directly executable inside a worker. The registry module must be a compiled `.js` file at a path the worker can `import()`. The example's build step compiles `registry.ts` before running. Pass the compiled URL as `registryModule` to `WorkerThreadContainer`.

## Key APIs

| Symbol | Import | Role |
|--------|--------|------|
| `WorkerThreadContainer` | `@noocodex/dagonizer-executor-node` | `DagContainerInterface` over a worker_threads pool |
| `WorkerThreadContainerOptions` | `@noocodex/dagonizer-executor-node` | `registryModule`, `registryVersion`, `servicesConfig`, `poolSize` |
| `NodeSystemInfo` | `@noocodex/dagonizer-executor-node` | Pool sizing: `recommendedWorkerCount(config)` |
| `DagContainerInterface` | `@noocodex/dagonizer/contracts` | Adapter contract: `runDag(task)` |
| `RegistryModuleInterface` | `@noocodex/dagonizer/contracts` | Default export shape loaded by `DagHost` inside each worker |
| `RegistryBundleInterface` | `@noocodex/dagonizer/contracts` | Return type of `createBundle`: bundle, services, version, restoreState |
| `DagonizerOptionsInterface.containers` | `@noocodex/dagonizer` | Binds logical role strings to backend instances |

## What it demonstrates

- **`container` key on a scatter placement.** A `ScatterNode` with a dag body and `container: "cpu"` delegates each clone's sub-DAG to the bound `WorkerThreadContainer`. Node-body scatter (no `dag` key in `body`) is not containable; validation rejects `container` on a node body.
- **`containers` option.** `new Dagonizer({ containers: { cpu: workerContainer } })` binds the `"cpu"` role. Any scatter or embedded-DAG placement declaring `container: "cpu"` uses this backend.
- **Pool lifecycle.** `WorkerThreadContainer` manages a pool of workers. Workers initialize on first use (sending `init` with the registry module URL and services config) and reuse across requests. Call `await container.destroy()` or `await dispatcher.destroy()` to shut down the pool cleanly.
- **`registryVersion` handshake.** The container sends the `registryVersion` to each worker during `init`. The worker's `DagHost` rejects an `init` message whose version does not match the string from `RegistryModuleInterface.createBundle`. This prevents a stale bundle from executing state from a newer bundle's run.
- **In-process fallback.** Remove the `container` key from the scatter placement (or omit `containers` from the dispatcher options) to run the scatter in-process. The output is byte-identical; no code changes are needed in node implementations.
- **V8 resource limits.** `WorkerThreadContainerOptions.resourceLimits` accepts a `maxOldGenerationSizeMb` cap to prevent runaway heap growth in individual workers.

## Run

```bash
pnpm run example:12
```

Source: [`examples/12-workers.ts`](../../examples/12-workers.ts)

## Other Node.js backends

`@noocodex/dagonizer-executor-node` also exports `ForkContainer` (isolated heap, IPC), `ClusterContainer` (pre-forked cluster workers), and `SpawnContainer` (any executable over NDJSON stdio). All four implement `DagContainerInterface` and accept the same `registryModule` / `registryVersion` / `servicesConfig` options. Swap the backend in the `containers` map with no changes to the DAG or node code.
