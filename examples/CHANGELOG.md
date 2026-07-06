# @studnicky/dagonizer-examples

## 0.1.1

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
  - @studnicky/dagonizer-adapter-ollama@1.0.0
  - @studnicky/dagonizer-embedder-ollama@1.0.0
  - @studnicky/dagonizer-patterns-graph@1.0.0
  - @studnicky/dagonizer-patterns-rag@1.0.0
  - @studnicky/dagonizer-executor-node@1.0.0

## 0.1.0

### Minor Changes

- 4234bc4: Adds `react-agent-memory`: a ReAct agent loop whose reasoning trace streams through a `DagStreamProducer` into an outer scatter that records each step into a shared `RdfStore` with a `wasInformedBy` provenance chain, and a second run against the same store that recalls the first run's reasoning via graph traversal and injects it as prompt context.

  Adds `react-agent-routing`: reuses `react-agent-memory`'s agent loop and node classes unchanged, and demonstrates routing concurrent streamed chat responses through ONE shared `RoutingCallModelNode` instance and ONE shared `StreamChannel<RoutedChatStreamChunkType>` sink. A routing DAG scattering over the same channel classifies each chunk by its stamped `routeKey` and demultiplexes two concurrent conversations into separate, uncontaminated transcripts.

### Patch Changes

- Updated dependencies [4234bc4]
- Updated dependencies [4234bc4]
  - @studnicky/dagonizer-adapter-ollama@0.30.0
  - @studnicky/dagonizer@0.30.0
  - @studnicky/dagonizer-embedder-ollama@0.30.0
  - @studnicky/dagonizer-executor-node@0.30.0
  - @studnicky/dagonizer-patterns-graph@0.30.0
  - @studnicky/dagonizer-patterns-rag@0.30.0

## 0.0.16

### Patch Changes

- Updated dependencies [23ec54b]
- Updated dependencies [23ec54b]
- Updated dependencies [23ec54b]
  - @studnicky/dagonizer@0.29.0
  - @studnicky/dagonizer-embedder-ollama@0.29.0
  - @studnicky/dagonizer-adapter-ollama@0.29.0
  - @studnicky/dagonizer-executor-node@0.29.0
  - @studnicky/dagonizer-patterns-rag@0.29.0

## 0.0.15

### Patch Changes

- Updated dependencies [6ed7c12]
  - @studnicky/dagonizer@0.28.0
  - @studnicky/dagonizer-adapter-ollama@0.28.0
  - @studnicky/dagonizer-embedder-ollama@0.28.0
  - @studnicky/dagonizer-executor-node@0.28.0
  - @studnicky/dagonizer-patterns-rag@0.28.0

## 0.0.14

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
  - @studnicky/dagonizer-adapter-ollama@0.27.0
  - @studnicky/dagonizer-embedder-ollama@0.27.0
  - @studnicky/dagonizer-executor-node@0.27.0
  - @studnicky/dagonizer-patterns-rag@0.27.0

## 0.0.13

### Patch Changes

- Updated dependencies [a79da55]
- Updated dependencies [a79da55]
- Updated dependencies [a79da55]
  - @studnicky/dagonizer@0.26.0
  - @studnicky/dagonizer-adapter-ollama@0.26.0
  - @studnicky/dagonizer-embedder-ollama@0.26.0
  - @studnicky/dagonizer-executor-node@0.26.0
  - @studnicky/dagonizer-patterns-rag@0.26.0

## 0.0.12

### Patch Changes

- Updated dependencies [feba895]
- Updated dependencies [ad70ba1]
- Updated dependencies [feba895]
  - @studnicky/dagonizer@0.25.0
  - @studnicky/dagonizer-adapter-ollama@0.25.0
  - @studnicky/dagonizer-embedder-ollama@0.25.0
  - @studnicky/dagonizer-executor-node@0.25.0
  - @studnicky/dagonizer-patterns-rag@0.25.0

## 0.0.11

### Patch Changes

- Updated dependencies [b9f68c5]
  - @studnicky/dagonizer@0.24.0
  - @studnicky/dagonizer-adapter-ollama@0.24.0
  - @studnicky/dagonizer-embedder-ollama@0.24.0
  - @studnicky/dagonizer-executor-node@0.24.0
  - @studnicky/dagonizer-patterns-rag@0.24.0

## 0.0.10

