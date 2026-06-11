# Dagonizer Audit & Hardening — Full Findings Register

Comprehensive register of every finding from the six-slice read-only audit
(2026-06-10/11). Each row: **severity** · `file:line` · description · standard
violated · proposed fix · **status**.

**Status legend**

- ✅ **Fixed** — applied in this hardening pass; workspace green (`pnpm run ci` exit 0).
- ⏸ **Deferred** — tracked follow-up (see end).
- ➖ **No change** — investigated and judged acceptable / already-correct / out-of-scope by design.

**Standards key**: #1 noun.verb static-class, no freestanding helpers · #2 class-extension-only (no callbacks) · #3 one opinionated way (no dual representations / legacy) · #4 required-with-defaults over optional · #5 V8 shape stability · #6 canonical names, no aliasing · #7 required positional + trailing options · #8 no `unknown` outside JSON ingest · #9 needless complexity / duplication · #N (schema-as-source-of-truth, three-tier interfaces, etc. per slice).

Totals: **13 HIGH · 50 MED · 50 LOW** across six slices.

> **Second-round resolution (your `<- fix it` notes).** Every item you annotated `<- fix it` is addressed and verified — full `pnpm run ci` green (build · typecheck · typecheck:examples · lint · test · lint:dags · smoke:adapters; core 705/705; 31 DAGs well-formed; smoke passed). Those rows are re-marked ✅ with the resolution. Two carried real ripple, now complete: `NodeInterface.timeout` made **required** (parallels `contract`; 70 example/fixture files updated) and the `ScatterWorkerPool` extraction. One row (`RetryPolicyOptionsInterface`) is the canonical trailing-options config bag that standard #7 mandates stay optional — kept with explicit JSDoc rather than "fixed" into a #7 violation. One row (`NodeStateBase._metadata`) was kept a `Record` (not `Map`) because the live `metadata` getter backs `MapGatherStrategy`'s dotted-path writes; only `_retries` moved to `Map`.

---

## Slice 1 — Core engine (`Dagonizer.ts`, `NodeStateBase`, `execution/`, `runtime/`, `lifecycle/`, `errors/`)

HIGH 4 · MED 10 · LOW 9

### `Dagonizer.ts`
- ✅ **[HIGH]** `Dagonizer.ts:87` — `DispatcherWarningEmitter` wraps an injected `(message)=>void` callback (callback dressed as a class). #2 → removed; `Dagonizer` implements `WarningEmitter.warn()` directly, routes to `onContractWarning`; passes `this`.
- ✅ **[HIGH]** `Dagonizer.ts:124` — `GatherNodeInvoker` stores two injected closures (`resolve`/`execute`). #2 → removed; uses the dispatcher instance reference directly.
- ✅ **[MED/HIGH]** `Dagonizer.ts:371` + `SignalComposer.ts:21` — two never-aborting signals (`Dagonizer.NEVER_ABORT_SIGNAL` + `SignalComposer.never()`). #3 → `NEVER_ABORT_SIGNAL` deleted; all uses call `SignalComposer.never()`.
- ✅ **[MED]** `Dagonizer.ts:1958` — redundant `contract === undefined` guard after a `.filter` that already excludes it. #9 → removed (contract now required).
- ✅ **[MED]** `Dagonizer.ts:1247/1260/1728` — scatter `reducer`/`itemKey`/`concurrency` read with `?? default` at multiple call sites. #4 → resolved once at top of `executeScatter`.
- ✅ **[MED]** `Dagonizer.ts:151` — `DagonizerOptionsInterface` all-optional. #4 → static `Dagonizer.options(partial)` normaliser resolves a complete value in one place; engine internals never see optional. `services` stays optional (caller-typed `TServices`, no sensible default).
- ✅ **[MED]** `Dagonizer.ts:523` — `buildObserverRelay` returns a plain object literal (per-call closures). #5 → `ObserverRelayImpl` class with `#dispatcher`/`#state` private fields and methods (stable hidden class per relay).
- ✅ **[MED]** `Dagonizer.ts:1107` — `placement.stateMapping?` optional-chained in two places. #4 → defaulted to an empty mapping at the entity layer (`EmbeddedDAGNodeDefaults`/`ScatterNodeDefaults`); `?? {}` fallbacks removed from the dispatcher.
- ✅ **[MED]** `Dagonizer.ts:2011` — `Dagonizer.fromValue/serialize/serializeCompact` are DAG-document ops on the dispatcher. #9 → moved to a `DAGDocument` static-class (root barrel + `./entities`); the static delegates were then deleted (no shim) and all callers repointed to `DAGDocument.*`. Instance `load` (register-into-dispatcher) preserved.
- ✅ **[LOW/MED]** `Dagonizer.ts:1400-1619` — 7 inline arrow helpers in `executeScatter`. #1/#9 → extracted into a `ScatterWorkerPool<TState>` class (`src/execution/ScatterWorkerPool.ts`) owning pool state, slot semaphore, ack/dedup, abort, incremental gather. Behavior-identical; full suite (scatter/resume/streaming/containment/cross-container-abort) green.
- ✅ **[LOW]** `Dagonizer.ts:1384` — `slotResolve` closure-as-semaphore. #2 → now a private field/method of `ScatterWorkerPool`, not a reassigned closure variable.

