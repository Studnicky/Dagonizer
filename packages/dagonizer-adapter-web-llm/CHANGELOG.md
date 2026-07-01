# @studnicky/dagonizer-adapter-web-llm

## 0.30.0

### Minor Changes

- 4234bc4: `WebLlmAdapter` overrides `performChatStream` to surface real MLC engine token deltas on the caller's sink as `ChatStreamChunkType` pushes, instead of discarding them into a single accumulated string; `usage` is captured from the engine's final chunk when available.

## 0.29.1

## 0.29.0

### Patch Changes

- 23ec54b: Enforce a single shared hard abort+timeout race in `BaseAdapter.chat()` so every adapter — cloud and in-browser — inherits identical cancellation semantics. The base now wraps `performChat()` in a guard that folds a per-request timeout and the caller's `AbortSignal` into one composed signal, passes it through to `performChat`, and rejects the instant that signal aborts even when the underlying operation never settles. A frozen in-browser stream or a hung socket therefore always rejects within the configured ceiling instead of hanging the caller.

  The timeout is configurable via the existing `timeoutMs` adapter option (module-level default 60 000 ms). A new protected `onCancelRequested()` hook gives subclasses a best-effort cooperative-cancel seam; `WebLlmAdapter` overrides it to call `engine.interruptGenerate()`. The HTTP adapters (`OpenAiCompatibleAdapter` and its `ollama` subclass, gemini-api, anthropic) drop their per-adapter timeout machinery and forward `request.signal` directly to `fetch`; the on-device `gemini-nano` adapter forwards it to `lm.create()`/`session.prompt()`. `WebLlmAdapter` no longer enforces its own timer; correctness comes from the base. Public adapter APIs, capabilities, and schemas are unchanged.

- 23ec54b: Fix `BindingError` thrown by `GrammarCompiler.CompileJSONSchema` on every structured-output call. `WebLlmAdapter.performChat()` now computes a `schema` string (JSON-serialised tool-plan schema or output schema) and passes it natively via `response_format: { type: 'json_object', schema }` so the grammar compiler receives a valid string instead of an undefined value. Plain text requests continue to receive `{ type: 'text' }` with no schema field. The system message still carries the schema description as belt-and-suspenders reinforcement.

## 0.28.1

## 0.28.0

## [unreleased]

### Minor Changes

- `WebLlmAdapter` overrides `performChatStream` to surface real engine token deltas: it opens the same MLC streaming session `performChat` uses (identical message composition, `response_format`, and `stream_options`) and pushes each non-empty delta to the caller's sink as a `ChatStreamChunkType`, instead of discarding it into a single accumulated string. `usage` is captured from the final chunk when the engine attaches one (`stream_options: { include_usage: true }`), falling back to `ZERO_TOKEN_USAGE` otherwise.

### Patch Changes

- `performChat` runs the MLC engine through its streaming path (`create({ stream: true, … })`), accumulating delta chunks. A per-request `timeoutMs` deadline (default 60s) and the request abort signal each call `engine.interruptGenerate()`, which truly halts in-flight WebGPU generation — unlike the previous non-cancellable `create()` race, which freed the caller but left compute running. An expired deadline surfaces as a `TIMEOUT` classification and an external abort preserves a caller-supplied `LlmError` reason (falling back to `TIMEOUT`), so a cascade falls through rather than hanging. An interrupt that surfaces as a thrown iterator error rather than an early return is still classified from the deadline/abort state, never downgraded.
- Forward `request.maxTokens` to the engine as the native `max_tokens` generation cap (previously unset, so generation was uncapped).
- Add a `protected loadEngine()` seam: the default boots the real MLC engine from the CDN; a subclass overrides it to inject a stub engine in tests without intercepting the dynamic import.
- `composeMessages` folds all system turns and the structured-output coercion into one leading system message at index 0, followed by the user/assistant/tool conversation. `composeMessages` is exposed as a static so the index-0 invariant is directly testable.
- Add a consumer-configurable `systemPrompt` option, forwarded to the `BaseAdapter` seam: when set, it is injected as the leading system turn of any request that carries no system message of its own (never overriding an explicit one). Lets a consumer frame persona/format once at construction without hand-prepending a system message to every call.
- Classify a failed CDN import or weight fetch as `MODEL_NOT_FOUND` instead of leaking a raw `Failed to fetch dynamically imported module`. The in-browser runtime and model weights stream from a CDN at first use, so an unreachable CDN is a missing backend, not a transient fault — a cascade now falls through to another adapter rather than retrying a fetch that will never resolve.

