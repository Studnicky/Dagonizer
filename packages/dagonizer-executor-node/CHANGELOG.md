# @noocodex/dagonizer-executor-node

## 0.21.0

### Patch Changes

- Updated dependencies [0296d9d]
- Updated dependencies [0296d9d]
  - @noocodex/dagonizer@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [dcbc4b5]
  - @noocodex/dagonizer@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [d5a95ea]
  - @noocodex/dagonizer@0.19.0

## [Unreleased]

### Added

- `WorkerThreadContainer`: `DagContainerBase` subclass. Implements the four abstract seams (`createEntry`, `attachDeathListeners`, `terminateWorker`, `awaitWorkerExit`) over a `worker_threads` pool. Runs a whole embedded DAG in a worker isolate via `MessagePortChannel`. Supports `resourceLimits.maxOldGenerationSizeMb` per worker. `entryUrl` option overrides the default `workerEntry.js` for test environments. Pool growth, semaphore waiting, and death eviction are owned by `DagContainerBase`.
- `ForkContainer`: `DagContainerBase` subclass. Implements the four abstract seams over a `child_process.fork` pool. Full heap and native-memory isolation per child; communicates over `IpcChannel`. Pool lifecycle owned by `DagContainerBase`.
- `ClusterContainer`: `DagContainerBase` subclass. Implements the four abstract seams over `node:cluster` workers. Workers inherit listener handles from the primary — appropriate for HTTP/TCP server applications needing port-sharing workers. Identical DAG-level protocol to `ForkContainer`; communicates over `IpcChannel`.
- `SpawnContainer`: `DagContainerBase` subclass. Implements the four abstract seams over `child_process.spawn` with `NdjsonChannel` over stdio. `command`/`args` options allow any runtime speaking the BridgeMessage protocol — Node without IPC, Bun, Python, or a compiled binary. The polyglot door.
- `MessagePortChannel`: `MessageChannelInterface` over a `worker_threads` `MessagePort`. Usable from both the parent side and the worker side via `parentPort`. Injectable `MessagePortLike` shape enables testing. Validates inbound payloads at the `unknown` ingest boundary.
- `IpcChannel`: `MessageChannelInterface` over child_process IPC. Accepts a structural `IpcEndpoint` so the same class serves both parent and child sides. Validates inbound payloads at the IPC ingest boundary.
- `NdjsonChannel`: `MessageChannelInterface` over `Readable`/`Writable` streams with newline-delimited JSON framing. Handles partial chunks and multiple messages per chunk. The accumulator is capped at 8 MiB (`MAX_BUFFER_BYTES`); overflow emits an `NDJSON_PARSE_ERROR` error BridgeMessage and resets the buffer. JSON parse failures, BridgeMessage validation failures, readable `'error'` events, and un-terminated trailing lines at stream close all surface as `NDJSON_PARSE_ERROR` error BridgeMessages rather than throwing.
- `NodeSystemInfo`: `SystemInfoInterface` implementation using `os.availableParallelism()` and `os.freemem()`. Injectable `OsServices` for deterministic testing. Applies memory-based pool clamping when `memoryPerWorkerBytes` is non-null.
- `workerEntry.ts`: worker_threads bootstrap wrapping `parentPort` in `MessagePortChannel` and starting a `DagHost`.
- `forkEntry.ts`: fork/cluster bootstrap wrapping the process IPC endpoint in `IpcChannel` and starting a `DagHost`.
- `spawnEntry.ts`: spawn bootstrap wrapping `process.stdin`/`process.stdout` in `NdjsonChannel` and starting a `DagHost`.
- Conformance suite: `DagConformance.laws()` (Laws 1–9) runs against real worker_threads, fork, spawn, and cluster backends, verifying the full DAG-level containment contract over each transport. Laws 7–9 are now active: Law 7 (scatter checkpoint byte-identity across in-process and contained backends) runs for all backends; Law 8 (at-least-once under real isolate death) runs for all four backends via `interruptMidScatter`. `WorkerThreadContainer` uses `KillAfterOneContainer` (routes the first `runDag` normally, then terminates the pool so `executeScatter`'s pool error path fires and the inbox retains un-acked items); `ForkContainer`, `SpawnContainer`, and `ClusterContainer` use the `kill-registry` fixture whose scatter-counter calls `process.exit(7)` on the kill item, so the real child/worker process dies mid-flight and the parent backstop fails the request. Each backend's Law 8 asserts the scatter resolves within a bounded time (no hang) and that a resume on a fresh container of the same backend reprocesses exactly the killed item so all 3 scatter items gather correctly. `buildHarness` uses `factoryCreated` to distinguish sentinel/per-law containers (built fresh with instrumentation) from caller-supplied Law 8 containers (used as-is).
- Silent worker-death conformance test: a worker self-terminates (`process.exit`) mid-request on a target scatter item with no result/error sent — the real-death proof for Law 4 (parent backstop) + Law 8 (at-least-once). It asserts the scatter resolves within a bounded time (no hang) and that a resume on a fresh `WorkerThreadContainer` reprocesses the killed item. The `kill-registry` fixture reconstructs the conformance bundle with a `scatter-counter` that terminates its worker thread on the kill item.

### Fixed

- Transport-death detection on every backend (parent backstop, Law 4): `WorkerThreadContainer` (`worker.on('error'|'exit')`), `ForkContainer` and `ClusterContainer` (`child`/`worker` `'error'`/`'exit'`/`'disconnect'`), and `SpawnContainer` (`child` `'error'`/`'exit'` + stdout `'close'`/`'error'`) now register death listeners that call `DagContainerBase.failChannel(...)` with `DAG_CONTAINER_WORKER_DIED`, failing the in-flight request instead of hanging it. The dead pool entry is evicted from the pool and free list (channel closed, slot waiter woken) so a fresh worker spawns on the next acquire. An intentional `destroy()` teardown is distinguished from an unexpected death via a `#destroyed` flag, so deliberate shutdown does not fail pending requests.
