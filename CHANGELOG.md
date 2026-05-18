# Changelog

All notable changes to `@noocodex/dagonizer` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Per-node timeout support via `NodeInterface.timeoutMs?: number`. When set, the engine derives a child `AbortController` from the run's signal, races the node's `execute()` against a `Scheduler`-backed deadline, and throws `NodeTimeoutError` on expiry. The child signal is passed as `context.signal` so signal-aware IO also cancels. `onError` fires with the `NodeTimeoutError`; the run is marked failed. Nodes without `timeoutMs` are unaffected.
- `NodeTimeoutError` — `DAGError` subclass (`code: 'NODE_TIMEOUT'`) carrying `nodeName` and `timeoutMs`. Exported from `./errors` and the root barrel.
- `DAG` is canonically JSON-LD 1.1. `@context` / `@id` / `@type` are required on the document and every node placement; the `@context` uses type-scoped contexts so `ParallelNode.nodes` and `DAG.nodes` map to distinct IRIs without key collision. Placements use `@type` IRIs (`"SingleNode"`, `"ParallelNode"`, `"FanOutNode"`, `"DeepDAGNode"`) as the discriminator. No projection layer — what `DAGBuilder.build()` returns is the JSON-LD document the engine consumes and the schema validates.
- `CytoscapeRenderer` — recursive deep-DAG inline expansion. The `deepDags?: ReadonlyMap<string, DAG>` option drives full-fidelity expansion of nested DAGs into compound parents (no opaque shortcut nodes). Cycle-safe via `visited` set and `maxDepth` (default 6).
- Archivist demo: full multi-source fan-out per intent. Five intent branches (`lookup-author`, `find-reviews`, `describe-book`, `recommend-similar`, `on-topic`) each fan out across `openLibraryScout` + `googleBooksScout` + `wikipediaScout` via `parallel` placements with `combine: 'collect'`. Results merge through `CanonicalId.dedupe` (ISBN-13 → ISBN-10 → `urn:work:<title>::<author>`).
- Archivist demo: typed-state mirroring to RDF named graph. `StateProjection` projects `ArchivistState` into `urn:dagonizer:state:<runId>` on every `onNodeEnd`; nodes query via SPARQL across state graphs for cross-run memory recall.
- Archivist demo: PROV-O activity log. `RdfProvObserver` writes `prov:Activity` quads (`startedAtTime`, `endedAtTime`, `wasInformedBy`, `wasAssociatedWith`) per node/tool/llm call into `urn:dagonizer:prov:<runId>`.
- Archivist demo: TBox + ABox ontology in `ArchivistOntology.ts` (7 classes, 8 object properties, 13 datatype properties). `dag:Run` and `dag:Activity` subclass `prov:Activity`; ontology loads into `urn:dagonizer:ontology` graph at startup.
- Archivist demo: browser persistence. `MemoryStore.enablePersistence()` writes N-Quads to `localStorage`; survives reloads. `PersistenceBadge` reflects state in the UI.
- Archivist demo: checkpoint resume. `CheckpointControls` saves the current run's cursor + typed state; `ask()` resume path reuses `buildObserver(fromCursor, prov)` so prov + state projection stay continuous across resume.
- Archivist demo: per-phase `TimeoutDrawer` controls + cancel button. Visitor adjusts compose/web-search/rank budgets; cancel button aborts the active `AbortController`. The overall `deadlineMs` is a safety-net only.
- Archivist demo: composable prompt directives in `prompts.ts`. Positive attractors only (no negative directives). Schema examples are shape-only (`<title-words>`, `<author-name>`, `<ISBN-13>`) to prevent LLM poisoning.
- Archivist demo: workshop UI with DAG / RDF memory / state / trace / logger / ontology tabs. `MemoryGraph` uses cosmos.gl native defaults with layer-chip filter (memory/state/prov). `DagGraph` D-pad navigation (3x3 grid: zoom/pan/center/expand/fit). `StateLegend` left column with equal-width rows.
- Archivist demo: three external tools — `OpenLibrarySearchTool`, `GoogleBooksTool`, `WikipediaSummaryTool`. Each returns normalized `Candidate[]` with overlapping `CanonicalId` keys so cross-source merge is natural.
- Three LLM adapters under `providers/adapters/`: `GeminiNanoAdapter` (in-browser via `chrome.aiOriginTrial`), `GeminiApiAdapter` (REST), `WebLlmAdapter` (in-browser MLC). Tool calling via each backend's native channel (`functionDeclarations` / `responseConstraint` / `response_format`).
- Archivist demo: `recallContext` node runs first on every visitor message. Issues SPARQL queries across `urn:dagonizer:state:*` graphs for prior intents (token-overlap ranked), recently shortlisted candidates, and similar prior queries (Jaccard ≥ 0.15). Populates `state.recalledContext` and a 1–2 sentence `summary` string. `classifyIntent` and all five `composeResponse` paths consume the summary as conversational priors for continuity across sessions.
- Archivist demo: `SubjectSearchTool` + `subjectScout`. OpenLibrary subject search wired into every fan-out branch (now 4 sources per intent: openlibrary + google-books + subject + wikipedia). Visitors can find books by theme/subject ("labyrinth house that eats people") rather than only by title/author.
- Archivist demo: workshop UI collapsed to 4 tabs — DAG, Memory (merged ontology + memory + state + prov RDF graph), Trace (merged logger + lifecycle + state-update feed via new `TraceFeed`), Timeouts (per-phase controls promoted from a floating drawer to a proper tab via `TimeoutPane`). Memory graph rendering bug fixed — ontology layer (`urn:dagonizer:ontology`) now mapped, colored, and chip-filterable alongside memory/state/prov.
- Archivist demo: graph chrome normalized across DagGraph and MemoryGraph — D-pad navigation bottom-right, kind/layer legend bottom-left. DagGraph uses strict `rankDir: 'TB'` with `ranker: 'tight-tree'` for a clean top-to-bottom flowchart.

