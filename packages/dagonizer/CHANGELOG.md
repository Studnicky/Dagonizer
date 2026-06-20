# @studnicky/dagonizer

## 0.23.0

### Minor Changes

- 66b49d7: Rename every discriminated-union tag from `kind` to `variant` across the whole monorepo (all packages version in lockstep). The discriminant field on every wire-shape entity and runtime union is now `variant`: `DAGLifecycleState` (`pending`/`running`/`completed`/`failed`/`cancelled`/`timed_out`), `LlmOutputSchema` (`none`/`schema`), the chat-response message union (`text`/`tools`/`mixed`), `ScatterProgress` (`map`/`field`/`plain`), the executor `BridgeMessage` union (`init`/`execute`/`abort`/`shutdown`/`ready`/`result`/`intermediate`/`instrumentation`/`error`), and the viz node descriptors. JSON Schema `$id`s are unchanged but their `kind` property is now `variant`, so persisted snapshots and on-the-wire messages from prior versions must migrate the field name. Consumers reading `state.lifecycle.kind`, `response.message.kind`, `outputSchema.kind`, or any bridge/scatter discriminant update to `.variant`.

  Example demos now gate on publish. `the-archivist`, `the-cartographer`, and the numbered `dagonizer-examples` each run a `node --test` suite (Node 24 native type-stripping — no tsx), wired into `test:examples` and the `ci`/`release` pipeline so a crashing or regressed demo can no longer reach a published release. This also resolves the `readable-stream`/`n3` loader crash that only surfaced under tsx.

- 66b49d7: LLM model discovery as a first-class adapter lifecycle capability. `listModels(options?): Promise<readonly LlmModelType[]>` joins `chat`/`connect`/`disconnect`/`probe` on `LlmAdapterInterface` and `EmbedderInterface`; like `probe`, it never throws and returns `[]` when the provider is unreachable. `LlmModelType` is the new schema-backed descriptor (`LlmModelSchema`/`FromSchema`/`Validator.llmModel`) with `name`, `variant` (`'chat' | 'embedding' | 'unknown'`), and `cloud` (provider-routed vs fully local), shipped through `./entities`, `./adapter`, and `./types`.

  Selection lives once on the base classes. `BaseAdapter.selectChatModel(options?: { preferred? })` lists models, drops embedders, honors an installed `preferred`, prefers local over cloud, sets the chosen model on the live adapter, and returns its name (or `null`). `BaseEmbedder.selectEmbeddingModel(options?)` is the symmetric embedding-model picker. The constructor `model` is now optional across every adapter and embedder; `chat()`/`embed()` throws a clear `MODEL_NOT_FOUND` `LlmError` until a model is selected, so discovery happens on the same instance the node runs.

  Every provider discovers its own models: `OpenAiCompatibleAdapter` reads `GET /v1/models` (covering Groq, Mistral, Cerebras, OpenRouter), Ollama reads `GET /api/tags` and classifies chat vs embedding and local vs `:cloud`, Gemini reads `GET /v1beta/models` and maps `supportedGenerationMethods` to `variant`, web-llm enumerates its prebuilt catalog, and gemini-nano reports its single on-device descriptor. The Ollama, Gemini, and Mistral embedders list embedding models the same way. `Validator.openAiModelsResponse` (and per-provider response schemas) validate each wire shape through the shared Ajv.

  Consumers no longer name a model. Examples 24/25/26 and the Archivist cascade discover and select through the contract — every hardcoded model string is gone, with `preferred` env/URL overrides where a specific model is wanted. The Archivist's bespoke `OllamaModels.pickChat` / `OllamaProbe.listModels` duplication is removed in favor of the inherited `selectChatModel`.

## 0.22.0

### Minor Changes

- 59a763d: Tech-debt remediation — a coherent breaking release across the whole monorepo (all
  packages version in lockstep).

  **Observability boundary.** The framework emits nothing and routes no diagnostic.
  The warning machinery is removed (`WarningEmitter`, `NoopWarningEmitter`,
  `onContractWarning`) from `./contracts`/`./runtime`/`./types`/`./builder`; contract
  misalignment now throws `DAGError` — dead writes are fatal like dangling reads, and
  an unbound container role on a non-empty registry throws.

  **Schemas as source of truth.** Every satellite wire and host shape is a `*Schema` +
  `FromSchema` type narrowed through `Validator.compile` against the framework's single
  shared Ajv; no consumer builds its own Ajv. `|undefined` fields become null
  sentinels.

  **Onion-skin layering.** `ObserverRelay`/`DispatcherBundle` → `./contracts`;
  `DAGDocument` moves to the new `./dag` subpath; `./core` no longer re-exports
  `GatherExecution`/`GatherRecord`/`OutcomeRecord` (import from `./contracts`).

  **Naming convention (types-are-data / interfaces-are-contracts).** Enforced by ported
  `@noocodec` ESLint rules: every `type` ends in `Type`, every `interface` is a contract
  ending in `Interface`, method-less data shapes are `type`s, runtime names are bare (no
  `Impl`/`Fn`). Consequently every public entity type gains a `Type` suffix
  (`NodeContextType`, `NodeOutputType`, `ExecutionResultType`, …) and every adapter
  contract gains an `Interface` suffix (`StoreInterface`, `EmbedderInterface`,
  `LlmAdapterInterface`, `ClockProviderInterface`, …). Six type+value collisions are
  resolved by pluralizing the constant values (`NodeTypes`, `MetadataKeys`, …). Numerous
  `make/build/from/parse/create` identifiers become idiomatic `noun.verb()`
  (`DAGBuilder.derive`, `ScatterOptions.resolve`, `NodeContextBuilder.of`,
  `LlmError.ofNetworkError`, `RegistryModule.instantiate`, …).

  **Pattern coherence & duplication.** Class-extension over function seams
  (`Cytoscape.create`, driver contracts in `./contracts`, `ToolError extends DAGError`);
  shared bases push down duplication (`BaseMessageChannel`, `NodeContainerBase`,
  `BaseAdapterCore.classify`, schema-property single-sourcing).

  **Engine decomposition.** `Dagonizer.ts` (2968→885 lines) is now a composition root;
  execution lives in focused `execution/` domain modules behind narrow ports
  (`BodyExecutor`, `PlacementRouter`, `LeafExecutor`, `EmbeddedDagExecutor`,
  `ScatterExecutor`, `Gather`, `NodeScheduler`, `PlacementDispatch`, `DagRegistrar`,
  `EngineComposer`).

  Examples are the leveled-logging reference (subclass + lifecycle hooks); the
  cartographer collects errors as data through the DAG flow; the Ollama adapter
  discovers an installed chat model instead of hardcoding. Behavior is preserved
  throughout — the DAG-container conformance Laws 1–9 and the full test suite pass
  unchanged.

  BREAKING CHANGE: every public entity type is `Type`-suffixed and every adapter
  contract is `Interface`-suffixed; the warning machinery is removed; `DAGDocument`
  moves to `./dag`; numerous identifiers are renamed to `noun.verb()`.

## 0.21.0

### Minor Changes

- 0296d9d: Remove the `@studnicky/dagonizer-adapter-stub` package and every stub backend. The Archivist demo, its CLI, and the LLM/embedder/tool-use examples now run only against real models (Ollama locally, or a cloud key); when no real backend is reachable the demo shows its no-model gate and the CLI throws `NO_ADAPTER_AVAILABLE` rather than returning canned responses. Examples 24–26 are rewritten against `OllamaApiAdapter` / `OllamaEmbedder`.

### Patch Changes

- 0296d9d: Node and DAG registration is idempotent by identity — re-registering the same instance (reference equality) is a no-op, enabling node reuse across multiple bundles. Only a different implementation claiming an already-registered name throws `DAGError`, with the message updated to `'X' is already registered with a different implementation` to distinguish the collision from the no-op case.

## [Unreleased]

### Removed

- **The framework warning machinery is removed (semver-major).** `WarningEmitter` (`./contracts`, `./types`) and `NoopWarningEmitter` (`./runtime`) no longer exist, and the `onContractWarning` lifecycle hook is gone from `Dagonizer`. The framework emits no diagnostics and accepts no sink; observability is the consumer's job, expressed by subclassing `Dagonizer` and emitting from the flow lifecycle hooks. `DAGBuilder.build()` (`./builder`) no longer accepts a `warningEmitter` option and keeps returning `DAG`; `ContractRegistryValidator.validate()` no longer takes a `WarningEmitter` parameter and stays throw-or-pass (`: void`). The `'contractWarning'` instrumentation relay and the dead `kind: 'log'` `BridgeMessage` branch are removed from the worker wire protocol.
- **The `./core` subpath no longer re-exports the gather/outcome contract types.** `GatherExecutionType`, `GatherRecordType`, and `OutcomeRecordType` resolve through exactly one subpath — `@studnicky/dagonizer/contracts`. They previously appeared on both `./core` and `./contracts`; the duplicate `./core` re-exports are removed so every exported symbol has a single authoritative subpath. The root barrel still re-exports all three (now sourced from `./contracts`).

### Added

- **`./dag` submodule subpath.** `DAGDocument` ships through a dedicated `@studnicky/dagonizer/dag` subpath. It is engine-coupled — it validates wire input against the compiled `Validator` at the single `unknown` ingest boundary — so it no longer lives under `./entities`, which now carries only schemas and `FromSchema` types with zero engine imports. `DAGDocument` remains exported from the root barrel unchanged; the dedicated subpath is the canonical home and the place future DAG-document surface (loaders, codecs) lands.
- **Batch-native execution, end to end.** The model the node contract already promised (`MonadicNode`: `Batch<TState>` → `RoutedBatchType<TOutput,TState>`) now reaches the DAG executor, the container transport, and scatter dispatch. (1) The DAG executor threads a whole `Batch` through a DAG — including embedded DAGs — partitioning items across branches by their routed output and merging sub-batches at convergence; a batch may reach multiple terminals. (2) The container transport carries N item-states per `execute` message (`ExecutionRequest`/`ExecutionResponse` hold an `items[]` array), so a worker runs the batch executor over N items in one round-trip. (3) A reservoir scatter (`reservoir: { keyField, capacity }`) dispatches each released batch to ANY body — node, DAG, or container — and `reservoir` composes with `container`. Per-item routing, scatter, and gather are uniform across nodes, DAGs, and containers; the prior `reservoir`-requires-a-node-body restriction is removed. Single-item execution is the batch-of-1 case and is byte-identical to before.
- `DagHost` accepts a statically-injected registry via `DagHostOptions.registry`, and `WebWorkerEntry.start(scope, registry?)` forwards it. When set, the host uses that registry directly instead of importing the `init` message's `registryModule` by URL — the required path for bundlers that forbid runtime dynamic import (a Vite browser/worker build): the worker entry imports its registry at module top, so the whole dependency graph is statically analysable and bundled into the worker chunk. When omitted, `DagHost` falls back to importing `registryModule` by URL (the Node `WorkerThreadContainer` path).
- `Validator.compile<T>(schema)` (`./validation`): public, sharedAjv-backed schema compiler. Satellite packages (adapters, embedders, tools) compile their own external wire/host schemas into an `EntityValidatorInterface<T>` through the framework's single Ajv instance instead of constructing their own `Ajv`. The method reuses the same compile and error-format path that backs every built-in per-entity validator; the validator name in thrown `ValidationError` messages derives from the schema's `$id`.
- `OpenApiGuard` (`./tool`): static shape guard. `OpenApiGuard.assertShape<T>(value, validator, label)` narrows a fetched JSON body to `T` through a compiled `EntityValidatorInterface`, throwing a non-retryable `ToolError` with reason `PARSE_ERROR` on a schema mismatch. HTTP-backed tools import one canonical guard rather than triplicating their own.
- `BaseEmbedder.fetchJson(url, init, signal)` (`./adapter`): protected helper that wraps `fetch`, re-throws a `fetch()` rejection as a NETWORK-classified `LlmError`, classifies a non-ok response via `LlmError.classifyHttp`, threads `signal` into `fetch`, and returns the parsed body typed `unknown` for the concrete embedder to validate against its own schema.
- `BaseMessageChannel` (`./container`): abstract base implementing `MessageChannelInterface`. It owns the inbound `#handler`/`#closed` state, `onMessage`, `close`, a protected `closed` accessor, and the guarded `dispatch(message)` that every concrete channel routes validated inbound messages through. A concrete channel (IPC, message-port, NDJSON, post-message) supplies only its transport `send` and endpoint subscription.
- `BaseEmbedderOptions` (`./adapter`): caller-facing options shared by every concrete embedder. Extends `BaseAdapterCoreOptions` with `model?` and `dimensions?`; the concrete embedder owns the provider-specific default and materialises a complete value from its own `DEFAULTS`, so the base declares neither default.
- `BaseAdapter.formatToolResult(message)` (`./adapter`): static that formats a `tool`-role `ChatMessage` as `[tool <name> result] <content>`, falling back to `unknown` for a blank `toolName`. Text-only adapters that flatten tool results into the prompt share this one source of the string.
- `NodeErrorProperties` and `NodeWarningProperties` (`./entities`): the canonical JSON Schema `properties` blocks for `NodeError`/`NodeWarning`. Each entity that embeds an inline error/warning item shape references the const structurally (`properties: NodeErrorProperties`, `required: NodeErrorSchema.required`) rather than hand-copying it, so a field change propagates from one place and `json-schema-to-ts` keeps the derived types identical.
- `TextChannelToolCallEnvelopeSchema` + `TextChannelToolCallEnvelope` (`./entities`): JSON Schema 2020-12 const and `FromSchema`-derived type for the inline tool-call envelope text-channel models emit; validated via `Validator.textChannelToolCallEnvelope` at module load.
- `Cytoscape` (`./viz`): domain module whose `Cytoscape.create(options)` static dynamic-imports the optional `cytoscape` peer and constructs a `Core`. The package never imports `cytoscape` as a value at module load; the peer is resolved lazily the first time a graph mounts.
- `ScatterPoolDriverInterface` + `ScatterItemResult` and `ReservoirDriverInterface` + `ScatterItemBatchResult` ship through `@studnicky/dagonizer/contracts`. The two scatter-execution adapter contracts and their result envelopes are now reachable through the canonical contract subpath.