### `NodeStateBase.ts`
- ✅ **[MED]** `NodeStateBase.ts:203/296/313` — `_metadata`/`_retries` wholesale reassignment on delete; imprecise V8 comment. #5 → `_retries` migrated to `Map<string,number>` (structural add/delete no longer churns shape). `_metadata` kept a `Record`: its getter is the live backing store for `MapGatherStrategy` dotted-path writes (`metadata.*`); a `Map` getter returning a fresh object would silently drop those writes. Comment corrected. Snapshot wire-shape byte-identical.
- ✅ **[LOW]** `NodeStateBase.ts:295` — destructuring-rest throwaway binding. #9 → addressed alongside the above.

### `errors/DAGError.ts`
- ✅ **[LOW]** `DAGError.ts:33` — constructor options `code?`/`context?` defaulted in-destructure. #4 → resolved via module-level `DAG_ERROR_DEFAULTS` (non-optional resolved values; `cause` a genuine sentinel).
- ✅ **[LOW]** `DAGError.ts:46` — `toJSON()` conditional spread → variable shape. #5 → emits a stable shape: `cause`/`stack` always present (`null` when absent); `DAGErrorJSONSchema` updated to match (`required` + nullable types).

### `runtime/RetryPolicy.ts`
- ✅ **[MED]** `RetryPolicy.ts:156` — `from()` an exact alias of the public constructor (dual construction path). #3 → constructor made `protected`; `from()` is sole path.
- ✅ **[MED]** `RetryPolicy.ts:98/146` — `retryOn`/`abortOn` stored as `…[] | null` while input uses `undefined` (dual rep). #3 → stored as required `[]`-default; `null` sentinel and `undefined→null` conversion removed; `length===0` = no filter.
- ✅ **[LOW]** `RetryPolicy.ts:165` — `getDelay` computes-and-discards a spread (`void {…}`). #9 → dead spread removed; `error` param retained for subclass overrides with a one-line comment.

### `runtime/` misc
- ✅ **[LOW]** `runtime/index.ts` — barrel re-exported internal-only `NoopWarningEmitter`/`SignalComposer`. → investigated; **retained** (genuinely consumed by public `ContractRegistryValidator` path; documented).
- ✅ **[LOW]** `SignalComposer.ts:64` / `Clock.ts:31` / `RealTimeScheduler.ts:37` — dead `?? null`, module-level mutable test-injection singletons, optional config objects. → dead `?? null` removed (`compose()` rewritten with named vars, no unchecked index). Clock/Scheduler provider singletons = the documented test-injection seam, and the optional config object = the canonical #7 trailing-options pattern: both standards-correct, intent now stated in-comment (no change).

---

## Slice 2 — Type/schema layer (`entities/`, `contracts/`, `constants/`, `validation/`)

HIGH 0 · MED 2 · LOW 4