- Archivist demo: molecular DAG composition. Two reusable deep-DAGs shipped as components — `BookSearchFanoutDAG` (4-source parallel scout cluster + rank + merge + record + citations-gate, used in three intent branches) and `ComposeRetryLoopDAG` (recall + compose + validate with bounded retry, the shared response terminus). Each deep-DAG exports a `register{Name}Nodes(dispatcher)` helper so consumers import the cluster and register its nodes in one call. `archivistDAG` shrinks from 348 → 236 lines and now reads as a composition of named deep-DAGs. `CytoscapeRenderer` receives the deep-DAG registry and expands each placement inline — no opaque boxes.
- Archivist demo: two-column responsive layout following the iridis container-query pattern. Left column tabs: Conversation, Config (absorbs BackendPicker, TimeoutPane, PersistenceBadge, CheckpointControls, API key). Right column tabs: DAG, Memory, Trace. Single-column on narrow widths; switches to two-column at ≥720px container width via `@container archivist (min-width: 720px)` — breakpoint is the component's own width, not the viewport.
- Archivist demo: docs page (`docs/examples/the-archivist.md`) inlines example source via VitePress `<<<` code imports directly from `examples/the-archivist/`. Single source — the file that runs in the demo is the same file shown on the page. Removed the stale Mermaid flow block (pre-fan-out topology), the GitHub source-tree listing, and other content the live demo now visualizes.
- Archivist demo: shared graph chrome — `GraphDpad.vue` (3×3 D-pad with optional zoom readout) and `GraphLegend.vue` (tab-based, click-to-toggle entries) drive both DagGraph and MemoryGraph identically. Both panes share a `.graph-pane` class (`640px`) so tab-switching feels consistent. Both auto-fit after their layout settles.
- Archivist demo: `recall-memories` meta-query intent. Visitor questions about the agent's own history (what books seen, what queries asked, what intents classified) route through a dedicated branch — `recallMemories` SPARQL-aggregates the persistent state graphs into a `MemoryDigest`, `composeMemoryResponse` turns it into a warm in-character reply via a new `LlmClient.composeMemoryRecall` method. Classifier prompt narrowed: off-topic now means "unrelated to books **and** unrelated to your memory".