### Changed

- The engine module wiring graph is extracted from the `Dagonizer` constructor into `src/execution/EngineComposer.ts`. `EngineComposer.compose(host)` takes one `EngineHostType` value — the intersection of every narrow `*SourceInterface`/`*PortInterface` the engine modules require, which `Dagonizer` implements — constructs the nine engine modules in their one valid dependency order (`bodyExecutor` before its `embeddedDagExecutor`/`scatterExecutor` consumers; `gather` before `scatterExecutor`; the three executors before `placementDispatch`), and returns an immutable `EngineBundleType` record of the constructed modules. The constructor resolves options, assigns its primitive fields, then wires the engine fields from the bundle; it no longer holds the dependency-ordered construction sequence. The dependency edges are explicit in one place. Behavior is byte-identical; no public API surface changes.
- The module-private freestanding `isPlacementEntry` type-guard and its `PLACEMENT_TYPES` set in `src/viz/internal.ts` fold into `PlacementUtils` as a `private static isPlacementEntry` and a `private static readonly PLACEMENT_TYPES`; `PlacementUtils.narrowNodes` calls the static. No freestanding function remains in the file.
- Composite-placement execution is extracted from `Dagonizer` into four focused domain modules under `src/execution/`: `Gather` (gather fold and registered-node invocation), `LeafExecutor` (`SingleNode` dispatch), `EmbeddedDagExecutor` (`EmbeddedDAGNode` dispatch), and `ScatterExecutor` (`ScatterNode` dispatch). Each module depends only on a narrow source-interface port that `Dagonizer` implements; `PlacementDispatch` routes directly to the executor instances rather than through a single monolithic `PlacementExecutorInterface`. `Dagonizer` exposes two new public methods (`nodeContext`, `runNodeOnState`) that satisfy the new port interfaces; the previously-exposed `invokeRegisteredNode`, `executeEmbeddedDAG`, `executeScatter`, `executeSingleNode`, and `composeGatherExecution` methods are removed. Behavior is byte-identical; no public API surface changes.

- The work-set node-graph scheduler is extracted from `Dagonizer` into `src/execution/NodeScheduler.ts`. `NodeScheduler` owns the streaming DAG traversal — the `runNodes` work-set generator and its tight helpers (`runPostPhasesAndFinalize`, `executePhasePlacement`, `isPhaseEntry`, `fireSinglePlacement`, `handleAbort`, `composeResult`). It depends only on the narrow `NodeSchedulerSourceInterface` port (registries, observer relay, placement dispatch, state mapper, container resolution, timeout wrapper, correlation minting, node-context builder) that `Dagonizer` implements through its public seams; the embedded re-entry recurses into `NodeScheduler.run`. `Dagonizer.runNodes` is now a thin delegate to `this.nodeScheduler.run`, and `Dagonizer` stays the orchestration layer (`execute`/`resume`/`executeBatch`, registration, observability hooks, relay forwarders). `Dagonizer` gains `relayFlowStart`/`relayFlowEnd` relay forwarders for the scheduler seam. Behavior is byte-identical; no public API surface changes.

- **Runtime names carry no `Impl`/`Fn` suffix; only types end in `Type` and interfaces in `Interface`.** The public checkpoint class `CheckpointRestoreAdapterFn` is renamed `CheckpointRestoreAdapter` (`./checkpoint` and the root barrel). It is the bare runtime class that implements `CheckpointRestoreAdapterInterface`; the two names coexist by design — the class is the value, the interface is the contract. Call sites use `CheckpointRestoreAdapter.wrap((snap) => MyState.restore(snap))`. The rename is value-only; behavior is byte-identical.

- **Mandatory `Interface` suffix on every adapter-contract interface (semver-major rename across the public surface).** Every consumer-implemented `interface` contract now carries the `Interface` suffix, marking the contract as distinct from any runtime value, schema-derived `*Type`, or `*Schema`. The renamed contracts reach every public subpath that exported them — `./contracts`, `./types`, `./store`, `./validation`, `./tool`, `./runtime`, `./checkpoint`, `./container`, and the root barrel: `Store` → `StoreInterface`, `Embedder` → `EmbedderInterface`, `LlmAdapter` → `LlmAdapterInterface`, `LlmClient` → `LlmClientInterface`, `ClockProvider` → `ClockProviderInterface`, `SchedulerProvider` → `SchedulerProviderInterface`, `CheckpointStore` → `CheckpointStoreInterface`, `CheckpointRestoreAdapter` → `CheckpointRestoreAdapterInterface`, `Snapshottable` → `SnapshottableInterface`, `StateAccessor` → `StateAccessorInterface`, `RemoteStore` → `RemoteStoreInterface`, `EntityValidator` → `EntityValidatorInterface`, `Tool` → `ToolInterface`, `TripleStore` → `TripleStoreInterface`, `NodeInvoker` → `NodeInvokerInterface`, `ObserverRelay` → `ObserverRelayInterface`, and the engine `DispatcherHooks` → `DispatcherHooksInterface`. The contract source files rename to match the canonical export (`src/contracts/StoreInterface.ts`, `src/tool/ToolInterface.ts`, …); the schema-derived sibling types in those files (`StoreSnapshotType`, `TermType`, `QuadType`, …) keep their `*Type` names. The `Store extends Snapshottable` and `RemoteStore extends Store` contract chains become `StoreInterface extends SnapshottableInterface` and `RemoteStoreInterface extends StoreInterface`. A `noocodec/interface-must-end-interface` ESLint rule (`--max-warnings 0`) enforces the convention going forward. The renames are type-only; runtime behavior is byte-identical, and consumers update `import type`, `: T` annotations, `<T>` generics, and `implements`/`extends` clauses to the suffixed names.

- **Mandatory `Type` suffix on every entity type (semver-major rename across the public surface).** Every `FromSchema`-derived entity type now carries a `Type` suffix: a type describes DATA and ends in `Type`, the schema value keeps its `*Schema` name, and the narrowing interface keeps its `*Interface` suffix. The renamed types reach every public subpath — `./entities`, `./types`, `./constants`, `./adapter`, `./viz`, and the root barrel: `DAG` → `DAGType`, `NodeContext` → `NodeContextType`, `NodeOutput` → `NodeOutputType`, `NodeResult` → `NodeResultType`, `NodeError` → `NodeErrorType`, `NodeWarning` → `NodeWarningType`, `NodeStateData` → `NodeStateDataType`, `SingleNode` → `SingleNodeType`, `ScatterNode` → `ScatterNodeType`, `EmbeddedDAGNode` → `EmbeddedDAGNodeType`, `TerminalNode` → `TerminalNodeType`, `PhaseNode` → `PhaseNodeType`, `GatherConfig` → `GatherConfigType`, `ExecutionResult` → `ExecutionResultType`, `InterruptionInfo` → `InterruptionInfoType`, `ExecutionRequest` → `ExecutionRequestType`, `ExecutionResponse` → `ExecutionResponseType`, `ExecutorIntermediate` → `ExecutorIntermediateType`, `RecommendedWorkerCountConfig` → `RecommendedWorkerCountConfigType`, `BridgeMessage` → `BridgeMessageType`, `ChatMessage` → `ChatMessageType`, `ChatResponse` → `ChatResponseType`, `ChatResponseMessage` → `ChatResponseMessageType`, `OpenAiResponseBody` → `OpenAiResponseBodyType`, `TextChannelToolCallEnvelope` → `TextChannelToolCallEnvelopeType`, `TokenUsage` → `TokenUsageType`, `ToolCall` → `ToolCallType`, `ToolDefinition` → `ToolDefinitionType`, `CheckpointData` → `CheckpointDataType`, `StoreSnapshotType` → `StoreSnapshotType`, `StoreSnapshotEntryType` → `StoreSnapshotEntryType` (the entity wire shapes; the `SnapshottableInterface` contract on `./contracts`/`./types` carries the `Interface` suffix), `ScatterProgress` → `ScatterProgressType`, `StoredScatterProgress` → `StoredScatterProgressType`, `ScatterInboxItem` → `ScatterInboxItemType`, `ScatterAckedResult` → `ScatterAckedResultType`, `WorkSetItem` → `WorkSetItemType`, `WorkSetEntry` → `WorkSetEntryType`, `WorkSetProgress` → `WorkSetProgressType`, `ValidationResult` → `ValidationResultType`, `DAGErrorJSON` → `DAGErrorJSONType`, `DAGHandoff` → `DAGHandoffType`, `DAGLifecycleStateData` → `DAGLifecycleStateDataType`, `ProgressKey` → `ProgressKeyType`, and the viz output shape `DagJsonLdDocument` → `DagJsonLdDocumentType` (`./viz`). The five constant-union types are suffixed too: `Output` → `OutputType`, `ScatterOutput` → `ScatterOutputType`, `MetadataKey` → `MetadataKeyType`, `GatherStrategyName` → `GatherStrategyNameType`, `BackoffStrategy` → `BackoffStrategyType` (their value records keep the prior plural names `OutputNames`, `ScatterOutputNames`, `MetadataKeys`, `GatherStrategyNames`, `BackoffStrategyNames`). The node-kind enum `NodeType` and the placement-union alias `DAGNodeType` already complied and are unchanged; the `Node` placement union is renamed `NodeUnionType` to avoid colliding with `NodeType`. A `no-restricted-syntax` ESLint rule under `src/**` requires every `FromSchema`-derived type alias to end in `Type`, enforcing the convention going forward. The renames are type-only; runtime behavior is byte-identical.

- **Duplication base-class push-down.** `BaseAdapterCore.classify` now owns the two branches every adapter shares — an `LlmError` passthrough and an abort/timeout `Error` → `TIMEOUT` mapping — before the `UNKNOWN` fallback; `OpenAiCompatibleAdapter.classify` is deleted because the base now covers it, and provider-specific subclasses keep only their own branch and delegate the rest to `super.classify`. `ChannelDispatch.request`/`requestBatch` (`./container`) share the abort-forwarding listener and the settle-once teardown through private `#withAbortHandler(signal, correlationId)` and a generic `#settle<T>(entry, signal, onAbort, resolve, value)` instead of two verbatim copies. `DagContainerBase.runDag`/`runDagBatch` (`./container`) share the acquire/try/catch/finally(release) channel lease through a private `#withChannel<T>(signal, fn, onError)`. The four inline `NodeError` wire-schema copies (`NodeOutput`, `NodeStateData`, `ExecutionResponse`, `BridgeMessage`) and the inline `NodeWarning` copy (`NodeStateData`) reference the canonical `NodeErrorProperties`/`NodeWarningProperties` consts structurally, ending the hand-copied drift.

