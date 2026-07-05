# @studnicky/dagonizer

## 0.30.0

### Minor Changes

- 4234bc4: `LlmAdapterInterface.chatStream(request, sink)` adds a streaming seam over `StreamSinkInterface<ChatStreamChunkType>`. `BaseAdapter` ships a provider-agnostic buffered default: one full `chat()` call, then a single chunk pushed to the sink. Concrete streaming adapters override `performChatStream` to push incremental deltas as they arrive.

  New `ChatStreamChunk` entity (`ChatStreamChunkSchema` + `ChatStreamChunkType` + `ChatStreamChunkBuilder.of`) carries one incremental text delta from a streaming chat call.

  New `ReasoningStep` entity (`ReasoningStepSchema` + `ReasoningStepType` + `ReasoningStepBuilder`) models one step — `thought` / `action` / `observation` / `final` — of an agent's reasoning trace as a discriminated union.

  New `ReasoningTraceItem` entity (`ReasoningTraceItemSchema` + `ReasoningTraceItemType` + `ReasoningTraceItemBuilder`) pairs a `ReasoningStepType` with a monotonic `ordinal`, so a streamed step is self-describing — a downstream consumer can derive a `wasInformedBy`-style chain from `ordinal - 1` with no cross-item state.

  New `AgentTraceProducer`, a `DagStreamProducer<ReasoningTraceItemType>` subclass, streams a running agent loop's node results as ordinal-tagged `ReasoningTraceItemType` items via a fixed node-name → reasoning-kind dispatch map. The ordinal increments only for emitted items, so the sequence stays contiguous. Consumers extend it and implement `describe(stage)` to supply each step's text.

  `CallModelNode` streams its model call via `chatStream`, taking an optional `sink` in its constructor options (`StreamSinkInterface<ChatStreamChunkType>`) that defaults to a no-op `NullStreamSink` when omitted.

  New `SseLineParser`, a shared isomorphic Server-Sent-Events framer built on Web Streams + `TextDecoder` only, so it runs unchanged in Node and the browser. `OpenAiCompatibleAdapter` overrides `performChatStream` to POST with `stream: true` and drain the response body through `SseLineParser`, pushing one `ChatStreamChunkType` per non-empty delta; a request carrying tools still falls back to the buffered default.

  `chatStream` is a new required method on `LlmAdapterInterface`, covered by a concrete default on `BaseAdapter`. Consumers who extend `BaseAdapter` (the documented extension path) are unaffected; a consumer implementing `LlmAdapterInterface` directly gains a new method to satisfy.

  New `RoutedChatStreamChunk` entity (`RoutedChatStreamChunkSchema` + `RoutedChatStreamChunkType` + `RoutedChatStreamChunkBuilder.of`) tags one streamed text delta with a `routeKey` and its originating `{dagName, nodeName}` source, and new `RoutingStreamSink` (`RoutingStreamSink.of`) decorates the per-execution sink handed to `adapter.chatStream`, stamping every pushed chunk before forwarding it to a shared downstream sink. `CallModelNode` gains an overridable `routeKey(state)` seam (default `''`) and constructs a fresh `RoutingStreamSink` per execution, so one shared sink — for example a `StreamChannel<RoutedChatStreamChunkType>` feeding a routing DAG that scatters by `routeKey` — demultiplexes concurrent runs sharing a single node instance.

## [unreleased]

### Major Changes