## 0.27.0

## 0.26.0

## 0.25.0

## 0.24.0

## 0.23.0

## 0.22.0

### Changed

- **Adapter-contract interfaces carry the `Interface` suffix (semver-major).** The framework contracts this package's public surface names are imported under their suffixed names: `EntityValidatorInterface` (the compiled host/response validator) and `ToolInterface` (the tool contract the adapter's tool-call dispatch operates against). The renames are type-only and propagate from `@studnicky/dagonizer`; runtime behavior is unchanged. Consumers typing against the old bare names (`EntityValidator`, `Tool`) update to the suffixed names.
- The dynamically-imported `@mlc-ai/web-llm` module and its engine are schema-backed. `WebLlmModuleSchema` and `WebLlmEngineSchema` (JSON Schema 2020-12) describe the host members; the base types derive via `FromSchema` and the tier-3 narrowing interfaces `WebLlmModuleInterface` / `WebLlmEngineInterface` add the call signatures the schema cannot express. `#boot` validates the imported module and the created engine through `webLlmModuleValidator` / `webLlmEngineValidator` at the import boundary. Both validators are compiled once at module load through the engine's shared `Validator.compile` (`@studnicky/dagonizer/validation`). The `navigator.gpu` probe narrows the WebGPU global structurally via `Reflect` instead of a fabricated cast. The hand-written `WebLlmEngine`/`WebLlmModule` interfaces are removed.
- The lazy engine promise lives in a module-level `WeakMap` keyed on the adapter instance; every `WebLlmAdapter` instance shape is fixed at construction.
- `WebLlmInitReport` is renamed to `WebLlmInitReportInterface`. This is a breaking rename of the exported type.
- The `classify` override keeps only the provider-specific `MODEL_NOT_FOUND` (`webgpu`) branch and delegates everything else to `super.classify`. The shared `LlmError` passthrough and `aborted|timeout` → `TIMEOUT` mapping live in `BaseAdapterCore.classify`.
- Tool-result messages flatten through the shared `BaseAdapter.formatToolResult(message)` static rather than an inline `[tool <name> result] <content>` string, so the format is single-sourced across the text-only adapters.

### Added

- Public schema surface: `WebLlmModuleSchema`, `WebLlmEngineSchema`, the `WebLlmModuleInterface` / `WebLlmEngineInterface` / `WebLlmCompletionParamsInterface` / `WebLlmCompletionResultInterface` / `WebLlmInitReportInterface` types, the `*BaseType` derivations, and the `webLlmModuleValidator` / `webLlmEngineValidator`.
- Adds `"browser"` export condition to the `.` entry for bundler target selection.

## 0.21.0

## 0.20.0

## 0.19.0

## 0.17.0

### Patch Changes

- 34b7155: Apply Clean Code manifesto: static classes replace free functions, named constants replace magic numbers, flag arguments replaced with options objects, SRP extractions from Dagonizer core.

  **Breaking removals:** `detectGeminiNano` (→ `GeminiNanoAdapter.detect()`), `decodeToolCallsJson` (→ `ToolCallCodec.decode()`), `classifyHttp` (→ `LlmError.classifyHttp()`), `asNetworkError` (→ `LlmError.fromNetworkError()`).

  **New:** `DAGValidator`, `StateMapper`, `ScatterCheckpoint`, `PlacementUtils`, `ToolCallCodec`, `OpenLibraryDocs`, `BookEntitiesError`, `ExecutionError.fromSignal()`, `GeminiNanoAdapter.detect()`.

## 0.16.0

## 0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [d3a4e7b]
  - @studnicky/dagonizer@0.14.0

## 0.13.2

### Patch Changes

- Updated dependencies [238a94d]
  - @studnicky/dagonizer@0.13.2

## 0.12.0

### Patch Changes

- Updated dependencies [7c0e38a]
- Updated dependencies [3286d07]
  - @studnicky/dagonizer@0.12.0