- **Pattern coherence: no behavior seam is a function-pass-in.** `CytoscapeGraph` (`./viz`) no longer takes a `cytoscape` factory in its constructor — the signature is `new CytoscapeGraph(container, dag, options?)`. `mount()` builds the `Core` through the protected `construct(options)` hook, which delegates to `Cytoscape.create`; subclasses override `construct` to supply a `Core` in SSR/headless/test contexts. `Execution` (root barrel) wraps an already-created flow generator (`new Execution(generator)`) instead of a generator factory; the dispatcher passes `this.runNodes(...)` directly. `ToolError` (`./tool`) extends `DAGError` with code `'TOOL_ERROR'`, so `instanceof DAGError` holds for every tool failure; `reason`/`retryable`/`status` remain typed own-properties set in declaration order. The engine-private `runNodes` consolidates its two optional positional tail params into one trailing `batch` config object, removing the optional positional tail. `ScatterPoolDriverInterface` and `ReservoirDriverInterface` move out of the execution modules to `src/contracts/`, the single source of truth for adapter contracts; `ReservoirBuffer` resolves its buffer key through the canonical `StateAccessorInterface` contract rather than a divergent inline accessor shape.

- **Onion-skin layering: structural types are homed in their inward layer, public subpaths unchanged.** Imports now point strictly inward (`contracts` → `entities` → `runtime`/`core` → engine → outer surfaces). `ObserverRelayInterface` and `DispatcherBundleType` move to `./contracts` (and become reachable through it for the first time); `Batch`/`Item`/`ItemId`/`RoutedBatchType`, `Timeout`, and the `OpenAiResponseBody` schema move to `./entities` (`Batch`/`RoutedBatchType` under `entities/batch`, `OpenAiResponseBody` under `entities/adapter`); the scatter/work-set progress keys move to an internal `entities/constants` module. Every original subpath (`./core`, `./runtime`, `./adapter`) re-exports its relocated symbol, and the root barrel exports are unchanged, so no consumer import breaks. The `tool` surface imports `ToolDefinition` from its canonical `entities/adapter` home, severing the `tool` → `adapter` edge. ESLint `no-restricted-imports` zones enforce the inward-only rule per directory, with the single sanctioned `NodeStateInterface`-in-`NodeStateBase` exception. Satellites import type-only engine symbols from `@studnicky/dagonizer/types`.
- **HTTP tool bodies are schema-validated, not cast.** `HttpTransport.getJson` / `postJson` (`./tool`) require an `EntityValidatorInterface<TResponse>` and return the parsed body narrowed by it; the `as TResponse` cast in the private `parseJson` is removed and a shape mismatch throws a non-retryable `ToolError(PARSE_ERROR)`. `ToolCallCodec.decode` (`./adapter`) validates the parsed envelope against `TextChannelToolCallEnvelopeSchema` before access — the hand-written `TextChannelToolCallEnvelope` wire interface and its cast are gone.
- `GatherRecordType<TState>` and `GatherExecutionType<TState>` (`./contracts`) gain a defaulted `TItem = unknown` generic; `GatherRecordType.item` is `TItem` rather than a permanent `unknown`. `RegistryBundleInterface` and `RegistryModuleInterface` (`./contracts`) gain a defaulted `TServices = unknown` generic threaded through `services` and `RegistryModuleInterface.instantiate`'s return. Both defaults keep every existing call site source-compatible.
- `RetryPolicy.getDelay` (`./runtime`) takes `options: { readonly error: Error | null } = { error: null }` (required-with-default) rather than an optional `error?`; the redundant `as string` cast on the `strategy` string-literal union is removed.
- **Contract misalignment is fatal: throw, never warn.** A dead write — a node whose co-located contract declares a `produces` path that no node in the registry `hardRequires` — now throws `DAGError`, matching the existing dangling-read throw. A container-dispatching dispatcher (one that binds at least one role in its `containers` option) now throws `DAGError` at `registerDAG` time when a placement declares a container role that registry does not bind, instead of silently degrading to in-process execution. A pure in-process dispatcher (no bound containers) runs every body in-process and treats declared roles as inert.
- Scatter checkpoint for compactable gathers (all built-in strategies except `custom`) now stores a watermark, bounded ahead-acked window, and outcome tally instead of an unbounded per-item acked array. Memory is O(1) with respect to item count for compactable gathers. Non-compactable gathers (`custom` strategy, where `retainsRecordsForFinalize` is `true`) retain full records unchanged.
- **Naming: one symbol, one name (semver-major).** The six `entities/constants` + `entities/runtime` value objects that shared an identifier with their `FromSchema` type now carry a distinct plural value name, leaving the type name unchanged: `GatherStrategyNames`, `MetadataKeys`, `NodeTypes`, `OutputNames`, `ScatterOutputNames`, and `BackoffStrategyNames` are the values; `GatherStrategyName`, `MetadataKey`, `NodeType`, `Output`, `ScatterOutput`, and `BackoffStrategy` remain the types. Consumers reading a value (`NodeTypes.SCATTER`, `Object.values(GatherStrategyNames)`) import the plural; type positions are unchanged. The internal `ProgressKey` value pair likewise becomes `ProgressKeys`, and the `DAG` JSON-LD identity helper namespace is renamed `DAGIdentity` (`DAGIdentity.id`, `DAGIdentity.placementId`) so it no longer collides with the `DAG` entity type. `DAGBuilder.fromNodes(name, version, entrypoint, nodes, options?)` is renamed `DAGBuilder.derive`; `ScatterOptions.from(partial)` is renamed `ScatterOptions.resolve(partial)`. `BackoffStrategy` is no longer re-exported from `@studnicky/dagonizer/runtime`; its single canonical home is `@studnicky/dagonizer/entities` (and the root barrel). `RemoteStoreEndpointType`, `RemoteStoreLeaseType`, and `RegistryBundleInterface` each move to their own `contracts/` module (one contract per file); every public subpath that exported them resolves unchanged.
- **ESLint canonical-naming gate.** Four rules ride the existing per-package flat configs (`--max-warnings 0`), scoped to framework runtime (`src/**`): a type+value-collision rule that forbids exporting `type X` and `const X` under one identifier; a ban on leading-underscore declarations (function/method parameters keep the sanctioned `^_` unused marker); a ban on freestanding exported functions (every public operation is a `noun.verb()` static method on a domain class); and a domain-verb gate that forbids method, function, and interface-member names matching `/^(make|build|from|parse|create)[A-Z]/`. The bare `from` materializer (no uppercase suffix) stays allowed.

- **Naming: domain-class verbs, grouped by entity (semver-major).** Every `make`/`build`/`from`/`parse`/`create`-prefixed method becomes an idiomatic `noun.verb()`. Public static factories: `DAGDocument.fromValue` → `DAGDocument.ofValue`, `Timeout.fromWire` → `Timeout.ofWire`, `LlmError.fromNetworkError` → `LlmError.ofNetworkError`, `DAGError.fromSignal` → `DAGError.ofSignal` (`ExecutionError` inherits), `CheckpointRestoreAdapter.fromFn` → `CheckpointRestoreAdapter.wrap`. `RegistryModuleInterface.createBundle` → `RegistryModuleInterface.instantiate` (every registry module implementer renames its method). Consumer override seams: `CytoscapeGraph.buildElements` → `composeElements`, `DagContainerBase` protected abstract `createEntry` → `composeEntry`. `Dagonizer.buildContext` is removed — node-context construction now lives on its own entity as `NodeContextBuilder.of(dagName, nodeName, signal, services)`, decoupling context assembly from the engine class. `StateMapper.createChild` → `cloneChild`. Engine-internal helpers (`buildResult`, `buildGatherExecution`, `buildObserverRelay`, the OpenAI adapter `#buildBody`/`#parseResponse`/`#parseJson`, `HttpTransport.parseJson`, `CytoscapeRenderer.buildNodeData`, `ContractRegistryValidator.buildUpstreamProducers`) rename to `composeResult`/`composeGatherExecution`/`relayFor`/`#composeBody`/`#decodeResponse`/`#decodeJson`/`decodeJson`/`composeNodeData`/`composeUpstreamProducers`.

- **The dispatcher observability hooks `onNodeStart`, `onNodeEnd`, `onError`, `onPhaseEnter`, and `onPhaseExit` are now public.** They remain the same overridable observability surface — subclasses override them exactly as before — and are additionally the relay seam the container path drives, so a dedicated relay adapter can forward worker-side events into them across the module boundary. `onFlowStart`/`onFlowEnd` stay `protected`. Runtime behavior is byte-identical; existing `protected override` declarations in subclasses become `override` (public).

### Internal

- **`Dagonizer.ts` god-file decomposition.** The engine class file drops from 2969 to 2200 lines by extracting cohesive domain seams into dedicated modules and promoting every object-literal-of-closures "function bag" to a named class with a stable V8 shape. The public API is unchanged: every export, subpath, type, and the `DagonizerInterface` contract are byte-identical, and all 873 tests pass without modification. New engine-internal modules: `execution/ScatterDispatch.ts` (the `ScatterPoolDriver` driver, the `ScatterDispatchAdapter` adapter class + its interface, and the engine-private scatter result/option/context types), `execution/PlacementDispatch.ts` (the `@type`-keyed placement router, replacing the constructor's `dispatch` closure map), `execution/NodeInvoker.ts` (the `custom`-gather node invoker, replacing the inline `NodeInvokerInterface` literal), `execution/ScatterSource.ts` (scatter source-to-`AsyncIterator` normalization), `observer/ObserverRelay.ts` (the `ObserverRelay` relay class + its `DispatcherHooksInterface` contract), and `observer/DispatcherHooks.ts` (the `DispatcherHooks` relay-hooks adapter, replacing the constructor's `#relayHooks` closure literal). The scatter watermark-accounting helper and checkpoint-restore logic move to their canonical home on `ScatterCheckpoint` (`advanceWatermark`, `restoreRunState` → `ScatterRunStateType`). Each promoted class holds a reference to the dispatcher (or a narrow source interface it satisfies) and initialises every field in constructor-declaration order.

- **Registration/validation extracted to `dag/DagRegistrar.ts`.** `Dagonizer.ts` drops to a thin composition root: the `registerDAG` / `registerNode` / `registerBundle` bodies — the duplicate-name throw, the `Validator.dag` schema pass, the `DAGValidator.validateDAGConfig` semantic pass, the `ContractRegistryValidator` contract pass, and the container-role-binding gate — move to a single-responsibility `DagRegistrar` class. The class depends only on the narrow `DagRegistrarSourceInterface` (the live `dags` / `nodes` / `nodeIndex` registries plus `resolveContainer` / `hasContainers`), constructed once in the dispatcher constructor against a source backed by the dispatcher's own registries. The public method signatures and throw behavior are unchanged; the three methods are now thin delegates to `this.dagRegistrar`. `Dagonizer.#hasContainers` becomes the public `hasContainers()` so the registrar reads it through the port. The public API surface and all 873 tests are byte-identical.

## 0.20.0

### Minor Changes

- dcbc4b5: Codebase-wide audit and hardening pass: collapse dual representations, remove callback extension seams, enforce schema-as-source-of-truth at every JSON ingest boundary, and align the sibling packages to one opinionated shape.

  Breaking changes (pre-1.0; see CHANGELOG `[Unreleased]` for full migration notes): `NodeInterface.contract` and `NodeInterface.timeout` are now required (`EMPTY_CONTRACT_FRAGMENT` / `Timeout.none()` defaults; `MonadicNode` unaffected); `RetryPolicy` is constructed via `RetryPolicy.from()`; `BaseStore.update` is abstract; `HttpTransport.validate` callback removed; `ChatMessage` is a role-discriminated union; DAG-document (de)serialization moved to `DAGDocument` (the static `Dagonizer.load/serialize` delegates are removed); `TypedStore` lifecycle access moved to `.inner`; `GatherStrategies`/`OutcomeReducers` registries throw on duplicate (`replace()` for intentional overrides); adapter wire-shape entities relocated to `entities/adapter/` (breaking the `contracts → adapter` cycle); adapter option-type aliases removed; the `Book` entity is composed into `BookIdentity`/`BookPublication`/`BookAvailability` with a `BookBuilder.from()` factory.

  Additions: public `EMPTY_CONTRACT_FRAGMENT`, `IncrementalGatherStrategy`, `DAGDocument`, `ScatterWorkerPool`, `StoreSnapshotSchema`, shared `SystemInfo.recommendedWorkerCount`, `'ABORTED'` `ToolErrorReason`, uniform adapter `maxAttempts`, `OpenRouter` `referer`/`title` options, Ollama-Cloud API-key support, and `ForkEntry`/`SpawnEntry`/`WorkerEntry` static node entries.