- Archivist demo: zoom-out clamped at fit on both graphs. DagGraph's `minZoom` re-anchors to the fit zoom level after every `fit()`; MemoryGraph tracks `fitZoomLevel` and clamps both button + wheel zoom-out so the graph never shrinks below its fitted view.
- Archivist demo: `decideTools` now requires all four search tools (OpenLibrary, Google Books, Subject, Wikipedia) for visitor lookups — strengthened prompt + safety-net post-processor that appends missing tools when the LLM returns a partial plan. Tool-plan query strings are unwrapped via an `unquote()` helper before being passed to fetch, fixing the `""double-quoted""` query bug.
- Archivist demo: always-respond on failure. New `composeEmptyResponse` LLM node replaces the canned `declineEmpty` path — when all scouts return empty, an `ownTheGap` prompt directive produces an in-character response that acknowledges what was searched, explains the gap, and offers one alternative angle. `state.failureCause` accumulates sanitized per-scout failure notes (source + outcome, no URLs/keys/stack traces) and feeds the prompt.
- Archivist demo: per-phase timeout defaults raised to 60s (compose, web-search) and 30s (rank) — agents are slow, especially web-bound scouts. `TimeoutPane` + `ArchivistRunner` reflect the new defaults.
- Docs: phase example pages (`01-linear` through `08-checkpoint`) now import their snippets from `examples/the-archivist/` via VitePress `<<<` code imports (`#region` markers for partial files). Single source — the runtime example IS the documented example. Eight pages, six source files with region markers added.

- Archivist demo: starter-query LLM suggestion + clear-on-send. On fresh sessions the input pre-fills with a random visitor-style question about a popular author/series (via new `LlmClient.suggestStarterQuery()`); falls back to a 12-entry static pool if the model errors. After every send, the input clears immediately.

### Fixed

- Engine: `runNodes` no longer fires `onFlowStart`/`onFlowEnd` or calls `state.markRunning`/`markCompleted` when invoked recursively from `executeDeepDAG`. Consumers see exactly one flow-start and one flow-end per top-level `execute()` call regardless of deep-DAG depth.
- Archivist demo: duplicate response bug resolved at the engine level. `ComposeRetryLoopDAG` routes its outputs to the parent-owned `respond-to-visitor` placement; the engine lifecycle fix ensures `onFlowEnd` fires once per run. The UI-side `dagName === 'the-archivist'` guard is removed — the engine invariant is the guarantee.
- Engine: `CytoscapeRenderer` deep-DAG inline expansion no longer emits dangling `<placement>/END` edges. When recursing into an expanded deep-DAG (`prefix` non-empty), `null` targets refer to the deep-DAG's terminus, not the parent's END — those internal terminal markers are now suppressed so the compound parent's own outgoing edges carry the real external routing.

### Changed

- Engine: deep-DAG placements that route any output to `null` (terminal) are rejected at `registerDAG` time. Deep-DAGs are reusable components; only the parent DAG owns END. The error message names the offending placement, route, and DAG so misconfiguration is immediately actionable.

### Removed

- Archivist demo: `OntologyGraph.vue`, `MemoryPane.vue`, `LogStream.vue`, `TraceList.vue`, `TimeoutDrawer.vue` — superseded by the merged Memory tab, `TraceFeed`, and `TimeoutPane`.

- `./types` subpath export — type-only barrel of every public interface and entity-derived type. Consumers import the type surface without pulling runtime classes (`import type { DAG, NodeInterface } from '@noocodex/dagonizer/types'`).
- `./core` subpath export — pluggable execution primitives (`ParallelCombiner`/`ParallelCombiners`, `FanInStrategy`/`FanInStrategies`).
- `DAGErrorInterface` exported from `./errors`.
- Three-tier interface taxonomy documented in `CLAUDE.md` and `docs/architecture.md`: class-shape interfaces colocated with their class, adapter contracts at the root of `src/contracts/`, entity-narrowing interfaces colocated with the entity.
- Read accessors on `Dagonizer`: `getDAG(name)`, `listDAGs()`, `getNode(name)`, `listNodes()`. Snapshots are independent shallow copies of the registry.
- `SignalComposer` static class in `runtime/`. `SignalComposer.compose(options)` folds caller `signal` and `deadlineMs` into a single `AbortSignal`. The dispatcher delegates to it; consumers reuse it directly to compose cancellation outside the dispatcher.
- `ParallelCombiner` abstract class + `ParallelCombiners` registry in `core/`. Defaults `all-success` / `any-success` / `collect` register at module load. Consumers extend `ParallelCombiner` and call `ParallelCombiners.register(new MyCombiner())`.
- `FanInStrategy` abstract class + `FanInStrategies` registry in `core/`. Defaults `append` / `partition` / `custom` register at module load. The `FanInExecution` context exposes the state accessor and an `invokeNode(name)` method for custom strategies.
- `StateAccessor` adapter contract in `contracts/` with default `DottedPathAccessor` in `runtime/`. `Dagonizer` accepts an `accessor` option to swap path resolution.
- Per-entity validators on `Validator`: `node`, `nodeContext`, `nodeOutput`, `nodeError`, `nodeWarning`, `nodeResult`, `nodeStateData`, `executionResult`, `validationResult`, `dagErrorJson`, `fanInConfig`, `singleNode`, `parallelNode`, `fanOutNode`, `deepDAGNode`, `dagLifecycleState`. Existing `dag` and `checkpoint` retained.
- Generic services container on `NodeContextInterface<TServices>`. `Dagonizer<TState, TServices>` accepts `{ services }` at construction; the same reference flows through every node's `context.services`. `TServices` defaults to `undefined` for nodes that don't depend on injected services.
- `CheckpointStore` adapter contract in `contracts/`. `MemoryCheckpointStore` ships as a reference in-process implementation. `Checkpoint.persist(store, key, data)` and `Checkpoint.recall(store, key, restoreState)` compose the codec with the store; `RecalledCheckpoint<TState>` is the recall return shape.
- `./derive` subpath export. `OperationContract` adapter contract in `contracts/`; `FlowDeriver.derive(opts)` produces a `DAG` from a contract registry plus declared `FlowAnnotations` (terminals, fanouts). Topology updates automatically as contracts change.
- `./viz` subpath export. `MermaidRenderer.render(dag)` emits Mermaid `flowchart` source for any `DAG`. Single nodes render as rectangles, fan-outs as hexagons, deep-dags as stadia, parallel placements as subgraphs.