- `ScatterNode`'s three uncoordinated concurrency-limiting knobs (`concurrency`, `throttle`, `reservoir`) collapse into ONE discriminated `execution` field: `execution: { mode: 'item', concurrency?, throttle? } | { mode: 'reservoir', concurrency?, reservoir }`. Absent `execution` defaults to `{ mode: 'item', concurrency: 1 }` — the pre-`execution` default behavior.

  Before this change, setting `throttle` alongside `reservoir` compiled and validated but silently did nothing: `ScatterExecutor` never wired `throttle` into `ReservoirBuffer`, and no error or warning surfaced. The schema now structurally prevents the combination — `mode: 'reservoir'` has no `throttle` field, so a consumer cannot even express it — because a per-item `Throttle` does not compose with reservoir mode's variable-size batch dispatch (capacity/idle/flush triggered).

  `concurrency` keeps its previous behavior in BOTH modes (this is not new — `ScatterExecutor` already passed `scatter.concurrency` into `ReservoirBuffer`'s semaphore): in `mode: 'item'` it is an item-level `Semaphore` permit count (max clone bodies executing at once); in `mode: 'reservoir'` it is the SAME `Semaphore` concept at batch granularity (max released batches dispatched concurrently). `throttle` (a second, independent `@studnicky/throttle` `Throttle` concurrency window wrapping item dispatch) is `mode: 'item'`-only, as it always was.

  **Migration:** `scatter.concurrency: N` → `scatter.execution: { mode: 'item', concurrency: N }`. `scatter.throttle: { concurrencyLimit }` → `scatter.execution: { mode: 'item', concurrency: N, throttle: { concurrencyLimit } }`. `scatter.reservoir: { keyField, capacity, idleMs? }` (with or without a sibling `scatter.concurrency`) → `scatter.execution: { mode: 'reservoir', concurrency: N, reservoir: { keyField, capacity, idleMs? } }`.

  `ScatterNodeDefaults.throttle(node)` is removed; `ScatterNodeDefaults.executionPolicy(node)` replaces it, returning a fully-resolved `ScatterExecutionPolicyType` (`{ mode: 'item', concurrency, throttle } | { mode: 'reservoir', concurrency, reservoir: { keyField, capacity, idleMs: number | null } }`) so callers never repeat an `?? default` guard. `ScatterExecutionOptionsType` (the wire `execution` shape) and `ScatterExecutionPolicyType` are new exports from `@studnicky/dagonizer/entities`. `DAGBuilder.scatter`'s `ScatterOptionsType` drops its flat `concurrency`/`reservoir` fields in favor of a single `execution?: ScatterExecutionOptionsType` option mirroring the wire shape.

  `ReservoirBufferOptionsType.reservoir.idleMs` is now `number | null` (was `number | undefined`) — the required-with-defaults counterpart of the wire schema's optional `idleMs`, resolved once by `ScatterNodeDefaults.executionPolicy` instead of `?? null` at every read site.

- `Dagonizer` now `implements` only `DagonizerInterface<TState>`; the eight internal engine-wiring interfaces (`DispatcherRelaySourceInterface`, `GatherSourceInterface`, `LeafExecutorSourceInterface`, `EmbeddedDagExecutorSourceType`, `BodyRunPortInterface`, `ScatterDispatchSourceInterface`, `NodeSchedulerSourceInterface`, `DagRegistrarSourceInterface`) are satisfied by a private engine-host object constructed once in the dispatcher's constructor and passed to `EngineComposer.compose` instead of `this`. No external consumer ever obtains a reference to that object.

  The following members are no longer public on `Dagonizer`: `relayFlowStart`, `relayFlowEnd`, `relayNodeStart`, `relayNodeEnd`, `relayError`, `relayPhaseEnter`, `relayPhaseExit`, `resolveContainer`, `hasContainers`, `nextCorrelationId`, `relayFor`, `bodyContext`, `nodeContext`, `runNodeOnState`, `runBodyNodes`, `runScatterNodes`, `executeDAGNode`, `withNodeTimeout`, and the `outputSchemaValidator` getter. The `dags`, `nodes`, `nodeIndex`, and `stateFactories` registries are no longer public mutable `Map` fields — `dispatcher.nodes.set(...)` and `dispatcher.dags.clear()` no longer compile. `accessor`, `stateMapper`, and `channels` are also no longer public fields.

  `DagonizerInterface` gains four narrow read-only accessors that cover every legitimate external read of the former Map fields: `hasNode(name): boolean`, `hasDag(name): boolean`, `nodeNames(): readonly string[]`, `dagNames(): readonly string[]`, and `getChildStateFactory(dagName): ChildStateFactoryType | undefined`. `getDAG`, `getNode`, `listDAGs`, `listNodes`, `registerDAG`, `registerNode`, `registerBundle`, `registerPlugin`, `execute`, `resume`, and `destroy` are unchanged. Consumers reading the former Map fields directly (e.g. `dispatcher.nodes.size`, `dispatcher.stateFactories.get(name)`) migrate to the new accessors (`dispatcher.nodeNames().length`, `dispatcher.getChildStateFactory(name)`).

  `EngineComposer.compose`'s `EngineHostType` parameter is unchanged in shape; `EngineBundleType` drops the `relayHooks` field, since the engine host now builds its own `DispatcherHooks` adapter internally rather than Dagonizer holding a copy for its (now-removed) `relayFor` method.

- `Clock`, `RealTimeScheduler`, and `RetryPolicy` now build on `@studnicky/clock`, `@studnicky/scheduler`, and `@studnicky/retry` instead of hand-rolled implementations.

  `Clock` is a thin static facade over a substrate `Clock` instance (`RealTimeClockProvider` by default). `ClockProviderInterface` now requires `now()` in addition to `hrtime()`, matching substrate's `ClockProviderType`. `RealTimeScheduler` subclasses substrate's `RealTimeScheduler`, adding the Promise/`AbortSignal` layer (`after`/`at`/`every`) this engine's `SchedulerProviderInterface` requires on top of substrate's callback-based `scheduleAt`. `testing/VirtualClock.ts` and `testing/VirtualScheduler.ts` (the `@studnicky/dagonizer/testing` deterministic-time doubles) are rebuilt on substrate's `VirtualClockProvider`/`VirtualScheduler` + `VirtualTimeCounter`, preserving their existing `tickNs`/`tickMs`/`advance`/`runUntil`/`runAll` test API.

  `RetryPolicy` now extends `@studnicky/retry`'s `Retry`, gaining its attempt-lifecycle FSM, `getStats()`/`resetStats()` request statistics, and observability hooks (`onAttempt`, `onSuccess`, `onRetryableError`, `onRetryScheduled`, `onGiveUp`) for subclasses to override. The declarative `strategy`/`baseDelay`/`maxDelay`/`multiplier`/`jitterFactor` backoff config and `retryOn`/`abortOn` error-constructor filters are unchanged; `RetryPolicy.run()` unwraps substrate's `MaxRetriesExceededError`/`NonRetryableError` wrapper types back to the original task error, so callers still catch the raw error. `RetryPolicy.run()` no longer schedules its backoff delay through the injected `Scheduler` — delays now go through substrate's `Retry`, which uses a real timer directly. `entities/runtime/BackoffStrategy.ts`'s schema-derived string enum is unchanged; substrate's own `BackoffStrategyType` is a function type, not a JSON-serializable wire value, so it does not replace this entity.

  `package.json` gains `@studnicky/clock`, `@studnicky/scheduler`, and `@studnicky/retry` as dependencies.

- `SignalComposer` is removed; the engine now depends on `@studnicky/signal`'s `Signal` class for `AbortSignal` composition. `Signal.compose(options)` never returns `null` — it falls through to `Signal.never()` (a cached, never-aborting `AbortSignal`) when neither `signal` nor `deadlineMs` is supplied, and validates `deadlineMs` (throws `SignalError` on negative/`NaN`).

  Every public method that previously accepted or returned `AbortSignal | null` because of `SignalComposer.compose`'s old nullable contract now works with a plain `AbortSignal`: `Dagonizer.bodyContext`, `Dagonizer.nodeContext`, `Dagonizer.withNodeTimeout`, `Dagonizer.executeDAGNode`, and the corresponding fields on `NodeSchedulerSourceInterface`, `LeafExecutorSourceInterface`, `GatherSourceInterface`, `ScatterDispatchSourceInterface`/`ScatterDispatchAdapterInterface`, `BodyRunPortInterface`, `NodeInvokerSourceInterface`, and `GatherExecutionType.signal`. A run with no caller-supplied cancellation surface carries `Signal.never()` end-to-end instead of `null`; consumers implementing these ports no longer need a null-check before forwarding a signal.

  `@studnicky/dagonizer/runtime` no longer exports `SignalComposer`. Consumers that imported it directly should import `Signal` from `@studnicky/signal` instead: `Signal.compose(options)` and `Signal.never()` are drop-in replacements for `SignalComposer.compose` (adjusted for the never-null contract) and `SignalComposer.never()`.

- `entities/json.ts`'s `JsonObject.is` and `entities/JsonValue.ts`'s `JsonValue.from()` now delegate to `@studnicky/types`'s `Guard`/`JsonValue` statics instead of a hand-rolled `typeof value === 'object' && value !== null && !Array.isArray(value)` check and a hand-rolled recursive coercion. Behavior is unchanged. `runtime/DottedPathAccessor.ts`'s dot-notation `get`/`set` now delegate to `@studnicky/json`'s `Path`, which also enforces the same prototype-pollution guards.

  `package.json` gains `@studnicky/types` and `@studnicky/json` as dependencies.

- `DagLoggerInterface` (`src/ObservedDag.ts`) now uses `@studnicky/logger`'s structured call shape instead of plain strings: `trace(body)`, `debug(body)`, `info(body)` take a built `LogBodyDataType`, and `error(fault)` takes a built `LogFaultDataType`. A real `@studnicky/logger` `Logger` instance satisfies `DagLoggerInterface` directly with no adapter. `ObservedDag`'s lifecycle hooks (`onFlowStart`, `onFlowEnd`, `onNodeStart`, `onNodeEnd`, `onError`, `onPhaseEnter`, `onPhaseExit`) build each log entry via `LogBody.create()`/`LogFault.create()`, mapping `component: 'dag'`, an `operation` per hook family (`flow`, `node`, `phase`), a lifecycle `status` (`in_progress`/`complete`/`failed`), a human-readable `message`, and structured `context` (`dagName`, `nodeName`, `placementPath`, `outcome`, `phase`, `placementName`, `output`).

  `package.json` gains `@studnicky/logger` as a dependency.

- `DAGError` now extends `@studnicky/errors`'s `ModuleError` instead of `Error` directly, gaining cause-chain traversal (`findCauseOfType`, `getCauseChain`, `hasCauseOfType`) and a `retryable: boolean` classification. Dagonizer's error taxonomy collapses to this ONE class: `ConfigurationError`, `ExecutionError`, `NotFoundError`, `ValidationError`, and `NodeTimeoutError` are removed. Every site that threw one of those now throws `DAGError` with the same `code` string the subclass used to fix (`CONFIGURATION_ERROR`, `EXECUTION_ERROR`, `NOT_FOUND_ERROR`, `VALIDATION_ERROR`, `NODE_TIMEOUT`) — callers distinguish by `error.code`, not `instanceof` on a subclass. `NodeTimeoutError`'s `nodeName`/`timeoutMs` fields fold into `context: { nodeName, timeoutMs }`; a `NODE_TIMEOUT` error also carries `retryable: true` (a node timeout is frequently transient). `ExecutionError.ofSignal(signal)` moves to `DAGError.ofSignal(signal)`, unchanged otherwise. `DagContainerError` is removed the same way — `DagContainerBase` throws `DAGError` with code `DAG_CONTAINER_ERROR`. `DAGError`'s constructor signature is `(message, { code?, context?, cause?, retryable?, statusCode? })` — `code` defaults to `'DAG_ERROR'`, `context` defaults to `{}` (never `undefined`, per this repo's required-with-defaults rule). `DAGErrorInterface` and the `DAGErrorJSON` wire schema are removed — `DAGError.toJSON()` is `ModuleError`'s own serialization (`code`, `message`, `name`, `retryable`, `stack`, plus `context`/`statusCode`/`cause` when present); there was no persistence boundary reconstructing a `DAGError` from its old bespoke JSON shape, so nothing round-trips it.

  `RetryPolicy`'s `retryOn`/`abortOn` filters accept a new `ErrorMatcherType` (`ErrorConstructorType | string`): an error constructor (matched via `instanceof`, for a consumer's own error classes) or a `DAGError` code string (matched via `error instanceof DAGError && error.code === matcher`), since Dagonizer's own errors are no longer distinguishable by constructor identity.

  `package.json` gains `@studnicky/errors` as a dependency.

- `DAGLifecycleMachine` now builds on `@studnicky/fsm`'s `StateMachine` instead of a hand-rolled reducer. The lifecycle transition logic lives on `DAGLifecycleMachineReducer`, a real `StateMachine<DAGLifecycleStateType, DAGLifecycleEventType, never>` subclass whose `reduce()` throws for terminal-state stickiness and illegal active-state transitions instead of returning the input state by reference. `DAGLifecycleMachine` is a thin static facade over one module-level `DAGLifecycleMachineReducer` singleton, matching the `Clock`/`Scheduler` static-facade pattern; `initial()`, `transition()`, `isTerminal()`, and `isParked()` keep their existing signatures and call sites. `NodeStateBase.#dispatch` now catches the thrown transition error and re-throws the same `DAGError` message it always has, so no behavior is visible to consumers of `NodeStateBase`.

  `package.json` gains `@studnicky/fsm` as a dependency.

- `ScatterWorkerPool` now bounds scatter-node concurrency with `@studnicky/concurrency`'s `Semaphore` instead of a hand-rolled slot counter. The pool builds one `Semaphore` (`Semaphore.builder().withPermits(concurrencyLimit).build()`) in its constructor and drives the pull loop by `acquire()`ing a permit before each pull and calling the returned release function once an item's execute+ack cycle settles; the internal `#activeWorkers` counter and `#slotResolve`/`#waitForSlot`/`#releaseSlot` methods are removed. The pull loop re-checks accumulated worker errors and the abort signal immediately after each `acquire()` resolves — not only at loop entry — so a worker error recorded while an iteration was queued for a permit is observed before another item is pulled. `ScatterWorkerPool`'s public constructor and `drain()`/`errors` surface are unchanged.

  `package.json` gains `@studnicky/concurrency` as a dependency.

- `ReservoirBuffer` (the reservoir-mode scatter execution path) now bounds concurrent batch dispatch with the same real `@studnicky/concurrency` `Semaphore` `ScatterWorkerPool` uses, instead of its own hand-rolled `#activeWorkers` counter and `#slotResolve`/`#waitForSlot`/`#releaseSlot` promise. Every batch dispatch — pull-loop capacity release, idle-timer release, complete-flush release, and resume replay (`replayBuffers`) — now acquires a `Semaphore` permit before executing and releases it once the batch settles, so `concurrencyLimit` is a hard cap on concurrently in-flight batches everywhere, including resume replay and idle-timer releases (previously those two paths could burst past the limit). `ReservoirBuffer`'s public constructor and `drain()` surface are unchanged.

- `@studnicky/dagonizer/progress`'s `EventBus` now extends `@studnicky/event-bus`'s `EventBus` instead of a hand-rolled synchronous pub/sub map. Every topic carries a `BusEventEnvelopeType<unknown>` payload; `publish(topic, payload)` wraps the payload in an envelope and delegates to the inherited typed async pub/sub, so `publish` and `subscribe`'s `close`/`drain` all return `Promise<void>`. Delivery goes through a per-subscriber `BusQueue` — a bounded FIFO with a high-water mark — so a slow subscriber's `publish()` call applies backpressure (the returned promise stays pending until the queue has room) instead of delivering synchronously with no bound.

  `EventBus.of()` replaces `new EventBus()` (the base class's constructor is `protected`, matching the `@studnicky/event-bus` factory convention). `EventBus.dispose()` is renamed `close()` (async, matching the base class). `EventBus.clear(topic)` is removed — unsubscribe the individual handlers returned by `subscribe()` instead; there is no bulk per-topic clear on the substrate base class.

  `BusObserver`'s lifecycle hooks (`onFlowStart`, `onNodeStart`, etc.) stay synchronous per `DispatcherObserverType`; each now fires a fire-and-forget `bus.publish(...)` rather than a synchronous delivery.

  `BroadcastChannelRelay`'s inbound handler now awaits the republish before releasing its `#suppressOutbound` echo-suppression flag, so every subscriber queue (including the relay's own outbound subscription) observes the flag before it resets.

  `package.json` gains `@studnicky/event-bus` as a dependency.

- `DagExecutionContext` provides per-execution correlation tracking (a fresh correlation id and the running DAG's name, readable from any node body or lifecycle hook during a run) via a graph-backed scope keyed by object identity, not ambient/continuation-local state. Every `Dagonizer.execute()`/`resume()`/`executeBatch()` call composes its own root `AbortSignal` (never the same object as a concurrent call's, even when no caller `signal`/`deadlineMs` is supplied) and registers it as the anchor for a fresh scope; reading context anywhere — a node body via `NodeContextType.signal`, or an observability hook via the `signal` it now receives — is `DagExecutionContext.tryGet(signal, key)`, an object-identity lookup into a small internal quad store (using this engine's own `TripleStoreInterface` shapes) followed by a `parentScope` walk. This is correct under any `await` timing and any level of concurrent/interleaved `Execution`s, including reads that happen after a node's own internal `await` — the one case ambient "current scope" tracking cannot guarantee. `DagExecutionContext.tryGet()`'s signature is `tryGet(signal: AbortSignal, key: string)`, not `tryGet(key: string)`. No dependency on `@studnicky/context` or `node:async_hooks` anywhere in the design, so browser bundles (`docs:build`, `dagonizer-executor-web`) are unaffected.

  Every dispatcher lifecycle hook (`onFlowStart`, `onFlowEnd`, `onNodeStart`, `onNodeEnd`, `onError`, `onPhaseEnter`, `onPhaseExit`) — the protected `Dagonizer` overrides, `DispatcherObserverType`'s muxed-observer callbacks, and `ObserverRelayInterface`'s container/worker relay boundary — now receives the run's `AbortSignal` as an additional trailing parameter, the anchor `DagExecutionContext.tryGet` resolves against. `ObservedDag`'s lifecycle hooks read `correlationId`/`dagName` through it; `onNodeStart`/`onNodeEnd`/`onError` also read `dagName` from the same context, since the dispatcher does not pass `dagName` as a hook argument at that level.

  A scope's bindings are released explicitly when its `Execution` completes or is abandoned early (`Execution`'s internal generator terminates the scope in a `finally` block), cascading to every nested/embedded child scope created under it. A capacity-bounded (`LruCache`-backed, matching `MemoryCheckpointStore`'s bounding pattern) root-scope registry is a backstop against any missed explicit cleanup, evicting the least-recently-created root (and its descendants) once the cap is exceeded.

  `package.json` does not depend on `@studnicky/context`.

### Patch Changes

- `ReservoirBuffer` narrows its `reservoir.idleMs` construction option to the reified `Timeout` entity once, at construction (`Timeout.ofWire(options.reservoir.idleMs ?? null)`), instead of carrying the raw `number | undefined` through every idle-timer code path. `#armIdleTimer`'s guard and `#idleAbort`'s "is an idle budget configured" check both read `Timeout`'s `.ms`/`.isNone` accessors, aligning the idle-release "give up and release the partial batch" concept with the same `Timeout`/`Timeout.none()` semantic `MonadicNode.timeout` and `DagTaskInterface.timeout` already use for per-operation time budgets. `ReservoirBufferOptionsType`'s public shape (`reservoir: { keyField, capacity, idleMs? }`) and `ReservoirBuffer`'s constructor/`drain()` surface are unchanged — internal representation only.

### Minor Changes

- `RetryPolicy.shouldRetry(error, attempt)` now consults `DAGError.retryable` instead of ignoring it, so the framework's three failure-handling mechanisms (`RetryPolicy`'s `retryOn`/`abortOn` filters, `BaseAdapter`'s opt-in circuit breaker/token bucket, and `DAGError.retryable`) form one coherent precedence instead of three disconnected signals. Order: an explicit `abortOn` match always stops retrying (consumer-authoritative override, even against a `DAGError` that self-reports `retryable: true`); a configured `retryOn` list is the sole authority when present (a miss stops retrying); only when NO `retryOn` filter is configured does a `DAGError` fall back to its own `error.retryable` field, replacing the old unconditional "no filter = retry everything" default. A non-`DAGError` error with no filters configured is unaffected and still retries.

  **Behavior change:** a `DAGError` constructed with `retryable: false` (the schema default) and retried under a `RetryPolicy`/placement `retry` config with no `retryOn`/`abortOn` filters previously WAS retried by default; it is now NOT retried — the error's own "don't retry me" classification is honored instead of silently ignored. A `DAGError` with `retryable: true` and no filters keeps retrying, as before.

  `RetryPolicy`'s class doc gains a documented (non-enforced) guidance example for wrapping `BaseAdapter.chat()` in an OUTER `RetryPolicy`: configure `abortOn: [CircuitBreakerOpenError, TokenBucketExhaustedError]` (both re-exported from `@studnicky/dagonizer/adapter`) so the outer policy fails fast on an already-open circuit or exhausted bucket instead of hammering it with further attempts — `BaseAdapter`'s own internal retry loop is unaffected; this is guidance for a consumer's own external retry wrapper, not a new default. The Retry guide documents the full resilience story: retry, circuit-breaking, and rate-limiting are three distinct concerns that compose in a fixed order (circuit → bucket → retry) inside `BaseAdapter.chat()`.

- `LlmAdapterInterface.chatStream(request, sink)` adds a streaming seam over `StreamSinkInterface<ChatStreamChunkType>`. `BaseAdapter` ships a provider-agnostic buffered default: one full `chat()` call, then a single chunk pushed to the sink. Concrete streaming adapters override `performChatStream` to push incremental deltas as they arrive.
- New `ChatStreamChunk` entity (`ChatStreamChunkSchema` + `ChatStreamChunkType` + `ChatStreamChunkBuilder.of`) carries one incremental text delta from a streaming chat call.
- New `ReasoningStep` entity (`ReasoningStepSchema` + `ReasoningStepType` + `ReasoningStepBuilder`) models one step — `thought` / `action` / `observation` / `final` — of an agent's reasoning trace as a discriminated union.
- New `ReasoningTraceItem` entity (`ReasoningTraceItemSchema` + `ReasoningTraceItemType` + `ReasoningTraceItemBuilder`) pairs a `ReasoningStepType` with a monotonic `ordinal`, so a streamed step is self-describing — a downstream consumer can derive a `wasInformedBy`-style chain from `ordinal - 1` with no cross-item state.
- New `AgentTraceProducer`, a `DagStreamProducer<ReasoningTraceItemType>` subclass, streams a running agent loop's node results as ordinal-tagged `ReasoningTraceItemType` items via a fixed node-name → reasoning-kind dispatch map. The ordinal increments only for emitted items, so the sequence stays contiguous. Consumers extend it and implement `describe(stage)` to supply each step's text.
- `CallModelNode` streams its model call via `chatStream`, taking an optional `sink` in its constructor options (`StreamSinkInterface<ChatStreamChunkType>`) that defaults to a no-op `NullStreamSink` when omitted.
- New `SseLineParser`, a shared isomorphic Server-Sent-Events framer: decodes a `ReadableStream<Uint8Array>` into `SseFrameType` frames (`event:`/`data:` accumulation, blank-line flush, `:`-comment skip, multi-`data:` join) over Web Streams + `TextDecoder` only, so it runs unchanged in Node and the browser. `OpenAiCompatibleAdapter` overrides `performChatStream` to POST with `stream: true` and drain the response body through `SseLineParser`, pushing one `ChatStreamChunkType` per non-empty delta; a request carrying tools still falls back to the buffered default.
- New `RoutedChatStreamChunk` entity (`RoutedChatStreamChunkSchema` + `RoutedChatStreamChunkType` + `RoutedChatStreamChunkBuilder.of`) tags one streamed text delta with a `routeKey` and its originating `{dagName, nodeName}` source. New `RoutingStreamSink` decorates the per-execution sink handed to `adapter.chatStream`, forwarding each plain `ChatStreamChunkType` push to a shared downstream sink as a stamped `RoutedChatStreamChunkType`. `CallModelNode` gains an overridable `routeKey(state)` seam (default `''`) and constructs a fresh `RoutingStreamSink` for each item it executes, so ONE shared sink — for example a `StreamChannel<RoutedChatStreamChunkType>` feeding a routing DAG that scatters by `routeKey` — correctly demultiplexes many concurrent runs sharing a single node instance.
- `MemoryCheckpointStore` now backs its entries with `@studnicky/cache`'s `LruCache<string, string>` instead of a bare `Map`, so a long-running process that never explicitly deletes checkpoints stops growing this in-process store without bound. Capacity defaults to `DEFAULT_CHECKPOINT_CAPACITY` (500 distinct checkpoint keys) and is configurable via `new MemoryCheckpointStore({ capacity })`; `MemoryCheckpointStore.defaultOptions` exposes the resolved default. `save`/`load`/`delete` keep their existing async signatures. `MEMORY_CHECKPOINT_STORE_DEFAULTS` and `MemoryCheckpointStoreOptionsType` are new exports from `@studnicky/dagonizer/checkpoint`.

  `package.json` gains `@studnicky/cache` as a dependency.

- `BaseAdapter.chat()` gains opt-in circuit breaking and rate limiting, configured per adapter instance via the `circuitBreaker` and `tokenBucket` fields on `BaseAdapterOptionsType`. Both accept a real `@studnicky/resilience` instance directly — `CircuitBreaker` and `TokenBucket` — used as-is, with no Dagonizer-specific wrapper; `null` (the default for both) disables the capability, so existing adapter construction call sites keep compiling and behaving unchanged. When configured, both guards wrap OUTSIDE the retry loop: the circuit breaker outermost (an open circuit rejects with `CircuitBreakerOpenError` before any attempt or token consumption), the token bucket next (`consume()` throws `TokenBucketExhaustedError` before the retry-wrapped attempt runs). A call rejected by an open circuit consumes no rate-limit token. `CircuitBreaker`, `CircuitBreakerOpenError`, `TokenBucket`, and `TokenBucketExhaustedError` are re-exported from `@studnicky/dagonizer/adapter` for ergonomic co-import with the adapter constructor that consumes them.

  `package.json` gains `@studnicky/resilience` as a dependency.

- `ScatterNode` gains an opt-in `throttle: { concurrencyLimit }` option (`null` when absent — the default, unchanged behavior) backed by `@studnicky/throttle`'s `Throttle`. On the non-reservoir scatter path, `ScatterWorkerPool` wraps `driver.executeItem` dispatch through an owned `Throttle` instance when `throttle` is set, as a second concurrency window independent of the existing `concurrency` `Semaphore` gate — the semaphore still caps how far the pull loop runs ahead of dispatch capacity; the throttle, when present, additionally paces the actual item-execution calls. `Throttle`'s own "sliding window" is a concurrency window (like `Semaphore`), not a wall-clock rate window — there is no `operationsPerWindow`/`windowMs` field on the underlying `@studnicky/throttle` package, so `throttle` is intentionally scoped to `concurrencyLimit`. The reservoir scatter path does not wire `throttle`: batch dispatch size varies with capacity/idle/flush triggers, so a per-batch throttle would gate a variable-size unit rather than the discrete per-item work `throttle` targets on the non-reservoir path; only `concurrency` (the `Semaphore`) gates batch dispatch there.

  `ScatterNodeDefaults.throttle(node)` resolves the option, defaulting to `null`. `ScatterThrottleOptionsType` is exported from `@studnicky/dagonizer/entities`.

  `package.json` gains `@studnicky/throttle` as a dependency.

- `MonadicNode.permissiveSchema(outputs)` builds a `{ type: 'object' }` `outputSchema` entry for every listed output name, so nodes that don't need per-port validation write `override get outputSchema() { return MonadicNode.permissiveSchema(this.outputs); }` instead of hand-writing the boilerplate record literal.

- `DAGBuilder.scatter`'s `gather` option is now optional on `ScatterOptionsType`, defaulting to `{ strategy: 'discard' }` (side-effect-only fan-out) when omitted. The default is materialised in `ScatterOptions.resolve` alongside the existing `itemKey`/`reducer` defaults and exported as `SCATTER_GATHER_DEFAULT` from `@studnicky/dagonizer/builder`.

### Patch Changes

- `ContextResolver.isContext`, `ToolInvocationState.isArgumentRecord`, and `NodeStateBase.restoreFields`'s `'array'`/`'object'` field restorers now call `@studnicky/predicates`'s `Predicates.matchesType` directly instead of a hand-rolled `typeof value === 'object' && value !== null && !Array.isArray(value)` check. Behavior is unchanged; these are the primitive type-guard sites in `src/` whose result is used as a plain boolean rather than feeding TypeScript's control-flow narrowing for later property access, so a direct `Predicates` static call drops in with no wrapper.

- `GatherStrategies` and `OutcomeReducers` now extend a shared `Registry<TEntry>` base (`src/core/Registry.ts`, re-exported from `@studnicky/dagonizer/core`) instead of each hand-rolling an identical named-strategy registry. `Registry` captures `register`/`replace`/`unregister`/`reset`/`resolve`/`list` and the duplicate-registration guard once, parameterised over the entry type and the built-in set plus label strings each subclass supplies for its error messages. `GatherStrategies` and `OutcomeReducers` are now singleton instances of a private `Registry` subclass rather than static classes with a private constructor; their public call sites, method signatures, and error messages are unchanged.

  `package.json` gains `@studnicky/predicates` as a dependency.

- `DAGError` gains three static helpers consolidating catch-clause error handling duplicated across the codebase: `DAGError.coerce(cause)` normalises an unknown catch value into an `Error`, wrapping non-`Error` causes in a `DAGError` (code `EXECUTION_ERROR`); `DAGError.messageOf(error)` extracts a message string from an unknown catch value; `DAGError.isTimeout(reason)` reports whether a rejection reason is an `Error` named `TimeoutError`. `src/patterns/agent/*.ts` (`BuildChatRequestNode`, `AppendAssistantNode`, `CollectToolResultsNode`, `DecodeTextToolCallsNode`, `CallModelNode`, `NormalizeResponseNode`, `BuildToolWorksetsNode`, `NormalizeToolCallsNode`), `src/checkpoint/Checkpoint.ts`, `src/dag/DAGDocument.ts`, and `src/container/DagHost.ts` now call `DAGError.coerce`/`DAGError.messageOf` instead of their own inline `instanceof Error` ternaries. Behavior is unchanged.

### Minor Changes

- `DagExecutionContext` gains two static shorthands for its two well-known reserved keys: `DagExecutionContext.correlationIdOf(signal)` and `DagExecutionContext.dagNameOf(signal)`, equivalent to `tryGet(signal, DagExecutionContextKeys.CORRELATION_ID)` / `tryGet(signal, DagExecutionContextKeys.DAG_NAME)` but discoverable directly off the class without importing `DagExecutionContextKeys`. `ObservedDag` now calls these instead of duplicating the `tryGet` + key lookup inline. `NodeContextType`'s doc comment points node authors at `context.signal` plus this shorthand instead of adding a `correlationId` field to the type itself — the value depends on external mutable scope state resolved at read time, which would defeat the type's fixed-key-order V8 shape guarantee if captured once at construction.

### Patch Changes

- `NodeScheduler` now enriches every node-firing error it catches (both the `SingleNode` path and the composite `ScatterNode`/`EmbeddedDAGNode` path) with structured `context`: `dagName`, `placementPath`, and — when the run has a registered `DagExecutionContext` scope — `correlationId`. Previously the wrapped `DAGError`'s `context` was always `{}`. `DAGError.context` is set once at construction and is not writable after, so enrichment constructs a NEW `DAGError` (via `DAGError.coerce(caughtError)` first, then wrapping) with the coerced error attached as `cause`, preserving `code`/`retryable` and any context the coerced error already carried (e.g. a `NODE_TIMEOUT` error's `nodeName`/`timeoutMs`) underneath the added fields.

- `LeafExecutor`'s "Unknown node" error (thrown when a `SingleNode` placement references a node name that was never `registerNode`'d) now lists up to 5 of the currently registered node names and points at `dispatcher.registerNode(...)`, instead of naming only the missing reference with no further context.