## 0.19.0

### Minor Changes

- d5a95ea: DAG containment, cross-host hand-off, crash-safe transport, and a full audit-and-harden pass.

  **Features**

  - DAG containment: run a whole sub-DAG inside a worker / child-process / web-worker isolate via a `container` placement key. Two new executor packages (`dagonizer-executor-node`, `dagonizer-executor-web`).
  - Cross-host hand-off (`HandoffChannelInterface` + `DAGHandoff`) and crash-safe transport (single-subscription correlation, death backstop, at-least-once delivery). Worker-pool lifecycle owned by `DagContainerBase`. Per-container-role viz colors.

  **Breaking — opinionated surface**

  - Removed `ParallelNode` (scatter+gather is the only fan-out), implicit null-route terminals (explicit `TerminalNode` only), and the Instrumentation plugin (subclass hooks are the only observability).
  - Removed all back-compat aliases/shims: `SchedulerHandle`, `PhaseNodePlacementInterface`, `TerminalNodePlacementInterface`, `StateRestoreFnType`. `AdapterBase` → `BaseAdapterCore`.
  - `Store.connect`/`disconnect` required (no-op defaults in `BaseStore`); `StoreError extends DAGError`; `runDag(task, options?)`.

  **Breaking — reified `Timeout`**

  - `Timeout` value object (`Timeout.none()` / `Timeout.ofMs(n)` / `Timeout.fromWire(n)`) replaces the ad-hoc `number | undefined | 0 | null` per-node and per-DAG-task timeout representations. `NodeInterface.timeout?: Timeout`, `MonadicNode.timeout`, `DagTask.timeout`. The `ExecutionRequest`/`BridgeMessage` wire stays `number | null`.

  **Breaking — type-shape conventions**

  - Canonical defaults: every options/config bag resolves through a co-located defaults object applied as both the default argument and a spread over caller input; defaulted fields are optional input, never required-of-caller.
  - Data-shape types are mutable: `readonly`/`ReadonlyArray`/`Readonly<Record>` removed from entity, wire, and options/config declarations to match the schema-derived shapes. Consumers apply `Readonly<>` at their boundary; class instance fields and `as const` schema literals keep their immutability. Compile-time only.

  Dispatch maps replace switch chains throughout; schema-as-source-of-truth gaps closed; all workspace consumer packages migrated. Validation: typecheck + lint clean, 698 dagonizer tests pass, every workspace package and example builds.

## [Unreleased]

Codebase-wide audit-and-harden pass: function-signature normalisation,
type-safety tightening, V8 shape stability, runtime robustness, public-export
completion, canonical-name enforcement, and documentation accuracy. The suite
has 698 tests.

### Breaking — null route removed

Routing a node output to `null` (e.g. `.node('step', n, { ok: null })`) is no longer valid. Every flow branch must end at an explicit named `TerminalNode` placement.

- **JSON schema**: `outputs` `additionalProperties` type changed from `['string', 'null']` to `'string'` in `SingleNode`, `ScatterNode`, and `EmbeddedDAGNode` schemas. `Validator.dag.is()` now rejects any DAG whose outputs map contains a `null` value.
- **`DAGBuilder`**: route maps are now `Record<TOutput, string>` (not `null | string`). Pass a named terminal and route to it.
- **`DAGDeriver`**: explicit-TerminalNode-only. When a declared output port or scatter outcome has no successor and no terminal annotation, `DAGDeriver` throws `DAGError` naming the placement and the unrouted port. Authors must declare an explicit terminal via `annotations.terminals`. There is no implicit terminal synthesis.
- **`WellFormedValidator`**: the null-route violation rule is removed; the schema now rejects null routes upstream.
- **`ExecutionResult.terminalOutcome`**: always set to the `TerminalNode`'s `outcome` field when a terminal is reached. `null` only on error or abort exits where no `TerminalNode` was reached.
- **`MermaidRenderer`**: no longer emits a synthetic `END([end])` node. Every terminal renders under its actual placement name.
- **`JsonLdRenderer`**: `dag:target` is always an IRI string; no longer `null` for null routes.
- **Migration**: replace every `.node(name, node, { output: null })` with `.node(name, node, { output: 'end' }).terminal('end')` (or any other terminal name).

### Breaking — removed aliases and type shims

One canonical name per symbol; back-compat aliases and placement-interface re-exports are removed.

- **`SchedulerHandle` removed** — `SchedulerProvider` is the one scheduler contract. All call sites use `SchedulerProvider` directly.
- **`PhaseNodePlacementInterface` removed** — use `PhaseNode`. **`TerminalNodePlacementInterface` removed** — use `TerminalNode`.
- **`StateRestoreFnType` removed** — a checkpoint restore function is a `CheckpointRestoreAdapter`. Wrap a bare function with `CheckpointRestoreAdapter.wrap(fn)`.
- **`NodeErrorBuilder` and `NodeOutputBuilder`** are no longer exported from the `./types` subpath (a type-only barrel); they remain on the root `.` export.
- **`MonadicNode`** no longer exposes `successPort()`/`emptyPort()`/`errorPort()` helpers — return the port literal (`'success'`/`'empty'`/`'error'`) directly.

### Breaking — function signatures (required positional, optional trailing config)

Every required argument is positional; every optional argument lives in a
single trailing `options` object.

- **`DAGError` and subclasses (`ConfigurationError`, `ExecutionError`, `NotFoundError`, `ValidationError`).** `new XError(message, context, errorOptions)` → `new XError(message, { context, ...errorOptions })`; `DAGError` also takes `{ code }`. `context` is now a required-with-default field (`{}` when absent) for V8 hidden-class stability.
- **`SchedulerProvider` `after`/`at`/`every`.** Trailing `signal` positional → `options?: { signal?: AbortSignal }`. `RealTimeScheduler` and the test `VirtualScheduler` updated in lockstep.
- **`RetryPolicy.run` / `RetryPolicy.getDelay`.** Trailing positional → `options?`. New static **`RetryPolicy.from(partial)`** factory centralises all defaults.
- **`Tool.execute(input, options?: { signal? })`** and **`Embedder.embed(text, options?: { signal? })`** — signal moved into options (and now actually honoured during embed retries).
- **`LlmError` constructor + `classifyHttp`** — trailing `cause` / `body` → options.
- **`DAGBuilder.build(options?)`, `terminal(name, options?: { outcome? })`, `static fromNodes(name, version, entrypoint, nodes, options?)`** — `fromNodes` no longer buries its required arguments in an object.
- **`DagOutcome.transportError(correlationId, options?: { code?, message? })`** (SC-12).
- **`ContractRegistryValidator.validate(contracts, warningEmitter, options?: { entrypointName? })`** — second argument is `WarningEmitter` (was `(message: string) => void`). `DAGBuilder.build({ warningEmitter? })` option renamed from `onContractWarning`.
- **`NodeErrorBuilder.from(code, message, operation, recoverable, timestamp, options?)`** — required args are positional (previously a single partial object).
- **`DagContainerError` constructor migrated to the options bag.**
- **`DagContainerInterface.runDag(task, options?: { relay? })`** — trailing `relay` positional moved into the options object.

### Breaking — registry & validation

- **`Dagonizer.registerNode` and `registerDAG`** throw `DAGError` when a name is already registered. The registry is append-only; no silent overwrite.
- **Sub-DAG cycle detection removed from `DAGValidator`.** The append-only registry combined with the rule that every `EmbeddedDAGNode`/`ScatterNode` body must reference an already-registered DAG makes sub-DAG references backward-only, so the reference graph is structurally acyclic. Explicit cycle detection is unnecessary and is no longer present.

### Breaking — monomorphic NodeError / NodeOutput

- **`NodeError.context`** is required in both the `NodeErrorSchema` `required` array and the `NodeErrorType`. The inlined `NodeError` shapes in `NodeStateData`, `ExecutionResponse`, and `BridgeMessage` also require `context`.
- **`NodeOutput.errors`** is required in both the `NodeOutputSchema` `required` array and the `NodeOutputType`. Both changes enforce V8 hidden-class stability across all node result shapes.
- **`NodeErrorBuilder.from`** constructs a complete `NodeError`, filling `context: {}` when absent. Ships through `.` and `./entities`.
- **`NodeOutputBuilder.of`** constructs outputs with `errors: []` as the default. **`NodeOutputBuilder.errorsOf` is removed** — read `.errors` directly.

### Breaking — abort-signal arguments unified

- **`AbortableOptionsType`** (`{ signal?: AbortSignal }`) is a contract in `./contracts`. `CheckpointStore` (`save`/`load`/`delete`), `Embedder` (`embed`/`embedBatch`/`probe`/`connect`/`disconnect`), and `Snapshottable` (`snapshot`/`restore`) each accept a trailing `options?: AbortableOptionsType` instead of a positional `signal?`. `LlmAdapter` (`connect`/`disconnect`/`probe`) takes the same `options?: AbortableOptionsType` so its lifecycle is identical to `Embedder`. `SchedulerProvider`, `RealTimeScheduler`, `RetryPolicy`, and `Tool` use the named `AbortableOptionsType` for their options object.

### Breaking — renamed contract & removed deprecated surface

- **`ChannelInterface` renamed to `HandoffChannelInterface`** — distinguishes the completed-DAG hand-off publish channel from the duplex `MessageChannelInterface`.
- **`DagOutcomeType` and `DagTaskInterface`** ship through the `./container` subpath only. The `./contracts` re-exports and forwarder modules are removed.
- **`@studnicky/dagonizer/patterns` `LlmClient` and `TripleStore` re-export modules removed.** `LlmClient` and `TripleStore` ship through `./contracts`.
- **`./derive` no longer re-exports `OperationContractType` / `OperationContractFragmentType`**; they ship through `./contracts`.

### Breaking — adapter layer

Shared adapter behaviour and config live on the canonical base class; concrete classes carry only what is unique.

- **`AdapterBase` renamed to `BaseAdapterCore`** (`./adapter`) — the abstract root of the adapter stack owning the shared retry policy, `id`/`displayName`, the `connect`/`disconnect`/`probe` lifecycle, and the default `classify()`. `BaseAdapter` extends it and adds only `capabilities` + `chat`; `BaseEmbedder` extends it and adds only `dimensions` + `embed`/`embedBatch`.
- **`AdapterBaseOptions` renamed `BaseAdapterCoreOptions`** — the partial `{ maxAttempts?; baseDelayMs? }` caller-facing type that consumers extend. **`AdapterBaseOptionsResolved` renamed `BaseAdapterCoreOptionsResolved`.** The `BaseAdapterCore` constructor accepts the partial `BaseAdapterCoreOptions` and resolves defaults internally via `{ ...BaseAdapterCore.defaultOptions(), ...options }`; subclasses pass their partial options through and do not spread `defaultOptions()` themselves.
- **`BaseRegistry<TInstance>`** owns the `register`/`has`/`resolve`/`list` registry behaviour; `EmbedderRegistry` and `LlmAdapterRegistry` extend it. **`BaseCascade`** owns the sequential `select()` probe loop; `EmbedderCascade` and `LlmAdapterCascade` extend it.
- **`BaseAdapterOptions` and `BaseEmbedderOptions` removed** — `BaseAdapterCoreOptionsResolved` is the one canonical resolved-options type. **`DEFAULT_MAX_ATTEMPTS`** and **`DEFAULT_BASE_DELAY_MS`** are the one canonical pair; `DEFAULT_EMBEDDER_MAX_ATTEMPTS` / `DEFAULT_EMBEDDER_BASE_DELAY_MS` are removed. **`CascadePreference`** is the one canonical cascade-preference type; `EmbedderCascadePreference` is removed.
- **`OpenAiCompatibleConfig.timeoutMs` is optional**, defaulting to `DEFAULT_REQUEST_TIMEOUT_MS` (60 000 ms) resolved by spread in the constructor.
- **`HttpTransport` `HttpRequestOptions<TResponse>` is generic**; `validate` is `(value: unknown) => TResponse`; `timeoutMs` and `maxRetries` are required-with-defaults.
- **`ToolError` options `status` is optional**, defaulting to `null`. `reason` and `retryable` remain required positional arguments.