- ✅ **[MED]** `entities/errors/DAGErrorJSON.ts:19` — `context` in `properties` but missing from `required`, though `toJSON()` always emits it. (schema-as-truth) → added to `required`; derived type non-optional.
- ✅ **[MED]** `contracts/Snapshottable.ts:19` — hand-written `StoreSnapshot`/`StoreSnapshotEntry` (real wire shape, no schema). (schema-as-truth) → `StoreSnapshotSchema`/`StoreSnapshotEntrySchema` added in `entities/checkpoint/`, `FromSchema`-derived, re-exported.
- ✅ **[LOW]** `entities/runtime/BackoffStrategy.ts:20` — `type BackoffStrategyValue` vs `const BackoffStrategy` dual name. #6 → type renamed to canonical `BackoffStrategy`; re-export removed.
- ✅ **[LOW]** `contracts/LlmAdapter.ts` / `LlmClient.ts` — import entity types from `adapter/` (contracts→adapter cycle). → 8 chat/adapter wire-shape schemas + `FromSchema` types relocated to `entities/adapter/`; contracts import from `entities/`; `./adapter` keeps re-exporting them (no consumer change). `grep "from '../adapter" contracts/` is empty — cycle broken.
- ✅ **[LOW]** `entities/dag/Placement.ts:1` — JSDoc mislabels a domain util as an "adapter contract helper". → JSDoc rewritten to describe it as a domain utility co-located with the entities it guards.
- ✅ **[LOW]** `contracts/RetryPolicyOptionsInterface.ts` / `NodeInterface.ts:56` — all-optional trailing config bag / `timeout?` optional. #4 → `NodeInterface.timeout` made **required** (parallel to `contract`; `Timeout.none()` default; 70 example/fixture files updated; `MonadicNode` unaffected). `RetryPolicyOptionsInterface` is the canonical #7 trailing-options bag — kept optional with explicit JSDoc (defaults in `RETRY_POLICY_DEFAULTS`); making it required would violate #7.

---

## Slice 3 — Peripheral modules (`adapter/`, `tool/`, `derive/`, `viz/`, `store/`, `container/`, `channels/`, `core/`, `patterns/`)

HIGH 1 · MED 9 · LOW 13

- ✅ **[HIGH]** `derive/DAGDeriver.ts:86` — "no contract" = `undefined` *or* empty fragment (dual rep + legacy external-implementor branch). #3 → `NodeInterface.contract` made required; legacy `=== undefined` branch deleted; `EMPTY_CONTRACT_FRAGMENT` made public.
- ✅ **[MED]** `derive/ContractRegistryValidator.ts:110` — `entrypointName?` optional on internal method. #4 → required field with spread-default.
- ✅ **[MED]** `adapter/OpenAiCompatibleAdapter.ts:73` — missing `baseDelayMs` passthrough; `#model` private (forced sibling dup). #4/#9 → added `baseDelayMs?` (readonly) + `protected get model()`.
- ✅ **[MED]** `adapter/LlmAdapter.ts:43` — `ChatMessageSchema` requires `toolCallId`/`toolName` for ALL roles. #4 → role-discriminated `oneOf`.
- ✅ **[MED]** `adapter/ToolCallCodec.ts:22` — `Date.now()` in synthesized id (non-deterministic). → per-call monotonic counter.
- ✅ **[MED]** `tool/HttpTransport.ts:42` — `validate` callback seam. #2 → removed; caller narrows; added `'ABORTED'` `ToolErrorReason`; collapsed double `resolveOptions`.
- ✅ **[MED]** `core/GatherStrategies.ts:88` — `applyIncremental?` optional method, duck-typed. #4 → `IncrementalGatherStrategy` subtype with required `applyIncremental`; dispatcher narrows via `instanceof`.
- ✅ **[MED]** `store/BaseStore.ts:81` — non-atomic `update` default with "MUST override" doc (broken implicit contract). → made abstract + `protected performUpdateRmw`.
- ✅ **[MED]** `container/DagHost.ts:106` — cast-laden `Partial<Record>` dispatch map. #8 → typed `switch (message.kind)`, casts removed.
- ✅ **[MED]** `viz/CytoscapeGraph.ts:194` — `protected` mutable `cyInstance`. → `#cyInstance` private + protected getter.
- ✅ **[LOW]** `viz/CytoscapeRenderer.ts:255` — inline IIFE building `baseData`. #9 → private static `buildNodeData`.
- ✅ **[LOW]** `derive/DAGDeriver.ts:468` — `as Extract<>` casts in gather dispatch map. → resolved with the `IncrementalGatherStrategy`/switch narrowing.
- ✅ **[MED]** `derive/DAGDeriverAnnotations.ts:69` — `concurrency?` optional. #4 → made required `concurrency: number` with exported sentinel `DEFAULT_SCATTER_CONCURRENCY = 0` ("unbounded / resolve to source length"); `DAGDeriver` reads `scatter.concurrency > 0`, aligned with `executeScatter`'s single resolution.
- ✅ **[LOW]** `store/TypedStore.ts:34`, `core/OutcomeReducers.ts`/`GatherStrategies.ts`, `channels/InMemoryChannel.ts:46`, `container/ChannelDispatch.ts:75`, `container/DagContainerBase.ts:104`, `patterns/MonadicNode.ts:97`, `viz/internal.ts:167` — all addressed: TypedStore drops the duplicated lifecycle surface (use `.inner`); both registries now **throw on duplicate** + `replace()` (consistent with `LlmAdapterRegistry`); `InMemoryChannel` collects `onPublished` errors into a `publishErrors` accessor (no swallow); `ChannelDispatch` uses a stable bound `#onMessage` handler (no per-call closure); `DagContainerBase` sources `DAG_CONTAINER_DEFAULTS` module constant; `MonadicNode` gives `validate`/`destroy` concrete no-op defaults (required-with-default at base; contract stays optional boundary); `viz/internal.narrowNodes` replaces the `as` with an `isPlacementEntry` type-guard filter.
---