- `Dagonizer`'s class-level doc comment and its no-op observability-hook section now point at `ObservedDag` as the ready-made structured-logging subclass, so a consumer who wants logs without hand-writing every lifecycle hook override can discover it directly from `Dagonizer`'s own docs. No behavior change — a bare `Dagonizer` remains silent by default.

## 0.29.1

### Patch Changes

- 6bdafa4: `BaseAdapter.selectChatModel()` now prefers a fully-local model when auto-selecting the cheapest chat model. A cloud-routed model (e.g. Ollama's `:cloud`/`-cloud` tags) reports a near-zero local footprint, so it ranks cheapest by `costRank` and was being auto-selected — but it needs a provider subscription and fails without one. The cheapest-fallback now picks from the non-`cloud` models when any exist, only falling back to a cloud model when no local chat model is installed. An explicit in-catalogue `preferred` model still wins regardless of its `cloud` flag.

## 0.29.0

### Minor Changes

- 23ec54b: Add the `CloudEmbedder` taxonomy for the REST cloud embedders.

  `CloudEmbedder extends BaseEmbedder` is the cloud sibling of `LocalModelEmbedder` (mirroring how `OpenAiCompatibleAdapter` sits under `BaseAdapter`). It implements `performEmbed` once — build request → `fetchJson` → parse — behind `endpoint()`/`requestInit(text)`/`vectorFrom(body)` seams. The gemini-api, mistral, and ollama embedders migrate onto it, each reduced to its provider's endpoint, headers, body, and response shape. No wire-behavior change.

- 23ec54b: Add the `LocalModelEmbedder<TModule, TModel>` taxonomy and run the on-device embedders fully offline.

  `LocalModelEmbedder` is an abstract intermediate under `BaseEmbedder` (mirroring how `OpenAiCompatibleAdapter` sits under `BaseAdapter`) that centralizes the on-device lifecycle the three local embedders duplicated: a memoized module load plus shape-stable model-handle build, `connect`/`disconnect`/`performEmbed`, and the `loadModule`/`spawnModel`/`embedWith` seams. The transformers, TensorFlow.js, and WebLLM embedders migrate onto it, and each CDN `import('https://esm.run/...')` is replaced with a bundled npm dependency (`@huggingface/transformers`, `@tensorflow-models/universal-sentence-encoder` + `@tensorflow/tfjs`, `@mlc-ai/web-llm`) so the libraries resolve from `node_modules` — no runtime CDN, bundler-friendly, node-resolvable.

  `TransformersEmbedder` additionally loads its model fully offline: it forces transformers.js onto local-only resolution (`env.allowRemoteModels = false`, `env.localModelPath` at the package's vendored `models/` directory) and loads the quantized ONNX weights (`dtype: 'q8'`), with no Hugging Face hub fetch at runtime. The `Xenova/all-MiniLM-L6-v2` weights are vendored by a `fetch-model` script (wired as `prebuild`/`pretest`) into a git-ignored `models/` dir. `localModelPath` and a new `wasmPaths` option are overridable per instance so a consumer can serve the model + onnxruntime WASM from its own bundle.

### Patch Changes

- 23ec54b: Enforce a single shared hard abort+timeout race in `BaseAdapter.chat()` so every adapter — cloud and in-browser — inherits identical cancellation semantics. The base now wraps `performChat()` in a guard that folds a per-request timeout and the caller's `AbortSignal` into one composed signal, passes it through to `performChat`, and rejects the instant that signal aborts even when the underlying operation never settles. A frozen in-browser stream or a hung socket therefore always rejects within the configured ceiling instead of hanging the caller.

  The timeout is configurable via the existing `timeoutMs` adapter option (module-level default 60 000 ms). A new protected `onCancelRequested()` hook gives subclasses a best-effort cooperative-cancel seam; `WebLlmAdapter` overrides it to call `engine.interruptGenerate()`. The HTTP adapters (`OpenAiCompatibleAdapter` and its `ollama` subclass, gemini-api, anthropic) drop their per-adapter timeout machinery and forward `request.signal` directly to `fetch`; the on-device `gemini-nano` adapter forwards it to `lm.create()`/`session.prompt()`. `WebLlmAdapter` no longer enforces its own timer; correctness comes from the base. Public adapter APIs, capabilities, and schemas are unchanged.

## 0.28.1

### Patch Changes

- fc7021e: Fix: self-loop edges (retry/parked) render as visible loops instead of being skipped with 'invalid endpoints'. `CytoscapeRenderer.placementEdges` tags edges where source === target with a `self-loop` class; `CytoscapeGraph.stylesheet` adds an `edge.self-loop` rule with `curve-style: bezier` that overrides the base `round-taxi` style, which cannot draw self-loops.

## 0.28.0

### Minor Changes

- 6ed7c12: Adds an isomorphic browser substrate: three new store packages (`dagonizer-store-indexeddb`, `dagonizer-store-opfs`, `dagonizer-store-webstorage`) provide durable, DOM-lib-free browser persistence via IndexedDB, Origin Private File System, and Web Storage respectively. Each ships a `BaseStore` subclass and a paired `CheckpointStoreInterface` implementation; access to browser globals uses `Reflect.get(globalThis, …)` + structural type-guard predicates — no `as` casts, no DOM lib dependency.

  The store port gains a streaming snapshot/restore seam (`snapshotStream` / `restoreStream`) as `AsyncIterable` paths on `SnapshottableInterface`; `BaseStore` provides concrete implementations built on new abstract hooks `performEntriesStream`, `performRestoreEntry`, and `performClear`. All existing store subclasses are migrated.

  The streaming-producer→scatter path is unified into a single engine dispatch: producers feed `ScatterNode` through one code path regardless of sync or async source. `StreamChannel.resumable` and `StreamCursor.resumeAfter` (cursor = pull count) cover caller-driven resume of async streams.

  `BaseAdapterOptionsType` gains a `systemPrompt` field: a consumer-supplied default the base injects as the leading message of any chat request that carries no system message. Leading position is load-bearing for on-device backends (Chrome Prompt API, MLC WebLLM). `OpenAiCompatibleAdapter` and its static preset factories (`groq`, `cerebras`, `mistral`, `openRouter`) accept and forward the same option.

  Every LLM adapter now uniformly exposes both `systemPrompt` and a per-request `timeoutMs` (default 60s). The HTTP adapters (`anthropic`, `gemini-api`, `ollama`, and the OpenAI-compatible presets) enforce the deadline around the network request; the on-device adapters enforce it around generation — `gemini-nano` composes the timeout into the `LanguageModel.create()`/`session.prompt()` abort signal, and `web-llm` races the non-cancellable MLC generation against the deadline. An expired deadline surfaces as a `TIMEOUT` classification so a cascade falls through instead of hanging.

  Per-placement retry is wired: `SingleNodePlacementType.retry` (a `RetryPolicyOptionsType`) wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(…)` with the node abort signal threaded through. `DAGBuilder.node()` accepts a trailing options object with `retry`.

  `executor-node` and `executor-web` add `"node"` and `"browser"` export conditions respectively for bundler target selection. `dagonizer-book-entities` entity types carry a mandatory `Type` suffix (`BookType`, `MoneyType`, …), and `CanonicalId` is a sealed static class whose canonical materializer is `CanonicalId.ofIsbns`. `dagonizer-patterns-flow` `FlowNode` is parameterized by `<TState, TOutput>`, with services injected through the node constructor.

  A CI guard script (`scripts/check-fixed-group.ts`) enforces that the changeset fixed group matches the full set of publishable workspace packages.

## [unreleased]

### Minor Changes

- **Streaming snapshot/restore seam on the store port (S-P1).** `SnapshottableInterface` gains two new methods: `snapshotStream(options?)` yields the full keyspace as an `AsyncIterable<StoreSnapshotEntryType>` and `restoreStream(entries, options?)` applies entries as an upsert without clearing first. `BaseStore` provides concrete implementations of both built on new abstract hooks `performEntriesStream()`, `performRestoreEntry(entry)`, and `performClear()`. The existing array-form `snapshot()` drains the stream; `restore()` calls `performClear()` then per-entry `performRestoreEntry()` — replacement semantics are preserved. Both new streaming methods honor `options.signal?.throwIfAborted()` between entries. Subclasses migrated: `MemoryStore`, `SqliteStore` (`dagonizer-store-sqlite`), `RdfStore` (`dagonizer-patterns-graph`), `EventLogStore` (`dagonizer-store-eventlog`).
- **Per-placement retry wiring (S-P2).** `SingleNodePlacementType` carries a `retry` field (`RetryPolicyOptionsType`). When set, the dispatcher wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(...)` with the node abort signal threaded through — aborted runs do not continue retrying. A node that routes to `'error'` is not retried (routing is not a throw). `DAGBuilder.node()` accepts a trailing options object with `retry` to author retry policies via the typed builder. `NO_RETRY` (`maxAttempts: 1`) is the default when `retry` is absent.
- **`PluginSpecifier` default resolvers (S-K2).** `PluginSpecifier.bareName` is the Node.js default resolver — it returns the bare npm package name unchanged and can be passed directly as the `resolveSpecifier` argument to `PluginDiscovery.loadAll`. `PluginSpecifier.rootedAt(baseUrl)` is the browser resolver factory — it returns a `(name) => string` resolver that maps bare names to absolute ESM URLs under `baseUrl` and passes through names that are already absolute URLs. Exported from `./plugin` subpath and root barrel.
- **`BroadcastChannelRelay` (S-A3).** DOM-free cross-context `EventBus` bridge: subscribes to an `EventBus` and relays events over a `BroadcastChannel`, and republishes inbound channel messages back onto the local bus (echo-suppressed). The `BroadcastChannel` global is reached via `Reflect.get` plus a `BroadcastChannelGlobal.is` structural type-predicate guard — zero DOM-lib dependency. `BroadcastChannelRelay.of(bus, topics, channel)` accepts an already-constructed channel; `BroadcastChannelRelay.open(bus, topics, name)` resolves from `globalThis`. Exported from `@studnicky/dagonizer/progress`.
- **`BaseAdapter` default-system-prompt seam.** `BaseAdapterOptionsType` (exported from `./adapter`) extends the core options with `systemPrompt`: a consumer-supplied default the base injects as the leading message of any chat request that carries no system message of its own — never overriding an explicit system turn, never producing a second one, no-op when unset (`''`). The engine owns no persona; a consumer frames role/format/language once at construction and the adapter stays backend plumbing. Leading position is load-bearing: the on-device backends (Chrome Prompt API, MLC WebLLM) reject a system message at any non-zero index. `OpenAiCompatibleAdapter` and its `groq`/`cerebras`/`mistral`/`openRouter` static factories accept and forward the same `systemPrompt` option.
- **`OpenAiCompatibleAdapter` request budget + timeout fidelity.** `#sendRequest` forwards `request.maxTokens` to each preset's native token field (`max_completion_tokens` for `groq`/`cerebras`, `max_tokens` for `mistral`/`openRouter` and Ollama), and enforces the `timeoutMs` deadline (default 60s) around the `fetch` via an internal `AbortController` whose abort reason is a `TIMEOUT`-classified `LlmError`. The `fetch` catch now re-throws an already-classified `LlmError` unchanged and routes only genuine transport failures through `LlmError.ofNetworkError` — so an expired deadline surfaces as `TIMEOUT` (a cascade falls through) instead of being downgraded to `NETWORK`.

## 0.27.0

### Minor Changes

- 54252c9: BusObserver: bridges Dagonizer lifecycle hooks (via the observers option) to an
  EventBus topic. Construct with (bus, topic); pass in DagonizerOptionsType.observers[].
  Every lifecycle event is published as a DagLifecycleEventType payload. Pairs with
  SseStream to stream pipeline progress to HTTP clients.
- 9902b59: OpenAiCompatibleAdapter gains four static factory methods: .groq(apiKey, options?),
  .cerebras(apiKey, options?), .mistral(apiKey, options?), .openRouter(apiKey, options?).
  These replace the separate dagonizer-adapter-groq, dagonizer-adapter-cerebras,
  dagonizer-adapter-mistral, and dagonizer-adapter-openrouter packages which are removed.

  Migration: replace `new GroqApiAdapter(key)` with `OpenAiCompatibleAdapter.groq(key)`;
  similarly for Cerebras, Mistral, and OpenRouter. All options that the removed adapters
  accepted (model, referer, title, timeoutMs) are available on the factory options object.

- 54252c9: DAGBuilder.placeholder(name, outputs, routes) adds a PlaceholderNode stub in one call.
  PlaceholderNode routes unconditionally to its first output; replace with a concrete
  MonadicNode subclass when ready.
- 54252c9: DAGDocument.load() and DAGDocument.ofValue() accept an optional overrides object merged
  before validation — enables config-driven topology parameterization without mutating the
  source document. registerDAG no longer runs a redundant schema validation pass; the
  semantic validation (entrypoint, node references, routing completeness) is unchanged.
- d7eb8bc: First-class HITL park-and-correlate primitive. A node that routes to the
  reserved `'parked'` output causes the engine to transition the run lifecycle to
  `awaiting-input`, set `result.cursor` to the parked placement, and populate
  `result.parked` with a `ParkedType` carrying `correlationKey`, `cursor`, and
  `dagName`. The caller captures a checkpoint and calls `dispatcher.resume()` when
  the human decision arrives. The `DAGLifecycleMachine` gains the `awaiting-input`
  variant and `park` event; `NodeStateBase` gains `park()` and a `parked` getter;
  `ExecutionResultType` gains `parked: ParkedType | null`; `Validator.parked` is
  added; the `DAGValidator` skips the reserved `'parked'` output in the routing
  completeness check.
- 0307e00: Promotes listModels() to LlmAdapterInterface and EmbedderInterface. OpenAiCompatibleAdapter implements /v1/models discovery covering Groq, Mistral, Cerebras, and OpenRouter. AnthropicApiAdapter implements /v1/models. All embedder packages implement listModels(). BaseEmbedder gains selectEmbeddingModel(). Adapters that already had listModels() (Ollama, Gemini, Nano, WebLLM) are unchanged. Hardcoded model strings removed from examples.
- 4675839: PluginLoader: type-safe dynamic plugin import binding. PluginLoader.load(specifier)
  dynamically imports a module and validates its default export as a PluginInterface via
  a structural type-guard predicate — no casts at the call site. PluginLoader.validate(mod)
  and PluginLoader.isPlugin(value) are also exported for use with already-imported modules.
  PluginDiscovery.loadAll(dag, registry, dispatcher, resolveSpecifier) composes the walker
  with the loader to register all transitively-referenced plugins in one call.
- d7eb8bc: Plugin loader: PluginInterface (register(dispatcher)) + Dagonizer.registerPlugin(plugin) +
  PluginDiscovery.referencedDagNames(dag) / walk(dag, registry) via new ./plugin subpath.

  Multi-observer mux: DagonizerOptionsType gains optional observers array of DispatcherObserverType
  callbacks muxed into all lifecycle hooks. Provides an alternative to subclassing for
  per-turn-rebuilt dispatchers.

- 088fe8b: Streaming producers feed a ScatterNode through one unified engine path — no
  separate stream node, executor, or scheduler. A `StreamChannel<T>` is a bounded
  push→pull async queue that is itself an `AsyncIterable<T>`, duck-typed as a
  scatter source. Statics: `StreamChannel.driven(producer)`,
  `StreamChannel.fanIn(producers)` (merge concurrent producers), and
  `StreamChannel.resumable(producer, resumeAfter)` (supply only the remainder after
  an interrupt). Producers are objects implementing `StreamProducerInterface`
  (`produce(sink)`) or `ResumableStreamProducerInterface` (`produce(sink, resumeAfter)`)
  pushing into a `StreamSinkInterface`; `DagStreamProducer<T>` (`./patterns`)
  bridges an inner DAG's node-result stream into a back-pressured sink.

  New public surface: `./channels` adds `StreamChannel`, `StreamCursor`,
  `StreamChannelInterface`, and the option types; `./contracts` adds
  `StreamProducerInterface`, `ResumableStreamProducerInterface`, and
  `StreamSinkInterface`; `./patterns` adds `DagStreamProducer`.

  Deterministic streamed resume: async/streaming sources are not engine
  index-skipped (only array sources get the seen-indices pre-scan). The caller
  reads the durable pull count with `StreamCursor.resumeAfter(state, scatterName)`
  and supplies the remainder via `StreamChannel.resumable(producer, cursor)`. On
  resume the engine replays in-flight inbox items from the checkpoint and the
  channel supplies fresh items at or after the cursor; the union is exactly-once.
  Acked items below the watermark are not re-folded — their gather contributions
  must already live in the resumed state snapshot.

  `GatherStrategy.initial(config, state, accessor)` is now invoked by the engine
  once on fresh scatter entry (no stored checkpoint), before the first reduce, and
  never on resume (where the accumulator is restored from the checkpoint). Built-in
  gathers inherit the no-op default; state-sourced custom gathers seed their
  accumulators here, which is what makes their durable cross-process resume
  correct.

- 8defaae: Bumps two visualization dev dependencies to their new major versions:
  `@cosmos.gl/graph` from ^2.6.4 to ^3.0.0 and `cytoscape-dagre` from ^3.0.0
  to ^4.0.0.

  `@cosmos.gl/graph` v3 introduces a luma.gl (WebGL 2) rendering engine and a
  config API change where `setConfig()` now resets all values to defaults — use
  the new `setConfigPartial()` to update individual properties without a full
  reset. In this workspace cosmos is consumed only by the docs memory-graph
  component (`docs/.vitepress/theme/components/MemoryGraph.vue`); every config
  key, callback, and `Graph` method that component uses (`simulationDecay`,
  `onSimulationTick`, `onZoom`, `onClick`, `setPointPositions`, `getZoomLevel`,
  `render`, `spaceToScreenPosition`, …) is present and signature-compatible in
  v3, and the component never calls `setConfig`, so the reset-behavior change
  does not apply.

  `cytoscape-dagre` v4 ships its own bundled TypeScript declarations. It has no
  importer in this workspace — the dagonizer viz layer drives layout via
  `@dagrejs/dagre` directly rather than the cytoscape-dagre plugin — so the bump
  is config-only. Consumers using the cytoscape-dagre layout should note the new
  `useDagreEdgeControlPoints`, `automaticDagreEdgeStyle`, and `dagreEdgeStyle`
  options available in v4.

### Patch Changes

- 55366b5: Harden `DottedPathAccessor.set` against prototype pollution by guarding each
  property write inline. The `__proto__`/`prototype`/`constructor` segment check
  now sits directly on the path to every assignment, so a config-supplied dotted
  path can never walk or mutate the prototype chain. Behaviour is unchanged for
  all legitimate paths; forbidden or empty segments make the write a no-op.
- ddf151f: Docs: wrap the interactive browser runners (`ArchivistRunner`, `DispatcherRunner`,
  `CartographerRunner`) in `<ClientOnly>`.

  These widgets seed initial reactive state from client-only sources at `setup()` —
  `Date.now()` (greeting selection), `localStorage` (saved backend, slow-banner,
  checkpoint), and `navigator.hardwareConcurrency` (worker pool size). VitePress's
  production build statically pre-renders each page, so those build-time values were
  baked into the HTML and could never match the values the browser computes on
  hydration, producing `Hydration completed but contains mismatches` console errors.
  Rendering the runners client-only eliminates the baked markup and the mismatch.
  The `DagGraph` embeds are unaffected (deterministic, SSR-safe) and remain SSR'd.

- 62dc1c7: Docs toolchain devDependency bumps:

  - `vue-tsc` bumped from `^2.2.12` to `^3.3.5`. vue-tsc 3 introduces the Volar 2
    rewrite; its TypeScript peer requirement (`>=5.0.0`) is satisfied by the
    workspace's pinned TS 6.0.3. `typecheck:docs` and `docs:build` pass clean.

  - `vite` bumped from `6.4.3` to `^8.1.0` in `examples/the-archivist/package.json`.
    The-archivist is a standalone browser demo; its `vite build` passes clean under
    vite 8 with no source changes. Version spec updated from exact pin to caret
    convention matching the rest of the workspace.

- b6d059e: Bump @types/node devDependency to ^26.0.0 across the workspace.
- 4d55c20: TypeScript devDependency bumped from ^5.6.0 to ^6.0.3 across all packages
  (dagonizer, dagonizer-executor-node, dagonizer-store-sqlite,
  dagonizer-executor-web, examples).

  Source fixes driven by TS 6.0 breaking changes:

  - `docs/tsconfig.json`: removed `baseUrl: "."` (deprecated in TS 6, reported as
    TS5101; unused under `moduleResolution: Bundler` with no path aliases).
  - `docs/.vitepress/shims/css.d.ts` (new): ambient module declarations for CSS
    side-effect imports. TS 6.0 enables `noUncheckedSideEffectImports` by default
    (TS2882), flagging bare `import './foo.css'` where no module type exists.
    Declarations cover local theme CSS and package CSS exports
    (`@shikijs/vitepress-twoslash/style.css`,
    `@studnicky/dagonizer/viz/explorer.css`).

## 0.26.0

### Minor Changes

- a79da55: Keys the node and DAG registries by expanded IRI instead of bare name, so two
  plugins can ship a node of the same local name without an irreconcilable
  collision. A new in-house `ContextResolver` expands `prefix:local` names through
  a document's `@context` prefix map (collision-free: a context that maps two
  prefixes to one namespace is rejected at load); bare, un-prefixed names expand to
  a default namespace, so every existing single-package DAG keeps working unchanged.

  Identity keying is scoped to the node-impl and DAG maps — placement names, the
  resume `cursor`, and `executedNodes`/`skippedNodes` stay DAG-local, so
  deterministic resume is preserved: a stored `dagName` resolves to its IRI through
  `ContextResolver` at resume time, so no checkpoint version field or migration path
  is needed. The container handshake carries a `keyingScheme` (`'name'` | `'iri'`)
  discriminant so a name-keyed worker isolate cannot silently bind against an
  IRI-keyed parent.

  The `CheckpointData` wire shape drops its `version` field entirely — checkpoints
  have one current shape, and `Checkpoint.load` validates against it with no
  version detection or upcasting.

- a79da55: Adds five framework-tooling surfaces that consumers previously hand-rolled:

  - **`./runner`** — `DagRunner`, an abstract base owning the canonical
    register → seed → execute → route → project loop (never-throw), plus a
    `TriggerInterface` adapter contract with four concrete triggers
    (`OnceTrigger`, `CliTrigger`, `EventTrigger`, `RequestTrigger`). The
    `request` trigger is the seam for per-turn dispatcher scope; the runner wires
    the previously-missing checkpoint/resume entry point.
  - **`AgentBuilder`** (`./patterns`) — assembles the eight-node agent tool-calling
    loop (including the tool-scatter sub-graph and the loop-back edge) into a
    runnable `DAGType` from one call, replacing the hand-wired `DAGBuilder` chain
    every agent consumer re-derived.
  - **`MonadicNode`** (`./core`) — the batch-native node base that owns the
    single execution contract: subclasses consume a `Batch` and return routed
    batches for their declared output ports.
  - **`./progress`** — `EventBus` (typed topic publish/subscribe) and `SseStream`
    (a bus topic → Server-Sent-Events stream with heartbeat and teardown), an
    isomorphic, dependency-free progress substrate.
  - **`LlmAdapterCascadeBuilder`** (`./adapter`) — assembles a configured
    `LlmAdapterCascade` from a provider catalogue expressed as data (no `switch`),
    lifting the provider-cascade glue consumers re-derive.

- a79da55: Services constructor-DI, typed metadata reads, store typed reads, and a repo-wide
  `noun.verb()` / cast-free conformance sweep.

  - **Breaking: services are injected into nodes, not threaded through the dispatcher.**
    The `TServices` generic, the `context.services` field, the `Dagonizer` `services`
    constructor option, and `AgentServicesType` are removed. A node that needs an
    external dependency (an LLM adapter, a store, a tool, a triple-store) receives it
    through its own constructor and holds it as an instance field, and is registered
    with that dependency (`dispatcher.registerNode(new FetchNode(db))`). `Dagonizer`
    is now `Dagonizer<TState>` (one type parameter); `NodeInterface<TState, TOutput>`,
    `MonadicNode`, and `NodeContextType` are non-generic over services;
    `NodeContextType` carries only `signal`, `dagName`, `nodeName`, `validateOutputs`,
    and `outputSchemaValidator`. The pattern packages follow suit: `GraphNode(memory)`,
    `LlmDispatchNode(llm)`, `ScoutNode(tool)`, `CallModelNode(llm)`. **Migration:** drop
    the `<TServices>` type argument and the `{ services }` option; give each node a
    constructor accepting the dependencies it read from `context.services`, store them
    as fields, and pass them when constructing the node for registration.

  - **Breaking: `TState` generic removed from engine internals.** The engine threads
    state through `NodeStateInterface` uniformly across all internal modules.
    `DagTaskInterface` and `DagContainerInterface` are non-generic; `GatherExecutionType<TItem>`
    carries `state` as `NodeStateInterface`. The public boundary (`Dagonizer<TState>`,
    `execute`, `resume`, `Execution<TState>`, `NodeResultType<TState>`,
    `ExecutionResultType<TState>`) keeps `TState`. Embedded/scatter child DAGs run on
    their own heterogeneous state classes — each implements `NodeStateInterface` but is
    not `TState`. **Migration:** consumers passing a concrete `TState` generic to
    `DagContainerInterface` or `DagTaskInterface` remove that type argument; all other
    public-API call sites are source-compatible.

  - **Typed metadata reads via `state.getter` (`MetadataGetter`).** `NodeStateBase.getMetadata(key)`
    returns `unknown` (the metadata store holds arbitrary JSON), so every state exposes
    `state.getter` — a `MetadataGetter` with `string(key, fallback?)`, `number`,
    `boolean`, `stringArray`, and `numberArray` that narrow each read to a concrete type
    with a required default, cast-free. `MetadataGetter` ships on the root barrel;
    `MetadataReadableInterface` (its minimal read contract) ships on `./contracts`.

  - **Store typed reads = configured validation.** `StoreInterface.get`/`update` return
    `JsonValueType` (no `<T>` generic); `BaseStore.narrowStored` is removed. `TypedStore`
    takes a per-key validator record and validates on read (the validator is the
    type-guard), toggled like `validateOutputs`.

  - **Cast-free / `noun.verb()` conformance sweep.** `StateAccessorInterface.get` returns
    `unknown` and callers narrow; `EventBus.publish`/`subscribe` operate on an `unknown`
    payload; remaining `as` casts are removed in favour of `noun.is` type-guards,
    `filter*` builders, and membership checks. Every freestanding/nested `verbNoun`
    helper is hoisted to a `noun.verb()` method (`PlacementRank.rankFor`,
    `MermaidExplorer.#dismiss`). **Migration:** replace `accessor.get<T>(state, path)`
    with `accessor.get(state, path)` plus a narrowing check; replace
    `bus.subscribe<T>(topic, fn)` with `bus.subscribe(topic, fn)` and narrow
    `event.payload`.

## 0.25.0

### Minor Changes

- feba895: Adds `@studnicky/dagonizer-adapter-anthropic` — a first-class adapter for the Anthropic Messages API. `AnthropicApiAdapter` extends `BaseAdapter` directly (not `OpenAiCompatibleAdapter`) because Anthropic's wire format is distinct from OpenAI's: system prompts are a top-level `system` field, tool responses are `tool_result` content blocks inside user turns, tool definitions use `input_schema` instead of `parameters`, and the response payload is a typed `content[]` array with a `stop_reason` field. Full `tool_use` capability is supported including all tool-choice variants (`auto`, `required`/`any`, `none`, specific tool). The adapter ships with intercepted-fetch wire-format tests covering text responses, `tool_use` responses, and mixed responses.
- ad70ba1: Harness recursion foundation: isolated child-state engine, per-port output contracts, and repo-wide cast elimination.

  - **Isolated child-state harness.** Tool and subagent embeds run on a fresh child state produced by a factory seam, not a clone of the parent state. The engine is now honestly heterogeneous-state: a child DAG carries its own `NodeStateBase` subtype, decoupled from the parent's. Tool state is isolated; scatter `dagFrom` is item-scoped so each scattered item materialises its own child DAG.
  - **Agent turn-loop + tool-execution node family.** New template-method pattern nodes for the agent turn-loop and tool-execution flow, extensible by subclass.
  - **Mandatory per-port `outputSchema` node contract.** Every `NodeInterface` declares `readonly outputSchema: Record<TOutput, SchemaObjectType>`; `MonadicNode.outputSchema` is abstract with no passthrough default. Opt-in output validation runs as a dedicated `validateOutputs` lifecycle stage (`fire → validate → route`), gated by `DagonizerOptionsType.validateOutputs` (default `false`). Tool input/output contracts validate against `tool.definition.inputSchema`/`outputSchema`.
  - **Tool-registry dispatch.** Tool invocation routes through the registry by name with route-to-error on miss; validators compile once at `ToolRegistry.register()`.
  - **Non-generic `BaseStore` hooks** and repo-wide elimination of `as` casts in favour of static type-guard predicates, `filter*` builders, and membership checks. Zero sanctioned casts remain, including the JSON snapshot/restore boundary.

- feba895: Visualization: `MermaidRenderer.render(dag, options?)` and a framework-agnostic `MermaidExplorer`.

  - **`MermaidRenderer.render(dag, options?)`** gains a `MermaidRenderOptionsType` (`orientation` default `'TB'`, `sanitizeNodeIds` default `true`, `terminalAnnotations` default `'strip'`, and a concrete-colour `theme` with per-role `containerTints`). The renderer now emits parse-safe Mermaid by default: colon-bearing placement ids are sanitized to keyword-safe ids (labels keep their colons), `\n(outcome)` terminal annotations that break the lexer are stripped, and the orientation is configurable. Existing `render(dag)` callers get the safe output with no change.
  - **`MermaidExplorer`** (`@studnicky/dagonizer/viz`) is a vanilla-TS, framework-agnostic enhancer that attaches the same D-pad (zoom · pan ×4 · centre · fit) and fullscreen-explore modal to rendered Mermaid SVGs that the interactive graph canvases use — one consistent navigation rule set across diagrams and live graphs. `MermaidExplorer.install(options?)` wires a `MutationObserver` for async-rendered diagrams; `MermaidExplorer.enhance(frame, options?)` upgrades one. A companion stylesheet ships at `@studnicky/dagonizer/viz/explorer.css`.

## 0.24.0

### Minor Changes

- b9f68c5: The `DAGDeriver` contract-derived flow generation is removed along with `DerivableNodeInterface`, `ChainableType`, `OperationContractType`, `ContractRegistryValidator`, and the `./derive` subpath export. `DAGBuilder` is the single, explicitly-wired, compile-checked way to construct a DAG.

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

## [Pre-1.0 migration notes (around 0.21.0)]

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

- **`Dagonizer.ts` god-file decomposition.** The engine class file drops from 2969 to 2200 lines by extracting cohesive domain seams into dedicated modules and promoting every object-literal-of-closures "object-of-closures" to a named class with a stable V8 shape. The public API is unchanged: every export, subpath, type, and the `DagonizerInterface` contract are byte-identical, and all 873 tests pass without modification. New engine-internal modules: `execution/ScatterDispatch.ts` (the `ScatterPoolDriver` driver, the `ScatterDispatchAdapter` adapter class + its interface, and the engine-private scatter result/option/context types), `execution/PlacementDispatch.ts` (the `@type`-keyed placement router, replacing the constructor's `dispatch` closure map), `execution/NodeInvoker.ts` (the `custom`-gather node invoker, replacing the inline `NodeInvokerInterface` literal), `execution/ScatterSource.ts` (scatter source-to-`AsyncIterator` normalization), `observer/ObserverRelay.ts` (the `ObserverRelay` relay class + its `DispatcherHooksInterface` contract), and `observer/DispatcherHooks.ts` (the `DispatcherHooks` relay-hooks adapter, replacing the constructor's `#relayHooks` closure literal). The scatter watermark-accounting helper and checkpoint-restore logic move to their canonical home on `ScatterCheckpoint` (`advanceWatermark`, `restoreRunState` → `ScatterRunStateType`). Each promoted class holds a reference to the dispatcher (or a narrow source interface it satisfies) and initialises every field in constructor-declaration order.

- **Registration/validation extracted to `dag/DagRegistrar.ts`.** `Dagonizer.ts` drops to a thin composition root: the `registerDAG` / `registerNode` / `registerBundle` bodies — the duplicate-name throw, the `Validator.dag` schema pass, the `DAGValidator.validateDAGConfig` semantic pass, the `ContractRegistryValidator` contract pass, and the container-role-binding gate — move to a single-responsibility `DagRegistrar` class. The class depends only on the narrow `DagRegistrarSourceInterface` (the live `dags` / `nodes` / `nodeIndex` registries plus `resolveContainer` / `hasContainers`), constructed once in the dispatcher constructor against a source backed by the dispatcher's own registries. The public method signatures and throw behavior are unchanged; the three methods are now thin delegates to `this.dagRegistrar`. `Dagonizer.#hasContainers` becomes the public `hasContainers()` so the registrar reads it through the port. The public API surface and all 873 tests are byte-identical.

## 0.20.0

### Minor Changes

- dcbc4b5: Codebase-wide audit and hardening pass: collapse dual representations, remove callback extension seams, enforce schema-as-source-of-truth at every JSON ingest boundary, and align the sibling packages to one opinionated shape.

  Breaking changes (pre-1.0; see the Pre-1.0 migration notes sections below for full migration notes): `NodeInterface.contract` and `NodeInterface.timeout` are now required (`EMPTY_CONTRACT_FRAGMENT` / `Timeout.none()` defaults; `MonadicNode` unaffected); `RetryPolicy` is constructed via `RetryPolicy.from()`; `BaseStore.update` is abstract; `HttpTransport.validate` callback removed; `ChatMessage` is a role-discriminated union; DAG-document (de)serialization moved to `DAGDocument` (the static `Dagonizer.load/serialize` delegates are removed); `TypedStore` lifecycle access moved to `.inner`; `GatherStrategies`/`OutcomeReducers` registries throw on duplicate (`replace()` for intentional overrides); adapter wire-shape entities relocated to `entities/adapter/` (breaking the `contracts → adapter` cycle); adapter option-type aliases removed; the `Book` entity is composed into `BookIdentity`/`BookPublication`/`BookAvailability` with a `BookBuilder.from()` factory.

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

  - Canonical defaults: every options/config object resolves through a co-located defaults object applied as both the default argument and a spread over caller input; defaulted fields are optional input, never required-of-caller.
  - Data-shape types are mutable: `readonly`/`ReadonlyArray`/`Readonly<Record>` removed from entity, wire, and options/config declarations to match the schema-derived shapes. Consumers apply `Readonly<>` at their boundary; class instance fields and `as const` schema literals keep their immutability. Compile-time only.

  Dispatch maps replace switch chains throughout; schema-as-source-of-truth gaps closed; all workspace consumer packages migrated. Validation: typecheck + lint clean, 698 dagonizer tests pass, every workspace package and example builds.

## [Pre-1.0 migration notes (around 0.19.0)]

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
- **`DagContainerError` constructor migrated to the options object.**
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

- **Engine-wide options resolution policy**: every options or config object resolves through a co-located defaults object applied as both the default argument and a spread over caller input (`{ ...DEFAULTS, ...options }`). Defaulted fields are optional input, never required-of-caller. This is the canonical required-with-defaults form across the engine; each option type's defaulted fields are explicitly `?` in the type.
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