### Breaking — store & container

- **`Store.connect()` / `Store.disconnect()`** are required methods; `BaseStore` provides no-op defaults.
- **`StoreError` extends `DAGError`** (code `STORE_ERROR`).

### Breaking — types and required fields

- **`OutputSchema` adapter type renamed to `LlmOutputSchemaType`** — resolves the canonical-name collision with the `constants/Output` `OutputSchema` value.
- **`NodeStateBase.clone()` now returns `this`** — preserves the concrete subclass type without a cast at call sites.
- **`StateAccessor.get<T = unknown>(state, path): T | null`** — absent-path sentinel changed from `undefined` to `null` (`undefined` is for absent optional props; `null` is the explicit "no value" sentinel). Migration: replace `=== undefined` / `!= null` absence checks with `=== null`. Implementers change their return from `undefined` to `null`.
- **`Store.get<T>(key): Promise<T | null>`** (and `BaseStore.performGet<T>`) — same null-sentinel change. Migration: absent-key callers that checked `=== undefined` must check `=== null`; `update(key, fn)` callback still receives `T | undefined` (unchanged).
- **`GatherExecutionType.invokeNode(name): Promise<void>` removed; replaced by `readonly invoker: NodeInvoker`** — bare function property was a callback seam; swap all `execution.invokeNode(name)` call sites to `execution.invoker.invokeNode(name)`.
- **`ContractRegistryValidator.validate` second argument is `WarningEmitter`** (was `(message: string) => void`). Pass `new NoopWarningEmitter()` for no-ops.
- **`NoopWarningEmitter`** added to `./runtime` — the canonical no-op `WarningEmitter` for call sites that do not surface dead-write warnings.
- **`ScatterAckedResult` is now a discriminated union** (`kind: 'map' | 'field' | 'plain'`) — one hidden class per variant; affects checkpoint shape.
- **`DAGLifecycleEvent` `cancel.reason` is required** (the `cancelled` state already required it; pass `''` for none).
- **`BaseStoreOptionsType.namespace` is required** (`''` = no namespace; `BASE_STORE_DEFAULTS` provides it).
- **`BridgeMessage` `abort.reason` narrowed to `'abort' | 'timeout'`** — `'timeout'` marks a run-level deadline; preserves `timed_out` vs `cancelled` classification across the transport (R2).
- **`RegistryBundleInterface.destroy?(): Promise<void>` added** — `DagHost` calls it on shutdown (R4).
- **`RealTimeClockProvider` requires `performance.now()`** (Node 24+ / modern browsers); it no longer falls back to `Date.now()`.
- **Scatter over an array source defaults to concurrency 1**, matching async-iterable sources. The previous unbounded-for-arrays default is removed. Pass `concurrency` explicitly for parallelism.

### Breaking — Timeout value object

`Timeout` reifies per-node and per-DAG-task execution timeouts as a typed value object. `Timeout.none()` is the single "no deadline" sentinel; `Timeout.ofMs(n)` expresses a millisecond budget; `Timeout.fromWire(n)` / `Timeout.toWire()` bridge the wire representation. `Timeout` ships through the root barrel (`.`) and `@studnicky/dagonizer/runtime`.

- **`NodeInterface.timeout?: Timeout`** replaces `timeoutMs?: number`; absent means `Timeout.none()`.
- **`MonadicNode.timeout: Timeout`** defaults to `Timeout.none()` (was `timeoutMs: number = 0`).
- **`DagTask` / `DagTaskInterface` carry `timeout: Timeout`** (was `timeoutMs: number | null`).
- **Wire shape unchanged**: `ExecutionRequest` / `BridgeMessage` retain `timeoutMs: number | null`; `DagTask.toRequest()` serialises via `Timeout.toWire()`.
- HTTP/adapter request timeouts (`HttpRequestOptions.timeoutMs`, `OpenAiCompatibleConfig.timeoutMs`) are a separate always-present duration concept and remain plain `number`.

### Breaking — data-shape types are mutable (compile-time only)

`readonly` field modifiers and `ReadonlyArray<T>` / `Readonly<Record<...>>` are removed from data-shape declarations: entity and wire types, entity-narrowing interfaces, and options/config bags. This aligns declared shapes with the mutable shapes `FromSchema` produces and eliminates readonly↔mutable bridging casts at call sites. Class instance fields and `as const` on `*Schema` literals retain their immutability. This is a compile-time type change only with no runtime or V8 effect.

- Consumers that pass a `readonly` array into a now-mutable field must copy the array (`[...x]`) at the call site.
- Consumers that relied on readonly field modifiers for immutability guarantees must apply `Readonly<>` / `ReadonlyArray<>` at their own boundaries.

### Fixed — runtime robustness

- **R1 (data loss).** Scatter over an async-iterable source no longer acks-and-clears remaining items when the run is aborted mid-flight; the pull-loop checks `signal.aborted` and throws before the checkpoint is cleared, so `resume()` replays the unprocessed inbox. Covered by a new regression test.
- **R2** abort-reason classification preserved across the container transport (`ChannelDispatch` / `DagHost.#handleAbort`).
- **R3** `DagHost` message dispatch attaches `.catch()` instead of bare `void`; handler exceptions become `{ kind: 'error', code: 'INTERNAL_ERROR' }` channel messages rather than process-killing unhandled rejections.
- **R4** `DagHost.#handleShutdown` destroys registered node resources via `bundle.destroy?.()`.
- **R5** `BaseEmbedder` embed retries honour the abort signal (previously ran the full backoff budget after abort).
- **R6** `DagContainerBase.runDag` forwards the real caught error message into the transport outcome.
- **R7** concurrent scatter worker failures are accumulated, not last-write-wins.
- **R8** `SCHEMA_VIOLATION` (HTTP 422) is no longer marked retryable.
- **R9** the worker-shutdown grace `setTimeout` is cleared when the worker exits first.
- **R10** `Scheduler.reset()` cancels the prior provider's in-flight timers.
- Post-phase node failures now route to `onError` and instrumentation, not just a warning.

### Fixed — type safety and V8 shape

- `DAGNodeType` unified to `DAG['nodes'][number]` with `@type` discriminated guards, removing the `as unknown as …` casts in the dispatch table, `registerDAG`, and `DAGValidator`.
- `NodeStateBase` snapshot/restore validate warnings (`Validator.nodeWarning`) and retry values instead of laundering through `as unknown`; `_metadata`/`_retries` use destructuring-rest removal instead of `delete` (avoids dictionary-mode).
- `Validator` passes Ajv errors as a typed `{ ajvErrors }` context; `DAGLifecycleMachine` narrows with `Extract<…>` instead of `as never`.
- Validator-narrowed boundary casts are documented at every ingest site; stale internal comments updated to present-state form throughout.

### Changed — required-with-defaults & schema-derived

- **Engine-wide options resolution policy**: every options or config bag resolves through a co-located defaults object applied as both the default argument and a spread over caller input (`{ ...DEFAULTS, ...options }`). Defaulted fields are optional input, never required-of-caller. This is the canonical required-with-defaults form across the engine; each option type's defaulted fields are explicitly `?` in the type.
- **`ScatterOptions.from(partial)`** materialises static scatter-placement defaults at build time: `itemKey` defaults to `'currentItem'`, `reducer` defaults to `'aggregate'`. Data-dependent defaults (`concurrency`, `inputs`, `container`) remain resolved at dispatch. `./builder` exports `ScatterOptions`, `SCATTER_ITEM_KEY_DEFAULT`, `SCATTER_REDUCER_DEFAULT`, and `ResolvedScatterOptions`.
- **`InterruptionInfo`** is derived from `InterruptionInfoSchema` (JSON Schema 2020-12). The type is no longer hand-written.
- **Dispatch maps replace switch/if-else chains** in `DagHost`, `ChannelDispatch`, `DAGDeriver`, `OpenAiCompatibleAdapter`, and the lifecycle/gather dispatch paths.
- **`GatherStrategy.supportsIncremental`** flag replaces duck-typing of `applyIncremental` — strategies declare their incremental capability at definition time.
- **`types/index.ts`** re-exports `GatherExecutionType`, `GatherRecordType`, and `OutcomeRecordType` from `./contracts`, their source of truth.

### Fixed — robustness & packaging

- **OpenAI-compatible adapter**: LLM responses are validated against `OpenAiResponseBodySchema` compiled once via the shared Ajv instance. Malformed `tool_calls` raise `LlmError(SCHEMA_VIOLATION)` instead of an unclassified `UNKNOWN`.
- **`HttpTransport.getJson`/`postJson`** accept a `validate` callback (`(value: unknown) => TResponse`) to check the response body shape before returning.
- **`package.json` `exports`**: every subpath lists the `types` condition before `default` so TypeScript consumers resolve declarations correctly.
- **`StoreError`** threads `cause` to `super` via a trailing `options?: { cause?: unknown }`, preserving the native error chain when wrapping a backing-store failure (previously the chain was dropped).

### Added

- **`DAG.id(dagName)`** and **`DAG.placementId(dagName, placementName)`** static methods produce canonical placement URNs. Both ship through `./entities`.
- **`SignalComposer.never()`** — a shared never-aborting `AbortSignal` for call sites that require a signal but never intend to cancel.
- **`Validator.interruptionInfo`**, **`Validator.gatherConfig`**, **`Validator.openAiResponseBody`** — compiled validators for the corresponding schemas.
- **`contracts/ChainableType.ts`** — the `ChainableType` utility type has its own dedicated file; the export name is unchanged.
- **Public-export completion:** `RetryableErrorPolicy` (`./adapter`), `InitMessageShape` (`./container`), the eight entity-narrowing interfaces (`./entities`), and 25 previously-internal public types (`./types`).
- **`RetryPolicy.from(partial)`**, **`DagContainerBase.defaultOptions`**, **`BASE_STORE_DEFAULTS`**.
- Defensive validation of empty/absent `choices` in `OpenAiCompatibleAdapter`.
- 62 tests: the R1 regression, cross-container abort propagation, container pool lifecycle (`#waiters` park/unpark, transport-death eviction, destroy-under-flight, double-destroy), `ForwardingInstrumentation` hook routing, `VirtualScheduler`/`VirtualClock` controls, `LoopbackChannel` semantics, de-vacuumed `DagConformance` laws 3/4/5, canonical placement URN methods, `SignalComposer.never`, `BaseAdapterCore` consolidation paths, scatter array concurrency default, and `CheckpointRestoreAdapter.fromFn` wrapping.

### Fixed — documentation

- Removed stale `ParallelNode` / `parallel`-placement references from the concepts, reference, and guide pages.
- Corrected the viz reference: all five `CytoscapeGraph` protected-hook signatures, the `CompositeLayout.compute` signature, and the per-role hashed-palette behaviour (replacing the single amber-`#f59e0b` claim); added the `'phase'` element type.
- Rewrote three checkpoint "produced before this field was introduced" notes in present-state form.

### Breaking

**Fan-out is now expressed solely via `ScatterNode` + a required `gather`.** `ParallelNode` and all associated surface are removed. The following specific symbols are deleted:

- **`ParallelNode` placement type removed.** DAGs with `'@type': 'ParallelNode'` fail schema validation and dispatch.
- **`ParallelCombine` constant removed.** `import { ParallelCombine } from '@studnicky/dagonizer/constants'` no longer resolves.
- **`ParallelCombiners` registry removed.** `import { ParallelCombiners } from '@studnicky/dagonizer/core'` no longer resolves.
- **`DAGBuilder.parallel()` removed.** Call sites that used `.parallel(name, nodes, combine, routes)` must be rewritten as `.scatter(name, source, body, routes, { gather, reducer })`.
- **`MetadataKey.PARALLEL_OUTPUTS` removed.** The `'parallelOutputs'` metadata key is no longer written by the engine. Migrate consumers reading `state.getMetadata('parallelOutputs')` to the scatter gather result written to the `target` key declared in `GatherConfig`.
- **`NodeType.PARALLEL` removed.** The `'parallel'` node type string is no longer in the schema enum or the `NodeType` const.
- **`DAGDeriverAnnotationsType.parallels` removed.** The `parallels` annotation key and `DAGDeriverParallel` interface are deleted. Use the `scatters` annotation to express same-depth fan-outs.
- **`Validator.parallelNode` removed.** The per-entity validator for `ParallelNode` is no longer present on the `Validator` class.

