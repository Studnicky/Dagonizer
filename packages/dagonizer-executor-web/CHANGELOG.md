# @noocodex/dagonizer-executor-web

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

- `WebWorkerLikeInterface` and `WorkerScopeLikeInterface`: structural contracts for Web Worker endpoints. No DOM lib dependency — all browser shapes are duck-typed so the package compiles and tests in Node.js.
- `PostMessageChannel`: `MessageChannelInterface` adapter over a `postMessage` / `addEventListener` endpoint. Inbound payloads are validated via `Validator.bridgeMessage`; invalid payloads surface as recoverable `error` messages rather than throwing.
- `WebSystemInfo`: `SystemInfoInterface` implementation using injected `hardwareConcurrency` and `crossOriginIsolated` probes. Implements the quadrascope clamp formula: `clamp(hardwareConcurrency − mainThreadReservation, fallbackWorkerCount, maximumWorkers)`.
- `WebWorkerContainer`: `DagContainerBase` subclass. Implements the four abstract seams (`createEntry`, `attachDeathListeners`, `terminateWorker`, `awaitWorkerExit`) over a lazy pool of Web Worker endpoints. Runs a whole embedded DAG in a Web Worker isolate via `PostMessageChannel`. Worker construction is extension-by-subclass (zero callbacks): `createEntry()` calls the protected `createWorker()` hook which throws by default; consumers override `createWorker(): WebWorkerLikeInterface` to return `new Worker(url, { type: 'module' })`. Pool growth, semaphore waiting, and death eviction are owned by `DagContainerBase`. `destroy()` sends `shutdown` then calls `terminate()` on every spawned worker.
- `WebWorkerEntry`: worker-side bootstrap. `WebWorkerEntry.start(scope)` wraps a `WorkerScopeLikeInterface` in a `PostMessageChannel` and starts a `DagHost`. No bare `self` reference at module top level — the scope is always injected.
- Unit tests: `post-message-channel.test.ts` (round-trip, invalid-payload, close semantics, structuredClone isolation), `web-system-info.test.ts` (clamp math, safe fallbacks, fuzz sample), `conformance.test.ts` (full `DagConformance.laws()` Laws 1–6 and 9 via in-process `FakeWorker` driving a `DagHost`, pool-size queuing, `destroy()` terminate coverage).
- `WebWorkerLikeInterface.addEventListener` gains a structural `'error'` overload (`listener: (event: { message?: string }) => void`) — the browser's worker death signal, structurally assignable from the real `Worker.addEventListener('error', …)` with no DOM lib dependency.

### Fixed

- Transport-death detection (parent backstop, Law 4): `WebWorkerContainer` registers a worker `'error'` listener that calls `DagContainerBase.failChannel(...)` with `DAG_CONTAINER_WORKER_DIED`, failing the in-flight request instead of hanging it, then evicts the dead slot (worker terminated, channel closed) so a fresh worker spawns on the next acquire. A `#destroyed` flag distinguishes intentional `destroy()` teardown from an unexpected death.