### Changed

- Class-shape interfaces colocated with their class. `DagonizerInterface` lives in `Dagonizer.ts`; `NodeStateInterface` lives in `NodeStateBase.ts`; `DAGErrorInterface` lives in `errors/DAGError.ts`. Subpath imports unchanged for consumers of the root barrel.
- `SingleNodeInterface` renamed to `SingleNodePlacementInterface`. Disambiguates the DAG-config narrowing from `NodeInterface` (the adapter contract).
- Adapter contracts have a single source of truth in `src/contracts/`. `runtime/` re-exports them through its barrel for ergonomic co-import; the source files no longer carry duplicate `export type` declarations.
- Constant exports unified — `FanInStrategyName`, `FanOutOutput`, `MetadataKey`, `Output`, `ParallelCombine`, `NodeType` each ship value+type under one identifier. The `…Type` aliases are removed.
- Wire-shape constant `FanInStrategy` renamed to `FanInStrategyName` (JSON enum unchanged: `'append' | 'custom' | 'partition'`). The `FanInStrategy` identifier is the abstract class consumers extend in `core/`.
- `Dagonizer` constructor takes `DagonizerOptionsInterface` (currently `{ accessor?: StateAccessor }`). Calls without arguments continue to work.

### Breaking

- **DAG wire format is canonically JSON-LD.** The flat `'type'` discriminator field is removed. Node placements use `@type` with string IRIs: `"SingleNode"`, `"ParallelNode"`, `"FanOutNode"`, `"DeepDAGNode"`. Persisted DAG JSON using the old flat `type` shape does not parse.
- **`SubDAGNode` → `DeepDAGNode`.** The entity, schema, and TypeScript type are renamed. `Validator.subDAGNode` → `Validator.deepDAGNode`. `SubDAGNodeSchema` → `DeepDAGNodeSchema`. All identifiers that referenced `SubDAG` now reference `DeepDAG`.
- **`DAGBuilder.subDAG()` → `DAGBuilder.deepDAG()`.** The builder method is renamed. Call sites using `.subDAG(name, dagName, routes, options)` must change to `.deepDAG(name, dagName, routes, options)`.
- **`DagJsonLd` projection module removed.** The DAG IS JSON-LD natively; there is no separate projection layer and there are no `toJsonLd` / `fromJsonLd` helpers. Code that imported `{ toJsonLd, fromJsonLd } from '@noocodex/dagonizer'` or `from '@noocodex/dagonizer/entities'` must be deleted — the DAG value returned by `DAGBuilder.build()` (or read off the wire) IS the JSON-LD document. `Dagonizer.load(json)` / `serialize(dag)` remain the standard parse/stringify surface.
- **`examples/the-archivist/subdags/` directory renamed to `examples/the-archivist/deepdags/`.** Any import paths that referenced `subdags/` must be updated to `deepdags/`.

## [0.4.0] - 2026-05-15

### Changed