**Migration: `ParallelNode` → `ScatterNode`**

A parallel group of N named nodes becomes a `ScatterNode` over an N-element descriptor source with a body node that dispatches on the `currentItem` metadata key:

```ts
// Before (removed):
.parallel('probe-group', ['probe-a', 'probe-b'], 'all-success', { success: 'next', error: null })

// After:
// state.probeDescriptors = ['probe-a', 'probe-b']
.scatter('probe-group', 'probeDescriptors', probeDispatchNode,
  { 'all-success': 'next', 'all-error': null, 'partial': null, 'empty': null },
  {
    gather:  { strategy: 'collect', target: 'probeResults' },
    reducer: 'all-success',
    concurrency: 2,
  },
)
```

One-to-one mapping for `combine` modes:

| Old `combine`    | New scatter `reducer` | New scatter `gather.strategy`                                                  |
| ---------------- | --------------------- | ------------------------------------------------------------------------------ |
| `'all-success'`  | `'all-success'`       | `'collect'` or `'discard'`                                                     |
| `'any-success'`  | `'any-success'`       | `'collect'` or `'discard'`                                                     |
| `'collect'`      | `'aggregate'`         | `'collect'` (writes per-clone output tokens in source-index order to `target`) |
| side-effect only | `'aggregate'`         | `'discard'` (no clone state written back)                                      |

`gather` is required on every `ScatterNode`. Use `{ strategy: 'discard' }` for fan-outs where no clone state flows back to the parent.

### Added

The visualizer colors container-bound (worker) sub-DAG placements per container role — each distinct role (e.g. `cpu` thread pool vs `io` fork pool) receives its own stable, distinct hue — so multi-backend DAGs are visually separable at a glance.

- **`RoleColorUtils.forRole(role)`** (`viz/internal`): deterministic per-role color triple `{fill, stroke, text}` derived from an FNV-1a hash of the role name mapped to a curated 8-hue palette. Same role string always yields the same colors; different roles yield visibly different fills. No `Math.random` / `Date.now`.
- **MermaidRenderer**: emits one `classDef contained-<sanitizedRole>` per distinct container role that appears in the DAG. Each classDef uses the role's fill/stroke from `RoleColorUtils`. A DAG with roles `cpu` and `io` emits two classDefs with two different fills.
- **CytoscapeRenderer**: contained placements carry `data.containerColor`, `data.containerStroke`, and `data.containerText` in addition to `data.container` (role string). All four keys are absent on in-process placements (`exactOptionalPropertyTypes` honored). Mermaid and Cytoscape use the same `RoleColorUtils` function so colors are consistent across renderers.
- **CytoscapeGraph**: the `node.dag-contained` stylesheet rule reads colors via cytoscape `data(...)` mappings (`'background-color': 'data(containerColor)'` etc.) so each node paints with its own role color without enumerating roles in the stylesheet.
- **`CytoscapeNodeData.kind`** (`'deterministic' | 'non-deterministic'`): present on every node element for stylesheet selection via `node[kind="deterministic"]` / `node[kind="non-deterministic"]` selectors. Subclasses enrich or override the classification by overriding `buildElements()`.
- **JsonLdRenderer**: `container` is included as `dag:container` in the JSON-LD output for `EmbeddedDAGNode` and dag-body `ScatterNode` placements when the field is present.
- **Example 13** (`examples/13-multibackend.ts`): demonstrates a DAG with two distinct container roles (`cpu` → `WorkerThreadContainer` for scatter items; `io` → `ForkContainer` for the sum step). Prints the Mermaid output showing `classDef contained-cpu` and `classDef contained-io` with different fills, then executes the DAG over both real backends and prints results. Run with `pnpm example:13`.
- **`gather` is now required on `ScatterNode`** (schema + builder + validator). Every scatter must declare the merge strategy. The `discard` gather strategy (`{ strategy: 'discard' }`) is the explicit declaration for side-effect-only fan-outs where no clone state flows back to the parent. Existing scatter DAGs with no gather must add `discard` (or the appropriate real merge strategy).
- **`discard` gather strategy** (`GatherStrategies`): a no-op `GatherStrategy` for side-effect-only scatters. `apply` and `applyIncremental` both no-op; nothing is written to parent state. Registered in `GatherStrategies` at module load.
- **`collect` gather strategy** (`GatherStrategies`): collects each clone's output token (or its `field` value when `field` is set) into a target collection on the parent in source-index order. Requires `target`. Mirrors the `CollectCombiner` intent for scatter: per-clone result array keyed by source index, appended in index order.
- **`all-success` outcome reducer** (`OutcomeReducers`): routes `'success'` when every clone output equals `'success'`, otherwise routes `'error'`. Returns `'error'` for empty record sets.
- **`any-success` outcome reducer** (`OutcomeReducers`): routes `'success'` when at least one clone output equals `'success'`, otherwise routes `'error'`. Returns `'error'` for empty record sets.
- **`'collect'` and `'discard'`** added to `GatherStrategySchema.enum` and `GatherStrategyName` const.
- **`ChannelInterface`** (`./contracts`): adapter contract for publishing completed-DAG hand-off envelopes to a downstream transport. Implementations provide `publish(handoff: DAGHandoff): Promise<void>` and an optional `destroy()`. Channels must not throw out of the dispatcher; the dispatcher wraps every publish call in a try/catch.
- **`DAGHandoff` entity** (`./entities`): JSON Schema 2020-12 envelope (`DAGHandoffSchema`) and `FromSchema`-derived `DAGHandoff` type. A `oneOf` discriminates between `stateSnapshot` (by-value, full `JsonObjectType`) and `stateSnapshotRef` (by-reference URI string) so exactly one is present. Common fields: `dagName`, `terminalName`, `terminalOutput`, `registryVersion`, `correlationId`, `placementPath`. `additionalProperties: false` on both branches.
- **`InMemoryChannel`** (`./channels`): default loopback `ChannelInterface` implementation. Stores published envelopes in an in-memory array (deep-cloned via `structuredClone` for full serialization fidelity) exposed via `published: readonly DAGHandoff[]`. Extension is by subclass (zero callbacks): override the protected `onPublished(handoff)` hook — awaited after each envelope is recorded — to chain a downstream DAG.
- **`./channels` subpath**: public submodule exporting `InMemoryChannel` and `InMemoryChannelOptions`.
- **`channels` option** on `DagonizerOptionsType`: `Readonly<Record<string, ChannelInterface>>` keyed by terminal placement name. When a non-embedded top-level run completes at a terminal whose name is bound in `channels`, the dispatcher builds a `DAGHandoff` envelope (by-value `stateSnapshot`) and calls `channel.publish(handoff)` after `onFlowEnd`/`flowEnd`. Different terminals route to different channels (`done` → queue, `escalate` → DLQ). An unbound terminal follows the in-process path with no publish. Defaults to `{}`.
- **`registryVersion` option** on `DagonizerOptionsType`: registry version string included in every `DAGHandoff` envelope for cross-host version handshake. Defaults to `'0'` when not supplied.
- **`Dagonizer.destroy()` cascades to bound containers and channels**: after destroying every registered node, `destroy()` calls the optional `destroy()` on each bound `DagContainerInterface` (worker/child pools) and then each bound `ChannelInterface`. Teardown order is nodes → containers → channels.
- **Publish failure handling**: if `channel.publish` throws, the dispatcher collects a `HANDOFF_PUBLISH_FAILED` error (recoverable: false) via `state.collectError` and fires `instrumentation.error`. The returned `ExecutionResult` and `terminalOutcome` are unchanged — a failed publish does not rewrite the run result.
- **`Validator.dagHandoff`**: `EntityValidator<DAGHandoff>` compiled from `DAGHandoffSchema` at module load via the existing `Validator.compile(...)` pattern.
- **DAG containment seam**: `container` placement key on `EmbeddedDAGNode` and `ScatterNode` (dag-body only). Attaching `container: 'roleName'` to an embedded-DAG or scatter-dag-body placement routes that sub-DAG to a registered `DagContainerInterface` backend (worker thread, fork, Web Worker, etc.) instead of the in-process engine. `SingleNode` and scatter node-body placements carry no `container` key and no routing change.
- **`DagContainerInterface`** (`./contracts`): adapter contract for running a whole DAG in an isolate. Implementors provide `runDag(task: DagTaskInterface): Promise<DagOutcomeType>` and an optional `destroy()`.
- **`DagTaskInterface` / `DagOutcomeType`** (`./contracts`): wire contracts between the dispatcher and container backends. `DagTask` (`./container`) is the engine-side implementation carrying live clone state plus `toRequest()` for wire serialisation.
- **`containers` option** on `DagonizerOptionsType`: `Readonly<Record<string, DagContainerInterface<TState>>>`. Roles declared in placements but absent from this map resolve to in-process and emit a `contractWarning`.
- **`ExecutionRequest` / `ExecutionResponse` / `ExecutorIntermediate` entities** (`./entities`): JSON Schema 2020-12 wire shapes for cross-isolate DAG execution; `FromSchema`-derived TypeScript types exported from `./entities` and `./types`.
- **`./container` subpath**: public submodule exporting `DagTask`, `DagHost`, `DagContainerBase`, `DagContainerOptions`, `PoolEntry`, `DagContainerError`, `DEFAULT_SHUTDOWN_GRACE_MS`, `ForwardingInstrumentation`, `DagOutcome`, the transport-error codes (`DAG_CONTAINER_TRANSPORT`, `DAG_CONTAINER_WORKER_DIED`), and the `TransportErrorCode` discriminator.
- **`applySnapshot(snapshot: JsonObjectType): void`** on `NodeStateInterface` and `NodeStateBase`: promoted from `protected` to `public` so container backends can rehydrate terminal state from an `ExecutionResponse.stateSnapshot`.
- **`snapshot(): JsonObjectType`** on `NodeStateInterface`: made explicit in the interface contract.
- **`BridgeMessage` protocol** (`./entities`): kind-discriminated oneOf JSON Schema for the parent↔DagHost channel. Parent→host: `init`, `execute`, `abort`, `shutdown`. Host→parent: `ready`, `result`, `intermediate`, `instrumentation`, `error`, `log`. The `execute` branch carries an `ExecutionRequest` with `correlationId`. The `result` branch uses `terminalOutput`. `Validator.bridgeMessage` validates at the channel boundary.
- **`BridgeMessageBuilder`** (`./entities`): static factory for `BridgeMessage` values. `BridgeMessageBuilder.invalid(code, message)` builds a channel-scoped error message (`correlationId: null`) for init failures, transport setup errors, and invalid message receipts at the channel boundary.
- **`DagHost`** (`./container`): isolate-side runtime. Receives `init` (dynamic-imports registry module, version-handshakes, replies `ready`), `execute` (restores state, runs whole DAG via per-execute `Dagonizer`, streams `intermediate` messages, replies `result`), `abort` (fires per-request `AbortController`), `shutdown` (closes channel). `ForwardingInstrumentation` is constructed per-execute with the request's `placementPath` as `basePath` so forwarded instrumentation messages carry the full composite path.
- **`DagContainerBase`** (`./container`): abstract pool-owning base implementing `DagContainerInterface`. Owns the full worker-pool lifecycle: demand-based pool growth, semaphore waiting, lazy init, death-detection eviction, and graceful shutdown. Subclasses implement four abstract seams only: `createEntry()` (construct worker + channel), `attachDeathListeners(entry)` (wire death events → `onTransportDeath`), `terminateWorker(worker)` (force-kill), and `awaitWorkerExit(worker)` (resolve on exit). Pass `{ instrumentation, poolSize, init }` to `super()`. `acquireChannel()` / `releaseChannel()` / `failChannel()` / `onTransportDeath()` are concrete base implementations, not subclass responsibilities.
- **`ForwardingInstrumentation`** (`./container`): `Instrumentation` implementation for DagHost. Suppresses `flowStart`/`flowEnd`; forwards `nodeStart`, `nodeEnd`, `phaseEnter`, `phaseExit`, `contractWarning`, `error` as `instrumentation` BridgeMessages. Takes a required `basePath` positional prepended to all forwarded `placementPath` values (pass `[]` for a top-level host with no parent placement context).
- **`DagOutcome`** (`./container`): static factory (`noun.verb()`) for `DagOutcomeType` values. `DagOutcome.transportError(correlationId, code?, message?)` builds the collected-error outcome (`terminalOutput: 'failed'` plus one unrecoverable `runDag` `NodeError`) the transport layer returns when a DAG never reaches a terminal. `ChannelDispatch` and `DagContainerBase` are the call sites.
- **`MessageChannelInterface`** (`./contracts`): duplex channel contract (`send`, `onMessage`, `close`).
- **`InstrumentationSink`** (`./contracts`): adapter contract for receiving forwarded instrumentation messages inside `ChannelDispatch.request()`. Implementors provide `onInstrumentation(msg)`. `DagContainerBase` constructs a concrete `InstrumentationSink` per request.
- **`RegistryModuleInterface` / `RegistryBundleInterface`** (`./contracts`): default-export contract for dynamically-importable registry modules. `createBundle(servicesConfig)` returns a `RegistryBundleInterface` with `bundle`, `services`, `registryVersion`, `restoreState`.
- **`SystemInfoInterface`** (`./contracts`): `recommendedWorkerCount(config)` contract for container backends.
- **`RecommendedWorkerCountConfig` entity** (`./entities`): JSON Schema and defaults for worker count heuristics.
- **`LoopbackChannel`** (`./testing`): in-memory duplex channel pair using `structuredClone` + `setImmediate` for full serialization testing. `LoopbackChannel.pair()` returns two connected sides.
- **`ConformanceRegistry`** (`./testing`): DAG-level law fixtures. Body DAGs (`conformance-body-law1`–`law9`) and runner DAGs (`conformance-runner-law1`–`law9`) using `EmbeddedDAGNode` with `stateMapping.output`. Nodes record observations through state (not closures) for snapshot round-trip fidelity. `ConformanceRegistry.bundle()` returns the `RegistryBundleInterface` plus `RegistryModuleInterface` default export for DagHost dynamic-import.
- **`DagConformance`** (`./testing`): backend-agnostic conformance law suite (Laws 1–9). `DagConformance.laws(harness)` returns `DagConformanceLawInterface[]` for any `DagConformanceHarnessInterface`. Laws cover: node execute with state surface, state mutation visibility, error collect-and-route, timeout, abort propagation, instrumentation placementPath, scatter checkpoint byte-identity across backends, at-least-once under container failure (Law 8, harness-gated), and state round-trip fixed point. `DagConformanceHarnessInterface` gains optional `createInProcessDispatcher` (Law 7) and `interruptMidScatter` (Law 8) hooks.
- **Scatter dag-body containment**: `executeScatter` in `Dagonizer` routes each scatter item's dag-body through a bound `DagContainerInterface` when `scatter.container` is set and the container resolves to non-null. Node-body scatter items always run inline. Per-ack checkpoint writes (`SCATTER_PROGRESS_KEY`) are byte-identical between in-process and contained paths. `ConformanceRegistry` adds `scatterCounterNode`, `scatterItemBodyDag` (dag-body for scatter law items), and `scatterDag` runner factory with map-gather `{ value → gatheredItems }`.
- **`NodeStateInterface.resetLifecycle()`**: resets the lifecycle discriminated union to `pending`. Called by the dispatcher before re-entering a flow on resume when the prior run ended in a terminal state (failed/cancelled/timed_out) due to a crash or interrupt. Lifecycle is not captured in snapshots; this method is the engine's mechanism for re-entering execution on a state that survived a crash.
- **`DagHost` synthetic-error guard** narrowed: the `DAG_EXECUTION_FAILED` synthetic error is only emitted when `terminalOutcome === null` AND `state.errors.length === 0` AND `lifecycle.kind !== 'completed'`. DAGs that complete without a `TerminalNode` (lifecycle `completed`, `terminalOutcome null`) no longer receive a spurious `recoverable: false` error that caused contained scatter items to route to `'error'` output instead of `'success'`.