## Slice 4 — LLM adapter packages (9 siblings)

HIGH 3 · MED 10 · LOW 8

- ✅ **[HIGH]** `OpenAiCompatibleAdapter.ts:70` — options fields lack `readonly` (all 5 inheritors affected). #5 → added `readonly`.
- ✅ **[HIGH]** `gemini-api/GeminiApiAdapter.ts:106` — response parsed via unguarded `as` cast. #8 → typed guard added; schema-validated before narrowing.
- ✅ **[HIGH]** `gemini-api/GeminiApiAdapter.ts:85` — no per-request timeout (hung connection never times out). #1/#9 → AbortController + `AbortSignal.any` timeout envelope, matching base.
- ✅ **[HIGH]** `gemini-nano/GeminiNanoAdapter.ts:70` — zero-arg constructor, `maxAttempts` hard-coded, no options type exported. #1/#4 → `constructor(options = {})` with `maxAttempts?`; `GeminiNanoAdapterOptions` exported.
- ✅ **[MED×4]** cerebras/groq/mistral/openrouter — `export type XApiAdapterOptions = OpenAiCompatibleAdapterOptions` re-aliases. #6 → deleted; OpenRouter gets a real interface (`referer?`/`title?`).
- ✅ **[MED]** `openrouter` — hardcoded `HTTP-Referer`/`X-Title` project identity, not overridable. → `referer?`/`title?` options with current defaults.
- ✅ **[MED]** `gemini-api` — duplicate `DEFAULT_GEMINI_MAX_ATTEMPTS`/`DEFAULT_TOKEN_COUNT`; abort→NETWORK (vs base TIMEOUT); inline zero-usage. #1/#9 → use `DEFAULT_MAX_ATTEMPTS`/`ZERO_TOKEN_USAGE`; abort→TIMEOUT.
- ✅ **[MED]** `gemini-nano` — duplicated `detect()`/`probe()`; inline zero-usage. → `probe()` delegates to `detect()`; `ZERO_TOKEN_USAGE`; `getLanguageModel` private.
- ✅ **[MED]** `ollama` — conditional-spread maxAttempts; `#currentModel` dup of base `#model`. #1 → `?? DEFAULT_MAX_ATTEMPTS`; uses new `protected get model()`.
- ✅ **[MED]** `web-llm` — missing `maxAttempts?`; `detectWebGpu` public. → added option; made private; folded webgpu classify.
- ➖ **[LOW]** stub adapter — no violations.