- **`DAGLifecycleState` normalized to uniform 5-field shape.** All six lifecycle variants (`pending`, `running`, `completed`, `failed`, `cancelled`, `timed_out`) now carry identical keys — `kind`, `startedAt`, `finishedAt`, `error`, `reason` — with `null` for fields not meaningful in a given state. V8 sees one hidden class regardless of which variant is live. Breaking changes:
  - `cancelled` state: `cancelledAt` renamed to `finishedAt`; `reason?: string` is now `reason: string` (always present, defaults to `'cancelled'` when omitted from the event)
  - `timed_out` state: `timedOutAt` renamed to `finishedAt`
  - `pending` state: now includes explicit `startedAt: null`, `finishedAt: null`, `error: null`, `reason: null` fields
  - `DAGLifecycleStateSchema` wire schema collapsed from a 6-branch `oneOf` to a single object schema with nullable-typed fields; `additionalProperties: false` still enforced
- **Scheduler API replaced with promise/async-iterable surface.** The callback-based `scheduleAt`/`scheduleAfter`/`scheduleEvery` methods and `ScheduledTask` interface are removed. The new API:
  - `scheduler.after(delayMs, signal?)` — resolves after delay; signal cancels
  - `scheduler.at(atMs, signal?)` — resolves at monotonic timestamp; signal cancels
  - `scheduler.every(intervalMs, signal?)` — async iterable; yields once per interval until signal fires
  - `scheduler.cancelAll()` — cancels all in-flight timers for this scheduler instance
  - `ScheduledTask` interface removed from public exports
  - `RealTimeScheduler` rewritten to use `node:timers/promises` `setTimeout` (natively signal-aware)
  - `VirtualScheduler` (testing) rewritten to a sorted-array promise resolver; `advance(ms)`, `runUntil(atMs)`, `runAll()` test control methods preserved; `pendingCount` replaces `activeTaskCount`
  - `RetryPolicy.sleep` updated to `await Scheduler.current().after(ms, signal)` — no manual signal wiring

## [0.4.0] - 2026-05-14

### Added

- **Flow → DAG terminology shift.** The static graph definition is a DAG; all public identifiers reflect this.
  - `FlowConfig` → `DAG` (entity and TypeScript type); `FlowConfigSchema` → `DAGSchema`; `$id` updated to `https://noocodex.dev/schemas/dagonizer/DAG`.
  - `FlowBuilder` class → `DAGBuilder`; builder method `subFlow` → `subDAG`; option type `SubFlowOptionsInterface` → `SubDAGOptionsInterface`.
  - `SubFlowNode` entity/schema/type → `SubDAGNode`/`SubDAGNodeSchema`; discriminator `type: 'sub-flow'` → `type: 'sub-dag'`; JSON field `flow` → `dag`.
  - `Dagonizer.registerFlow(flow)` → `Dagonizer.registerDAG(dag)`; internal private `flows` Map → `dags`.
  - `Dagonizer.execute(flowName, ...)` → `Dagonizer.execute(dagName, ...)`; `resume(flowName, ...)` → `resume(dagName, ...)`.
  - `NodeContextInterface.flowName` field → `dagName`; `NodeContextSchema` property updated accordingly.
  - `CheckpointData.flowName` field → `dagName`; `CheckpointDataSchema` required property updated; `Checkpoint.from(dagName, result)` and `Checkpoint.restore` return `dagName`.
  - `Validator.flow` → `Validator.dag`.
  - `entities/flow/` directory → `entities/dag/`; `FlowConfig.ts` → `DAG.ts`; `SubFlowNode.ts` → `SubDAGNode.ts`.
  - `@noocodex/dagonizer/entities/flow` subpath export → `entities/dag`.
- **Static codec methods on `Dagonizer`.** `FlowLoader` and `FlowSerializer` deleted; equivalent surface moved onto `Dagonizer` as static methods.
  - `Dagonizer.load(json: string): DAG` — parses JSON and validates against `DAGSchema`. Throws `ValidationError` for malformed JSON or schema violations.
  - `Dagonizer.fromValue(value: unknown): DAG` — validates an already-decoded value.
  - `Dagonizer.serialize(dag: DAG): string` — pretty JSON (2-space indent).
  - `Dagonizer.serializeCompact(dag: DAG): string` — compact JSON.