### Changed

- **Archivist scout fan-outs converted to scatter.** The `reviews-scatter`, `describe-scatter` (in `the-archivist/dag.ts`), and `book-search-scatter` (in `BookSearchScatterDAG.ts`) fan-outs now use `ScatterNode` with a descriptor source (`state.scoutProviders = ['openlibrary','googlebooks','subject','wikipedia']`), a single `scoutDispatch` body node that dispatches on the `currentItem` metadata key to the matching scout logic, the `scout-merge` gather strategy that flat-merges `candidates` and `failureCause` from all four clone states, and the `any-success` outcome reducer. Concurrency is 4. The four individual per-source node placements are removed; behavior is preserved.
- **`GatherConfig.strategy` is now an open `string`.** The schema constraint was widened from a closed enum to `{ type: 'string', minLength: 1 }`. Custom gather strategies registered via `GatherStrategies.register(...)` can now be referenced by name in DAG author expressions without a type error. Unknown names are caught at runtime by `GatherStrategies.resolve(name)`.
- **`examples/dags/parallel-combiner.ts` recast as scatter-extension demo.** The file now demonstrates `TopNGatherStrategy` (custom `GatherStrategy`) and `ThresholdReducer` (custom `OutcomeReducer`) as the scatter extension points.
- **`examples/dags/constants-usage.ts`** replaces the `ParallelCombine.ALL_SUCCESS` snippet with `GatherStrategyName.COLLECT` to showcase the current fan-out vocabulary.

### Fixed

- **`NodeStateBase.clone()` subclass identity**: `clone()` now instantiates the concrete subclass via `this.constructor` rather than hardcoding `new NodeStateBase()`. Domain state survives the `clone()→applySnapshot()` round-trip on embedded-DAG and scatter (including contained/worker) paths without requiring a hand-written `clone()` override in every subclass. The `as TState` cast in `StateMapper.createChild` is now truthful at runtime.

- **EventEmitter listener accumulation on reused pooled workers**: `DagContainerBase.runDag` previously called `channel.onMessage(handler)` on every request, accumulating O(N) transport listeners on a shared channel and triggering Node's `MaxListenersExceededWarning` when a worker handled more than 10 scatter items. Replaced per-request listener registration with `ChannelDispatch` — a single-subscription `correlationId` correlator that installs exactly one `channel.onMessage` handler per channel lifetime and demuxes responses via a `Map<correlationId, resolver>`. Channel implementations (`MessagePortChannel`, `IpcChannel`, `NdjsonChannel`, `PostMessageChannel`, `LoopbackChannel`) are updated to enforce replace semantics on `onMessage` (the underlying transport listener is installed once in the constructor; subsequent `onMessage` calls replace the delegated handler, never re-subscribe). A regression test (`channel-correlation.test.ts`) asserts exactly one subscription regardless of request count, correct per-request result correlation, and no cross-talk under out-of-order delivery.

- **Worker/child death no longer hangs the in-flight request**: when a pooled container worker or child died without sending a result or error (terminate, OOM via `resourceLimits`, segfault, `process.exit`, killed tab), nothing failed the pending `ChannelDispatch` entry, so `runDag` hung forever and `executeScatter`'s pool drain never resolved. Added `ChannelDispatch.failAll(code, message)` — settles every pending entry with a transport-error `DagOutcomeType` and rejects an in-flight init; the channel-scoped (`correlationId: null`) error path is factored to call it, so there is one code path that fails all pending work. `DagContainerBase.failChannel(channel, code, message)` is the protected hook backends call from their transport-death listeners. This is death detection, not a blind timer, so legitimately long-running DAGs are never killed. The transport-error codes (`DAG_CONTAINER_TRANSPORT`, `DAG_CONTAINER_WORKER_DIED`) and the `TransportErrorCode.isInfrastructureFailure(code)` discriminator are canonical exports from `./container`.

- **Contained scatter preserves at-least-once on infrastructure failure (Law 8)**: a contained scatter dag-body whose `container.runDag` returned a transport-error outcome (the DAG never ran to a terminal because the worker died or the channel was lost) was previously acked anyway, removed from the inbox, and wiped from the checkpoint — silently losing the item. `executeScatter`'s contained branch now throws an `ExecutionError` when the outcome carries an infrastructure-failure code, so the pool-error path fires, the item is left un-acked, and the throw precedes `ScatterCheckpoint.clear` — a resume on a healthy container reprocesses exactly the lost item. A legitimate body that ran and routed to its `error` output (a real terminal) still acks as before. The cardinality-1 embedded-DAG branch keeps routing an infrastructure failure to its `error` output (never throws), per Law 3.

## 0.17.0

### Minor Changes

- 34b7155: Apply Clean Code manifesto: static classes replace free functions, named constants replace magic numbers, flag arguments replaced with options objects, SRP extractions from Dagonizer core.

  **Breaking removals:** `detectGeminiNano` (→ `GeminiNanoAdapter.detect()`), `decodeToolCallsJson` (→ `ToolCallCodec.decode()`), `classifyHttp` (→ `LlmError.classifyHttp()`), `asNetworkError` (→ `LlmError.fromNetworkError()`).

  **New:** `DAGValidator`, `StateMapper`, `ScatterCheckpoint`, `PlacementUtils`, `ToolCallCodec`, `OpenLibraryDocs`, `BookEntitiesError`, `ExecutionError.fromSignal()`, `GeminiNanoAdapter.detect()`.

## 0.16.0

### Minor Changes

- 8b47957: Native streaming scatter: unified executor with bounded worker pool, durable-inbox checkpoint, and incremental gather.
- 8b47957: viz: ship a subclassable `CytoscapeGraph` factory, make the visualizer opt-in, and fix self-loop node rendering.

  - **`CytoscapeGraph`** (new, `@studnicky/dagonizer/viz`): given a `DAG`, `await new CytoscapeGraph(cytoscape, container, dag, options).mount()` returns a fully-configured `cytoscape.Core` — elements (via `CytoscapeRenderer`), the canonical stylesheet, the bottom-up dagre `preset` layout, and pan/zoom/box-select defaults. Cytoscape is dependency-injected; protected hooks (`buildElements`, `stylesheet`, `presetLayout`, `interactionDefaults`, `layoutRegistry`, `applyLayout`, `enforceVisibility`, `onReady`) are the extension surface. Ships with `CytoscapeGraphInterface` and `CytoscapeGraphOptionsType`.
  - **`cytoscape` and `@dagrejs/dagre` are now optional peer dependencies.** The visualizer is opt-in: consumers who do not import `./viz` install neither. `@dagrejs/dagre` was previously a devDependency while `dist/viz/CompositeLayout` imported it at runtime, so external consumers of the cytoscape renderer crashed with `Cannot find module '@dagrejs/dagre'`.
  - **`CompositeLayout.compute` is now `async`** and lazy-imports `@dagrejs/dagre`, so `MermaidRenderer` / `JsonLdRenderer` consumers never load the layout engine. **`CytoscapeRenderer.render` returns elements only** — the `computeLayout` / `layoutOptions` options are removed; positioning is owned by `CompositeLayout` / `CytoscapeGraph`.
  - **Fixed:** DAG nodes carrying a self-loop edge (a `retry` route to self) rendered invisible. The canonical stylesheet used deprecated `width: 'label'` / `height: 'label'` auto-sizing, which left a degenerate size cache on self-loop nodes that cytoscape culled. It now uses explicit numeric node dimensions and a concrete monospace font stack, with a post-layout visibility sweep as a guard.
  - **`PhaseNode` rendering** (6th placement type): all three renderers (`CytoscapeRenderer`, `MermaidRenderer`, `JsonLdRenderer`) now recognize `PhaseNode` placements. `CytoscapeRenderer` emits a node element with `data.type === 'phase'` carrying `data.phase` and `data.node`; the `CytoscapeGraph` stylesheet styles phase nodes with a `barrel` shape and dashed purple border to distinguish them from flow nodes. `MermaidRenderer` emits a stadium-shape node with the `(pre|post)` suffix and no outgoing edges. `JsonLdRenderer` emits a `dag:PhaseNode` entry with `dag:phase` and `dag:node` fields.

