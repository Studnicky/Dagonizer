# @studnicky/dagonizer-executor-web

## 1.0.0

### Patch Changes

- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
  - @studnicky/dagonizer@1.0.0

## 0.30.0

### Patch Changes

- Updated dependencies [4234bc4]
  - @studnicky/dagonizer@0.30.0

## 0.29.1

### Patch Changes

- Updated dependencies [6bdafa4]
  - @studnicky/dagonizer@0.29.1

## 0.29.0

### Patch Changes

- Updated dependencies [23ec54b]
- Updated dependencies [23ec54b]
- Updated dependencies [23ec54b]
  - @studnicky/dagonizer@0.29.0

## 0.28.1

### Patch Changes

- Updated dependencies [fc7021e]
  - @studnicky/dagonizer@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [6ed7c12]
  - @studnicky/dagonizer@0.28.0

## [Unreleased]

### Added

- Adds `"browser"` export condition to the `.` entry for bundler target selection.

## 0.27.0

### Patch Changes

- Updated dependencies [54252c9]
- Updated dependencies [55366b5]
- Updated dependencies [9902b59]
- Updated dependencies [54252c9]
- Updated dependencies [54252c9]
- Updated dependencies [ddf151f]
- Updated dependencies [62dc1c7]
- Updated dependencies [d7eb8bc]
- Updated dependencies [0307e00]
- Updated dependencies [4675839]
- Updated dependencies [d7eb8bc]
- Updated dependencies [088fe8b]
- Updated dependencies [b6d059e]
- Updated dependencies [4d55c20]
- Updated dependencies [8defaae]
  - @studnicky/dagonizer@0.27.0

## 0.26.0

### Patch Changes

- Updated dependencies [a79da55]
- Updated dependencies [a79da55]
- Updated dependencies [a79da55]
  - @studnicky/dagonizer@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [feba895]
- Updated dependencies [ad70ba1]
- Updated dependencies [feba895]
  - @studnicky/dagonizer@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [b9f68c5]
  - @studnicky/dagonizer@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [66b49d7]
- Updated dependencies [66b49d7]
  - @studnicky/dagonizer@0.23.0

## 0.22.0

### Patch Changes

- Updated dependencies [59a763d]
  - @studnicky/dagonizer@0.22.0

### Changed

- `PostMessageChannel` extends the shared `BaseMessageChannel` from
  `@studnicky/dagonizer/container`. The duplicated inbound-handler, closed-latch,
  `onMessage`, and guarded-dispatch members live once in the base; the channel
  keeps only its `postMessage` transport `send` and `addEventListener`
  subscription. Runtime behavior is unchanged.
- **Naming: domain-class verbs (semver-major).** The consumer override seam `WebWorkerContainer.createWorker` is renamed `spawnWorker`, and `createEntry` is renamed `composeEntry` (tracking the `DagContainerBase` base rename). The web registry module's `createBundle` implementation is renamed `instantiate` (tracking the `RegistryModuleInterface` rename). Subclasses override `spawnWorker()` to return a real `Worker`; behavior is unchanged.

## 0.21.0

### Patch Changes

- Updated dependencies [0296d9d]
- Updated dependencies [0296d9d]
  - @studnicky/dagonizer@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [dcbc4b5]
  - @studnicky/dagonizer@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [d5a95ea]
  - @studnicky/dagonizer@0.19.0

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
