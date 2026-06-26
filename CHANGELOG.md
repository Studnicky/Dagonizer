# Changelog

All notable changes to `@studnicky/dagonizer` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

- **Docs/build toolchain dependency advisories resolved (`pnpm audit` clean).** Pinned patched versions of transitive dev-only dependencies via `pnpm.overrides`: `vitepress > vite` to `^6.4.3` (verified: VitePress 1.6.4 builds on Vite 6 — the Vite advisories are dev-server CVEs that do not affect the static docs build or the deployed site), `dompurify` (via mermaid) to `>=3.4.11`, `esbuild@0.28` to `>=0.28.1`, `js-yaml@4` (via changesets) to `^4.2.0`, and `read-yaml-file` to `^2.1.0` (drops the last `js-yaml@3` instance from the changesets release tooling; `changeset version` verified end-to-end on the new resolution). No published-package runtime dependency changes.

### Changed

- **`ObservedDag<TState>` replaces `ObservedDagonizer` and `ObservedArchivist`.** A single generic base class (`ObservedDag<TState extends NodeStateInterface>`) that takes an injected `ConsoleLogger` and wires all lifecycle hooks to leveled log lines. Class extension is the one observation mechanism — callback injection (`ObservedDagonizer`) is removed. Both the Archivist and Cartographer browser runners subclass `ObservedDag<TState>` directly. The Archivist browser observer adds a `ARCHIVIST_NODE_TRACE` dispatch map that emits `INFO` lines for extracted search terms, each tool's search query, candidate counts from tool scouts, and the final shortlist count — now visible in the trace panel. `ConsoleLogger.maxBuffer` default raised from 500 to 1000.
- **`extract-query` validates non-empty terms before routing `success`.** Previously, if the LLM returned an empty array (malformed output), the node silently routed `success` with `state.terms = []` — `buildBookWorksets` then built no tool arguments, tools returned `[]`, and `merge-candidates` went empty with no diagnostic. Now an empty-terms result enters the retry/salvage budget, the same path taken on an LLM error.
- **All 23 switch statements converted to dispatch maps** across the engine, adapters, and both example apps. `ChannelDispatch`, `DagHost`, `MermaidRenderer`, `JsonLdRenderer`, `CytoscapeRenderer`, `PlacementDispatch`, `GeminiApiAdapter`, `CanonicalId`, and all Archivist/Cartographer nodes now use `Record<key, handler>` maps.
- **Underscore-prefixed identifiers removed repo-wide.** `NodeStateBase` private fields converted to `#` ECMAScript private (`#errors`, `#lifecycle`, `#metadata`, `#retries`, `#warnings`); underscore-prefixed parameters dropped or renamed across all pattern nodes, adapters, embedders, and example nodes.
- **`'_sources'` notes key renamed `'sources'`** across `CanonicalId`, `GoogleBooksTool`, `openLibraryTypes`, and `WikipediaSummaryTool`. All read sites updated.

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
- **Mandatory per-port `outputSchema` node contract.** Every `NodeInterface` declares `readonly outputSchema: Record<TOutput, SchemaObjectType>` — a JSON Schema 2020-12 partial for each output port describing the state delta the node writes. `MonadicNode.outputSchema` is `abstract`: there is no passthrough default, so a concrete node that omits its return shapes does not compile. The compiler is the enforcement — the contract is declared everywhere, for every node in the engine, the pattern packages, and the examples. `ToolDefinitionType` gains a required `outputSchema` field mirroring `inputSchema`. `SchemaObjectType` is exported from the root barrel and `./contracts`.
- **Opt-in output validation as a dedicated lifecycle stage (`validateOutputs`).** Output-contract validation is a first-class stage in the scheduler work-set loop, run between a node firing and its routed output being pushed downstream — `fire → validate → route` — never folded into `node.execute`. `OutputContractApplier` is the single enforcement point; it covers `ScalarNode` and `MonadicNode` subclasses uniformly, and the scatter path re-applies the same stage at each per-item emit into the gather. `DagonizerOptionsType.validateOutputs` (default `false`) gates it: when off, `outputSchemaValidator` is null and the stage returns the routed map unchanged — a single null-check, byte-identical to pre-contract routing. When on, per-item state is validated against `outputSchema[port]`; on mismatch the item re-routes to `'error'` with code `outputContractViolation`. Enable in dev/test via `new Dagonizer({ validateOutputs: true })`.
- **Tool input/output contract validation.** `ToolInvokeNode` validates the resolved input against `tool.definition.inputSchema` before execution (code `toolInputContractViolation`) and the result against `tool.definition.outputSchema` after execution (code `toolOutputContractViolation`). Both are always active. Validators are compiled once at `ToolRegistry.register()` time and reused across `bundle()` calls.
- **`StreamChannel<T>`** (`@studnicky/dagonizer/channels`): bounded push-to-pull bridge. Three static factories: `StreamChannel.driven(producer, options?)` wires one `StreamProducerInterface<T>` to the channel; `StreamChannel.fanIn(producers, options?)` merges multiple producers (closes when all settle, fails on first rejection); `StreamChannel.resumable(producer, resumeAfter, options?)` drives a `ResumableStreamProducerInterface<T>` from a resume ordinal. The channel implements `AsyncIterable<T>` so it is assignable directly as a scatter source. `StreamChannelOptionsType` controls `capacity` (default 256) and `signal` (abort).
- **`StreamCursor`** (`@studnicky/dagonizer/channels`): resume-ordinal accessor. `StreamCursor.resumeAfter(state, scatterName, options?)` returns the scatter's durable pull count (`nextIndex`) from the checkpoint. Returns 0 on a fresh run. Pair with `StreamChannel.resumable` for deterministic scatter resume: the producer skips its first `resumeAfter` emissions and the scatter resumes from the next un-consumed item with no duplicates and no gaps.
- **`StreamSinkInterface<T>`**, **`StreamProducerInterface<T>`**, **`ResumableStreamProducerInterface<T>`** (`@studnicky/dagonizer/contracts`): the push-side contracts. `StreamSinkInterface` declares `push(item): Promise<void>`. `StreamProducerInterface` declares `produce(sink): Promise<void>`. `ResumableStreamProducerInterface` declares `produce(sink, resumeAfter): Promise<void>`.
- **`DagStreamProducer<T>`** (`@studnicky/dagonizer/patterns`): abstract base class that bridges an inner DAG's per-node result stream into a push sink. Subclasses implement `protected abstract executions(): AsyncIterable<NodeResultType<NodeStateInterface>>` (run the inner DAG in streaming mode) and `protected abstract select(stage): Iterable<T>` (extract items from each node result). The `produce` method drives the inner execution and awaits `sink.push` for each selected item — back-pressuring the inner DAG at the outer scatter's drain rate.
- **Example 34 — StreamChannel driven producer** (`examples/34-stream-channel.ts`): a `NumberProducer` implementing `StreamProducerInterface<number>` pushes a finite burst of integers via `StreamChannel.driven` into a scatter. Shows bounded-memory back-pressure with `capacity: 4`.
- **Example 35 — StreamChannel fanIn and resumable** (`examples/35-stream-fanin-resume.ts`): two `RangeProducer` instances merged via `StreamChannel.fanIn`; then a `DeterministicProducer` demonstrates resume — the first run processes 0..9, `StreamCursor.resumeAfter` reads 10, the second run with `StreamChannel.resumable` skips the first 10 and delivers 10..19 with no duplicates.
- **Example 36 — DagStreamProducer** (`examples/36-dag-stream-producer.ts`): a `LabelStreamProducer extends DagStreamProducer<string>` runs an inner DAG's per-node result stream through `select`, extracting label strings that feed an outer scatter.

### Removed

- **`Instrumentation` plugin contract removed. ⚠ BREAKING.** `Instrumentation<TState>`, `InstrumentationSink`, `NoopInstrumentation`, and `ForwardingInstrumentation` are removed from all subpaths. The `instrumentation` field on `DagonizerOptionsInterface` and `DagContainerOptions` is removed. Observability is now exclusively via the protected `on*` hooks on `Dagonizer` subclasses (`onFlowStart`, `onFlowEnd`, `onNodeStart`, `onNodeEnd`, `onError`, `onPhaseEnter`, `onPhaseExit`, `onContractWarning`). For contained (worker/process) DAGs, `WorkerObserver` bridges events from the isolate through `ObserverRelay` to the parent dispatcher's protected hooks — no consumer change required for containment observability. **Migration:** delete any `instrumentation: new MyInstrumentation()` constructor argument; fold the hook logic into `protected override on*` methods on your `Dagonizer` subclass.
- **`HttpTransport.validate` callback option removed. ⚠ BREAKING.** The `validate` field on `HttpRequestOptions` is gone — callback-based extension is forbidden. `getJson`/`postJson`/`request` return the parsed JSON typed as the caller's `TResponse`; narrow it in your own domain layer (a type-guard or schema validator). **Migration:** drop `validate: …` from request options and validate the returned value at the call site.
- **Adapter option-type aliases removed. ⚠ BREAKING.** `CerebrasApiAdapterOptions`, `GroqApiAdapterOptions`, and `MistralApiAdapterOptions` (re-aliases of `OpenAiCompatibleAdapterOptions`) are removed. **Migration:** import `OpenAiCompatibleAdapterOptions` from `@studnicky/dagonizer/adapter` directly.
- **Tool packages no longer re-export `@studnicky/dagonizer-book-entities` symbols. ⚠ BREAKING.** `Book`, `Candidate`, `Money`, and `CanonicalId` are no longer re-exported from the `dagonizer-tool-*` barrels. **Migration:** import them from `@studnicky/dagonizer-book-entities` (now a direct dependency of each tool).
- **`WebSystemInfo.crossOriginIsolated` removed.** The unused reserved field/getter is dropped from `@studnicky/dagonizer-executor-web`.
- **`Dagonizer.load` / `fromValue` / `serialize` / `serializeCompact` static methods removed. ⚠ BREAKING.** DAG-document (de)serialization moved to the dedicated `DAGDocument` static class (root barrel + `@studnicky/dagonizer/entities`). **Migration:** replace `Dagonizer.serialize(dag)` / `Dagonizer.load(json)` with `DAGDocument.serialize(dag)` / `DAGDocument.load(json)`. (The instance `dispatcher.load` for registering a DAG into a running dispatcher is unchanged.)
- **`TypedStore` no longer re-exposes the store lifecycle. ⚠ BREAKING.** `snapshot`/`restore`/`connect`/`disconnect` are removed from `TypedStore`; access them via `typedStore.inner`. `TypedStore` keeps only its typed `set`/get surface.

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
- **O(1)-memory scatter checkpoint (`bounded` mode).** `ScatterProgress` is now a discriminated union keyed by `mode: 'bounded' | 'retained'`. Compactable gather strategies (all built-ins: `append`, `map`, `collect`, `partition`, `discard`) persist a `watermark` (highest contiguous completed index), `aheadAcked` (out-of-order completions not yet contiguous with the watermark), and `outcomeTally` (per-output-token count) instead of an unbounded `ackedResults` array. Memory usage during scatter execution is now O(concurrency) rather than O(n). The `retained` mode is preserved for custom gather strategies (via `CustomGatherStrategy`) that require full record sets at finalize time. `ScatterCheckpoint` exposes `writeBounded` and `writeRetained` in place of the removed `write` method. `GatherStrategy` gains a `retainsRecordsForFinalize` property (default `false`); `CustomGatherStrategy` overrides it `true`.
- **`GatherFinalizeRecord`** (`@studnicky/dagonizer/contracts`): a lightweight record carrying `index`, `item`, `output`, and `terminalOutcome` without `cloneState`, used for the batch-apply finalize pass. `GatherExecution.records` is now `GatherFinalizeRecord[]`.

- **`EMPTY_CONTRACT_FRAGMENT` is now public** (root barrel and `@studnicky/dagonizer/contracts`). It is the canonical value a node assigns to `contract` when it declares no data-flow for `DAGDeriver`.
- **`IncrementalGatherStrategy`** (`@studnicky/dagonizer/core`): an abstract subclass of `GatherStrategy` that makes `applyIncremental` a required member for strategies advertising `supportsIncremental`. Batch-only strategies extend `GatherStrategy`; incremental strategies extend `IncrementalGatherStrategy`.
- **`StoreSnapshotSchema` / `StoreSnapshotEntrySchema`** (`@studnicky/dagonizer/entities`): the store-snapshot wire shape is now schema-derived (`FromSchema`) rather than hand-written.
- **`'ABORTED'` `ToolErrorReason`**: a caller-aborted HTTP request now classifies as `ABORTED` (non-retryable) instead of the misleading `UNKNOWN`.
- **`OpenRouterApiAdapterOptions`** gains `referer?` and `title?` so the `HTTP-Referer`/`X-Title` attribution headers are overridable per deployment.
- **`maxAttempts?`** is now a uniform option across every adapter (including `GeminiNanoAdapter` and `WebLlmAdapter`, which previously hard-coded it).
- **`SystemInfo.recommendedWorkerCount(config, probes)`** (root barrel + `@studnicky/dagonizer/entities`): the canonical worker-count clamp, now shared by both `@studnicky/dagonizer-executor-node` and `-web` (the duplicate per-package formulas are removed).
- **`@studnicky/dagonizer-executor-node`** exports `ForkEntry`/`SpawnEntry`/`WorkerEntry` static classes — the process-entry bootstraps are now importable/testable (mirroring `WebWorkerEntry`).
- **`DagHost` static registry injection.** `DagHostOptions.registry` and `WebWorkerEntry.start(scope, registry?)` let a worker entry inject its registry directly, so the host runs no runtime dynamic import — the required path for bundlers that forbid it (a Vite browser/worker build). Without it, `DagHost` imports the `init` message's `registryModule` by URL (the Node `WorkerThreadContainer` path).
- **`@studnicky/dagonizer-embedder-ollama`** supports **Ollama Cloud**: `OllamaEmbedderOptions.apiKey?` sends `Authorization: Bearer <key>` when present (local usage needs no key).
- **Composed `Book` entity** (`@studnicky/dagonizer-book-entities`): `Book` is now `{ identity: BookIdentity; publication: BookPublication; availability: BookAvailability }` with a `BookBuilder.from(BookInput)` factory. ⚠ BREAKING for direct `Book` consumers. **Migration:** read `book.identity.isbn` (was `book.isbn`) etc.; construct with `BookBuilder.from({ isbn, title, … })`.

### Fixed

- **O(1) peak heap for reservoir + container streaming scatter.** Three sources of unbounded heap growth in the scatter/container path are eliminated:
  1. `DagHost` batch path accumulated all N × M inner-node `ExecutorIntermediate` objects in `ExecutionResponse.intermediates` before shipping the result. The array now stays empty for multi-item batches; live observability is unaffected (intermediate messages are still forwarded over the channel in real time).
  2. `ackBatch` removed scatter inbox items via per-item `findIndex + splice` (O(inbox × batch)); replaced with a single O(inbox) in-place filter pass using a pre-built `Set<number>`.
  3. `executeBatch` (all three branches) created child clones that inherited the parent state's `SCATTER_PROGRESS_KEY` and `WORKSET_PROGRESS_KEY` metadata. Those keys carry the full durable inbox (up to `concurrencyLimit × capacity` items). Each clone copied the metadata object via `NodeStateBase.clone()` and then shipped it to the worker inside `state.snapshot()`. At `concurrencyLimit=16` and `capacity=1000` this produced up to 16,000 inbox copies in-flight — O(N²) at scale. Child clones now delete both keys immediately after `createChild`.
  4. `CartographerState.clone()` copied parent-level gather accumulators (`sampleRecords`, `insights`, `journeys`, `records`, `ingestBuckets`, `canonicalEvents`) into every child clone. At 200 `sampleRecords` per clone × 16,000 concurrent clones the copy cost reached ~960 MB. These fields are scatter-gather outputs that child body executions never read; the clone now resets them to empty defaults.

  Measured peak heap at 100 000 events: 129 MB. At 200 000 events: 185 MB. Both are well under 300 MB and roughly flat, proving O(1) growth.

### Changed

- **Services are injected into nodes, not threaded through the dispatcher. ⚠ BREAKING.** The `TServices` type parameter, the `context.services` field, and the `Dagonizer` `services` constructor option are removed engine-wide. A node that needs an external dependency receives it through its own constructor and holds it as an instance field, and is registered with that dependency (`dispatcher.registerNode(new FetchNode(db))`). `Dagonizer` is now `Dagonizer<TState>`; `NodeInterface`, `ScalarNode`, `MonadicNode`, and `NodeContextType` are non-generic over services; `AgentServicesType` is removed. The pattern packages inject their dependency too — `GraphNode(memory)`, `LlmDispatchNode(llm)`, `ScoutNode(tool)`, `CallModelNode(llm)`. This is the framework's DI / class-extension model: the dispatcher carries no ambient services record, so no generic-default cast is needed to materialise one. **Migration:** drop the `<TServices>` type argument and the `{ services }` option; give each node a constructor accepting the dependencies it read from `context.services`, store them as fields, and pass them when constructing the node for registration. State that needs typed metadata reads uses the new cast-free `state.getter` (`MetadataGetter`); `StateAccessorInterface.get` and `EventBus.publish`/`subscribe` now traffic in `unknown` and callers narrow.

- **`TState` eliminated from all engine-internal execution types. ⚠ BREAKING for implementors of engine contracts.** The `TState` type parameter is removed from every contract and class that does not need it at the public boundary. Types affected: `DagContainerInterface` (now non-generic), `DagTaskInterface` (now non-generic), `ScatterItemResultType`, `ScatterItemBatchResultType`, `ScatterPoolDriverInterface`, `ReservoirDriverInterface`, `ScatterWorkerPool`, `ReservoirBuffer`, `DagContainerBase<TWorker>` (was `DagContainerBase<TState, TWorker>`), `RunNodeResultType`, `RunNodesBatchType`, `ScatterRunContextType`, `ScatterDispatchAdapterInterface`, `ScatterDispatchSourceInterface`, `GatherRecordType` (state field is `NodeStateInterface`; `TItem` remains). The new `ChildStateFactoryType` (`(parent: NodeStateInterface) => NodeStateInterface`) and `ChildStateFactory.cloneParent` default make `registerDAG(dag, factory?)` accept isolation factories for child-state construction. `dagFrom` (a dotted state path whose resolved string names the dag at runtime) is now a valid `ScatterNode` body variant alongside `node` and `dag`; unregistered resolved names route to `error`. `DagonizerOptionsType` drops its `TState` parameter. **Migration:** subclasses of `DagContainerBase` drop the first type argument (`DagContainerBase<TState, Worker>` → `DagContainerBase<Worker>`); implementations of `DagContainerInterface` remove the type argument; implementations of `DagTaskInterface` drop the type argument (it is now non-generic); direct uses of the removed types listed above similarly drop their state type argument.