- **Entity-ization pass.** Every data shape and every constant is now backed by a JSON Schema draft-2020-12 entity (`entities/<domain>/<Name>.ts`) with a `*Schema` const and a `FromSchema`-derived type. New domains: `node/`, `execution/`, `validation/`, `errors/`, `constants/`, `runtime/`.
  - Node domain: `Node`, `NodeContext`, `NodeError`, `NodeWarning`, `NodeOutput`, `NodeResult`, `NodeStateData`
  - Execution domain: `ExecutionResult`
  - Validation domain: `ValidationResult`
  - Errors domain: `DAGErrorJSON` (the `toJSON()` wire shape)
  - Constants domain: `FanInStrategy`, `FanOutOutput`, `MetadataKey`, `Output`, `ParallelCombine`, `NodeType` — each with a JSON Schema enum, a `FromSchema`-derived union type, and a const object namespace satisfying that type
  - Runtime domain: `BackoffStrategy` (migrated from `runtime/RetryPolicy.ts` to `entities/runtime/BackoffStrategy.ts`)
- **Interface refactors.** Interfaces in `src/types/` that hold data now extend or re-export their corresponding entity types:
  - `NodeOutputInterface<TOutput>` extends `Omit<NodeOutput, 'errors' | 'output'>` and narrows both fields
  - `NodeInterface<TState, TOutput>` extends `Omit<Node, 'outputs'>` and narrows `outputs`
  - `NodeContextInterface` extends `NodeContext` and adds `signal: AbortSignal`
  - `NodeErrorInterface` extends `Omit<NodeError, 'context'>` and narrows `context`
  - `NodeWarningInterface` = `NodeWarning` (type alias)
  - `ValidationResultInterface` = `ValidationResult` (type alias)
  - `ExecutionResultInterface<TState>` extends `Omit<ExecutionResult, 'state'>` and narrows `state`
  - `NodeResultInterface<TState>` extends `Omit<NodeResult, 'state'>` and narrows `state`
  - `DAGErrorJSONInterface` = `DAGErrorJSON` (type alias)
  - `FlowConfigInterface` = `FlowConfig`, `FanInConfigInterface` = `FanInConfig`, `FanOutNodeInterface` = `FanOutNode`, `ParallelNodeInterface` = `ParallelNode`, `SubFlowNodeInterface` = `SubFlowNode`, `SingleNodeInterface<TOutput>` extends `Omit<SingleNode, 'outputs'>` and narrows `outputs`
  - `NodeStateData` entity documents the persistence wire shape for `NodeStateBase.snapshot()` without `NodeStateInterface` extending it (the `lifecycle.error` field carries an in-memory `Error`, not JSON-expressible)
- `entities/index.ts` barrel updated — all new schema constants and derived types are exported, grouped by domain.
- `src/index.ts` re-exports constants (`FanInStrategy`, `FanOutOutput`, `MetadataKey`, `Output`, `ParallelCombine`, `NodeType`) from `entities/index.js` instead of the now-removed `constants.ts`.

### Removed

- `FlowLoader` class (`src/validation/FlowLoader.ts`) — superseded by `Dagonizer.load` / `Dagonizer.fromValue`.
- `FlowSerializer` class (`src/validation/FlowSerializer.ts`) — superseded by `Dagonizer.serialize` / `Dagonizer.serializeCompact`.
- `src/constants.ts` — all constants migrated to `entities/constants/` with JSON Schema backing.

- **Single execution path.** `Dagonizer.execute()` and `Dagonizer.resume()` now both return an `Execution<TState>` that is both async-iterable (yields each node as it completes) and `PromiseLike<ExecutionResultInterface>` (awaits the final summary). One generator body — sync-style is just iteration that consumes every node before resolving. Iteration and `await` on the same execution share the same underlying generator; the flow body runs exactly once.
- `Dagonizer.resume(flowName, state, fromNode, options?)` — continues a flow from a given node. Caller rehydrates `state` first (typically via `Checkpoint.restore`).
- `cursor: string | null` field on `ExecutionResultInterface` — the next node to run on abort, or `null` on clean completion.
- `NodeStateBase.snapshot()` — serialize state to a `JsonObject` (metadata + errors + warnings, lifecycle excluded). Subclasses override `snapshotData()` to include domain fields.
- `NodeStateBase.restore(snapshot)` — static factory rehydrating a state instance with fresh `pending` lifecycle. Subclasses override `restoreData()` to read their fields.
- `CheckpointData` entity (`entities/checkpoint/CheckpointData.ts`) — schema + `FromSchema`-derived type. Schema fields: `version`, `flowName`, `cursor`, `state`, `executedNodes`, `skippedNodes`. `CHECKPOINT_DATA_VERSION` = `'1'`.
- `CheckpointDataValidator` (`schema/CheckpointDataValidator.ts`) — pre-compiled Ajv validator. Shares the `sharedAjv` 2020-12 instance with `FlowConfigValidator`.
- `Checkpoint` (`checkpoint/Checkpoint.ts`) — `from(flowName, result)` builds a `CheckpointData`; `restore(data, restoreFn)` parses + validates + rehydrates via a state-factory callback; `toJson(checkpoint)` for serialization.
- `JsonValue` / `JsonObject` / `JsonArray` / `JsonPrimitive` types at `entities/json.ts`.
- New subpath export: `@noocodex/dagonizer/checkpoint`.
- Example `08-checkpoint.ts` — abort, persist as JSON, parse back, resume.
- 8 new unit tests covering snapshot/restore round-trip (base + subclass), cursor population on abort vs clean completion, full abort → snapshot → restore → resume cycle using `VirtualClock` / `VirtualScheduler` for deterministic time, schema rejection of malformed checkpoints.