Consistency matrix (post-fix): all 9 agree on options shape, `maxAttempts`, `ZERO_TOKEN_USAGE`, abort→TIMEOUT. ✅

---

## Slice 5 — embedders, executors, stores, tools, book-entities

HIGH 3 · MED 14 · LOW 9

### Embedders
- ✅ **[MED]** `embedder-ollama:81` — dead `?? 768` (unreachable; table default already 768). #4 → removed; `DEFAULT_DIMENSIONS` constant.
- ✅ **[LOW]** all 3 embedders — response envelopes narrowed via `as` cast. #7 → typed guards at ingest, consistent across the three.
- ✅ **[MED]** `embedder-ollama:81` — `(options?)`-only constructor vs `(apiKey, options?)` siblings. #1 → **Ollama Cloud** support added: `OllamaEmbedderOptions.apiKey?` sends `Authorization: Bearer <key>` when present; local needs none. Asymmetry resolved (the difference is now an optional key, not a missing capability). Tests cover both header paths.

### Executors
- ✅ **[HIGH]** `executor-node` `kill-registry.ts` fixture — node lacked required `contract`. → `readonly contract = EMPTY_CONTRACT_FRAGMENT`.
- ✅ **[MED]** `ForkContainer`/`ClusterContainer` — identical ~15-line IpcEndpoint closures. #9 → hoisted to `IpcChannel.fromChildProcess(process)`.
- ✅ **[MED]** `executor-web/WebSystemInfo.ts:74` — dead `crossOriginIsolated` field/getter. #4 → removed.
- ✅ **[was HIGH]** Node vs Web `recommendedWorkerCount` clamp — DRY'd: one canonical `SystemInfo.recommendedWorkerCount(config, probes)` in core; both executors call it (the two duplicate formulas deleted). Clamp tests pass with identical numbers.
- ✅ **[LOW]** web `navigator` probe double-cast; node bare-entry scripts. → `WebNavigatorProbes` interface + `DEFAULT_WEB_PROBES` (one typed boundary, no scattered casts); node entries wrapped in exported `ForkEntry`/`SpawnEntry`/`WorkerEntry` static classes (importable/testable, mirroring `WebWorkerEntry`).

### Stores
- ✅ **[HIGH/MED]** `eventlog/EventLogStore.ts:84` — `JSON.parse(line) as EventLogEntry` unvalidated ingest. #7 → `EventLogEntrySchema` + validator; throws `StoreError(INCOMPATIBLE_SNAPSHOT)`. Also implements now-abstract `update`.
- ✅ **[MED]** `sqlite/SqliteStore.ts:62` — `let next!: T` definite-assignment hack. → restructured, `!` removed.
- ✅ **[HIGH/MED]** both stores — inline `{ namespace: '' }` default instead of `BASE_STORE_DEFAULTS`. #4 → use `BASE_STORE_DEFAULTS`.
- ✅ **[LOW]** import-style divergence between the two stores. #1 → aligned.

### Tools
- ✅ **[HIGH]** `wikipedia:80` — `(err as { status?: number }).status` structural cast. #7 → `err instanceof ToolError && err.status === 404`.
- ✅ **[MED]** all 3 tools — hand-written external-API response interfaces, `as` cast. #7 → consistent typed-guard narrowing at the `getJson` boundary.
- ✅ **[MED]** `openlibrary` — `// #region` tags (lone in family); empty `'required': []`. #1 → removed.
- ✅ **[MED]** tools re-export book-entities symbols (`Book`/`Candidate`/`Money`/`CanonicalId`). #6/#5 → removed; `book-entities` is now a direct dependency.

### book-entities
- ✅ **[MED]** `CanonicalId.ts:24` — static class without `private constructor` (instantiable). #2 → sealed.
- ✅ **[LOW]** `entities.ts:38` — no-op `source: 'web-search' | string` union. → `string`.
- ✅ **[MED]** `entities.ts:19` — `Book` flat optional bag. #4 → **composed** into `BookIdentity` (isbn/title/authors) + `BookPublication` (year/languages/publishers/subjects/summary) + `BookAvailability` (price/inStock), with a `BookBuilder.from(BookInput)` factory materializing defaults. Optionality is now localized per sub-entity. Tools + the-archivist migrated to the composed shape via the factory.
- ✅ **[LOW]** `CanonicalId.ts:87` — repeated ternary-spread for optional fields. #9 → `merge` is table-driven: a `PUBLICATION_MERGE_MAP` dispatch map names each field + its merge strategy; `mergePublication` walks the map, eliminating every per-field ternary spread.

