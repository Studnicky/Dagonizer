# @studnicky/dagonizer-executor-web

Browser isolating container backend for [@studnicky/dagonizer](https://github.com/Studnicky/Dagonizer).

Runs a whole embedded DAG in a Web Worker isolate over the bridge protocol. The same DAG document and the same node implementations run unchanged inside the worker — no per-node remoting. State seeds into the container, the DAG runs to completion, and the terminal state crosses back.

## Installation

```sh
npm install @studnicky/dagonizer-executor-web @studnicky/dagonizer
```

## Usage

### 1. Create a worker file

The worker file calls `WebWorkerEntry.start` with the worker global scope. The cast to `WorkerScopeLikeInterface` lives in your file — at your boundary — because this package has no DOM lib dependency.

```ts
// worker.ts (your file)
import { WebWorkerEntry } from '@studnicky/dagonizer-executor-web';
import type { WorkerScopeLikeInterface } from '@studnicky/dagonizer-executor-web';

WebWorkerEntry.start(self as unknown as WorkerScopeLikeInterface);
```

### 2. Create a registry module

The registry module is dynamic-imported by the `DagHost` inside each worker. It implements `RegistryModuleInterface` from `@studnicky/dagonizer/contracts`.

```ts
// registry.ts
import type { RegistryModuleInterface, RegistryBundleInterface } from '@studnicky/dagonizer/contracts';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';
import { MyState } from './MyState.js';
import { myNode } from './myNode.js';
import { myDag } from './myDag.js';

const registry: RegistryModuleInterface = {
  async createBundle(_servicesConfig: JsonObjectType): Promise<RegistryBundleInterface> {
    return {
      bundle: { nodes: [myNode], dags: [myDag] },
      services: undefined,
      registryVersion: '1.0.0',
      restoreState: (snap) => MyState.restore(snap),
    };
  },
};

export default registry;
```

### 3. Wire the container on the main thread

```ts
import { Dagonizer } from '@studnicky/dagonizer';
import { WebWorkerContainer } from '@studnicky/dagonizer-executor-web';
import type { WebWorkerLikeInterface } from '@studnicky/dagonizer-executor-web';

// Extension is by subclass (zero callbacks): this package cannot construct
// browser workers itself, so override createWorker() to supply the real worker.
class AppWorkerContainer extends WebWorkerContainer {
  protected override createWorker(): WebWorkerLikeInterface {
    return new Worker(
      new URL('./worker.js', import.meta.url),
      { type: 'module' },
    );
  }
}

const container = new AppWorkerContainer({
  registryModule: new URL('./registry.js', import.meta.url).href,
  registryVersion: '1.0.0',
  poolSize: 4, // optional; defaults to navigator.hardwareConcurrency - 1
});

const dispatcher = new Dagonizer({
  containers: { 'cpu': container },
});

// Register your DAG (EmbeddedDAGNode placements have container: 'cpu')
dispatcher.registerBundle(bundle);

const result = await dispatcher.execute('my-dag', state);
```

## Design

- No DOM lib dependency. All browser shapes (`Worker`, `DedicatedWorkerGlobalScope`, `navigator`) are structural interfaces or injected probes — the package compiles and tests in Node.js.
- `WebSystemInfo` uses injected probes for `navigator.hardwareConcurrency` and `crossOriginIsolated`.
- `PostMessageChannel` validates every inbound payload via `Validator.bridgeMessage`; invalid data surfaces as a recoverable `error` message, never a throw.
- Pool semaphore: `WebWorkerContainer` uses a promise-queue waiter list so the active worker count never exceeds `poolSize`.
- Containment grain is the DAG. A single `EmbeddedDAGNode` placement sends the entire child DAG into the Web Worker; individual nodes never travel.

## License

MIT