- **Docs toolchain dependency hygiene.** The `pnpm.overrides` block is removed from the workspace `package.json`: the `vue` pin and the `@shikijs/twoslash` pin are both redundant under pnpm 10, which resolves the full Vue range to a single `vue@3.5.38` and the Shiki/twoslash chain to a single `2.5.0` on its own. The lockfile carries no orphaned Shiki/twoslash v4 chain and a single resolved `vue`. VitePress 1.6.4, `@shikijs/vitepress-twoslash@2.5.0`, and the docs typecheck/build are unaffected.
- **`NodeInterface.contract` is now required. ⚠ BREAKING.** The dual "no contract" representation (`undefined` *or* an empty fragment) is collapsed to one: every node carries a `contract`. **Migration:** a node implementing `NodeInterface` directly assigns `readonly contract = EMPTY_CONTRACT_FRAGMENT;` when it declares no data-flow. Nodes extending `MonadicNode` inherit this default and need no change.
- **`NodeInterface.timeout` is now required. ⚠ BREAKING.** Parallel to `contract`: every node carries a `timeout` for V8 shape stability; `Timeout.none()` means "no per-node budget". **Migration:** a node implementing `NodeInterface` directly assigns `readonly timeout = Timeout.none();`. Nodes extending `MonadicNode` inherit the default and need no change.
- **Adapter wire-shape entities relocated to `entities/adapter/`.** `ChatRequest`/`ChatResponse`/`ChatMessage`/`ChatResponseMessage`/`ToolCall`/`ToolDefinition`/`TokenUsage`/`AdapterCapabilities` schemas + `FromSchema` types now live under `@studnicky/dagonizer/entities` (and remain re-exported from `@studnicky/dagonizer/adapter` — no consumer change). This breaks the former `contracts → adapter` import cycle.
- **`DAGDeriver` scatter annotation `concurrency` is now required** (default sentinel `0` = unbounded / resolve to source length). The `DEFAULT_SCATTER_CONCURRENCY` constant is exported.
- **`DAGError.toJSON()` emits a stable shape**: `cause` and `stack` are always present (`null` when absent) rather than conditionally omitted; `DAGErrorJSONSchema` reflects this.
- **`GatherStrategies.register` / `OutcomeReducers.register` now throw on a duplicate name. ⚠ BREAKING.** This protects built-ins from silent override; use the new `replace(name, …)` method for an intentional override. (Matches the `LlmAdapterRegistry` throw-on-duplicate semantics.)
- **`MonadicNode.validate` / `destroy`** are now concrete no-op defaults on the base class (every node has them) rather than optional methods; subclasses override as needed. The `NodeInterface` contract keeps them optional at the external boundary.
- **`InMemoryChannel`** collects errors thrown from `onPublished` into a `publishErrors` accessor instead of silently swallowing them.
- **`RetryPolicy` is constructed via `RetryPolicy.from(options)`. ⚠ BREAKING.** The public constructor is now `protected`, making `from` the single creation path. `retryOn`/`abortOn` are required fields defaulting to `[]` ("no filter"); the previous `null` sentinel is gone. **Migration:** replace `new RetryPolicy(opts)` with `RetryPolicy.from(opts)`.
- **`BaseStore.update` is now abstract. ⚠ BREAKING.** The non-atomic default read-modify-write was removed; the RMW fallback is available as `protected performUpdateRmw(key, fn)`. **Migration:** a store subclass implements `update` natively (transactional) or delegates to `performUpdateRmw`.
- **`ChatMessage` is a role-discriminated union. ⚠ BREAKING.** `ChatMessageSchema` is now a `oneOf` keyed by `role`: only `role:'tool'` messages carry `toolCallId`/`toolName`; `system`/`user`/`assistant` messages must not. **Migration:** stop setting empty-string `toolCallId`/`toolName` on non-tool messages — omit the fields.
- **`BackoffStrategyValue` type renamed to `BackoffStrategy`** (canonical single name shared with the constant). **Migration:** update `import type { BackoffStrategyValue }` to `BackoffStrategy`.
- **`DAGErrorJSONSchema` requires `context`.** `DAGError.toJSON()` always emits `context`, so the schema and derived type now reflect that (no longer optional).
- **`patterns-flow` `RespondNode.extractDraft` is now abstract.** The unsafe convention-based default (`state as Record<string, unknown>`) is removed; subclasses declare which state field they read.
- **Adapter consistency pass.** `GeminiApiAdapter` now enforces a per-request timeout and schema-validates its response body; aborted errors classify as `TIMEOUT` uniformly across adapters; zero-usage results use the shared `ZERO_TOKEN_USAGE`. `OpenAiCompatibleAdapter` exposes a `protected get model()`.
- Internal hardening (no consumer-facing surface change): dispatcher callback seams (`DispatcherWarningEmitter`, `GatherNodeInvoker`) and the duplicate never-aborting signal collapsed; external-JSON ingest in embedders, stores, and tools narrowed at the boundary; freestanding example helpers folded into static-class domain modules.
- Execution-engine dedup (no consumer-facing surface change). Two engine-private domain primitives carry the logic the composite executors previously hand-rolled three times over. `BodyExecutor` (`execution/BodyExecutor.ts`) owns the sub-DAG body run: the in-process-vs-container branch, the container snapshot/error collection, and the `bufferIntermediates` O(N·M·L) guard, returning a uniform `{ terminalOutcome, intermediates, infrastructureError }`. `PlacementRouter` (`execution/PlacementRouter.ts`) owns the result-assembly tail: the `'success'`/`'error'` route decision (honoring `hasUnrecoverable`), child→parent error/warning propagation, output-state mapping, next-stage resolution, and the `{ nextStage, result }` envelope. `executeEmbeddedDAG`, `executeSingleNode`, and the scatter per-item path compose these primitives; each depends on a narrow port (`BodyRunPortInterface`, `StateMergePortInterface`), not the whole dispatcher. Behavior is byte-identical — the conformance Laws and the scatter/embedded-dag/checkpoint suites pass unchanged.

### Documentation

- **TSDoc backfill on the `contracts/` adapter-contract tier (comments only).** `contracts/index.ts` gains a file-level barrel doc block and section comments grouping the re-exports by subsystem. Adapter contracts whose members lacked doc comments are documented one line per member: `CheckpointRestoreAdapterInterface.restore`, `DispatcherBundleType.nodes`/`dags`, `LlmAdapterInterface.chat`, `LlmClientInterface.chat`, `NodeInvokerInterface.invokeNode`, `NodeInterface.name`, the five `ObserverRelayInterface` hooks, `ReservoirDriverInterface.executeBatch`/`ackBatch`, and `StoreInterface.get`/`set`/`has`/`delete`. No code, signature, or schema-shape changes.

## [0.18.0] - 2026-06-09

This release lands the DAG-containment / cross-host hand-off feature work together
with a whole-package audit-and-hardening pass (the 11 operating principles plus
abort/transport/error hardening). It contains breaking API changes (0.x policy);
migrate using the guide below.

### Breaking Changes — migration guide

- **`Store.get` / `StateAccessor.get` return `T | null`** (was `T | undefined`) for an absent key/path. Replace `=== undefined` absent-checks on these results with `=== null`.
- **Adapter infrastructure ships only via `@studnicky/dagonizer/adapter`.** `AdapterDescriptor`, `BaseEmbedder`, `Classifications`, `EmbedderCascade`, `EmbedderRegistry`, `LlmAdapterCascade`, `LlmAdapterRegistry`, and `LlmError` are no longer on the root barrel — import them from `@studnicky/dagonizer/adapter`.
- **`OpenAiCompatibleConfig.toolsFallback` removed.** Override `protected shouldFallbackWithoutTools(error)` on your adapter subclass instead.
- **`Embedder.embed`/`embedBatch` take a trailing `signal?: AbortSignal`** (not `{ signal }`); `performEmbed(text, signal)` gains a required signal; `probe`/`connect`/`disconnect` take an optional trailing `signal?`.
- **`ErrorClassification` is a discriminated union** on `retryable`; retryable variants carry `retryAfterMs: number | null`. Replace `retryAfterMs !== undefined` with `retryable && retryAfterMs !== null`.
- **`Checkpoint.restoreState(adapter)`** takes a `CheckpointRestoreAdapter<TState>`. Wrap an inline function with `CheckpointRestoreAdapterFn.fromFn(fn)`.
- **`GatherExecution` exposes `invoker: NodeInvoker`** (not an `invokeNode` function); custom `GatherStrategy.apply` calls `execution.invoker.invokeNode(name)`.
- **`DAGBuilder.build({ warningEmitter })`** replaces the `onContractWarning` callback option; `ContractRegistryValidator` takes a `WarningEmitter` (pass `NoopWarningEmitter` for none).
- **Type guards moved to the `Placement` static class** (`Placement.isScatter(n)`, …); the freestanding `isScatterNode`/`isEmbeddedDAGNode`/… exports are removed.
- **`DAGError` and subclasses type `cause` as `Error`** (was `unknown`); pass an `Error` instance as `cause`.
- **Pattern leaf nodes drop the free `TOutput` parameter** (they declare concrete output); subclasses passing a `TOutput` type argument remove it.
- **`Store.connect`/`disconnect` are optional**; invoke via `store.connect?.()`.
- **`CHECKPOINT_DATA_VERSION` is `'2'`** — checkpoints written by older versions do not resume (intentional 0.x breakage).

### Changed

- **ADP-1: `toolsFallback` callback removed from `OpenAiCompatibleConfig`. ⚠ BREAKING.** The `toolsFallback?: (error: unknown) => boolean` property is removed. Concrete subclasses that need the retry-without-tools path override the new `protected shouldFallbackWithoutTools(error: unknown): boolean` method (default returns `false`). **Migration:** delete `toolsFallback` from any config object literal; add `protected override shouldFallbackWithoutTools(error: unknown): boolean { return <your predicate>; }` to your `extends OpenAiCompatibleAdapter` subclass.
- **ADP-2b: `LlmAdapter` interface source migrated to `src/contracts/LlmAdapter.ts`.** The interface declaration has moved to `contracts/`; `adapter/LlmAdapter.ts` re-exports it from there for `./adapter` consumers. `BaseAdapter`, `LlmAdapterRegistry`, and `LlmAdapterCascade` import from `contracts/` directly. No consumer-facing import path changes — both `@studnicky/dagonizer/adapter` and `@studnicky/dagonizer/contracts` export `LlmAdapter` as before.
- **ADP-3: `performEmbed` receives `AbortSignal`.** The abstract `performEmbed(text, signal)` signature gains a required `AbortSignal` parameter. `BaseEmbedder.embed()` always materialises a signal (never-aborting when the caller omits one) so `performEmbed` is always called with a valid signal. **Migration:** update `protected override performEmbed(text: string): Promise<readonly number[]>` to `protected override performEmbed(text: string, signal: AbortSignal): Promise<readonly number[]>` in every concrete embedder.
- **ADP-6: `ErrorClassification` is now a discriminated union.** `retryable: true` variants carry `retryAfterMs: number | null` (null = no provider hint); `retryable: false` variants omit `retryAfterMs`. Retryable `Classifications` constants now carry `retryAfterMs: null`. Retry-site checks updated from `!== undefined` to `!== null`. **Migration:** code that checks `classification.retryAfterMs !== undefined` must change to `classification.retryable && classification.retryAfterMs !== null`.
- **ADP-7: `embed` / `embedBatch` signatures flattened. ⚠ BREAKING.** `embed(text, options?: { signal?: AbortSignal })` is now `embed(text, signal?: AbortSignal)`. `embedBatch(texts, options?: { signal?: AbortSignal })` is now `embedBatch(texts, signal?: AbortSignal)`. `Embedder` contract updated identically. **Migration:** replace `.embed(text, { signal })` with `.embed(text, signal)` and `.embedBatch(texts, { signal })` with `.embedBatch(texts, signal)`.
- **ADP-8: JSON Schema 2020-12 added for adapter wire shapes.** `ChatMessageSchema`, `ToolDefinitionSchema`, `ToolCallSchema`, `TokenUsageSchema`, `ChatResponseMessageSchema`, and `ChatResponseSchema` are exported from `@studnicky/dagonizer/adapter`. Each carries a `$id` under `https://noocodex.dev/schemas/dagonizer/adapter/`. Enables Ajv-based validation of provider responses at the JSON-ingest boundary.
- **ADP-9: Adapter infrastructure removed from root barrel. ⚠ BREAKING.** `AdapterDescriptor`, `BaseEmbedder`, `Classifications`, `EmbedderCascade`, `EmbedderRegistry`, `LlmAdapterCascade`, `LlmAdapterRegistry`, and `LlmError` (and their associated types) are no longer exported from `@studnicky/dagonizer`. They ship exclusively via `@studnicky/dagonizer/adapter`. **Migration:** change `from '@studnicky/dagonizer'` to `from '@studnicky/dagonizer/adapter'` for any of these symbols.
- **ADP-10: `BaseAdapter.defaultOptions()` static added.** Returns a fully-resolved `BaseAdapterOptionsResolved` (both `maxAttempts` and `baseDelayMs` always present). Subclasses can spread this as a base before forwarding a partial options object to `super()`.
- **CTR-15: `probe`, `connect`, and `disconnect` on `Embedder` contract accept an optional `signal?: AbortSignal`.** `BaseEmbedder` default implementations accept and ignore the parameter; concrete subclasses may thread it into real lifecycle calls.

### Fixed

- **ADP-4: Backoff sleep in `HttpTransport.request` is abort-aware.** The exponential-backoff sleep between retries is replaced with an abort-aware sleep: when the caller's signal fires during the wait, the sleep rejects immediately with a non-retryable `ToolError`, preventing the transport from hanging until the next retry window. The previous `setTimeout`-only sleep did not observe the signal.
- **ADP-5: `OpenAiCompatibleAdapter` throws `LlmError(SCHEMA_VIOLATION)` on malformed tool-call arguments.** Previously, a JSON parse failure in tool-call `arguments` silently returned `{}` (empty args), causing the tool to be invoked with no input. It now throws `LlmError` with reason `SCHEMA_VIOLATION`, surfacing the parse failure through the normal error-classification path.

### Changed

- **RUN-4: `RetryPolicy` constructor delegates all defaulting to `RetryPolicy.materialise()`.**  The duplicated `??`-chain in the constructor body and the `from()` static are unified through a private `materialise()` helper so `DEFAULT_*` constants are applied in exactly one place. Both `new RetryPolicy(partial)` and `RetryPolicy.from(partial)` now produce identical results. `from()` is documented as the preferred call form for external callers. **Migration:** no breaking change — both `new RetryPolicy(opts)` and `RetryPolicy.from(opts)` remain valid; prefer `from()` for new code.
- **RUN-3: `Checkpoint.restoreState()` now accepts `CheckpointRestoreAdapter<TState>`.** The bare function seam `StateRestoreFnType` is replaced with the adapter contract `CheckpointRestoreAdapter<TState>`. `CheckpointRestoreAdapterFn.fromFn((snap) => MyState.restore(snap))` wraps an inline lambda for ergonomic call sites. `StateRestoreFnType` remains exported for `RegistryBundleInterface.restoreState` (a bundle field, not this method). **Migration:** replace `ckpt.restoreState((snap) => MyState.restore(snap))` with `ckpt.restoreState(CheckpointRestoreAdapterFn.fromFn((snap) => MyState.restore(snap)))`.
- **CTR-7: `Store.connect()` and `Store.disconnect()` are now optional.** Both methods carry `?:` so stores that hold no connection lifecycle omit them without writing no-op bodies. Engine callers use optional chaining (`store.connect?.()`). `BaseStore` retains the no-op implementations for subclasses that want a default; `TypedStore` delegates via optional chaining. **Migration:** stores that previously overrode the no-ops to implement real behavior are unaffected. Callers must use `store.connect?.()` / `store.disconnect?.()`.
- **CTR-16: `SchedulerHandle` derived from `SchedulerProvider`.** Both interfaces carried an identical four-method list, creating a drift risk. `SchedulerHandle` is now `type SchedulerHandle = SchedulerProvider` with a role-documenting comment. Both names remain exported at their canonical paths so existing import sites compile unchanged.

### Fixed

- **RUN-9: `RealTimeScheduler.every()` clears the in-flight timer on consumer `break`.** A `try/finally` block tracks the pending timer handle; if the consumer breaks the `for-await` loop, the generator's implicit `return` triggers `finally`, which calls `clearTimeout` immediately instead of waiting for the timer to fire naturally.
- **RUN-10 (a): `RetryPolicy.run()` checks `signal.aborted` after `await task()` resolves.** An abort that races with task completion is now detected at the decision point — the resolved result is discarded and `ExecutionError.fromSignal(signal)` is thrown instead of returning a stale value.
- **RUN-10 (b): Decorrelated-jitter lower-bound clamped.** The jitter range is now `[baseDelay, baseDelay × 3]`. When `baseDelay ≥ maxDelay` the computed value is `≥ baseDelay`, then clamped to `maxDelay` by `getDelay()`, keeping the result in `[0, maxDelay]`.
- **RUN-8: `CheckpointData.state` schema tightened to `{ type: 'object', additionalProperties: true }`.** The `additionalProperties` addition documents intent and matches AJV's runtime behavior; `FromSchema` still derives `Record<string, unknown>` (json-schema-to-ts cannot express the recursive `JsonValue` constraint without a `$ref`), so the `as JsonObject` narrowing cast in `restoreState` is retained at this single ingest boundary.
- **CTR-13: `CheckpointStore.save/load/delete` each accept an optional `signal?: AbortSignal`.** `MemoryCheckpointStore` accepts and ignores the parameter. Network-backed implementations may honor it for cancellation.
- **CTR-14: `Snapshottable.snapshot()` and `restore()` each accept an optional `signal?: AbortSignal`.** `BaseStore` and `TypedStore` accept and ignore (pass-through) the parameter. Remote-backed implementations may honor it.

### Fixed