### Changed

- **`execute()` and `resume()` no longer throw on abort, deadline, or node error.** They return an `Execution` that resolves to an `ExecutionResultInterface` with `cursor` set and the state's lifecycle marked (`cancelled` / `failed` / `timed_out`). One result shape, never a thrown exception except for genuinely fatal validation errors at registration time. Catch-and-inspect is replaced with await-and-inspect.
- **`executeIterative()` is removed.** `execute()` is the canonical method for both streaming and sync-style consumption. `for await (const node of dispatcher.execute(...))` replaces every prior `executeIterative` call site.
- v0.2 tests that asserted `assert.rejects` on cancellation / timeout / unwired-output flows now assert on the returned `ExecutionResult.cursor` and `state.lifecycle.kind`.
- Sub-flow execution internally uses the canonical `runStages` generator instead of the removed `executeIterative` method.

### Breaking

- `executeIterative(flowName, state, options?)` → use `execute(flowName, state, options?)` and iterate the returned `Execution`. Identical streaming semantics.
- `execute()` return type changes from `Promise<ExecutionResultInterface>` to `Execution<TState>`. `await dispatcher.execute(...)` still works because `Execution` is `PromiseLike` — most call sites need no change.
- Aborted / failed / timed-out runs no longer reject. The result's `cursor` and the state's `lifecycle.kind` indicate what happened. Code that did `await assert.rejects(execute(...))` must move to `const result = await execute(...); assert.equal(result.state.lifecycle.kind, 'cancelled')`.
- `ExecutionResultInterface` gains a required `cursor: string | null` field.

## [0.3.0] - 2026-05-12

### Added

- Entities folder (`src/entities/`) with a per-shape file pattern: `<Name>Schema` constant + `FromSchema<typeof Schema>` derived type. Layout:
  - `entities/flow/` — `FlowConfig`, `SingleNode`, `ParallelNode`, `FanOutNode`, `SubFlowNode`, `FanInConfig`
  - `entities/state-machines/` — `DAGLifecycleState` (wire shape; in-memory `Error` type still lives at `lifecycle/`)
- `FlowConfigSchema` — JSON Schema draft-2020-12 with `$id` `https://noocodex.dev/schemas/dagonizer/FlowConfig`. Inlines node-entry sub-shapes via `oneOf`; standalone sub-shape schemas remain exported for per-shape validation.
- `FlowConfigValidator` — pre-compiled Ajv validator (`Ajv2020`, `allErrors: true`). `is(value)` predicate, `validate(value)` throwing `ValidationError`, `errors(value)` returning a formatted list.
- `FlowLoader.fromJson(text)` / `fromValue(value)` — single permitted ingest boundary where `unknown` enters the package. JSON.parse → Ajv-narrow → `FlowConfig`.
- `FlowSerializer.toJson(flow)` / `toCompactJson(flow)` — symmetric counterpart for the round-trip.
- `Dagonizer.registerFlow()` now runs the schema validator as a structural pre-pass before semantic validation. Schema errors surface as `ValidationError`; semantic errors (unknown nodes, missing outputs, sub-flow cycles) continue to surface as `DAGError`.
- New subpath exports: `@noocodex/dagonizer/schema`, `@noocodex/dagonizer/entities`.
- Example `07-schema.ts` — load + validate + execute + round-trip a JSON flow.
- 12 new unit tests covering Ajv success/failure paths, FlowLoader malformed-JSON handling, round-trip equality, and the `ValidationError` vs `DAGError` boundary.

### Changed

- Added runtime deps: `ajv` (^8.20.0) and `json-schema-to-ts` (^3.1.1). No Zod.

### Schema entity pattern

