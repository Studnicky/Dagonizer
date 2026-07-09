# @studnicky/dagonizer-executor-node

Node.js isolating DAG container backends for [@studnicky/dagonizer](../dagonizer/README.md).

Provides `WorkerThreadContainer`, `ForkContainer`, `SpawnContainer`, and `ClusterContainer` — each a `DagContainerBase` subclass that runs a **whole embedded DAG** in an isolate, speaking the same BridgeMessage protocol over different transports. A single DAG document runs unchanged across all topologies; the deployment chooses the container.

The grain is the DAG. A contained execution runs an entire embedded child DAG to completion inside an isolate and returns the terminal state snapshot, collected errors, and per-node intermediates to the parent. There is no per-node remoting.

## Usage

```ts
import { WorkerThreadContainer } from '@studnicky/dagonizer-executor-node';
import { Dagonizer } from '@studnicky/dagonizer';

// The registry module is a file that default-exports a RegistryModuleInterface:
//   export default { async createBundle(servicesConfig) { return { bundle, services, registryVersion, restoreState }; } }
const registryModule = new URL('./registry.js', import.meta.url).href;

const container = new WorkerThreadContainer({
  registryModule,
  registryVersion: '1.0.0',
  poolSize: 4,                          // optional; defaults to NodeSystemInfo
  servicesConfig: { dbUrl: '...' },     // optional; forwarded to createBundle
  resourceLimits: { maxOldGenerationSizeMb: 256 },  // optional V8 heap cap
});

const dispatcher = new Dagonizer({
  containers: { isolated: container },
});

// DAG placements declare container: 'isolated' on an EmbeddedDAGNode or dag-body
// ScatterNode to route through the pool. Nodes, state, and DAG documents are
// unchanged from the inline path.

// Drain all workers cleanly when the application shuts down:
await container.destroy();
```

## Containers

| Class | Transport | Use case |
|---|---|---|
| `WorkerThreadContainer` | `MessagePort` (worker_threads) | CPU-bound isolation, shared memory address space |
| `ForkContainer` | IPC (child_process.fork) | Full process isolation, long-running embedded DAGs |
| `SpawnContainer` | NDJSON over stdio | Polyglot workers (Node, Bun, Python, compiled binary) |
| `ClusterContainer` | IPC (node:cluster) | Server applications needing inherited listener handles |

## Channel types

`MessagePortChannel`, `IpcChannel`, and `NdjsonChannel` implement `MessageChannelInterface` and are independently usable for custom topologies.

## Pool sizing

`NodeSystemInfo` implements `SystemInfoInterface` using `os.availableParallelism()` with a memory-based cap:

```ts
import { NodeSystemInfo } from '@studnicky/dagonizer-executor-node';

const info = new NodeSystemInfo();
const count = info.recommendedWorkerCount({
  maximumWorkers: 8,
  mainThreadReservation: 1,
  minimumWorkerCount: 1,
  memoryPerWorkerBytes: 256 * 1024 * 1024,
});
```