### Patch Changes

- Updated dependencies [66b49d7]
- Updated dependencies [66b49d7]
  - @studnicky/dagonizer@0.23.0
  - @studnicky/dagonizer-adapter-ollama@0.23.0
  - @studnicky/dagonizer-embedder-ollama@0.23.0
  - @studnicky/dagonizer-executor-node@0.23.0
  - @studnicky/dagonizer-patterns-rag@0.23.0

## 0.0.9

### Patch Changes

- ce2708d: Convert the residual guide twoslash blocks to real-source transclusions. The
  custom checkpoint store, custom adapter, pattern node, and serverless handler
  guides now pull from runnable example modules — `custom-checkpoint-store.ts`,
  `custom-adapter.ts`, `pattern-node.ts`, `serverless-handler.ts` — that
  type-check under the examples tsconfig and run offline against real in-process
  backings (Map-backed store, echo adapter, in-memory queue channel). The
  distribution hand-off guide transcludes the existing `11-handoff.ts` channel
  implementation. The persistence contract block remains a reference-style
  twoslash for the `CheckpointStoreInterface` surface.
- Updated dependencies [e4a84bc]
- Updated dependencies [59a763d]
  - @studnicky/dagonizer-adapter-ollama@0.22.0
  - @studnicky/dagonizer@0.22.0
  - @studnicky/dagonizer-embedder-ollama@0.22.0
  - @studnicky/dagonizer-executor-node@0.22.0
  - @studnicky/dagonizer-patterns-rag@0.22.0

## 0.0.8

### Patch Changes

- Updated dependencies [0296d9d]
- Updated dependencies [0296d9d]
  - @studnicky/dagonizer@0.21.0
  - @studnicky/dagonizer-adapter-ollama@0.21.0
  - @studnicky/dagonizer-embedder-ollama@0.21.0
  - @studnicky/dagonizer-executor-node@0.21.0

## 0.0.7

### Patch Changes

- Updated dependencies [dcbc4b5]
  - @studnicky/dagonizer@0.20.0
  - @studnicky/dagonizer-adapter-stub@0.20.0
  - @studnicky/dagonizer-executor-node@0.20.0

## 0.0.6

### Patch Changes

- Updated dependencies [d5a95ea]
  - @studnicky/dagonizer@0.19.0
  - @studnicky/dagonizer-executor-node@0.19.0

## [unreleased]

### Changed

- `NodeErrorBuilder.from(...)` is positional: `from(code, message, operation, recoverable, timestamp, options?)`. All call sites updated.
- `MonadicNode` no longer provides `successPort()`/`emptyPort()`/`errorPort()` helpers. Subclasses return the output port string literal directly.
- Registry modules (`12-workers.registry.ts`, `13-multibackend.registry.ts`): `restoreState` is a `CheckpointRestoreAdapter<NodeStateInterface>`, wrapped with `CheckpointRestoreAdapter.wrap(...)` from `@studnicky/dagonizer/checkpoint`.
- `RetryPolicy.getDelay` override signature requires `{ error: Error | null }` (not optional).
- `ChannelInterface` references updated to `HandoffChannelInterface` throughout.
- `Instrumentation` plugin and `NoopInstrumentation` references removed; phase/observability events surface via protected subclass hooks on `Dagonizer` (`onPhaseEnter`, `onPhaseExit`, `onFlowStart`, `onFlowEnd`, `onNodeStart`, `onNodeEnd`, `onError`).
- Implicit null-route terminal language removed; flows terminate at explicit `TerminalNode` placements.

## 0.0.5

### Patch Changes

- Updated dependencies [34b7155]
  - @studnicky/dagonizer@0.17.0

## 0.0.4

### Patch Changes

- Updated dependencies [8b47957]
- Updated dependencies [8b47957]
  - @studnicky/dagonizer@0.16.0

## 0.0.3

### Patch Changes

- Updated dependencies [b5b931f]
- Updated dependencies [a338274]
- Updated dependencies [a338274]
  - @studnicky/dagonizer@0.15.0

## 0.0.2

### Patch Changes

- Updated dependencies [d3a4e7b]
  - @studnicky/dagonizer@0.14.0

## 0.0.1

### Patch Changes

- Updated dependencies [7c0e38a]
- Updated dependencies [3286d07]
  - @studnicky/dagonizer@0.12.0