## 0.15.0

### Minor Changes

- b5b931f: Audit-driven cleanup across the monorepo (performance, V8 shape, consistency) — every confirmed and advisory finding addressed.

  Core (`@studnicky/dagonizer`):

  - perf: `Scheduler.current()` returns the active provider directly (no per-call wrapper allocation on the node/scatter hot path); `SchedulerProvider` structurally satisfies `SchedulerHandle`, so the public return type is unchanged.
  - perf: gather strategies (`map`/`append`/`partition`) no longer re-sort `execution.records` — records are now documented as an invariant to be source-index ordered (the scatter loop builds them so on every path including resume), eliminating a redundant `.slice().sort()` per gather. `executeScatter` builds the reducer input by iterating the outputs map directly (no intermediate spread).
  - fix(v8-shape): `ToolError.status` is `number | null`, always initialised, so every instance shares one hidden class.
  - consistency: wire-format helpers in `OpenAiCompatibleAdapter` are private methods (no freestanding `toX`/`parseX` functions); removed the forbidden `SearchTool` alias from `./patterns` (use canonical `Tool` from `./tool`).

  Plugin packages: provider adapters' wire-format/error helpers consolidated onto their adapter classes; `StubAdapter` constructor arg `opts`→`options`; redundant `public` modifier dropped; `OpenLibrarySearchTool` populates `notes` provenance consistently with the other tools.

  Tool packages (`-tool-googlebooks`, `-tool-wikipedia`): now re-export the `@studnicky/dagonizer-book-entities` types (`Book`, `Candidate`, `Money`, `CanonicalId`) they expose in their public surface, matching `-tool-openlibrary`.

- a338274: Add `WellFormedValidator` (`./validation`): an opt-in authoring lint that flags hacky/legacy DAG shapes the structural Ajv schema cannot express — bare `null` flow-ends (route to a canonical `TerminalNode` instead), dangling output targets, and malformed scatter/embedded/terminal placements. It returns human-readable violations and is NOT wired into the permissive runtime `registerDAG` (where `null` routes remain a supported natural-end). The repo's flagship example DAGs are gated against it via a new `lint:dags` CI step.

### Patch Changes

- a338274: `registerDAG` now credits the co-located contract of `EmbeddedDAGNode` and `ScatterNode` placements (resolved by placement name), not just `SingleNode` placements. Previously, an operation rendered as an embedded-DAG or scatter placement was dropped from the contract graph, so a downstream node reading its `produces` was wrongly flagged as a dangling read and `registerDAG` threw `DAGError`. Fixes the `examples/derive.ts` embedded-DAG flow, which failed contract validation at registration.

## 0.14.0

### Minor Changes

- d3a4e7b: Fork, embed, and join are three distinct node types, each with exactly one way to express them. No fan-out API.

  - **Fork** is `ScatterNode` / `.scatter(name, source, body, outputs, options?)`. `source` is required (a fork is always 1→N). `FanOutNode` / `.fanOut()` are removed.
  - **Embed** is `EmbeddedDAGNode` / `.embeddedDAG(name, dagName, outputs, options?)`: invoke a sub-DAG once (cardinality 1) with `stateMapping { input, output }` (`input` seeds the child from the parent, `output` copies child fields back). Distinct from fork; never a flag on `scatter`.
  - **Merge** machinery is `GatherConfig` + the `GatherStrategies` (`map`/`append`/`partition`/`custom`) and `OutcomeReducers` (`aggregate`/`terminal`) registries. `FanInConfig`, `FanInStrategies`/`FanInStrategy`/`FanInExecution` are removed.
  - Renames: `FAN_OUT_PROGRESS_KEY`→`SCATTER_PROGRESS_KEY` (and `FanOutProgress`/`StoredFanOutProgress`→`ScatterProgress`/`StoredScatterProgress`); `MetadataKey.fanInResults`→`gatherResults`; derive `annotations.fanouts`→`annotations.scatters`, `DAGDeriverFanOut`→`DAGDeriverScatter`, `fanInOperation`→`customNode` (the `embeddedDAGs` annotation now renders an `EmbeddedDAGNode`); `@studnicky/dagonizer-patterns-flow`'s `FanInReducerNode`→`MergeReducerNode`.
  - Visualization gains an `embedded-dag` placement type (Cytoscape) / subroutine shape (Mermaid) / `dag:EmbeddedDAGNode` (JSON-LD), distinct from `scatter`.

  `NodeResult.output` is now required and typed `string | null` (`null` = no route emitted; previously optional `string`), and every `NodeResultType` carries a required `intermediateResults` array (`[]` for leaf nodes): one stable result shape, no post-construction mutation. `onNodeEnd` and `Instrumentation.nodeEnd` take `output: string | null` to match.

  One way to seed child state: `ScatterNode` uses `stateMapping.input` (builder option `inputs`) to seed each clone, the same field/orientation as `EmbeddedDAGNode.stateMapping.input`; the old `ScatterNode.projection` field is gone. (Scatter has no `stateMapping.output`: the N→1 merge is `gather`'s job.) `GatherConfig.strategy` references the canonical `GatherStrategy` enum instead of re-declaring it.

  `NodeStateInterface` gains `deleteMetadata(key)`. The `./constants` subpath now resolves (constant value+type pairs: `GatherStrategyName`, `MetadataKey`, `NodeType`, `Output`, `ParallelCombine`, `ScatterOutput`).

  No back-compat shims. Clean breaks, versioned:

  - `DAGDeriver.derive` takes `nodes` (contracts co-located on each node, single source of truth); the standalone `contracts` input is removed.
  - `CheckpointData.stores` is required; checkpoints produced before stores were captured no longer load.
  - The observability hooks (`onNodeStart`/`onNodeEnd`/`onError`) take `placementPath` as a required argument (no `[]` default).
  - `ContractRegistryValidator` treats the entrypoint's `hardRequired` as the flow's ambient external state, so any node may read those keys and multi-root topologies (several roots reading the initial input) validate.
  - `DAGDeriverTerminal` has one way to end and one way to route: `{ outcome, emit }` synthesizes a `TerminalNode` (the only way to end an outcome); `{ outcome, target: string }` routes to an existing placement. The implicit `target: null` end is removed; terminals are explicit.

  Checkpointing depends on a capability, not the key-value surface. The new `Snapshottable` contract (`./contracts`) declares just `snapshot()` / `restore()`; `Store extends Snapshottable`. `StoreSnapshotType` and `StoreSnapshotEntryType` move to `Snapshottable` and are exported only from there (and the `./contracts` / `./store` barrels); `./contracts/Store` no longer re-exports them. `Checkpoint.capture(dag, result, { stores })` and `Checkpoint.restoreStores(stores)` take `Record<string, Snapshottable>`, so a non-KV backing (an RDF triple store, a vector index) can ride along in a checkpoint without implementing `get`/`set`/`has`/`delete`/`update`.

  Retry is a flow shape, not an in-node policy. `NodeStateBase` (the state every consumer extends) gains a retry-attempt concept (`recordAttempt(key)`, `retriesFor(key)`, `clearAttempts(key)`, and `withinRetryBudget(key, maxAttempts)`) keyed by a routing name (typically `context.nodeName`). A node that fails routes to a `retry` output (the DAG loops the edge back, bounded by the counter) or a `salvage` output (budget spent); the loop and the recovery both live in the topology, not inside the node. The counter is part of `snapshot()` (the persistence shape `NodeStateData` adds a `retries` map), so a retry budget survives checkpoint/resume.

  Embedded DAGs nest arbitrarily deep (DAG-in-DAG-in-DAG); cross-kind sub-DAG cycles (embed ↔ scatter) are detected at registration.

  Migration: replace `.fanOut(name, body, outputs, { source, ... })` with `.scatter(name, source, body, outputs, { ... })`; nested-flow invocations keep using `.embeddedDAG()`. Observers reading a node result's `output` now receive `null` (not `undefined`) when no route was emitted.

## 0.13.2

### Patch Changes

- 238a94d: Hotfix: align every package in the workspace to 0.13.1 and lockstep them via the new `fixed:` group in `.changeset/config.json`. Eliminates the v0.13.0 release artifact where peer-dep range churn caused most packages to jump to 1.0.0 while the engine itself sat at 0.12.0; the tag `v0.13.0` was correct but the per-package version numbers disagreed. All packages in the `@studnicky/dagonizer*` group now move together; peer ranges restored to `workspace:^0.13.1` across the workspace.

## 0.12.0

### Minor Changes

- 7c0e38a: Archivist demo: embedder cascade exposed as `ArchivistServices.embedder` and used across `recordFindings` (writes embedding triples), `recallCandidates` (cosine-similarity prior-candidate recall with Jaccard fallback), and `rankCandidates` (hybrid composite score with LLM tiebreak on top-3). New anti-hallucination validator runs deterministically before the LLM validator in `compose-retry-loop`, cross-referencing draft named entities against the shortlist. `decideTools` pattern-matches common query shapes and bypasses the LLM for unambiguous tool selection.
- 3286d07: Archivist live-demo polish: PROV-O bridge connects books to run activities (`prov:wasGeneratedBy`, `prov:wasAttributedTo`, `prov:generated`) so the MemoryGraph reads as one connected graph instead of two clusters. Persona rewritten as positive imperatives ("research librarian with global catalog" instead of "small independent bookstore", eliminating the "in stock" inventory framing); all engineer-jargon "shortlist" references replaced with "catalog records" in user-facing strings. DagGraph viewport: smooth synchronous fit with 120ms debounce, parallel nodes coalesce to one zoom-out, user-gesture latch pauses auto-follow until Fit/Center released, reset cancels in-flight animation, horizontal edge labels with taxi-turn 50%, CompositeLayout separations widened. OpenLibrary scout reads typed `author`/`subject`/`isbn` args; `decideTools` deterministic shortcuts detect ISBN-13/10. Embedded-DAG outcome routing tolerates recoverable errors so one rate-limited source doesn't poison the whole subgraph. MemoryGraph label colours match node layer colours. Conversation auto-scrolls when new turns arrive (respects user scroll-up).

## 0.11.4

### Patch Changes

- a3528ad: `CytoscapeRenderer` emits `data.label` as Title Case (kebab → Title Case with `/` separators preserved). Machine identifiers stay kebab-case; only the rendered display label changes. Archivist example DAG placements renamed to drop `bsf-` / `crl-` namespace prefixes; the embedded-DAG containment already provides the visual namespace.

## 0.11.3

### Patch Changes

- 22491f7: Archivist demo: in-node 30s timeouts + salvage paths on every LLM-calling node so the DAG always completes (no more hangs on slow on-device backends). `rankCandidates` and `decideTools` LLM schemas refactored to emit integer indices into pre-numbered lists instead of full records, a token-economy fix delivering ~10–25× speedup on Gemini Nano. Slow-backend warning banner added to the demo when the browser built-in backend is selected without cloud keys.

## 0.11.2

### Patch Changes

- 0789762: `DagGraph` cytoscape stylesheet: compound subgraphs (embedded-DAGs, parallel containers, every `node:parent`) render as `round-hexagon`; fan-out placements render as `concave-hexagon`; edges switch to `round-taxi` with `vee` arrowheads and 12px corner radius. Dagre layout uses `ranker: 'tight-tree'` with centered ranks (no fixed `align`) and `marginx/marginy: 40` so outermost nodes have wrap-around room.

## 0.11.1

### Patch Changes

- 40f8abf: Archivist demo: `rank-candidates` no longer aborts the whole embedded-DAG when its LLM call exceeds the per-node timeout. Signal is propagated through `llm.rankCandidates` so the LLM call is actually cancelled, the default timeout is raised to 90s for on-device backends, and any abort/timeout leaves `state.candidates` intact (with their original scout-supplied scores) so the compose step sees real books instead of an empty shortlist.

## 0.10.0

### Minor Changes

- 110fef0: v0.10.0: Plugin architecture per RFC 0001.

  Main package gains three subpaths: `./adapter`, `./patterns`, `./tool`.
  Eight cloud / on-device adapter packages, three external-service tool
  packages, and three pattern packages ship for the first time. The
  Archivist example consumes them all and demonstrates the canonical
  extension pattern.

  Required-with-defaults + V8 shape stability principles enforced
  across every contract surface.