Each entity file follows the swap-friendly pattern:

```ts
import type { FromSchema } from 'json-schema-to-ts';
export const FooSchema = { '$id': '...', ... } as const;
export type Foo = FromSchema<typeof FooSchema>;
```

The schema bodies and `$id`s are stable. Type derivation can be migrated to a future schema-registry package without changing entity definitions.

## [0.2.0] - 2026-05-12

### Added

- `Clock` + `Scheduler` singletons with installable providers (`VirtualClockProvider`, `VirtualScheduler`, `RealTimeScheduler`). Lifecycle FSM and retry waits flow through them — tests pin time deterministically.
- `NodeContextInterface` passed as the second argument to every `NodeInterface.execute(state, ctx)`. Carries `signal: AbortSignal`, `flowName`, `nodeName`.
- Cancellation: `Dagonizer.execute(name, state, { signal?, deadlineMs? })`. The dispatcher composes the caller's signal with `AbortSignal.timeout(deadlineMs)` via `AbortSignal.any()` and marks state `cancelled` / `timed_out` per the reason.
- `RetryPolicy` (in `runtime/`): strategy enum (`CONSTANT | LINEAR | EXPONENTIAL | DECORRELATED_JITTER`), `retryOn` / `abortOn` filter lists, `getDelay(attempt, error)`, `shouldRetry(error, attempt)`, `run(fn, signal)`. Delays scheduled through `Scheduler.current()`; honors abort mid-wait.
- Class-extension hooks on `Dagonizer`: `protected onFlowStart`, `onFlowEnd`, `onNodeStart`, `onNodeEnd`, `onError`. Subclass and override — no callbacks.
- Type-safe node outputs: `NodeInterface<TState, TOutput extends string>` and `SingleNodeInterface<TOutput>` parameterize the output union. `outputs: Record<TOutput, string | null>` is exhaustiveness-checked at compile time when the node declares a narrow union.
- `FlowBuilder` (in `builder/`): chainable authoring of `FlowConfig`. `node()`, `parallel()`, `fanOut()`, `subFlow()`, `entrypoint()`, `build()`.
- New subpath exports: `@noocodex/dagonizer/runtime`, `@noocodex/dagonizer/builder`.
- Examples 01–06 runnable via `tsx`: linear chain, fan-out + partition, sub-flows, cancellation + deadline, RetryPolicy, FlowBuilder.
- 32 new unit tests covering runtime, retry, cancellation, hooks, builder, fan-in strategies (partition / custom), fan-out concurrency cap, and `NodeStateBase.clone` semantics.

### Changed

- **Canonical instantiation is `new`, not factories.** `Dagonizer.create<TState>()` and `FlowBuilder.create(name, version)` are removed. Use `new Dagonizer<TState>()` and `new FlowBuilder(name, version)`. Single path, supports subclassing directly.
- `Dagonizer` constructor is `public` to support subclass-based observability.
- Nodes are registered widened: internal storage is `NodeInterface<TState, string>` while `registerNode` accepts any narrower `TOutput`. Narrow → wide is sound covariantly on both `outputs` and result `output`.
- Lifecycle FSM (`DAGLifecycleMachine`) now reads time via `Clock.now()` instead of `Date.now()` inline.

### Breaking

- `Dagonizer.create<TState>()` → `new Dagonizer<TState>()`.
- `FlowBuilder.create(name, version)` → `new FlowBuilder(name, version)` (FlowBuilder itself is new in 0.2.0).
- `NodeInterface.execute(state)` → `execute(state, ctx)`. The second arg is required by the type, optional in practice (existing single-arg implementations still work because the extra param is ignored at runtime).

## [0.1.0] - 2026-05-12

### Added

- Initial release.
- `Dagonizer` graph dispatcher with single nodes, parallel groups, fan-out + fan-in, sub-flows.
- `NodeStateBase` with bundled `DAGLifecycleMachine` (pending → running → completed | failed | cancelled | timed_out).
- Validation: duplicate node names, missing entrypoints, unknown nodes, unwired outputs, fan-in strategy/config consistency, circular sub-flow detection.
- `DAGError` hierarchy: `ConfigurationError`, `ExecutionError`, `NotFoundError`, `ValidationError`.
- Public exports under `@noocodex/dagonizer`, `/types`, `/errors`, `/constants`, `/lifecycle`.
- Constants: `FanInStrategy`, `FanOutOutput`, `MetadataKey`, `Output`, `ParallelCombine`, `NodeType`.