- **CON-1: `acquireChannel` ejects parked waiters on AbortSignal.** `DagContainerBase.acquireChannel` accepts the task's `AbortSignal` and registers an `{ once: true }` abort listener on each parked waiter entry. When the signal fires, the waiter is spliced from the queue and the parked promise rejects with `DagContainerError('aborted')`, resolving the calling `runDag()` as a transport-error outcome immediately — no longer stranded until an unrelated pool slot frees. The abort listener is always removed in a finally path to prevent leaks.
- **CON-2: `destroy()` fails in-flight `ChannelDispatch` entries before closing channels.** Graceful destroy now calls `failChannel(entry.channel, DAG_CONTAINER_TRANSPORT, 'container destroyed')` on each pool entry before `terminateWorker` and `channel.close()`, matching the death path (`onTransportDeath → failChannel → evict`). Concurrent `runDag()` callers awaiting `dispatch.request()` resolve with a transport-error outcome instead of hanging forever.
- **CON-3: `InitMessageShape` derived from `BridgeMessage`, not hand-written.** The exported `InitMessageShape` type in `ChannelDispatch.ts` is now `Omit<BridgeMessage & { kind: 'init' }, 'kind'>` — a schema-derived type that cannot drift from the canonical `BridgeMessage` definition.
- **CON-5: `ContractRegistryValidator.validate` options required-with-default.** `options?: { entrypointName?: string }` changed to `options: { entrypointName?: string } = {}`; `options?.entrypointName` updated to `options.entrypointName`.
- **CON-6: `ScatterNode` object literal includes `concurrency` at construction.** Post-construction `scatterNode.concurrency = value` assignment replaced with spread `...(scatter.concurrency !== undefined ? { concurrency: scatter.concurrency } : {})` in the initial object literal, eliminating the V8 hidden-class split between instances with and without the optional field.
- **CON-7: `EmbeddedDAGNode.stateMapping` included in the initial object literal.** Post-construction `embeddedNode.stateMapping = ...` replaced with a conditional spread in the `EmbeddedDAGNode` object literal so every instance has a consistent construction shape.
- **CON-8: Redundant `task.state as TState` cast removed.** `DagContainerOptions.instrumentation` parameterised as `Instrumentation<TState>` (was `Instrumentation<NodeStateInterface>`); `this.instrumentation` typed as `Instrumentation<TState>`; `task.state as TState` cast in `runDag()` removed — `task.state` is already `TState`.
- **CON-9: Redundant `bundle.bundle as DispatcherBundle<…>` cast removed from `DagHost`.** The `RegistryBundleInterface.bundle` field is already typed as `DispatcherBundle<NodeStateInterface, unknown>`; the cast was redundant. Unused `DispatcherBundle` import removed.
- **CON-10: Protocol-boundary casts in `ChannelDispatch.#route` documented.** The `errors as readonly NodeError[]` and `stateSnapshot as JsonObject | null` casts at the BridgeMessage 'result' branch are documented with single-sentence rationale: `errors` — inline error shape is structurally identical to `NodeErrorSchema`, only a nominal gap from two independent `FromSchema` derivations; `stateSnapshot` — Ajv validates the wire value as a JSON object, making the narrowing from `{ [k: string]: unknown } | null` to `JsonObject | null` safe at this boundary.
- **CON-11: `stateMapping.input/output` casts documented.** `Partial<Record<...>>` is retained in `DAGDeriverEmbeddedDAG` (callers supply only the keys they need to map — requiring all keys would force mapping every state property). The spread casts to `Record<string, string>` are documented: with `exactOptionalPropertyTypes`, optional keys in the spread are either absent or present with a string value; the wire shape is structurally satisfied at runtime.
- **CON-13/CTR-1,2: Interface taxonomy relocation.** `DagTaskInterface` (class-shape) moved to `src/container/DagTask.ts` (above the `DagTask` class). `DagOutcomeInterface` (entity-narrowing) moved to `src/container/DagOutcome.ts` (above the `DagOutcome` factory class). Both contracts files (`contracts/DagTaskInterface.ts`, `contracts/DagOutcomeInterface.ts`) become forwarding stubs re-exporting from the canonical container locations, preserving the `./contracts` subpath surface. `contracts/index.ts` and `container/index.ts` export directly from the canonical sources.
- **CTR-4: `InstrumentationSink` no longer re-exported from `DagContainerBase.ts`.** `container/index.ts` now re-exports `InstrumentationSink` directly from `contracts/InstrumentationSink.ts`, making `contracts/` the unambiguous source of truth for this adapter contract.

### Fixed

- **PAT-1: free `TOutput` generic removed from fixed-port leaf nodes** in `dagonizer-patterns-flow`, `-rag`, and `-graph`. `ReduceNode`, `SelectNode`, `ComposeNode`, `ScoutNode`, `MemoryDigestNode`, `RecallContextNode`, and `RecordFindingsNode` each emits a statically known set of ports; those nodes now declare a concrete output type (`'success'`, `'success' | 'empty'`, or `'success' | 'empty' | 'error'`) instead of a free `TOutput extends string` parameter. The previous free generic caused TS2322 (`'string' is not assignable to type 'TOutput'`) in every pattern package; the removal makes the `execute()` return types provably sound without any cast. All in-package subclasses (`DedupeByKeyNode`, `GroupByFieldNode`, `MergeReducerNode`, `PickByScoreNode`, `SortByNode`, and the four `ComposeNode` leaves) are updated in lockstep to drop the now-absent type argument.
- **PAT-2: `ScoutNode.execute` passes `{ signal }` options object to `Tool.execute`** instead of a bare `AbortSignal`. `Tool.execute` signature is `(input, options?: { signal?: AbortSignal })`; the previous call site passed `context.signal` directly, producing TS2559 (`Type 'AbortSignal' has no properties in common with type '{ signal?: AbortSignal }'`).
- **PAT-3: `MonadicNode.successPort/emptyPort/errorPort` JSDoc updated** to state that these helpers return concrete literals; fixed-port leaf nodes should declare a concrete output type rather than a free generic, making the helpers directly assignable.

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
- **`Placement` static class** in `src/entities/dag/Placement.ts`. Provides five type-guard static methods — `isEmbeddedDAG`, `isScatter`, `isSingle`, `isTerminal`, `isPhase` — that narrow `DAGNodeType` via `@type` discriminant. Replaces five freestanding `export function is*` guards that previously lived in `Dagonizer.ts`. Exported from `./types`, `./entities`, and the root barrel.
- **`DAGNodeType` canonical union** exported from `src/entities/dag/Placement.ts`. Previously a local alias in `Dagonizer.ts` and independently re-declared in `DAGBuilder.ts` and `DAGValidator.ts`. Both local declarations replaced with an import from the canonical source.
- **`NodeOutputBuilder` static class** in `src/entities/node/NodeOutput.ts`. Provides `NodeOutputBuilder.of(output, options?)` (constructs a `NodeOutputInterface` with `errors: []` by default) and `NodeOutputBuilder.errorsOf(result)` (normalises the optional `errors` field to `[]` at the engine boundary). Replaces three `result.errors ?? []` null-check guards at `executeSingleNode`, `executeScatter`, and `executePhasePlacement` call sites. Named `NodeOutputBuilder` to avoid the identifier collision with the schema-derived `NodeOutput` type. Exported from `./types`, `./entities`, and the root barrel.
- **`ScatterCheckpoint.read(state, placementName)` static method.** Reads the stored scatter progress map and validates it with `Validator.storedScatterProgress` at the metadata ingest boundary. A corrupt or migrated checkpoint now throws `ValidationError` close to the read site rather than propagating type mismatches silently into the scatter loop. `Dagonizer.executeScatter` uses `ScatterCheckpoint.read` in place of the direct `getMetadata` call.
- **Canonical scatter progress types** (`ScatterInboxItem`, `ScatterAckedResult`, `ScatterProgress`, `StoredScatterProgress`) from `src/entities/scatter/ScatterProgress.ts` replace the hand-written interfaces that previously lived in `Dagonizer.ts`. `Dagonizer.ts` and `ScatterCheckpoint.ts` import from the entity module; `Dagonizer.ts` re-exports the types for backward-compatible public consumers.

### Changed

- **`Dagonizer` inbox iterator** typed as `AsyncIterator<ScatterInboxItem, undefined>`. The second type parameter declares the done-branch value as `undefined`, eliminating the `undefined as unknown as ScatterInboxItem` double cast at both done-branch return sites.
- **`NodeStateBase.setMetadata`** implementation comment clarifies that the `value as JsonValue` cast is the single permitted ingest point at this boundary; the parameter remains `unknown` because schema-derived scatter progress types carry `item: unknown` payload fields.
- **`_InternalNodeResult<TState>` and `_RunOptions`** converted from `interface` declarations to `type` aliases in `Dagonizer.ts`. Both are engine-private; using leading-underscore `type` aliases removes them from the fourth-pattern taxonomy drift identified in CORE-7.

### Fixed

- **`DAGBuilder` node-union drift.** Local `type DAGNodeType = EmbeddedDAGNode | ScatterNode | ...` replaced with `import type { DAGNodeType } from '../entities/dag/Placement.js'` so the builder's internal union tracks the canonical definition automatically.

- **`DAGValidator` node-union drift.** Local `type DAGNodeType = DAG['nodes'][number]` replaced with `import type { DAGNodeType } from '../entities/dag/Placement.js'`.

- **`DAGValidator` static class** in `src/validation/DAGValidator.ts`. All semantic validation logic (`validateDAGConfig`, `validateDAGNode`, `validatePhaseNode`, `validateSingleNode`, `validateParallelNode`, `validateEmbeddedDAGNode`, `validateScatterNode`, `collectDAGReferences`) extracted from `Dagonizer` into a dedicated static class. `Dagonizer.registerDAG` delegates to `DAGValidator.validateDAGConfig`.
- **`StateMapper<TState>` class** in `src/runtime/StateMapper.ts`. `createChild(parentState, inputMapping?)` and `mapOutput(childState, parentState, output?)` extracted from `Dagonizer` instance methods. `Dagonizer` holds a `StateMapper` constructed with its `StateAccessor`.
- **`ScatterCheckpoint` static class** in `src/runtime/ScatterCheckpoint.ts`. `ScatterCheckpoint.write(state, placementName, inbox, ackedResults)` and `ScatterCheckpoint.clear(state, placementName)` replace the private instance methods `writeScatterProgress` / `clearScatterProgress`.
- **`PlacementUtils` static class** in `src/viz/internal.ts`. `embeddedDagName(placement)` and `idIn(prefix, name)` moved from free-function exports to static methods. All call sites in `CytoscapeRenderer` and `CompositeLayout` updated.
- **`ToolCallCodec` static class** in `src/adapter/ToolCallCodec.ts`. Replaces the free function `decodeToolCallsJson`. Call: `ToolCallCodec.decode(raw, idPrefix)`.
- **`OpenLibraryDocs` static class** in `src/openLibraryTypes.ts`. `pickDescription(doc)` and `buildCandidates(docs, source, sourcesLabel)` replace the free functions `pickDescription` and `buildCandidates`. `OPENLIBRARY_ENDPOINT` constant exported from the same module.
- **`GeminiNanoAdapter.detect()` static method.** Replaces the free function `detectGeminiNano()`. Call: `GeminiNanoAdapter.detect()`.
- **`LlmError.classifyHttp(status, body?)` static method.** Replaces the free function `classifyHttp`.
- **`LlmError.fromNetworkError(err)` static method.** Replaces the free function `asNetworkError`.
- **`ExecutionError.fromSignal(signal?)` static method.** Normalises `AbortSignal.reason` into a typed `Error`.
- **Named constants** replace inline magic numbers across adapter and tool packages: `DEFAULT_MAX_ATTEMPTS`, `WEBLLM_MAX_ATTEMPTS`, `GPU_PROBE_TIMEOUT_MS`, `DEFAULT_GEMINI_MAX_ATTEMPTS`, `DEFAULT_TOKEN_COUNT`, `GOOGLE_BOOKS_MAX_RESULTS`, `GOOGLE_BOOKS_MIN_RESULTS`, `GOOGLE_BOOKS_DEFAULT_RESULTS`, `GOOGLE_BOOKS_MAX_SUBJECTS`, `MAX_SUBJECTS`, `MAX_PUBLISHERS`, `GEMINI_NANO_MAX_ATTEMPTS`.
- **`RunOptions` internal interface** on `Dagonizer`. Replaces the positional `isEmbeddedDAG: boolean` parameter on `runNodes` and `runPostPhasesAndFinalize` with `runOptions: RunOptions` carrying `embedded: boolean`.
- **`BookEntitiesError`** base error class for `@studnicky/dagonizer-book-entities`.

### Changed

- **`OpenAiCompatibleAdapter.#doRequest`** split into `#doRequest(request)` (tools path) and `#doRequestWithoutTools(request)` (toolless fallback path) with shared `#sendRequest(request, body)` wire implementation. Eliminates the `withTools: boolean` flag argument.

### Removed

- **`detectGeminiNano` free function** from `@studnicky/dagonizer-adapter-gemini-nano`. Use `GeminiNanoAdapter.detect()`.
- **`decodeToolCallsJson` free function** from `@studnicky/dagonizer/adapter`. Use `ToolCallCodec.decode(raw, idPrefix)`.
- **`classifyHttp` free function** from `@studnicky/dagonizer/adapter`. Use `LlmError.classifyHttp(status, body)`.
- **`asNetworkError` free function** from `@studnicky/dagonizer/adapter`. Use `LlmError.fromNetworkError(err)`.

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
- **Native streaming scatter (§A).** `executeScatter` now uses a single unified executor for all source types. Arrays, sync iterables, and `AsyncIterable` sources all drain through a bounded worker pool (max in-flight = `scatter.concurrency`). True backpressure: a new item is pulled from the source only when a worker slot frees; the full source is never buffered. Default concurrency for arrays without an explicit cap is `source.length` (backwards-compatible: all items run concurrently as before). Streaming sources default to `concurrency = 1`.
- **Durable-inbox checkpoint model.** As each item is pulled from the source it enters a persisted inbox under `SCATTER_PROGRESS_KEY`. The inbox holds the actual item payload so resume never needs to re-read the source by index. On success the item is acked (removed from inbox, added to `ackedResults`). On crash/resume, inbox items are reprocessed first, then fresh source items continue. `CHECKPOINT_DATA_VERSION` bumped to `'2'`.
- **Incremental gather.** `GatherStrategy` gains an optional `applyIncremental(config, record, state, accessor)` method. `Map`, `Append`, and `Partition` implement it: each completed record is folded into parent state as it arrives. `Custom` does not implement it; it continues to accumulate records and call `apply` once at the end.
- **Source-normalization statics on `Dagonizer`.** `toAsyncIterator(v)` normalizes any array, sync iterable, or async iterable to an `AsyncIterator<unknown>`.
- **`ScatterInboxItem`, `ScatterAckedResult`, `ScatterProgress`, `StoredScatterProgress` types** exported from `Dagonizer.ts` for checkpoint inspection and testing.
- **7 acceptance tests** under `packages/dagonizer/tests/unit/scatter-streaming.test.ts`: backward-compat array source, bounded concurrency, `AsyncIterable` source, true backpressure, resume mid-stream (array), resume mid-stream (async-iterable), and incremental gather (`map`/`append`/`partition` progressive + `custom` batch fallback).

### Changed

- **`MapGatherStrategy.applyIncremental` always writes arrays.** In incremental gather mode, cardinality is not known up front, so `map` always appends values to an array rather than writing a scalar for single-item sources. The batch `apply` path (used only by `custom` strategy) retains the singleton-scalar behavior.
- **`CHECKPOINT_DATA_VERSION` bumped from `'1'` to `'2'`.** Old checkpoints will not resume across the bump; this is intentional (0.x breakage policy).

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
- **`CytoscapeGraph`: subclassable Cytoscape factory in `@studnicky/dagonizer/viz`.** Given a `DAG`, `await new CytoscapeGraph(cytoscape, container, dag, options).mount()` returns a fully-configured `cytoscape.Core`: elements (via `CytoscapeRenderer`), the canonical dark-pearl stylesheet, the bottom-up dagre `preset` layout, and pan/zoom/box-select interaction defaults. Cytoscape is dependency-injected (the package never imports it), so any consumer can render their flows with no bespoke wiring. Protected hooks — `buildElements`, `stylesheet`, `presetLayout`, `interactionDefaults`, `layoutRegistry`, `applyLayout`, `enforceVisibility`, `onReady` — are the extension surface; subclass it to layer on live-run animation. Shipped with `CytoscapeGraphInterface` and `CytoscapeGraphOptions`.
- **`cytoscape` and `@dagrejs/dagre` are optional peer dependencies.** The visualizer is opt-in: consumers who do not import `./viz` install neither. Consumers who do install both and pass the `cytoscape` constructor in.

### Changed

- **`CompositeLayout.compute` is now `async`** and lazy-imports `@dagrejs/dagre` on first call, so `MermaidRenderer` / `JsonLdRenderer` consumers never pull in the layout engine.
- **`CytoscapeRenderer.render` returns elements only.** The `computeLayout` and `layoutOptions` options are removed; positioning is owned by `CompositeLayout.compute` / `CytoscapeGraph`. The renderer is a pure DAG→elements transform.
- **The docs site renders every DAG through the shipped factory.** `DagGraph.vue` is a thin host over `AnimatedDagGraph extends CytoscapeGraph`, which adds the live-run `DagVizMachine`, camera-follow, embed-expand toggle, and the imperative runner surface. The hand-rolled stylesheet, layout, and `cytoscape()` instantiation that lived in the component are gone.

### Fixed

- **DAG nodes carrying a self-loop edge no longer render invisible.** A node targeted by its own `retry` route (e.g. `classify-intent`, the `*-extract` / `*-decide-tools` nodes, `compose-empty`) was culled from the canvas because the stylesheet used the deprecated `width: 'label'` / `height: 'label'` auto-sizing, which leaves a degenerate size cache on self-loop nodes. The canonical stylesheet now uses explicit numeric node dimensions and a real monospace font stack (cytoscape cannot resolve a CSS custom property on the canvas), and a post-layout visibility sweep guards against any residual cache staleness.
- **`@dagrejs/dagre` is a declared dependency of the viz layout path.** It was a `devDependency` while `dist/viz/CompositeLayout` imported it at runtime, so an external consumer calling the cytoscape renderer crashed with `Cannot find module '@dagrejs/dagre'`. It is now a declared (optional) peer, lazy-loaded.

## [0.13.1] - 2026-05-26

**Hotfix: per-package version alignment + Changesets lockstep group.**

### Changed

- Every `@studnicky/dagonizer*` package now versions in lockstep via `.changeset/config.json` `fixed:` group. A single minor/major bump on any package in the group applies to all of them. Eliminates the v0.13.0 release artifact where peer-dependency range churn caused most packages to jump to 1.0.0 while the engine itself sat at 0.12.0; the tag `v0.13.0` was correct, but the per-package version numbers disagreed.
- Peer- and regular-dependency ranges restored to `workspace:^0.13.1` across every adapter / embedder / tool / pattern / store / book-entities package. With the `fixed:` group bumping all packages together on every release, this range is always satisfied without forcing dependent major bumps on minor engine releases.

## [0.13.0] - 2026-05-25