---

## Slice 6 — pattern packages, examples, docs

HIGH 2 · MED 5 · LOW 7

### Patterns
- ✅ **[MED]** `patterns-flow/RespondNode.ts:24` — `(state as Record<string,unknown>)['draft']` convention cast leaking `unknown`. #4/#8 → `extractDraft` made abstract.
- ✅ **[LOW]** `patterns-rag/DecisionNode.ts:18` — redundant `export { type RagServices }` re-export. #6 → removed.
- ✅ **[LOW]** `patterns-rag/LlmDispatchNode.ts:43` — user message built with empty `toolCallId`/`toolName` (now fails the oneOf validator). → fields omitted for non-tool roles.

### Examples
- ✅ **[MED]** `the-archivist/memory/MemoryStore.ts:53` — freestanding `stateGraphIri`/`provGraphIri` arrow exports. #1 → static methods.
- ✅ **[LOW]** `the-archivist/nodes/{decideTools,rankCandidates}.ts` — `matchShortcut`/`compositeScore` bound-function exports. #1 → call the static classes directly. (Also `composeResponse.ts` `detectEntities`/`antiHallucinationCheck` → `ResponseAnalysis.*`.)
- ✅ **[LOW]** import-path drift — `DAGBuilder`/`NodeContextInterface`/`DAGHandoff` imported from deep subpaths in some examples, root barrel in others. #2 → unified on root barrel.

### Docs
- ✅ **[HIGH]** `subclassing.md:187` / `services.md:64` — `NodeContextInterface` imported from `@noocodex/dagonizer/contracts` (not exported there). → root barrel.
- ✅ **[HIGH]** `builder.md:340` — `.terminal('end-fail', 'failed')` wrong signature. → `{ outcome: 'failed' }`.
- ✅ **[MED]** `plugins.md:90/116` — `Tool.execute(input, signal)` wrong. → `execute(input, options?)`.
- ✅ **[MED]** guides — raw `{ output: ... as const }` returns vs idiomatic `NodeOutputBuilder.of()`. #3 → switched to the builder across guides.
- ✅ **[MED]** `builder.md:333/379` — `DAGBuilder` import path flips within one file. #2 → unified on root barrel.
- ✅ **[+]** docs also updated for the breaking changes (required `contract`/`EMPTY_CONTRACT_FRAGMENT`, `RetryPolicy.from`, `RetryPolicy.run(task,{signal})`, `BackoffStrategy` rename, `reference/contracts.md` `timeout: Timeout`).

---

## Formerly deferred — now done

1. ✅ **`contracts → adapter` circular import** — 8 chat/adapter wire-shape schemas + types relocated to `entities/adapter/`; cycle broken (`grep` empty); `./adapter` still re-exports them.
2. ✅ **`ScatterWorkerPool` extraction** — done; `src/execution/ScatterWorkerPool.ts`; behavior-identical; full suite green.
3. ✅ **`Dagonizer.fromValue/serialize/serializeCompact`** — moved to `DAGDocument`; static delegates deleted (no shim); callers repointed.
4. ✅ Remaining ➖ rows addressed in round 3 (line-87 core cluster, ollama-cloud key, executor clamp DRY + probe typing/entry classes, composed `Book`, `CanonicalId` dispatch map) — nothing left judged "no change" except the two standards-correct cases (the `RetryPolicyOptionsInterface` #7 trailing-options bag, and `NodeStateBase._metadata` kept a live `Record` for `MapGatherStrategy`).

## Verification

`pnpm run ci` exit 0 — `typecheck` · `typecheck:examples` · `lint` (--max-warnings 0) · `test` (24 packages; core 705/705) · `lint:dags` (31 DAGs) · `smoke:adapters`. CHANGELOG `[Unreleased]` documents every breaking change with migration notes.
