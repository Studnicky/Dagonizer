# @studnicky/dagonizer-adapter-gemini-api

## 0.30.1

## 0.30.0

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

### Minor Changes

- 4234bc4: `GeminiApiAdapter` overrides `performChatStream` with real token streaming: calls the `streamGenerateContent` endpoint and drains the SSE body through the shared `SseLineParser`, pushing one `ChatStreamChunkType` per non-empty text delta on the caller's sink. A request carrying tools still falls back to the buffered default.

## 0.29.1

## 0.29.0

### Patch Changes

- 23ec54b: Enforce a single shared hard abort+timeout race in `BaseAdapter.chat()` so every adapter — cloud and in-browser — inherits identical cancellation semantics. The base now wraps `performChat()` in a guard that folds a per-request timeout and the caller's `AbortSignal` into one composed signal, passes it through to `performChat`, and rejects the instant that signal aborts even when the underlying operation never settles. A frozen in-browser stream or a hung socket therefore always rejects within the configured ceiling instead of hanging the caller.

  The timeout is configurable via the existing `timeoutMs` adapter option (module-level default 60 000 ms). A new protected `onCancelRequested()` hook gives subclasses a best-effort cooperative-cancel seam; `WebLlmAdapter` overrides it to call `engine.interruptGenerate()`. The HTTP adapters (`OpenAiCompatibleAdapter` and its `ollama` subclass, gemini-api, anthropic) drop their per-adapter timeout machinery and forward `request.signal` directly to `fetch`; the on-device `gemini-nano` adapter forwards it to `lm.create()`/`session.prompt()`. `WebLlmAdapter` no longer enforces its own timer; correctness comes from the base. Public adapter APIs, capabilities, and schemas are unchanged.

## 0.28.1

## 0.28.0

## [unreleased]

### Minor Changes

- `GeminiApiAdapter` overrides `performChatStream` with real token streaming: it calls the `streamGenerateContent` endpoint and drains the SSE body through the shared `SseLineParser`, pushing one `ChatStreamChunkType` per non-empty text delta on the caller's sink (matching `chatStream`'s contract). A request carrying tools still falls back to the buffered default (`super.performChatStream`).

### Patch Changes

- Add a consumer-configurable `systemPrompt` option, forwarded to the `BaseAdapter` seam: when set, it is injected as the leading system turn of any request that carries no system message of its own (never overriding an explicit one, no-op when empty). Lets a consumer set a default directive once at construction instead of hand-prepending a system message to every call.
- Forward `request.maxTokens` to Gemini's native `generationConfig.maxOutputTokens` field.
- Enforce the `timeoutMs` deadline (default 60s) around the REST POST via an internal `AbortController`. An expired deadline surfaces as a `TIMEOUT` classification — the timeout abort reason is a `TIMEOUT`-classified `LlmError` that the network catch now re-throws unchanged, so it is no longer downgraded to `NETWORK`. A cascade falls through to the next adapter instead of hanging.

## 0.27.0

## 0.26.0

## 0.25.0

## 0.24.0

## 0.23.0

## 0.22.0

### Changed

- **Adapter-contract interfaces carry the `Interface` suffix (semver-major).** The framework contracts this package's public surface names are imported under their suffixed names: `EntityValidatorInterface` (the compiled host/response validator). The rename is type-only and propagates from `@studnicky/dagonizer`; runtime behavior is unchanged. Consumers typing against the old bare name (`EntityValidator`) update to the suffixed name.
- The Gemini `generateContent` response body is schema-backed. `GeminiResponseBodySchema` (JSON Schema 2020-12) is the source of truth and `GeminiResponseBodyType` derives from it via `FromSchema`. The `geminiResponseBodyValidator`, compiled once at module load through the engine's shared `Validator.compile` (`@studnicky/dagonizer/validation`), narrows the `unknown` HTTP body at the network boundary. The hand-written `GeminiResponseBody`/`GeminiPart` interfaces and the `isGeminiResponseBody` predicate are removed.
- The `classify` override is removed. The `LlmError` passthrough and the `aborted|timeout` → `TIMEOUT` mapping live in `BaseAdapterCore.classify`; gemini-api carries no provider-specific branch, so it inherits the base classifier directly.

### Added

- Public schema surface: `GeminiResponseBodySchema`, `GeminiCandidateSchema`, `GeminiContentSchema`, `GeminiPartSchema`, `GeminiFunctionCallSchema`, `GeminiUsageMetadataSchema`, the `GeminiResponseBodyType` type, and the `geminiResponseBodyValidator`.

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