**Archivist live-demo polish: PROV-O bridge, positive-imperative persona, smooth viewport + user-gesture latch, edge labels, conversation auto-scroll.**

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
- **PROV-O bridge:** `recordFindings` now writes the W3C PROV-O relations that connect shortlisted Books (memory layer) to their producing Run Activity (prov layer): `<book> prov:wasGeneratedBy <run-activity>`, `<book> prov:wasAttributedTo <archivist-software-agent>`, `<run-activity> prov:generated <book>`. Plus `<book> dag:source` is mirrored into the prov graph so the source scout becomes a connecting literal. Without this bridge the MemoryGraph visualisation showed two disconnected clusters (books on the left, activities on the right). They are now one connected graph, traversable via standard PROV-O paths in SPARQL.
- **Conversation auto-scroll:** `Conversation.vue` watches `turns.length` and, when a new turn arrives, smooth-scrolls the list to the bottom IF the visitor was already within 80 px of the bottom. If they had scrolled up to re-read an earlier turn, their position is respected. Same user-gesture-pauses-auto principle as the DAG follow latch.
- **User-gesture latch on the DAG viewport:** any user pan / zoom / node-drag (or the D-pad's pan/zoom buttons) pauses the auto-follow. The latch is released ONLY by pressing Fit or Center on the D-pad. Auto-follow then resumes from the next node-start event.

### Changed

- **Archivist persona rewritten as positive imperatives.** The role is now "a research librarian with global catalog access through OpenLibrary, Google Books, and Wikipedia" rather than "a librarian at a small independent bookstore". Eliminates the inventory framing that made the model say "we don't have it in stock" / "not in our catalog". The composed directives describe what the Archivist DOES (look up, describe, summarise, weave catalog metadata into prose) rather than what to avoid; attractors bind tighter than repulsors. Engineer-jargon "shortlist" is gone from every user-facing string; "catalog records returned" is the new framing.
- **OpenLibrary scout reads typed `author` / `subject` / `isbn` args.** The tool's `WebSearchInput` already declared them; the scout was ignoring them in favour of the keyword-query path. Now the scout dispatches by axis priority (isbn → author → subject → keyword) and the log line names which axis fired. Coupled with `decideTools` deterministic shortcuts (ISBN-10/13 detection, author lookup, subject lookup), an ISBN query hits OpenLibrary's `?q=<isbn>` directly; an author lookup hits `?author=<name>`; a subject lookup hits `?subject=<term>`.
- **Embedded-DAG outcome routing tolerates recoverable errors.** Previously a single recoverable error logged via `state.collectError(... recoverable: true)` (e.g. a Google Books 429 from one of four parallel scouts) caused the embedded-DAG to route the parent placement to `error` even when the surviving scouts populated a real shortlist and the citations-gate passed. The routing now only switches to `error` when an inner `TerminalNode(outcome: 'failed')` fires OR an unrecoverable error (`recoverable: false`) was collected.
- **DagGraph viewport follow:** replaced per-node `cy.animate({ fit: ... })` (silently no-op on this cytoscape build) with synchronous `cy.fit(...)`, debounced 120 ms. Parallel node starts coalesce into a single zoom-out fit of the active branch. Reset cancels the in-flight animation, clears the pending follow timer, hard-clears active node ids, and snaps back to the fitted view. `maxZoom` raised from 4× to 8× the initial fit zoom so the visitor can read individual node labels.
- **DagGraph edge labels:** route names render as horizontal pills with `text-rotation: 'none'` (was `autorotate`, which made labels crooked along taxi corners). `taxi-turn: '50%'` and `taxi-radius: 16` place the bend at the midpoint between source and target rank so the pill sits in the vertical channel, not on a horizontal segment.
- **CompositeLayout separations widened:** `rankSep 80→160`, `nodeSep 60→120`, `nodeWidth 180→220`, `nodeHeight 50→60`, `MARGIN 40→60` so cytoscape's round-taxi edges have room to route without colliding with sibling nodes.
- **MemoryGraph label colours match node layer colours.** Previously every IRI label rendered cyan and every literal violet, independent of layer. Now ontology IRIs render green, memory IRIs cyan, state IRIs gold, prov IRIs violet, matching the legend swatches so the eye can scan by colour band.

### Fixed

- **Inner DAG placements light up during execution.** The runner uses the new `placementPath` argument (introduced in 0.12.0) to build the full cytoscape id (`[...placementPath, nodeName].join('/')`) for every `setActive` / `setCompleted` / `setErrored` / `markEdgeTraversed` call. Only the placement currently executing highlights; no more three-placement bleed from same-named inner nodes across `on-topic-search` / `author-search` / `similar-search`.
- The `decideTools` safety-net paths (sparse plan / empty plan / catch) no longer thread the raw visitor sentence as the scout's `query` arg; they now omit `query`/`subject` entirely so each scout falls back to `state.terms.join(' ')` (the extracted keywords). OpenLibrary, Google Books, and Subject Search receive catalog-searchable keywords instead of prose questions.

## [0.12.0] - 2026-05-25

**Smart Archivist: embedder-based recall, anti-hallucination validator, deterministic decide-tools, hybrid rank-candidates.**

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
- `Instrumentation` contract gains a `placementPath: readonly string[]` argument on `nodeStart`, `nodeEnd`, and `error` hooks. `Dagonizer.onNodeStart`, `onNodeEnd`, and `onError` subclass hooks accept the same argument (defaulted to `[]` for back-compat). The path holds the ordered embedded-DAG placement names that led to the current node: empty for top-level dispatches, `['on-topic-search']` for one-deep, longer for nested. Enables consumers (like the in-browser Archivist demo) to disambiguate same-named inner nodes across multiple embedded-DAG instances and highlight only the placement currently executing.
- `ArchivistServices.embedder`: `Embedder | null` exposed as a service. Wired in the CLI runtime (`runArchivist.ts`) from the existing `EmbedderCascade` and set to `null` in the browser runtimes (`main.ts`, `ArchivistRunner.vue`) where no native embedder is available. Every consumer handles `null` gracefully via deterministic fallback.
- `recordFindings` writes a `dag:embedding` literal per shortlisted candidate (computed from title + description) and a `dag:queryEmbedding` per run, computed via the embedder when reachable. Skipped gracefully on any embedder failure; the absence of these triples is invisible to nodes that don't explicitly use embeddings.
- `recallCandidates` uses cosine similarity (threshold 0.70) against prior `dag:queryEmbedding` triples when the embedder is reachable; falls back to Jaccard (threshold 0.35) otherwise. Each recalled candidate carries `notes.cosineSimilarity` so downstream nodes can see the match strength. Captures semantic equivalents like "morality in post-scarcity" ↔ "ethics under abundance".
- Anti-hallucination validator runs deterministically before the LLM validator in `compose-retry-loop`. Tokenises capitalised multi-word entity spans and italicised titles in the draft, cross-references against `state.shortlist` + `state.priorCandidates`, and forces a retry when the draft names books not in either pool. Also bias-checks: when the shortlist is non-empty but the draft cites no shortlist title, the retry loop fires. Eliminates the "Utopia / Iron Heel" class of hallucination at zero LLM cost.

### Changed

- `decideTools` deterministic shortcuts now route ISBN queries (ISBN-10 / ISBN-13) to a direct OpenLibrary lookup via `?q=<isbn>`, author lookups via `?author=<name>`, and subject/topic queries via `?subject=<term>`. The OpenLibrary scout reads typed `author`/`subject`/`isbn` args alongside the existing `query` arg, so the four-scout cascade exploits OpenLibrary's actual search axes instead of always falling back to a keyword query. Pattern-matches five common query shapes (isbn-lookup, author lookup, single-quoted title, "books about X", catalog browsing) and bypasses the LLM for unambiguous tool selection. Saves one LLM call per turn on Nano. Existing safety-nets still apply when no pattern matches.
- `rankCandidates` hybrid pipeline: deterministic composite score (cosine 50%, token overlap 25%, source priority 15%, recency 10%, prior-memory bonus 5%) sorts all candidates; LLM tiebreaks ONLY the top-3 when their scores are within 0.10. Reduces LLM calls per turn from N to at most 1, with better-grounded ordering. Title embeddings cached on `notes.titleEmbedding` for reuse across nodes.

## [0.11.5] - 2026-05-25

**Archivist DAG node rename + CytoscapeRenderer Title-Case label formatter + search-quality fixes + prior-memory candidate salvage.**

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
- `recallCandidates` node: runs before `book-search-fanout` scouts and pre-loads `state.priorCandidates` from memory: prior shortlisted books for runs whose visitor query has Jaccard >= 0.35 overlap with the current query. Cap 10. When live scouts return zero or a source fails (e.g. Google Books 429), the fan-out merges in these prior candidates so the composer always has material to ground a response.
- `ArchivistState.priorCandidates`: `readonly Candidate[]`, always initialized. Round-trips through checkpoint snapshot/restore and clone().
- Compose prompts gain a `priorMemoryHint` directive that fires when any candidate carries `notes.fromPriorMemory: true`, so the archivist phrases recalls as "I recall from earlier" instead of "I just searched". Wired into `compose`, `composeAuthor`, `composeReviews`, `describeBook`, and `composeSimilar`.
- `recallContext` seeds `state.priorCandidates` (cap 5) from high-Jaccard prior runs so intents that skip the `book-search-fanout` embedded-DAG (e.g. `describe-book`, `recall-memories`) still have access to prior candidates.

### Fixed

- Scouts now run their searches against the keywords produced by `extract-query` instead of the raw visitor sentence. `defaultToolArguments` no longer threads `state.query` through as the `query`/`subject` arg; that override was bypassing each scout's `state.terms.join(' ')` fallback. OpenLibrary, Google Books, and Subject Search receive proper catalog-searchable keywords; Wikipedia continues to use `state.terms` directly.
- `extract-query` prompt rewritten with concrete examples teaching the LLM to distill prose into 2-4 catalog-searchable domain keywords (strip fillers, normalize abbreviations, keep proper nouns). Eliminates the prior failure mode where "sci-fi novels existential questions" got 0 OpenLibrary hits because "novels" and "questions" are noise tokens.
- Per-scout query shaping: `subject_search` picks the most-specific term from `state.terms` (Library of Congress subject indexes prefer single subjects); `wikipedia_summary` prefers the first capitalised term when one is present (proper-noun title heuristic).
- Scout logs now include the raw upstream hit count and the first-result title, so debugging 0-hit responses doesn't require devtools.

### Changed

- Every Archivist DAG placement renamed to drop the `bsf-` (book-search-fanout) and `crl-` (compose-retry-loop) namespace prefixes. The embedded-DAG containment already provides the visual namespace in the cytoscape view, so the prefix on each leaf placement was redundant. Affects every reference site: parent `dag.ts` routes, embedded-DAG builders, node-registration order, trace-feed display, prompts that pinned placement names, and any test fixtures that snapshotted the old names.
- `CytoscapeRenderer` now emits `data.label` formatted as Title Case (kebab-case → Title Case, with `/` path separators preserved). Machine identifiers (placement `name`, route keys, trace node fields) remain kebab-case. So `book-search-fanout/extract-query` renders as "Book Search Fanout / Extract Query".

## [0.11.4] - 2026-05-25

**In-node timeouts and salvage paths on every LLM-calling Archivist node; index-pointer schemas for rank-candidates and decide-tools; slow-backend warning banner.**

### Fixed

- The Archivist demo no longer hangs when the on-device backend (Gemini Nano, WebLLM) stalls on a constrained-output call. `decideTools`, `classifyIntent`, `extractQuery`, and `rankCandidates` wrap their LLM call in an in-node 30s `AbortController` timer merged with `context.signal` via `AbortSignal.any`. Cancellation is real: the underlying `fetch` / `LanguageModelSession.prompt` aborts. Salvage paths fall through with sensible defaults (raw-query tool plan, `on-topic` intent, whitespace-split terms, unranked scout candidates), so the DAG always completes.

### Changed

- `rankCandidates` LLM schema simplified to `{order: number[]}`: integer indices into the pre-numbered candidate list. Deterministic code materializes the ranked list; LLM stops generating per-candidate isbn/title/score/reason fields. Expected speedup on Nano: 10–25×.
- `decideTools` LLM schema simplified to `{tools: number[]}`: integer indices into the numbered tool list. Tool arguments default to `{query: state.query, limit: 8, lang: state.userLanguage}` and are no longer LLM-generated. The adapter's tools channel (`functionDeclarations` / `responseConstraint`) is no longer used here; `outputSchema` is used instead. Expected speedup on Nano: ~10×.
- `LlmClient.decideTools`, `classifyIntent`, and `extractTerms` accept an optional trailing `signal?: AbortSignal` parameter, propagated through `ChatRequestBuilder`.

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
- Browser-built-in slow-backend warning banner on the Archivist demo. Shown when the active backend is `gemini-nano` or `web-llm` AND no cloud API key is configured. Dismissable; preference persisted in `localStorage` under `archivist:dismiss-slow-banner`.

## [0.11.3] - 2026-05-25

**DagGraph hex motif + dagre tuning.**

### Changed

- Compound subgraphs (`embedded-dag`, `parallel`, every `node:parent` container) render as `round-hexagon`. Fan-out placements render as `concave-hexagon`. Leaf nodes stay rectangular; the hex motif now reads as "container" at every level.
- Edges render with `curve-style: round-taxi` (rounded 90° segments, 12px corner radius) and a `vee` arrowhead (sharper 6-sided wedge, fitting the hex motif). `source-endpoint` / `target-endpoint` set to `outside-to-node-or-label` so arrows never sit inside node padding.
- Dagre layout: `ranker: 'tight-tree'` (packs DAGs whose branches reconverge, like the Archivist's fan-out → merge pattern); `align` removed so each rank centers under its predecessor; `marginx: 40` / `marginy: 40` added so outermost nodes have wrap-around room.

## [0.11.2] - 2026-05-25

**Archivist `rank-candidates`: signal propagation, timeout budget, and unranked-candidate salvage.**

### Fixed

- `rank-candidates` no longer loses scout-found candidates when the LLM is slow. `context.signal` is now forwarded through `LlmClient.rankCandidates` all the way to the adapter's `fetch` call via `ChatRequest.signal`. When the parent flow's deadline aborts the signal, the underlying fetch is cancelled immediately rather than running to completion and having its result silently discarded.
- The per-node `timeoutMs` field is removed from the `rank-candidates` placement. The dispatcher implements `timeoutMs` as an external `Promise.race`: when the deadline wins, the execute promise is discarded and the node's try/catch salvage block never runs. With `timeoutMs` absent, abort/timeout errors surface inside `execute` where the catch block can handle them.
- On abort or timeout, the catch block logs `rank-candidates: timed out, falling through with N unranked candidates` and routes `'ranked'` with `state.candidates` intact (scout-supplied scores preserved). The merge and compose steps proceed with real books instead of an empty shortlist.
- `RANK_TIMEOUT_MS` raised to 90,000 ms for documentation purposes. On-device models (Gemini Nano, WebLLM) take 60–90 s to batch-score 8 candidates; cloud APIs respond in 1–3 s and are unaffected by the larger budget.

## [0.11.1] - 2026-05-24

**Archivist intent routing fixes, conversation context threading, and Ollama error UX.**

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
- `ConversationTurn` interface exported from `ArchivistState.ts`. Carries `role`, `text`, and `ts` for a single visitor or archivist turn.
- `ArchivistState.conversation` field (`readonly ConversationTurn[] = []`): stores the N most-recent turns sliced from the runner's display buffer before each DAG execution. Round-trips through `snapshotData()` / `restoreData()` for checkpoint support. V8 shape stability: always initialised to `[]`, never undefined.
- `ConversationContextPane.vue`: new Config tab slider ("Conversation context window", default 6 turns, range 0–20). Setting to 0 disables history threading entirely. Persisted to `localStorage`. Mirrors the `TimeoutPane` styling.
- Archivist demo threads the last N conversation turns into every LLM compose call and the `classifyIntent` prompt. Prior turns are formatted as a "Conversation so far" block so the model resolves pronouns ("that", "it", "yes let's do that") against context. Fixes a bug where pronoun-resolution queries were treated as cold starts.
- `recallContext` and `recallMemories` nodes boost their LLM-ready summary when the current query is a short pronoun-acceptance ("yes", "sure", "let's do that") and the last archivist turn proposed an action, so the classifier can resolve the reference before SPARQL memory data is available.

### Changed

- Backend cascade reordered: cloud APIs (Groq, Cerebras, Gemini API, Mistral, OpenRouter) take priority over local daemon (Ollama) and on-device models (Gemini Nano, WebLLM). The highest-priority reachable backend is now auto-selected at mount time; saved user preference still wins on reload.
- `IntentClassifier` anchor phrases sharpened: `recommend-similar` now covers "similar to Dune" patterns; `search` anchor explicitly covers tool-use and web-lookup requests; `off-topic` is restricted to queries clearly unrelated to books (weather, sports, jokes).
- `classifyIntent` LLM prompt updated: explicit rule that tool-related and web-search queries must route to `search`, never `off-topic`; `off-topic` definition tightened; two new examples added.
- `decideTools` safety net extended: when `intent === 'on-topic'` and the LLM proposes fewer than two tools, all four scouts (`web_search_books`, `google_books_search`, `subject_search`, `wikipedia_summary`) are pre-populated so the fan-out runs in full.
- `LlmClient` interface (`services.ts`): `classifyIntent`, `compose`, `composeAuthor`, `composeReviews`, `describeBook`, `composeSimilar`, `composeMemoryRecall`, and `composeEmptyResponse` accept an optional trailing `conversation?: readonly ConversationTurn[]` parameter. Existing call sites pass `undefined` and are unaffected.

### Fixed

- Ollama adapter now intercepts HTTP 404 responses and re-throws with the message `Ollama model 'X' is not installed. Run: ollama pull X` instead of a generic error.

## [0.11.0] - 2026-05-24

**EmbeddedDAG boundary + engine hardening.** Deep-DAG authoring is renamed
`EmbeddedDAG` throughout the codebase, adding typed state mappings, structured
lifecycle phases, resumable fan-out, and a plugin-accessible instrumentation
contract. Checkpoint API gains named-store capture/recall. LLM adapter cascade,
user-language threading, and an Embedder pipeline ship alongside the engine
changes.

### Added: EmbeddedDAG authoring

- `TypedDeepDAGOptionsInterface<TChildState, TParentState>` narrows both sides of `inputs` and `outputs` at compile time via the new `Path<T>` recursive dotted-path type.
- `Path<T>` utility type resolves `'a' | 'a.b' | 'a.b.c'` strings from a state shape (depth cap 8; array indices included).
- `DAGBuilder.deepDAG<TChildState, TParentState>()`: both generics default to `NodeStateInterface`; existing call sites typecheck unchanged.
- `examples/05-embedded-dags.ts` (renamed from `05-deepflows.ts`) illustrates the typed mapping API.

### Added: PhaseNode placements

- `PhaseNodePlacementInterface`: `'pre'` and `'post'` phase nodes run before the entrypoint and after flow completion respectively, outside the main node loop.
- `DAGBuilder.phase(name, kind, nodeClass, routes)` registers a phase placement.
- Pre-phases abort the flow on error; post-phases run unconditionally after the main loop (including on abort/failure). Both are suppressed when the dispatcher is invoked as a deep-DAG re-entry.
- `Instrumentation.phaseEnter` / `phaseExit` hooks fire around every phase execution.

### Added: Instrumentation contract

- `Instrumentation` adapter contract (in `./contracts`): `flowStart`, `flowEnd`, `nodeStart`, `nodeEnd`, `phaseEnter`, `phaseExit`, `error` hooks for plugin-supplied tracing and metrics.
- `NoopInstrumentation` default: every method is a no-op; consumers extend and override the hooks they care about.
- `DagonizerOptionsInterface.instrumentation`: pass an `Instrumentation` instance at construction; fires alongside the existing protected `on*` subclass hooks so both surfaces coexist.

### Added: Bundle registration

- `DispatcherBundle<TState, TServices>`: cohesive unit of `nodes` + `dags` exported by plugin packages.
- `Dagonizer.registerBundle(bundle)`: registers all nodes first, then all DAGs, in a single call.

### Added: Resumable fan-out

- Fan-out nodes persist per-item progress in `state.metadata` under `FAN_OUT_PROGRESS_KEY`.
- `executeFanOut` resumes from the last completed item index on `dispatcher.resume`, skipping already-finished items and reconstructing `resultsByOutput` buckets.
- `FanOutProgress` and `StoredFanOutProgress` types exported from the root barrel.

### Added: Checkpoint named-store API

- `Checkpoint.capture(dagName, result, options?)`: builds and optionally persists a checkpoint to named `StoreProvider` instances in one call.
- `Checkpoint.recall(store, runId)`: loads a raw checkpoint from a `CheckpointStore` by run ID; returns `null` when not found.
- `Checkpoint.load(raw).restoreState(fn)`: replaces the previous `Checkpoint.restore()` static. Parses the raw JSON, then restores state via caller-supplied factory.
- `Checkpoint.restoreStores(map)`: rehydrates named stores from snapshot data before resuming.
- `examples/08-checkpoint.ts` and `examples/the-archivist/runArchivist.ts` demonstrate the full `capture → persist → recall → restoreState → resume` round-trip against `MemoryCheckpointStore`.

### Added: LLM adapter cascade and Embedder pipeline

- `LlmAdapter.probe()` on the adapter contract: returns a liveness signal; `BaseAdapter` default returns `true`.
- `LlmAdapterCascade`: tries adapters in priority order, falling back on `probe()` failure or error. Ships in `@studnicky/dagonizer/adapter`.
- `EmbedderAdapter` contract + `EmbedderRegistry` + `EmbedderCascade`: plugin-supplied embedding backends with cosine-similarity cascade fallback.
- Three embedder plugin packages: `@studnicky/dagonizer-embedder-ollama`, `@studnicky/dagonizer-embedder-gemini-rest`, `@studnicky/dagonizer-embedder-mistral`.
- `IntentClassifier`: cosine-similarity intent classification with LLM fallback when similarity scores are below threshold.

### Added: User-language threading

- `LlmAdapter.language` property: resolves from `navigator.language`, persisted per session.
- Adapter cascade threads ISO 639-2 language code through scout tool calls (`langRestrict`, `lang`, Wikipedia subdomain) so responses match the user's device language.

### Added: RemoteStore contract

- `RemoteStore extends Store`: distributed shared-state contract with `endpoint`, `acquireLease`, `releaseLease`, and `health` primitives. Ships in `./contracts`.

### Changed: Execution result

- `ExecutionResultInterface.interruptedAt`: `InterruptionInfo | null` records the node name and abort reason when a run is cancelled or timed out; `null` on clean completion.
- `Dagonizer.handleAbort` returns structured `{ error, reason }` rather than throwing; the dispatcher uses this to populate `interruptedAt` and fire instrumentation hooks.

### Changed: Canonical naming and signatures

- `ChatRequestBuilder` (static class) replaces the previous `ChatRequest` const export; `ChatResponseMessageBuilder` replaces `ChatResponseMessage`. All import sites de-aliased; no re-aliasing at any import boundary.
- Adapter constructors lift `apiKey`, `id`, `displayName`, and `capabilities` to required positional parameters; options interfaces are fully optional. `PartialBaseAdapterOptions` removed.
- `gemini-nano` adapter `displayName` rephrased to "Browser built-in LanguageModel"; package name and `id` unchanged, non-breaking (#24).

### Docs

- All guide, reference, and example pages under `docs/` rewritten in present tense to match the v0.11 surface.
- `docs/examples/05-embedded-dags.md` replaces `05-deepflows.md`; `docs/reference/nodes.md` replaces `operations.md`.
- `docs/examples/10-shared-state.md`: new example covering the shared-state pattern.
- Obsolete RFCs (`0001-plugin-architecture.md`, `0002-v0.10-review-findings.md`, `0003-v0.10-release-checklist.md`) removed; superseded by shipped v0.10 and v0.11.
- Composable prompt primitives documented in the Archivist example: every static directive is a named constant; builder bodies compose by reference.

## [0.10.0] - 2026-05-21

**Plugin architecture (RFC 0001).** Workspace restructure into pnpm monorepo;
17 packages ship as a single ecosystem version locked at 0.10.0.

> **Beta: GitHub-only release. Not yet published to npm.** Wire-format
> compatibility verified via intercepted-fetch smoke; live-API smoke against
> each provider is pending. Expect minor adjustments per adapter before 1.0.

### Added: main package gains three stable subpaths

- `@studnicky/dagonizer/adapter`: `LlmAdapter`, `BaseAdapter`, `OpenAiCompatibleAdapter`, `ChatRequestBuilder`, capability metadata, error taxonomy.
- `@studnicky/dagonizer/patterns`: `MonadicNode` root + service contracts (`LlmClient`, `TripleStore`, `SearchTool`).
- `@studnicky/dagonizer/tool`: `Tool` interface, `ToolError`, `HttpTransport`.

### Added: 8 cloud / on-device adapter packages

- `@studnicky/dagonizer-adapter-{gemini-api,gemini-nano,web-llm,groq,cerebras,mistral,openrouter,stub}`.
- All four OpenAI-shaped cloud adapters now extend `OpenAiCompatibleAdapter`; each provider is ~30 LOC of configuration. Removed ~600 LOC of duplication.
- Cerebras default switched to `gpt-oss-120b` (was `llama-3.3-70b` which doesn't exist in Cerebras's catalog).
- StubAdapter gains test-fixture primitives: `invocations` snapshot, `enqueueResponse`, `setError`, `clear`. Six unit tests cover the new surface.

### Added: local adapter

- `@studnicky/dagonizer-adapter-ollama`: local-first via Ollama's OpenAI-compatible endpoint. Browser-side picker auto-detects the daemon via a 600 ms ping; model name persists to localStorage.

### Added: 3 tool packages

- `@studnicky/dagonizer-tool-{openlibrary,googlebooks,wikipedia}`: book-domain external searches. `HttpTransport` (in `@studnicky/dagonizer/tool`) consolidates retry + abort + timeout.

### Added: book-entities shared package

- `@studnicky/dagonizer-book-entities`: `Book` / `Candidate` / `Money` types + `CanonicalId` dedupe. Replaces duplicated entity files across the three book-search tools.

### Added: 3 pattern packages

- `@studnicky/dagonizer-patterns-rag`: `LlmDispatchNode` parent + `DecisionNode` (with `ClassifyIntentNode`, `DecideToolsNode`, `ValidateResponseNode`, `RankCandidatesNode` leaves), `ComposeNode` (with `ComposeResponseNode`, `ComposeEmptyResponseNode`, `ComposeMemoryResponseNode`, `DeclineNode` leaves), `ScoutNode`.
- `@studnicky/dagonizer-patterns-graph`: `GraphNode` + `RecallContextNode`, `RecordFindingsNode`, `MemoryDigestNode`.
- `@studnicky/dagonizer-patterns-flow`: `FlowNode` + `SelectNode` (→ `PickByScoreNode`, `SortByNode`), `ReduceNode` (→ `DedupeByKeyNode`, `GroupByFieldNode`, `FanInReducerNode`), `PredicateGateNode`, `ExtractFieldNode`, `RespondNode`.

### Changed: adapter contract surface

- `ChatRequest` fields are required (no `?:`). Use `ChatRequestBuilder.from(partial)` to fill defaults (`DEFAULT_TOOL_CHOICE`, `DEFAULT_OUTPUT_SCHEMA`, `DEFAULT_MAX_TOKENS`, `DEFAULT_TEMPERATURE`, never-aborting `AbortSignal`).
- `ChatResponse.message` is a discriminated union: `{ kind: 'text' | 'tools' | 'mixed' }`. Use `ChatResponseMessage.from(content, toolCalls)`.
- `OutputSchema` is a discriminated union: `{ kind: 'none' } | { kind: 'schema', schema, id }`.
- `LlmAdapter.connect` / `disconnect` are required; `BaseAdapter` ships no-op defaults.
- Operating principle codified in `CLAUDE.md`: required-with-defaults over optional/undefined, with V8 hidden-class rationale.

### Added: Archivist demo UX

- Conversation send button shows a running indicator (pulsing cyan textarea + rotating spinner ring behind ✕).
- DAG camera auto-follows the active node during execution (480 ms ease).
- Dagre layout widened (`rankSep` 180→240, `nodeSep` 80→140, `edgeSep` 30→60); edges no longer overlap.
- Edge labels anchored at source end with `source-text-margin-y` / `source-text-offset` / autorotate; never overlap downstream nodes.
- BackendPicker shows all 9 adapter rows (8 plugin + ArchivistStub) + Ollama row with detection chip.
- Mobile mode auto-defaults to ArchivistStub (with seed library) when no API key is set.
- Pre-seeded 18-book sci-fi + philosophy library loads into the memory graph on mount.

### Tooling

- pnpm workspaces.
- Per-package mini-docs (16 plugin READMEs).
- Per-package isolation tests (210+ across the workspace).
- Hoisted `tsconfig.base.json` + `tsconfig.package.json` with `${configDir}` substitution.
- Changesets-driven release pipeline; `release.yml` opens a "Version Packages" PR (npm publish step intentionally skipped for the 0.10.0 GitHub-only ship).

### Notes: known limitations

- Live-API smoke (real provider keys) deferred; checklist in `docs/rfc/0003-v0.10-release-checklist.md`.
- Cerebras `gpt-oss-120b` tool-call adherence is partial; adapter has fallback.
- OpenRouter `:free` tier can downgrade tool support per-route; capability declared `'partial'`.
- Gemini Nano uses `responseConstraint` JSON shim (no native function calling).
- Pattern packages ship the canonical taxonomy; Archivist nodes are not yet refactored to extend them (incremental adoption path).

## [0.9.2] - 2026-05-20

### Fixed

- `GroqApiAdapter` now sends `max_completion_tokens` instead of `max_tokens`; Groq's API does not support `max_tokens`. Requests previously silently ignored the token cap.
- `CerebrasApiAdapter` default model corrected to `gpt-oss-120b`; Cerebras's catalog does not include any `llama-3.3-70b` variant, so the previous default returned a model-not-found error on every call. The adapter also now sends `max_completion_tokens` (Cerebras's documented field).

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
- `AdapterCapabilities` interface on `LlmAdapter`: every adapter declares `{ toolUse: 'full' | 'partial' | 'none'; structuredOutput: boolean; jsonMode: boolean }`. Lets the host DAG introspect what a backend can do and route accordingly instead of assuming tool calls survive every model.
- Capability declarations on all eight adapters: Gemini API (full), Gemini Nano (none), WebLLM (partial), Groq (full), Cerebras (partial), Mistral (full), OpenRouter (partial), Stub (full).
- `examples/the-archivist/__smoke__/adapter-transport.smoke.ts` + `npm run smoke:adapters`: wire-format smoke test that intercepts `fetch` and asserts each cloud adapter's outgoing request body matches the provider's documented schema (endpoint URL, field names, headers, tool shape). No network calls. Runs as part of `npm run ci`.

## [0.9.1] - 2026-05-20

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
⦿ `GroqApiAdapter`: OpenAI-compatible REST adapter for Groq (`https://api.groq.com/openai/v1/chat/completions`). Default model `llama-3.3-70b-versatile`. Supports tool-use via `tools` + `tool_choice`, structured output via `response_format: json_object`, 60-second per-request timeout via AbortController.
⦿ `CerebrasApiAdapter`: OpenAI-compatible REST adapter for Cerebras (`https://api.cerebras.ai/v1/chat/completions`). Default model `llama-3.3-70b`. Tool-use gated with try/catch fallback to plain chat when the model signals tools are unsupported.
⦿ `MistralApiAdapter`: OpenAI-compatible REST adapter for Mistral AI (`https://api.mistral.ai/v1/chat/completions`). Default model `mistral-small-latest`. Full tool-use and structured-output support.
⦿ `OpenRouterApiAdapter`: OpenAI-compatible REST adapter for OpenRouter (`https://openrouter.ai/api/v1/chat/completions`). Default model `meta-llama/llama-3.3-70b-instruct:free` (free tier). Includes required `HTTP-Referer` and `X-Title` headers.
⦿ `MobileDetection`: static class that triangulates mobile device status from three signals (touch points, coarse pointer media query, viewport width). Supports `localStorage`-backed `setOverride`/`readOverride` for user-controlled desktop/mobile mode.
⦿ Per-provider API key storage in `localStorage` under `dagonizer-api-keys` (JSON blob keyed by `ProviderId`). `loadApiKeys()` and `saveApiKeys()` helpers with automatic migration of the legacy `dagonizer-gemini-key` entry.
⦿ Mobile banner in `ArchivistRunner`: shown when `MobileDetection.isLikelyMobile()` returns true. Links to Groq key page, explains on-device backend unavailability, and provides a "Treat as desktop" override link.
⦿ `BackendPicker` per-backend key inputs: each cloud backend gets its own collapsible `<details>` with a password input, reveal toggle, link to the key page, and a set/not-set status chip. Desktop-only chip on `gemini-nano` and `web-llm` rows when `isMobile` is true.
⦿ Stub adapter is now surfaced on mobile as the zero-setup fallback; the mobile banner makes the canned-vs-real LLM distinction explicit so visitors know what they're seeing until a key is entered.
⦿ 18-book sci-fi / philosophy seed library (`SeedLibrary`) auto-loaded into `urn:dagonizer:memory` on mount. The Memory tab has content from first paint; stub responses cite real titles from the seed graph; `reset()` restores the seed alongside the ontology TBox.

### Changed

⦿ `ProviderId` union extended: `'groq' | 'cerebras' | 'mistral' | 'openrouter'` added.
⦿ `BROWSER_VISIBLE` list extended to include the four new cloud providers.
⦿ `DetectionInputs.apiKeys` replaces the previous single `apiKey?: string`. All callers updated.
⦿ `pickBestBackend(backends, options?)` gains an optional `{ isMobile: boolean }` second argument. Mobile suppresses `gemini-nano` and `web-llm` from ranking. Priority order: groq → cerebras → gemini-api → mistral → openrouter → gemini-nano → web-llm → stub.
⦿ `hasNoRunnableModel` forwards `isMobile` option to `pickBestBackend`.
⦿ `instantiateProvider` extended to construct all four new adapters; throws `LlmError` (AUTH_FAILED) for missing keys, and handles the exhaustive `never` case.
⦿ `BackendPicker` emits `update:apiKeys` (full map) instead of `update:apiKey` (single string). `ArchivistRunner` updated accordingly.
⦿ Archivist docs (`docs/examples/the-archivist.md`) Backends section enumerates all eight backends with mobile detection behavior documented.

## [0.9.0] - 2026-05-20

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
⦿ `OperationContractFragment`: new adapter contract (`src/contracts/OperationContractFragment.ts`) carrying only the deriver-facing fields (`hardRequired`, `produces`). `OperationContract` extends the fragment with `name` and `outputs` for backward compatibility.
⦿ `NodeInterface.contract?: OperationContractFragment`: optional co-located data-flow declaration on every node. When present, `DAGDeriver.derive({ nodes })` projects the node into a full `OperationContract` using the node's own `name` and `outputs` fields. The node is the single source of truth for its contract.
⦿ `DAGDeriverOptions.nodes?: readonly NodeInterface[]`: alternative to `contracts`; mutually exclusive. Nodes without a `contract` field are silently skipped in topology derivation.
⦿ `DAGDeriver.extractContracts(nodes)`: static helper that projects contract-bearing nodes into `OperationContract[]`, skipping contract-less nodes. Exported from `@studnicky/dagonizer/derive`.
⦿ `ContractRegistryValidator`: new static class (`src/derive/ContractRegistryValidator.ts`) that validates co-located contracts for dangling reads (throws `DAGError`) and dead writes (calls `onContractWarning`). Runs automatically during `Dagonizer.registerDAG` for DAGs derived from a `nodes` registry.
⦿ `Dagonizer.onContractWarning(message)`: new protected observability hook, no-op by default. Fires when `ContractRegistryValidator` detects a dead-write (a node produces a path no downstream node consumes). Subclass and override to surface these warnings.
⦿ `Chainable<A, B>`: compile-time type utility exported from `NodeInterface`. Resolves to `true` when `B`'s `hardRequired` set is fully satisfied by `A`'s `produces` set, `never` otherwise. Most useful with `as const` literal-tuple contracts.
⦿ Exports: `OperationContractFragment` and `Chainable` added to `@studnicky/dagonizer/contracts`, `@studnicky/dagonizer/types`, and the root barrel. `ContractRegistryValidator` exported from `@studnicky/dagonizer/derive`.
⦿ `DAGBuilder.build(onContractWarning?)` runs dangling-read / dead-write contract validation when any node placement registered via `.node()` or `.fanOut()` carries a `contract` field on its `NodeInterface`. Dangling reads throw `DAGError`; dead writes call the optional `onContractWarning` callback (no-op when omitted). Matches the validation `DAGDeriver` runs at derive time; drift fails at build time, before the DAG is registered.
⦿ `DAGBuilder.fromNodes({ name, version, entrypoint, nodes, annotations? })`: static convenience method that delegates to `DAGDeriver.derive({ nodes })` for the linear-topology common case. Produces the same canonical `DAG` document as the equivalent `.node()` chain, without requiring manual placement. Throws `DAGError` when no node carries a `contract` field (matches deriver behavior).

### Changed

⦿ `DAGDeriverOptions.contracts` is now optional (was required). The standalone `contracts` path is unchanged and fully backward-compatible.
⦿ `DAGDeriverOptions`: `contracts` and `nodes` are mutually exclusive; supplying both throws `DAGError`. Supplying neither throws `DAGError`.
⦿ `Dagonizer.registerDAG` runs a third validation pass (contract validation) after the existing schema and semantic passes, for DAGs whose nodes carry co-located contracts.
⦿ Docs updated: `docs/reference/contracts.md` introduces `OperationContractFragment` and the co-located pattern; `docs/guide/derive.md` adds "Co-located contracts" and "Catching contract drift" sections; `docs/reference/dagonizer.md` documents the third validation pass and `onContractWarning` hook.

## [0.8.4] - 2026-05-20

### Fixed

⦿ Archivist demo: `reset()` now calls `memoryStore.clear()` followed by `memoryStore.loadOntology(ONTOLOGY_NTRIPLES)` so the TBox schema layer is re-seeded after every reset. Previously the ontology named graph was dropped on reset, leaving the Memory tab layer-chip filter empty.
⦿ Archivist demo: `TripleInspector` accepts a structured `MemorySelection` prop (`{ kind: 'iri'; iri: string } | { kind: 'literal'; value: string }`) instead of a raw IRI string. Clicking a literal node now queries `?s ?p <literal>` and displays inbound triples rather than showing "No triples mention this IRI."

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
⦿ Archivist demo: `PanesTabs` exposes a `#tab-suffix` named slot rendered at the right edge of the tab row with `margin-left: auto`. The right-column `PanesTabs` uses it to host a compact persistence toggle button (replaces the "Memory store" section in the Config tab).
⦿ Archivist demo: D-pad pan on `MemoryGraph`. The four directional buttons shift all point positions by 250 world-units via `getPointPositions`/`setPointPositions(next, true)` and call `render(0)`, providing manual pan without a native cosmos.gl API.
⦿ Archivist demo: drag-and-throw physics on `MemoryGraph` via `enableDrag: true` in the cosmos.gl config.
⦿ Archivist demo: `humanLabel` helper in `MemoryGraph`. Run IRIs render as "Run <6-char prefix>"; book IRIs look up `dag:title` and fall back to "Book <last 4 of isbn>"; `xsd:dateTime` literals render as `HH:MM:SS` only; `dag:` vocabulary terms show only the local name.

### Changed

⦿ Archivist demo: starter-query, greeting, and visitor-reply LLM prompts bias toward science fiction and philosophy (Liu Cixin, Gibson, Le Guin, Lem, Ted Chiang, Borges, Camus, Foucault, Deleuze, Wittgenstein) instead of generic world literature. Static fallback pool updated to match.
⦿ Archivist demo: `MemoryGraph` emits a structured `MemorySelection` union on node click (`{ kind: 'iri'; iri } | { kind: 'literal'; value }`) instead of a raw IRI string. `ArchivistRunner` tracks `selectedSelection: Ref<MemorySelection | null>` and passes it to `TripleInspector`.
⦿ `package.json` keywords gain LLM / agent-orchestration and semantic-web terms (`agent-framework`, `llm-orchestration`, `ai-agent`, `tool-use`, `function-calling`, `rag`, `sparql`, `n3`, `ontology`, `owl`, `named-graphs`, `provenance`, `prov-o`, `task-graph`) for npm discoverability. GitHub repository topics seeded with a matching 20-topic subset.

## [0.8.3] - 2026-05-20

### Fixed

⦿ `docs/guide/subclassing.md` code sample built a `DAG` literal using the pre-v0.6.0 flat shape (`{ type: 'single', ... }`) which would fail validation against `DAGSchema`. Rewrote to canonical JSON-LD with `@context` (`DAG_CONTEXT`), `@id`, `@type: 'DAG'` at the document root, and `'@type': 'SingleNode'` + `@id` on every placement. Import line now includes `DAG_CONTEXT`.
⦿ `docs/reference/derive.md` "Related guides" called DAGBuilder "the imperative alternative", pre-v0.8.0 framing that contradicted the deterministic-vs-agentic positioning the rest of the docs adopted. Replaced with a link to `Authoring DAGs` plus a corrected DAGBuilder description ("imperative authoring for deterministic / ETL workflows").

## [0.8.2] - 2026-05-20

### Fixed

⦿ `docs/guide/derive.md` frontmatter `seeAlso` linked to DAGBuilder as "the imperative alternative when contracts don't fit", old framing that contradicted the v0.8.0 deterministic-vs-agentic positioning. Replaced with a link to `Authoring DAGs` plus a corrected DAGBuilder description.
⦿ `docs/reference/derive.md` prose described `annotations.fanouts.<name>.fanInOperation` as if it were universally present, predating the v0.8.0 discriminated union. Rewrote to scope to `strategy === 'custom'` and added the full validation invariants the deriver enforces (terminal/partition/parallel-membership/placement-kind mismatch).
⦿ `docs/examples/05-deepflows.md` only showed the imperative `DAGBuilder.deepDAG(...)` composition path. Added a "Composing the same flow via `DAGDeriver.subDAGs`" section with a worked example and a cross-link to `examples/derive.ts` so the declarative path is discoverable from the deep-DAG composition page.

## [0.8.1] - 2026-05-19

### Changed

⦿ Strict CLAUDE.md compliance sweep across `src/`. Every previously-module-level helper now lives as a `private static` method on its containing static class: `Validator.formatErrors` / `Validator.compile`, `MermaidRenderer.escapeLabel` / `MermaidRenderer.renderShape` / `MermaidRenderer.renderEdges`, `JsonLdRenderer.placementIri` / `JsonLdRenderer.dagIri` / `JsonLdRenderer.renderRoutes` / `JsonLdRenderer.renderPlacement` / `JsonLdRenderer.renderDagRoot`, `CytoscapeRenderer.idIn` / `CytoscapeRenderer.placementNode` / `CytoscapeRenderer.placementEdges` / `CytoscapeRenderer.renderInto`. Module-level `const`s for shared values became `private static readonly` class fields. No consumer-visible API change; the public surfaces (`Validator.dag.validate`, `MermaidRenderer.render`, `JsonLdRenderer.render`, `CytoscapeRenderer.render`) are unchanged. Repo now satisfies the "Domain modules with `noun.verb()` only. Static classes. No freestanding helpers." invariant at `tsc` enforcement.

## [0.8.0] - 2026-05-19

### Breaking

⦿ **`FlowDeriver` → `DAGDeriver`**. Class, type vocabulary, and module file renamed to align with the rest of the DAG-prefixed surface (`DAGError`, `DAGSchema`, `DAGBuilder`, etc.). `FlowAnnotations` → `DAGDeriverAnnotations`, `FlowFanOut` → `DAGDeriverFanOut`, `FlowTerminal` → `DAGDeriverTerminal`, `FlowDeepDAG` → `DAGDeriverSubDAG`, `FlowDeriverOptions` → `DAGDeriverOptions`. Source paths `src/derive/FlowDeriver.ts` → `src/derive/DAGDeriver.ts`, `src/derive/FlowAnnotations.ts` → `src/derive/DAGDeriverAnnotations.ts`. The `@studnicky/dagonizer/derive` subpath is unchanged; consumers re-import the renamed identifiers.

⦿ **`DAGDeriverFanOut` is now a discriminated union over `strategy`**. The flat `{ fanInOperation, ... }` shape from v0.7.0 is replaced by three variants: `'custom'` (with `fanInOperation`), `'partition'` (with `partitions: Record<outcome, statePath>`), and `'append'` (with `target: statePath`), each carrying its strategy-specific required fields. The top-level `node: string` field is required (registered node invoked per item). Existing fan-out annotations fail at `tsc` with "Property 'strategy' is missing" until updated.

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
⦿ **`DAGDeriverFanOut.strategy: 'partition' | 'append'`** alongside `'custom'`. DAGDeriver can now emit fan-out placements with any of the three fan-in strategies the engine supports, closing the long-standing "DAGDeriver forces 'custom'" gap. Partition keys are validated against `outcomes` at derive time; out-of-band keys throw `DAGError`.

⦿ **`DAGDeriverAnnotations.parallels`**: explicit `ParallelNode` grouping with chosen combine strategy. Without it, same-topological-depth operations auto-group with `combine: 'collect'` as before. With it, the named group forces members into one `ParallelNode` with `combine: 'all-success' | 'any-success' | 'collect'`. Membership is exclusive across groups; members can't also appear in `fanouts` or `subDAGs`. Validated at derive time.

⦿ **`docs/guide/authoring.md`**: top-level framing doc that establishes the positioning publicly. The DAG JSON-LD object is the API; DAGBuilder and DAGDeriver are two authoring journeys. DAGBuilder is for *deterministic workflows you control end-to-end* (ETL, transformation chains, fixed sequences). DAGDeriver is for *agentic flows where reaching the final state matters more than authoring the order* (tool-driven agents, exploratory pipelines, contract-registries). Includes decision matrix, capability matrix, and explicit documentation of the two patterns that are imperative-only (recursive trampoline, runtime-conditional topology).

### Changed

⦿ `guide/builder.md` and `guide/derive.md` open with the deterministic-vs-agentic positioning and cross-link to `guide/authoring.md`. `examples/02-builder.ts` and `examples/derive.ts` JSDoc headers reframe each as the canonical surface for its respective mental model.

⦿ DAGDeriver capability parity with DAGBuilder at the static-topology level. Both authoring journeys can now express every DAG the schema allows: any placement kind, any fan-in strategy, any combine strategy, multi-port routing, sub-DAG composition, explicit or auto-derived parallel grouping. The two surfaces remain shape-different deliberately; DAGBuilder's chain narrows route types at compile time while DAGDeriver's flat registry derives topology from the data graph. Imperative-only patterns (recursive trampoline via `services.dispatcher.execute`, runtime-conditional topology) live in node bodies regardless of authoring journey.

## [0.7.0] - 2026-05-19

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
⦿ `FlowAnnotations.subDAGs`: declarative sub-DAG composition for `FlowDeriver`-derived flows. An operation listed in `subDAGs[name]` renders as a `DeepDAGNode` placement instead of `SingleNode`. The contract still declares `produces ↔ hardRequired` so topology derivation is unchanged; the annotation only swaps the rendered placement kind. `FlowDeepDAG` exports from `@studnicky/dagonizer/derive`:

  ```ts
  interface FlowDeepDAG {
    readonly dag:           string;
    readonly stateMapping?: { readonly input?: Readonly<Record<string, string>>;
                              readonly output?: Readonly<Record<string, string>> };
    readonly outputs:       readonly string[];
  }
  ```

  Closes the last legitimate `DAGBuilder` use-case outside cycle-bounded loops: plugin dispatch, phase composition, and runtime-resolved child flows can now derive cleanly from contracts.

### Changed

⦿ `FlowDeriver.renderNodes` resolves output maps for both `SingleNode` and `DeepDAGNode` placements through one helper. Every port in `subDAG.outputs` auto-wires to the next derived stage; `FlowAnnotations.terminals` overrides individual ports; a terminal whose `outcome` doesn't appear in `subDAG.outputs` throws `DAGError` at derive time with the same fail-fast semantics as `contract.outputs`. An operation appearing in both `fanouts` and `subDAGs` throws; placement kind must be unambiguous.

## [0.6.0] - 2026-05-19

### Breaking

⦿ `OperationContract.outputs: readonly string[]` is now required. Every contract declares the output ports its node can emit. `FlowDeriver` auto-wires every port to the next derived stage; `FlowAnnotations.terminals[name]` overrides individual ports per-operation; a terminal whose `outcome` doesn't appear in `contract.outputs` throws `DAGError` at derive time. Closes the "FlowDeriver auto-wires success outputs only" limitation so multi-port nodes (`['success', 'cached', 'skipped', 'error', 'unknown', 'invalid']`) route uniformly with one contract field instead of N terminal annotations. Pre-existing contracts without `outputs` fail at `tsc`; add `outputs: ['success']` or the actual port set the node emits.

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
⦿ `Dagonizer.serialize(dag)` / `Dagonizer.serializeCompact(dag)` / `Dagonizer.fromValue(value)`: explicit JSON-LD round-trip surface alongside `Dagonizer.load(json)`. `serialize` produces pretty 2-space-indented JSON; `serializeCompact` produces single-line. `fromValue` skips `JSON.parse` for callers with an already-decoded payload (DB jsonb columns, message envelopes).
⦿ `docs/guide/json-ld.md`: comprehensive JSON-LD export/import guide. Covers the canonical `@context`/`@id`/`@type` shape, all four placement discriminators (`SingleNode`, `ParallelNode`, `FanOutNode`, `DeepDAGNode`), round-trip pattern, persistence patterns (file/DB/HTTP with `application/ld+json`), RDF interop showing the equivalent triple form.
⦿ FlowDeriver multi-port routing: every port declared in `contract.outputs` auto-wires to the next derived stage. `FlowDeriver vs DAGBuilder` comparison section in `guide/derive.md` documents the break-even point (3+ ports with mostly-uniform routing → FlowDeriver; mostly-divergent → DAGBuilder).

### Changed

⦿ Documentation overhaul to canonical VitePress templates. `HomeHero.vue` reads `hero` + `features` from frontmatter; `DocFooter.vue` reads `seeAlso` + `nextSteps` from frontmatter; `TopBar.vue` owns the left navbar zone via the `nav-bar-content-before` slot. The home page is now `layout: doc` so it gets the same sidebar/topbar/footer chrome as every other page. 38 doc pages had their `## See also` / `## Next steps` H2 sections lifted into `seeAlso:` / `nextSteps:` frontmatter arrays, rendered uniformly by `DocFooter`.
⦿ Phase examples renumbered simple → complex. New order: `01-linear`, `02-builder`, `03-schema` (Tool schemas: JSON Schema 2020-12 `inputSchema` design), `04-fanout`, `05-deepflows`, `06-cancellation`, `07-retry`, `08-checkpoint`. Files renamed under `examples/` and `docs/examples/`; sidebar labels, page titles, H1s, cross-page links, `examples/README.md` lesson table, `docs/public/llms.txt`, and `package.json` `example:*` scripts all updated to match.
⦿ Sidebar labels aligned with page H1 titles. `Operations` → `Nodes`, `Services` → `Services container`, `Checkpoint` → `Checkpoint & Resume`, `Persistence` → `Checkpoint persistence`, `Schema & JSON loading` → `Schema & JSON Loading`, `JSON-LD export & import` → `JSON-LD export and import`. The `Examples` top-nav link points at `the-archivist` (canonical demo).
⦿ Reference docs reconciled with the current source. `Dagonizer<TState, TServices>` second generic + `DagonizerOptionsInterface` documented; `NodeInterface.timeoutMs` listed in operations table; `NodeContextInterface.services` added; `SchedulerProvider` / `SchedulerHandle` interfaces rewritten to the actual `after`/`at`/`every`/`cancelAll` shape (the old `scheduleAt`/`scheduleAfter`/`scheduleEvery` API never existed); `Clock.hrtime()` corrected to reference `performance.now()` not `process.hrtime.bigint()`; entity discriminators corrected from `type: 'single'` to `'@type': 'SingleNode'` etc.; `NodeTimeoutError` added to the error hierarchy; `Execution` clarified as a class (value import) not type-only; `viz.md` documents the previously-undocumented `JsonLdRenderer`, `CytoscapeRenderer`, `DAGONIZER_VOCAB`, and associated types.
⦿ `Composing Dagonizer with other runtimes` section in `concepts.md` replaces the prior `vs alternatives` framing. Each pairing (Temporal, XState, BullMQ) describes the integration pattern (Temporal Activities wrap Dagonizer DAGs, XState transitions invoke `dispatcher.execute()`, BullMQ jobs hydrate state and dispatch) rather than telling readers to use a different tool.
⦿ Mermaid diagrams render labels contained inside their rects. Root causes fixed: font-size and font-weight overrides removed from CSS so mermaid's measurement matches the rendered glyph metrics; font stack pinned to system monospace (`SF Mono, ui-monospace, Menlo, Consolas`) to eliminate the JetBrains Mono web-font-load measurement race; `white-space: nowrap` on `.edgeLabel` / `.nodeLabel` foreignObjects + paragraph margin/line-height reset inside foreignObjects so VitePress's prose styles don't bleed in; `useMaxWidth: false` + SVG `max-width: 100%` so wide LR diagrams scale down to fit the column without scaling tall TB diagrams to viewport-tall; `wrappingWidth` raised to 220; state diagrams enable `htmlLabels: true` so state name rects size to fit (no more `pending` → `pendin` truncation); `--mermaid-state-stroke` realigned with `--dagonizer-brand` (cyan) instead of brand2 (violet) so state diagrams match flowchart styling.
⦿ Cytoscape DAG canvas unified with the mermaid theme. Pearl-black node interior (`#020306`), cyan border (`#22e8ff`), pearl text (`#eef3f7`), monospace font, 14px labels, `curve-style: taxi` for angled segments matching mermaid's `linear` curve, navy-panel edge label background. Compound parents (`node:parent`) use the cluster steel-on-deepest-navy palette. State styling (`dag-active` / `dag-completed` / `dag-errored`) keeps the dark interior and shifts the border color so one active node pops without flooding the viewport. Canvas surface uses the canonical `--dagonizer-surface-bg-deep` + grain texture so the cytoscape viewport and the mermaid SVG frames read as the same panel family.
⦿ Bullet lists render with alternating ⦿ (cyan) / ⦾ (gold) glyph markers via `.vp-doc ul > li::before`. Nested lists use `▸`. Ordered lists keep numeric markers in cyan mono. 6 paragraph-prefixed pseudo-bullet sections in `concepts.md` rewritten as proper markdown bullet lists so the canonical styling applies.
⦿ Canonical surface treatment unified across all boxed elements. CSS variables `--dagonizer-surface-{radius,border,bg,bg-deep,grain,grain-size,pad}` drive feature cards, code blocks, mermaid frames, blockquotes, tables, and `.custom-block` (tip/info/warning/danger/details) so they read as one family. Code blocks and mermaid frames use the deep `pearl-black` surface; tables, blockquotes, feature cards use the `bg-alt` navy.
⦿ Navbar architecture refactored to use VitePress CSS-variable shadowing instead of `!important` overrides. `.VPNav` paints the surface (VitePress's scoped CSS hard-codes `.VPNavBar` to `transparent` at ≥960px); `--vp-sidebar-width: 0px` and `--vp-layout-max-width: 100%` shadowed inside `.VPNavBar` neutralize the sidebar-reservation padding without per-element overrides. `.VPNav.VPNav { width: 100vw; z-index: 1000; }` selector-specificity beats VitePress's scoped `[data-v-…]` (0,1,1) without `!important`; spans the scrollbar gutter and outranks any positioned `.VPContent` descendant that could bleed through. Page scrollbar styled (`scrollbar-color: pewter on --vp-c-bg-alt`) so the gutter matches the navbar surface. Net effect: ~13 navbar `!important`s removed; remaining `!important`s are all legitimate mermaid SVG inline-style overrides.

### Fixed

⦿ `the-archivist.md` referenced non-existent `toJsonLd` / `fromJsonLd` exports; replaced with the real `Dagonizer.serialize` / `Dagonizer.load` API.
⦿ `getting-started.md` minimal example now constructs a canonical JSON-LD DAG with `@context`, `@id`, `@type: 'DAG'`, and `'@type': 'SingleNode'` on the placement, matching `DAGSchema`. The prior `type: 'single'` shape was schema-invalid.
⦿ `concepts.md` referenced non-existent `registerFlow`; corrected to `registerDAG`.
⦿ `guide/cancellation.md` + `guide/observability.md` used the non-existent `context.flowName` field; corrected to `context.dagName`.
⦿ `guide/builder.md` showed a `deepDAG` example with `error: null` routing, which `registerDAG` rejects (null-targeted DeepDAGNode outputs throw). Updated to route through a finalize placement.
⦿ `guide/schema.md` imported `sharedAjv` from `./validation`; that's an internal export not on the barrel. Replaced with the real `Validator` sub-validator API (`is`, `validate`, `errors`).
⦿ All 8 phase examples confirmed to exit 0 under `npx tsx`. Phase 02 had inverted URL-length comments in the inline annotation table; corrected.

## [0.5.0] - 2026-05-18

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
⦿ Full iridis SEO parity: `llms.txt` (llmstxt.org canonical URL index), RSS `feed.xml` generated from CHANGELOG at build time, BreadcrumbList JSON-LD per page, HowTo JSON-LD for examples pages, `manifest.webmanifest`, hreflang alternates (`en-US` + `x-default`), `article:modified_time` + `article:author` from git lastUpdated, Organization JSON-LD block, bingbot directive, referrer policy meta, title-template suppression on home page. Search-console verification tags gated on `package.json` `dagonizer.seo.*` placeholders (values added next release).

⦿ Per-node timeout support via `NodeInterface.timeoutMs?: number`. When set, the engine derives a child `AbortController` from the run's signal, races the node's `execute()` against a `Scheduler`-backed deadline, and throws `NodeTimeoutError` on expiry. The child signal is passed as `context.signal` so signal-aware IO also cancels. `onError` fires with the `NodeTimeoutError`; the run is marked failed. Nodes without `timeoutMs` are unaffected.
⦿ `NodeTimeoutError`: `DAGError` subclass (`code: 'NODE_TIMEOUT'`) carrying `nodeName` and `timeoutMs`. Exported from `./errors` and the root barrel.
⦿ `DAG` is canonically JSON-LD 1.1. `@context` / `@id` / `@type` are required on the document and every node placement; the `@context` uses type-scoped contexts so `ParallelNode.nodes` and `DAG.nodes` map to distinct IRIs without key collision. Placements use `@type` IRIs (`"SingleNode"`, `"ParallelNode"`, `"FanOutNode"`, `"DeepDAGNode"`) as the discriminator. No projection layer; `DAGBuilder.build()` returns the JSON-LD document the engine consumes and the schema validates.
⦿ `CytoscapeRenderer`: recursive deep-DAG inline expansion. The `deepDags?: ReadonlyMap<string, DAG>` option drives full-fidelity expansion of nested DAGs into compound parents (no opaque shortcut nodes). Cycle-safe via `visited` set and `maxDepth` (default 6).
⦿ Archivist demo: full multi-source fan-out per intent. Five intent branches (`lookup-author`, `find-reviews`, `describe-book`, `recommend-similar`, `on-topic`) each fan out across `openLibraryScout` + `googleBooksScout` + `wikipediaScout` via `parallel` placements with `combine: 'collect'`. Results merge through `CanonicalId.dedupe` (ISBN-13 → ISBN-10 → `urn:work:<title>::<author>`).
⦿ Archivist demo: typed-state mirroring to RDF named graph. `StateProjection` projects `ArchivistState` into `urn:dagonizer:state:<runId>` on every `onNodeEnd`; nodes query via SPARQL across state graphs for cross-run memory recall.
⦿ Archivist demo: PROV-O activity log. `RdfProvObserver` writes `prov:Activity` quads (`startedAtTime`, `endedAtTime`, `wasInformedBy`, `wasAssociatedWith`) per node/tool/llm call into `urn:dagonizer:prov:<runId>`.
⦿ Archivist demo: TBox + ABox ontology in `ArchivistOntology.ts` (7 classes, 8 object properties, 13 datatype properties). `dag:Run` and `dag:Activity` subclass `prov:Activity`; ontology loads into `urn:dagonizer:ontology` graph at startup.
⦿ Archivist demo: browser persistence. `MemoryStore.enablePersistence()` writes N-Quads to `localStorage`; survives reloads. `PersistenceBadge` reflects state in the UI.
⦿ Archivist demo: checkpoint resume. `CheckpointControls` saves the current run's cursor + typed state; `ask()` resume path reuses `buildObserver(fromCursor, prov)` so prov + state projection stay continuous across resume.
⦿ Archivist demo: per-phase `TimeoutDrawer` controls + cancel button. Visitor adjusts compose/web-search/rank budgets; cancel button aborts the active `AbortController`. The overall `deadlineMs` is a safety-net only.
⦿ Archivist demo: composable prompt directives in `prompts.ts`. Positive attractors only (no negative directives). Schema examples are shape-only (`<title-words>`, `<author-name>`, `<ISBN-13>`) to prevent LLM poisoning.
⦿ Archivist demo: workshop UI with DAG / RDF memory / state / trace / logger / ontology tabs. `MemoryGraph` uses cosmos.gl native defaults with layer-chip filter (memory/state/prov). `DagGraph` D-pad navigation (3x3 grid: zoom/pan/center/expand/fit). `StateLegend` left column with equal-width rows.
⦿ Archivist demo: three external tools: `OpenLibrarySearchTool`, `GoogleBooksTool`, `WikipediaSummaryTool`. Each returns normalized `Candidate[]` with overlapping `CanonicalId` keys so cross-source merge is natural.
⦿ Three LLM adapters under `providers/adapters/`: `GeminiNanoAdapter` (in-browser via `chrome.aiOriginTrial`), `GeminiApiAdapter` (REST), `WebLlmAdapter` (in-browser MLC). Tool calling via each backend's native channel (`functionDeclarations` / `responseConstraint` / `response_format`).
⦿ Archivist demo: `recallContext` node runs first on every visitor message. Issues SPARQL queries across `urn:dagonizer:state:*` graphs for prior intents (token-overlap ranked), recently shortlisted candidates, and similar prior queries (Jaccard ≥ 0.15). Populates `state.recalledContext` and a 1–2 sentence `summary` string. `classifyIntent` and all five `composeResponse` paths consume the summary as conversational priors for continuity across sessions.
⦿ Archivist demo: `SubjectSearchTool` + `subjectScout`. OpenLibrary subject search wired into every fan-out branch (now 4 sources per intent: openlibrary + google-books + subject + wikipedia). Visitors can find books by theme/subject ("labyrinth house that eats people") rather than only by title/author.
⦿ Archivist demo: workshop UI collapsed to 4 tabs: DAG, Memory (merged ontology + memory + state + prov RDF graph), Trace (merged logger + lifecycle + state-update feed via new `TraceFeed`), Timeouts (per-phase controls promoted from a floating drawer to a proper tab via `TimeoutPane`). Memory graph rendering bug fixed; ontology layer (`urn:dagonizer:ontology`) now mapped, colored, and chip-filterable alongside memory/state/prov.
⦿ Archivist demo: graph chrome normalized across DagGraph and MemoryGraph, with D-pad navigation bottom-right and kind/layer legend bottom-left. DagGraph uses strict `rankDir: 'TB'` with `ranker: 'tight-tree'` for a clean top-to-bottom flowchart.

⦿ Archivist demo: molecular DAG composition. Two reusable deep-DAGs shipped as components: `BookSearchFanoutDAG` (4-source parallel scout cluster + rank + merge + record + citations-gate, used in three intent branches) and `ComposeRetryLoopDAG` (recall + compose + validate with bounded retry, the shared response terminus). Each deep-DAG exports a `register{Name}Nodes(dispatcher)` helper so consumers import the cluster and register its nodes in one call. `archivistDAG` shrinks from 348 → 236 lines and now reads as a composition of named deep-DAGs. `CytoscapeRenderer` receives the deep-DAG registry and expands each placement inline; no opaque boxes.
⦿ Archivist demo: two-column responsive layout following the iridis container-query pattern. Left column tabs: Conversation, Config (absorbs BackendPicker, TimeoutPane, PersistenceBadge, CheckpointControls, API key). Right column tabs: DAG, Memory, Trace. Single-column on narrow widths; switches to two-column at ≥720px container width via `@container archivist (min-width: 720px)` (breakpoint is the component's own width, not the viewport).
⦿ Archivist demo: docs page (`docs/examples/the-archivist.md`) inlines example source via VitePress `<<<` code imports directly from `examples/the-archivist/`. Single source; the file that runs in the demo is the same file shown on the page. Removed the stale Mermaid flow block (pre-fan-out topology), the GitHub source-tree listing, and other content the live demo now visualizes.
⦿ Archivist demo: shared graph chrome; `GraphDpad.vue` (3×3 D-pad with optional zoom readout) and `GraphLegend.vue` (tab-based, click-to-toggle entries) drive both DagGraph and MemoryGraph identically. Both panes share a `.graph-pane` class (`640px`) so tab-switching feels consistent. Both auto-fit after their layout settles.
⦿ Archivist demo: `recall-memories` meta-query intent. Visitor questions about the agent's own history (what books seen, what queries asked, what intents classified) route through a dedicated branch; `recallMemories` SPARQL-aggregates the persistent state graphs into a `MemoryDigest`, `composeMemoryResponse` turns it into a warm in-character reply via a new `LlmClient.composeMemoryRecall` method. Classifier prompt narrowed: off-topic now means "unrelated to books **and** unrelated to your memory".

⦿ Archivist demo: zoom-out clamped at fit on both graphs. DagGraph's `minZoom` re-anchors to the fit zoom level after every `fit()`; MemoryGraph tracks `fitZoomLevel` and clamps both button + wheel zoom-out so the graph never shrinks below its fitted view.
⦿ Archivist demo: `decideTools` now requires all four search tools (OpenLibrary, Google Books, Subject, Wikipedia) for visitor lookups, with a strengthened prompt and safety-net post-processor that appends missing tools when the LLM returns a partial plan. Tool-plan query strings are unwrapped via an `unquote()` helper before being passed to fetch, fixing the `""double-quoted""` query bug.
⦿ Archivist demo: always-respond on failure. New `composeEmptyResponse` LLM node replaces the canned `declineEmpty` path; when all scouts return empty, an `ownTheGap` prompt directive produces an in-character response that acknowledges what was searched, explains the gap, and offers one alternative angle. `state.failureCause` accumulates sanitized per-scout failure notes (source + outcome, no URLs/keys/stack traces) and feeds the prompt.
⦿ Archivist demo: per-phase timeout defaults raised to 60s (compose, web-search) and 30s (rank); agents are slow, especially web-bound scouts. `TimeoutPane` + `ArchivistRunner` reflect the new defaults.
⦿ Docs: phase example pages (`01-linear` through `08-checkpoint`) now import their snippets from `examples/the-archivist/` via VitePress `<<<` code imports (`#region` markers for partial files). Single source; the runtime example IS the documented example. Eight pages, six source files with region markers added.

⦿ Archivist demo: starter-query LLM suggestion + clear-on-send. On fresh sessions the input pre-fills with a random visitor-style question about a popular author/series (via new `LlmClient.suggestStarterQuery()`); falls back to a 12-entry static pool if the model errors. After every send, the input clears immediately.

### Fixed

⦿ Engine: `runNodes` no longer fires `onFlowStart`/`onFlowEnd` or calls `state.markRunning`/`markCompleted` when invoked recursively from `executeDeepDAG`. Consumers see exactly one flow-start and one flow-end per top-level `execute()` call regardless of deep-DAG depth.
⦿ Archivist demo: duplicate response bug resolved at the engine level. `ComposeRetryLoopDAG` routes its outputs to the parent-owned `respond-to-visitor` placement; the engine lifecycle fix ensures `onFlowEnd` fires once per run. The UI-side `dagName === 'the-archivist'` guard is removed; the engine invariant is the guarantee.
⦿ Engine: `CytoscapeRenderer` deep-DAG inline expansion no longer emits dangling `<placement>/END` edges. When recursing into an expanded deep-DAG (`prefix` non-empty), `null` targets refer to the deep-DAG's terminus, not the parent's END; those internal terminal markers are now suppressed so the compound parent's own outgoing edges carry the real external routing.

### Changed

⦿ Engine: deep-DAG placements that route any output to `null` (terminal) are rejected at `registerDAG` time. Deep-DAGs are reusable components; only the parent DAG owns END. The error message names the offending placement, route, and DAG so misconfiguration is immediately actionable.

### Removed

⦿ Archivist demo: `OntologyGraph.vue`, `MemoryPane.vue`, `LogStream.vue`, `TraceList.vue`, `TimeoutDrawer.vue`: superseded by the merged Memory tab, `TraceFeed`, and `TimeoutPane`.

⦿ `./types` subpath export: type-only barrel of every public interface and entity-derived type. Consumers import the type surface without pulling runtime classes (`import type { DAG, NodeInterface } from '@studnicky/dagonizer/types'`).
⦿ `./core` subpath export: pluggable execution primitives (`ParallelCombiner`/`ParallelCombiners`, `FanInStrategy`/`FanInStrategies`).
⦿ `DAGErrorInterface` exported from `./errors`.
⦿ Three-tier interface taxonomy documented in `CLAUDE.md` and `docs/architecture.md`: class-shape interfaces colocated with their class, adapter contracts at the root of `src/contracts/`, entity-narrowing interfaces colocated with the entity.
⦿ Read accessors on `Dagonizer`: `getDAG(name)`, `listDAGs()`, `getNode(name)`, `listNodes()`. Snapshots are independent shallow copies of the registry.
⦿ `SignalComposer` static class in `runtime/`. `SignalComposer.compose(options)` folds caller `signal` and `deadlineMs` into a single `AbortSignal`. The dispatcher delegates to it; consumers reuse it directly to compose cancellation outside the dispatcher.
⦿ `ParallelCombiner` abstract class + `ParallelCombiners` registry in `core/`. Defaults `all-success` / `any-success` / `collect` register at module load. Consumers extend `ParallelCombiner` and call `ParallelCombiners.register(new MyCombiner())`.
⦿ `FanInStrategy` abstract class + `FanInStrategies` registry in `core/`. Defaults `append` / `partition` / `custom` register at module load. The `FanInExecution` context exposes the state accessor and an `invokeNode(name)` method for custom strategies.
⦿ `StateAccessor` adapter contract in `contracts/` with default `DottedPathAccessor` in `runtime/`. `Dagonizer` accepts an `accessor` option to swap path resolution.
⦿ Per-entity validators on `Validator`: `node`, `nodeContext`, `nodeOutput`, `nodeError`, `nodeWarning`, `nodeResult`, `nodeStateData`, `executionResult`, `validationResult`, `dagErrorJson`, `fanInConfig`, `singleNode`, `parallelNode`, `fanOutNode`, `deepDAGNode`, `dagLifecycleState`. Existing `dag` and `checkpoint` retained.
⦿ Generic services container on `NodeContextInterface<TServices>`. `Dagonizer<TState, TServices>` accepts `{ services }` at construction; the same reference flows through every node's `context.services`. `TServices` defaults to `undefined` for nodes that don't depend on injected services.
⦿ `CheckpointStore` adapter contract in `contracts/`. `MemoryCheckpointStore` ships as a reference in-process implementation. `Checkpoint.persist(store, key, data)` and `Checkpoint.recall(store, key, restoreState)` compose the codec with the store; `RecalledCheckpoint<TState>` is the recall return shape.
⦿ `./derive` subpath export. `OperationContract` adapter contract in `contracts/`; `FlowDeriver.derive(opts)` produces a `DAG` from a contract registry plus declared `FlowAnnotations` (terminals, fanouts). Topology updates automatically as contracts change.
⦿ `./viz` subpath export. `MermaidRenderer.render(dag)` emits Mermaid `flowchart` source for any `DAG`. Single nodes render as rectangles, fan-outs as hexagons, deep-dags as stadia, parallel placements as subgraphs.

### Changed

⦿ Class-shape interfaces colocated with their class. `DagonizerInterface` lives in `Dagonizer.ts`; `NodeStateInterface` lives in `NodeStateBase.ts`; `DAGErrorInterface` lives in `errors/DAGError.ts`. Subpath imports unchanged for consumers of the root barrel.
⦿ `SingleNodeInterface` renamed to `SingleNodePlacementInterface`. Disambiguates the DAG-config narrowing from `NodeInterface` (the adapter contract).
⦿ Adapter contracts have a single source of truth in `src/contracts/`. `runtime/` re-exports them through its barrel for ergonomic co-import; the source files no longer carry duplicate `export type` declarations.
⦿ Constant exports unified: `FanInStrategyName`, `FanOutOutput`, `MetadataKey`, `Output`, `ParallelCombine`, `NodeType` each ship value+type under one identifier. The `…Type` aliases are removed.
⦿ Wire-shape constant `FanInStrategy` renamed to `FanInStrategyName` (JSON enum unchanged: `'append' | 'custom' | 'partition'`). The `FanInStrategy` identifier is the abstract class consumers extend in `core/`.
⦿ `Dagonizer` constructor takes `DagonizerOptionsInterface` (currently `{ accessor?: StateAccessor }`). Calls without arguments continue to work.

### Breaking

⦿ **DAG wire format is canonically JSON-LD.** The flat `'type'` discriminator field is removed. Node placements use `@type` with string IRIs: `"SingleNode"`, `"ParallelNode"`, `"FanOutNode"`, `"DeepDAGNode"`. Persisted DAG JSON using the old flat `type` shape does not parse.
⦿ **`SubDAGNode` → `DeepDAGNode`.** The entity, schema, and TypeScript type are renamed. `Validator.subDAGNode` → `Validator.deepDAGNode`. `SubDAGNodeSchema` → `DeepDAGNodeSchema`. All identifiers that referenced `SubDAG` now reference `DeepDAG`.
⦿ **`DAGBuilder.subDAG()` → `DAGBuilder.deepDAG()`.** The builder method is renamed. Call sites using `.subDAG(name, dagName, routes, options)` must change to `.deepDAG(name, dagName, routes, options)`.
⦿ **`DagJsonLd` projection module removed.** The DAG IS JSON-LD natively; there is no separate projection layer and there are no `toJsonLd` / `fromJsonLd` helpers. Code that imported `{ toJsonLd, fromJsonLd } from '@studnicky/dagonizer'` or `from '@studnicky/dagonizer/entities'` must be deleted; the DAG value returned by `DAGBuilder.build()` (or read off the wire) IS the JSON-LD document. `Dagonizer.load(json)` / `serialize(dag)` remain the standard parse/stringify surface.
⦿ **`examples/the-archivist/subdags/` directory renamed to `examples/the-archivist/deepdags/`.** Any import paths that referenced `subdags/` must be updated to `deepdags/`.

## [0.4.0] - 2026-05-15

### Changed

⦿ **`DAGLifecycleState` normalized to uniform 5-field shape.** All six lifecycle variants (`pending`, `running`, `completed`, `failed`, `cancelled`, `timed_out`) now carry identical keys (`kind`, `startedAt`, `finishedAt`, `error`, `reason`) with `null` for fields not meaningful in a given state. V8 sees one hidden class regardless of which variant is live. Breaking changes:
  ⦿ `cancelled` state: `cancelledAt` renamed to `finishedAt`; `reason?: string` is now `reason: string` (always present, defaults to `'cancelled'` when omitted from the event)
  ⦿ `timed_out` state: `timedOutAt` renamed to `finishedAt`
  ⦿ `pending` state: now includes explicit `startedAt: null`, `finishedAt: null`, `error: null`, `reason: null` fields
  ⦿ `DAGLifecycleStateSchema` wire schema collapsed from a 6-branch `oneOf` to a single object schema with nullable-typed fields; `additionalProperties: false` still enforced
⦿ **Scheduler API replaced with promise/async-iterable surface.** The callback-based `scheduleAt`/`scheduleAfter`/`scheduleEvery` methods and `ScheduledTask` interface are removed. The new API:
  ⦿ `scheduler.after(delayMs, signal?)`: resolves after delay; signal cancels
  ⦿ `scheduler.at(atMs, signal?)`: resolves at monotonic timestamp; signal cancels
  ⦿ `scheduler.every(intervalMs, signal?)`: async iterable; yields once per interval until signal fires
  ⦿ `scheduler.cancelAll()`: cancels all in-flight timers for this scheduler instance
  ⦿ `ScheduledTask` interface removed from public exports
  ⦿ `RealTimeScheduler` rewritten to use `node:timers/promises` `setTimeout` (natively signal-aware)
  ⦿ `VirtualScheduler` (testing) rewritten to a sorted-array promise resolver; `advance(ms)`, `runUntil(atMs)`, `runAll()` test control methods preserved; `pendingCount` replaces `activeTaskCount`
  ⦿ `RetryPolicy.sleep` updated to `await Scheduler.current().after(ms, signal)`; no manual signal wiring

## [0.4.0] - 2026-05-14

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
⦿ **Flow → DAG terminology shift.** The static graph definition is a DAG; all public identifiers reflect this.
  ⦿ `FlowConfig` → `DAG` (entity and TypeScript type); `FlowConfigSchema` → `DAGSchema`; `$id` updated to `https://noocodex.dev/schemas/dagonizer/DAG`.
  ⦿ `FlowBuilder` class → `DAGBuilder`; builder method `subFlow` → `subDAG`; option type `SubFlowOptionsInterface` → `SubDAGOptionsInterface`.
  ⦿ `SubFlowNode` entity/schema/type → `SubDAGNode`/`SubDAGNodeSchema`; discriminator `type: 'sub-flow'` → `type: 'sub-dag'`; JSON field `flow` → `dag`.
  ⦿ `Dagonizer.registerFlow(flow)` → `Dagonizer.registerDAG(dag)`; internal private `flows` Map → `dags`.
  ⦿ `Dagonizer.execute(flowName, ...)` → `Dagonizer.execute(dagName, ...)`; `resume(flowName, ...)` → `resume(dagName, ...)`.
  ⦿ `NodeContextInterface.flowName` field → `dagName`; `NodeContextSchema` property updated accordingly.
  ⦿ `CheckpointData.flowName` field → `dagName`; `CheckpointDataSchema` required property updated; `Checkpoint.from(dagName, result)` and `Checkpoint.restore` return `dagName`.
  ⦿ `Validator.flow` → `Validator.dag`.
  ⦿ `entities/flow/` directory → `entities/dag/`; `FlowConfig.ts` → `DAG.ts`; `SubFlowNode.ts` → `SubDAGNode.ts`.
  ⦿ `@studnicky/dagonizer/entities/flow` subpath export → `entities/dag`.
⦿ **Static codec methods on `Dagonizer`.** `FlowLoader` and `FlowSerializer` deleted; equivalent surface moved onto `Dagonizer` as static methods.
  ⦿ `Dagonizer.load(json: string): DAG`: parses JSON and validates against `DAGSchema`. Throws `ValidationError` for malformed JSON or schema violations.
  ⦿ `Dagonizer.fromValue(value: unknown): DAG`: validates an already-decoded value.
  ⦿ `Dagonizer.serialize(dag: DAG): string`: pretty JSON (2-space indent).
  ⦿ `Dagonizer.serializeCompact(dag: DAG): string`: compact JSON.
⦿ **Entity-ization pass.** Every data shape and every constant is now backed by a JSON Schema draft-2020-12 entity (`entities/<domain>/<Name>.ts`) with a `*Schema` const and a `FromSchema`-derived type. New domains: `node/`, `execution/`, `validation/`, `errors/`, `constants/`, `runtime/`.
  ⦿ Node domain: `Node`, `NodeContext`, `NodeError`, `NodeWarning`, `NodeOutput`, `NodeResult`, `NodeStateData`
  ⦿ Execution domain: `ExecutionResult`
  ⦿ Validation domain: `ValidationResult`
  ⦿ Errors domain: `DAGErrorJSON` (the `toJSON()` wire shape)
  ⦿ Constants domain: `FanInStrategy`, `FanOutOutput`, `MetadataKey`, `Output`, `ParallelCombine`, `NodeType`, each with a JSON Schema enum, a `FromSchema`-derived union type, and a const object namespace satisfying that type
  ⦿ Runtime domain: `BackoffStrategy` (migrated from `runtime/RetryPolicy.ts` to `entities/runtime/BackoffStrategy.ts`)
⦿ **Interface refactors.** Interfaces in `src/types/` that hold data now extend or re-export their corresponding entity types:
  ⦿ `NodeOutputInterface<TOutput>` extends `Omit<NodeOutput, 'errors' | 'output'>` and narrows both fields
  ⦿ `NodeInterface<TState, TOutput>` extends `Omit<Node, 'outputs'>` and narrows `outputs`
  ⦿ `NodeContextInterface` extends `NodeContext` and adds `signal: AbortSignal`
  ⦿ `NodeErrorInterface` extends `Omit<NodeError, 'context'>` and narrows `context`
  ⦿ `NodeWarningInterface` = `NodeWarning` (type alias)
  ⦿ `ValidationResultInterface` = `ValidationResult` (type alias)
  ⦿ `ExecutionResultInterface<TState>` extends `Omit<ExecutionResult, 'state'>` and narrows `state`
  ⦿ `NodeResultInterface<TState>` extends `Omit<NodeResult, 'state'>` and narrows `state`
  ⦿ `DAGErrorJSONInterface` = `DAGErrorJSON` (type alias)
  ⦿ `FlowConfigInterface` = `FlowConfig`, `FanInConfigInterface` = `FanInConfig`, `FanOutNodeInterface` = `FanOutNode`, `ParallelNodeInterface` = `ParallelNode`, `SubFlowNodeInterface` = `SubFlowNode`, `SingleNodeInterface<TOutput>` extends `Omit<SingleNode, 'outputs'>` and narrows `outputs`
  ⦿ `NodeStateData` entity documents the persistence wire shape for `NodeStateBase.snapshot()` without `NodeStateInterface` extending it (the `lifecycle.error` field carries an in-memory `Error`, not JSON-expressible)
⦿ `entities/index.ts` barrel updated: all new schema constants and derived types are exported, grouped by domain.
⦿ `src/index.ts` re-exports constants (`FanInStrategy`, `FanOutOutput`, `MetadataKey`, `Output`, `ParallelCombine`, `NodeType`) from `entities/index.js` instead of the now-removed `constants.ts`.

### Removed

⦿ `FlowLoader` class (`src/validation/FlowLoader.ts`): superseded by `Dagonizer.load` / `Dagonizer.fromValue`.
⦿ `FlowSerializer` class (`src/validation/FlowSerializer.ts`): superseded by `Dagonizer.serialize` / `Dagonizer.serializeCompact`.
⦿ `src/constants.ts`: all constants migrated to `entities/constants/` with JSON Schema backing.

⦿ **Single execution path.** `Dagonizer.execute()` and `Dagonizer.resume()` now both return an `Execution<TState>` that is both async-iterable (yields each node as it completes) and `PromiseLike<ExecutionResultInterface>` (awaits the final summary). One generator body; sync-style is just iteration that consumes every node before resolving. Iteration and `await` on the same execution share the same underlying generator; the flow body runs exactly once.
⦿ `Dagonizer.resume(flowName, state, fromNode, options?)`: continues a flow from a given node. Caller rehydrates `state` first (typically via `Checkpoint.restore`).
⦿ `cursor: string | null` field on `ExecutionResultInterface`: the next node to run on abort, or `null` on clean completion.
⦿ `NodeStateBase.snapshot()`: serialize state to a `JsonObject` (metadata + errors + warnings, lifecycle excluded). Subclasses override `snapshotData()` to include domain fields.
⦿ `NodeStateBase.restore(snapshot)`: static factory rehydrating a state instance with fresh `pending` lifecycle. Subclasses override `restoreData()` to read their fields.
⦿ `CheckpointData` entity (`entities/checkpoint/CheckpointData.ts`): schema + `FromSchema`-derived type. Schema fields: `version`, `flowName`, `cursor`, `state`, `executedNodes`, `skippedNodes`. `CHECKPOINT_DATA_VERSION` = `'1'`.
⦿ `CheckpointDataValidator` (`schema/CheckpointDataValidator.ts`): pre-compiled Ajv validator. Shares the `sharedAjv` 2020-12 instance with `FlowConfigValidator`.
⦿ `Checkpoint` (`checkpoint/Checkpoint.ts`): `from(flowName, result)` builds a `CheckpointData`; `restore(data, restoreFn)` parses + validates + rehydrates via a state-factory callback; `toJson(checkpoint)` for serialization.
⦿ `JsonValue` / `JsonObject` / `JsonArray` / `JsonPrimitive` types at `entities/json.ts`.
⦿ New subpath export: `@studnicky/dagonizer/checkpoint`.
⦿ Example `08-checkpoint.ts`: abort, persist as JSON, parse back, resume.
⦿ 8 new unit tests covering snapshot/restore round-trip (base + subclass), cursor population on abort vs clean completion, full abort → snapshot → restore → resume cycle using `VirtualClock` / `VirtualScheduler` for deterministic time, schema rejection of malformed checkpoints.

### Changed

⦿ **`execute()` and `resume()` no longer throw on abort, deadline, or node error.** They return an `Execution` that resolves to an `ExecutionResultInterface` with `cursor` set and the state's lifecycle marked (`cancelled` / `failed` / `timed_out`). One result shape, never a thrown exception except for genuinely fatal validation errors at registration time. Catch-and-inspect is replaced with await-and-inspect.
⦿ **`executeIterative()` is removed.** `execute()` is the canonical method for both streaming and sync-style consumption. `for await (const node of dispatcher.execute(...))` replaces every prior `executeIterative` call site.
⦿ v0.2 tests that asserted `assert.rejects` on cancellation / timeout / unwired-output flows now assert on the returned `ExecutionResult.cursor` and `state.lifecycle.kind`.
⦿ Sub-flow execution internally uses the canonical `runStages` generator instead of the removed `executeIterative` method.

### Breaking

⦿ `executeIterative(flowName, state, options?)` → use `execute(flowName, state, options?)` and iterate the returned `Execution`. Identical streaming semantics.
⦿ `execute()` return type changes from `Promise<ExecutionResultInterface>` to `Execution<TState>`. `await dispatcher.execute(...)` still works because `Execution` is `PromiseLike`; most call sites need no change.
⦿ Aborted / failed / timed-out runs no longer reject. The result's `cursor` and the state's `lifecycle.kind` indicate what happened. Code that did `await assert.rejects(execute(...))` must move to `const result = await execute(...); assert.equal(result.state.lifecycle.kind, 'cancelled')`.
⦿ `ExecutionResultInterface` gains a required `cursor: string | null` field.

## [0.3.0] - 2026-05-12

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
⦿ Entities folder (`src/entities/`) with a per-shape file pattern: `<Name>Schema` constant + `FromSchema<typeof Schema>` derived type. Layout:
  ⦿ `entities/flow/`: `FlowConfig`, `SingleNode`, `ParallelNode`, `FanOutNode`, `SubFlowNode`, `FanInConfig`
  ⦿ `entities/state-machines/`: `DAGLifecycleState` (wire shape; in-memory `Error` type still lives at `lifecycle/`)
⦿ `FlowConfigSchema`: JSON Schema draft-2020-12 with `$id` `https://noocodex.dev/schemas/dagonizer/FlowConfig`. Inlines node-entry sub-shapes via `oneOf`; standalone sub-shape schemas remain exported for per-shape validation.
⦿ `FlowConfigValidator`: pre-compiled Ajv validator (`Ajv2020`, `allErrors: true`). `is(value)` predicate, `validate(value)` throwing `ValidationError`, `errors(value)` returning a formatted list.
⦿ `FlowLoader.fromJson(text)` / `fromValue(value)`: single permitted ingest boundary where `unknown` enters the package. JSON.parse → Ajv-narrow → `FlowConfig`.
⦿ `FlowSerializer.toJson(flow)` / `toCompactJson(flow)`: symmetric counterpart for the round-trip.
⦿ `Dagonizer.registerFlow()` now runs the schema validator as a structural pre-pass before semantic validation. Schema errors surface as `ValidationError`; semantic errors (unknown nodes, missing outputs, sub-flow cycles) continue to surface as `DAGError`.
⦿ New subpath exports: `@studnicky/dagonizer/schema`, `@studnicky/dagonizer/entities`.
⦿ Example `07-schema.ts`: load + validate + execute + round-trip a JSON flow.
⦿ 12 new unit tests covering Ajv success/failure paths, FlowLoader malformed-JSON handling, round-trip equality, and the `ValidationError` vs `DAGError` boundary.

### Changed

⦿ Added runtime deps: `ajv` (^8.20.0) and `json-schema-to-ts` (^3.1.1). No Zod.

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

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
⦿ `Clock` + `Scheduler` singletons with installable providers (`VirtualClockProvider`, `VirtualScheduler`, `RealTimeScheduler`). Lifecycle FSM and retry waits flow through them; tests pin time deterministically.
⦿ `NodeContextInterface` passed as the second argument to every `NodeInterface.execute(state, ctx)`. Carries `signal: AbortSignal`, `flowName`, `nodeName`.
⦿ Cancellation: `Dagonizer.execute(name, state, { signal?, deadlineMs? })`. The dispatcher composes the caller's signal with `AbortSignal.timeout(deadlineMs)` via `AbortSignal.any()` and marks state `cancelled` / `timed_out` per the reason.
⦿ `RetryPolicy` (in `runtime/`): strategy enum (`CONSTANT | LINEAR | EXPONENTIAL | DECORRELATED_JITTER`), `retryOn` / `abortOn` filter lists, `getDelay(attempt, error)`, `shouldRetry(error, attempt)`, `run(fn, signal)`. Delays scheduled through `Scheduler.current()`; honors abort mid-wait.
⦿ Class-extension hooks on `Dagonizer`: `protected onFlowStart`, `onFlowEnd`, `onNodeStart`, `onNodeEnd`, `onError`. Subclass and override; no callbacks.
⦿ Type-safe node outputs: `NodeInterface<TState, TOutput extends string>` and `SingleNodeInterface<TOutput>` parameterize the output union. `outputs: Record<TOutput, string | null>` is exhaustiveness-checked at compile time when the node declares a narrow union.
⦿ `FlowBuilder` (in `builder/`): chainable authoring of `FlowConfig`. `node()`, `parallel()`, `fanOut()`, `subFlow()`, `entrypoint()`, `build()`.
⦿ New subpath exports: `@studnicky/dagonizer/runtime`, `@studnicky/dagonizer/builder`.
⦿ Examples 01–06 runnable via `tsx`: linear chain, fan-out + partition, sub-flows, cancellation + deadline, RetryPolicy, FlowBuilder.
⦿ 32 new unit tests covering runtime, retry, cancellation, hooks, builder, fan-in strategies (partition / custom), fan-out concurrency cap, and `NodeStateBase.clone` semantics.

### Changed

⦿ **Canonical instantiation is `new`, not factories.** `Dagonizer.create<TState>()` and `FlowBuilder.create(name, version)` are removed. Use `new Dagonizer<TState>()` and `new FlowBuilder(name, version)`. Single path, supports subclassing directly.
⦿ `Dagonizer` constructor is `public` to support subclass-based observability.
⦿ Nodes are registered widened: internal storage is `NodeInterface<TState, string>` while `registerNode` accepts any narrower `TOutput`. Narrow → wide is sound covariantly on both `outputs` and result `output`.
⦿ Lifecycle FSM (`DAGLifecycleMachine`) now reads time via `Clock.now()` instead of `Date.now()` inline.

### Breaking

⦿ `Dagonizer.create<TState>()` → `new Dagonizer<TState>()`.
⦿ `FlowBuilder.create(name, version)` → `new FlowBuilder(name, version)` (FlowBuilder itself is new in 0.2.0).
⦿ `NodeInterface.execute(state)` → `execute(state, ctx)`. The second arg is required by the type, optional in practice (existing single-arg implementations still work because the extra param is ignored at runtime).

## [0.1.0] - 2026-05-12

### Added

- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
⦿ Initial release.
⦿ `Dagonizer` graph dispatcher with single nodes, parallel groups, fan-out + fan-in, sub-flows.
⦿ `NodeStateBase` with bundled `DAGLifecycleMachine` (pending → running → completed | failed | cancelled | timed_out).
⦿ Validation: duplicate node names, missing entrypoints, unknown nodes, unwired outputs, fan-in strategy/config consistency, circular sub-flow detection.
⦿ `DAGError` hierarchy: `ConfigurationError`, `ExecutionError`, `NotFoundError`, `ValidationError`.
⦿ Public exports under `@studnicky/dagonizer`, `/types`, `/errors`, `/constants`, `/lifecycle`.
⦿ Constants: `FanInStrategy`, `FanOutOutput`, `MetadataKey`, `Output`, `ParallelCombine`, `NodeType`.

[0.11.0]: https://github.com/Studnicky/Dagonizer/compare/v0.10.0...v0.11.0
