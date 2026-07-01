# @studnicky/dagonizer-adapter-gemini-nano

## 0.29.1

## 0.29.0

### Patch Changes

- 23ec54b: Enforce a single shared hard abort+timeout race in `BaseAdapter.chat()` so every adapter — cloud and in-browser — inherits identical cancellation semantics. The base now wraps `performChat()` in a guard that folds a per-request timeout and the caller's `AbortSignal` into one composed signal, passes it through to `performChat`, and rejects the instant that signal aborts even when the underlying operation never settles. A frozen in-browser stream or a hung socket therefore always rejects within the configured ceiling instead of hanging the caller.

  The timeout is configurable via the existing `timeoutMs` adapter option (module-level default 60 000 ms). A new protected `onCancelRequested()` hook gives subclasses a best-effort cooperative-cancel seam; `WebLlmAdapter` overrides it to call `engine.interruptGenerate()`. The HTTP adapters (`OpenAiCompatibleAdapter` and its `ollama` subclass, gemini-api, anthropic) drop their per-adapter timeout machinery and forward `request.signal` directly to `fetch`; the on-device `gemini-nano` adapter forwards it to `lm.create()`/`session.prompt()`. `WebLlmAdapter` no longer enforces its own timer; correctness comes from the base. Public adapter APIs, capabilities, and schemas are unchanged.

## 0.28.1

## 0.28.0

## [unreleased]

### Minor Changes

- `GeminiNanoAdapter` overrides `performChatStream` with real on-device token streaming: it opens the session with `LanguageModel.create()` and drains `session.promptStreaming()`, pushing one `ChatStreamChunkType` per delta on the caller's sink as the on-device model generates. A request carrying tools still falls back to the buffered default (`super.performChatStream`) — tool turns need the JSON-coercion (`responseConstraint` + `ToolCallCodec.decode`) shape, which has no streamed variant.

### Patch Changes

- Add a per-request `timeoutMs` option (default 60s) enforced around `LanguageModel.create()` and `session.prompt()`; an expired deadline aborts the on-device call and surfaces as a `TIMEOUT` classification so a cascade falls through rather than hanging.
- All system turns are collapsed into a single index-0 system prompt passed to `LanguageModel.create()`; user turns go to `prompt()`. A user-only request passes no `initialPrompts` (a valid session). `create()` failures route through `LlmError` classification.
- `globalThis.LanguageModel` is narrowed via the structural `LanguageModelHost.is` type-predicate (checks `typeof === 'function'` on the global), so `probe()` succeeds on-device in Chrome. `LanguageModelHost` is exported in place of the removed `languageModelStaticValidator`; the session host keeps its `languageModelSessionValidator`.

## 0.27.0

## 0.26.0

## 0.25.0

## 0.24.0

## 0.23.0

## 0.22.0

### Changed

- **Adapter-contract interfaces carry the `Interface` suffix (semver-major).** The framework contracts this package's public surface names are imported under their suffixed names: `EntityValidatorInterface` (the compiled host/response validator). The rename is type-only and propagates from `@studnicky/dagonizer`; runtime behavior is unchanged. Consumers typing against the old bare name (`EntityValidator`) update to the suffixed name.
- The browser `window.LanguageModel` host object is schema-backed. `LanguageModelStaticSchema` and `LanguageModelSessionSchema` (JSON Schema 2020-12) describe the host members; the base types derive via `FromSchema` and the tier-3 narrowing interfaces `LanguageModelStaticInterface` / `LanguageModelSessionInterface` add the call signatures the schema cannot express. The adapter reads `globalThis.LanguageModel` as `unknown` and narrows it through `languageModelStaticValidator` (and the live session through `languageModelSessionValidator`) before use. Both validators are compiled once at module load through the engine's shared `Validator.compile` (`@studnicky/dagonizer/validation`). The hand-written `LanguageModelStatic`/`LanguageModelSession`/`PromptOptions` interfaces and the cast-based `getLanguageModel` accessor are removed.
- `GeminiNanoAvailability` is renamed to `GeminiNanoAvailabilityType`. This is a breaking rename of the exported type.
- The `classify` override keeps only the provider-specific `MODEL_NOT_FOUND` (`availability|not present`) branch and delegates everything else to `super.classify`. The shared `LlmError` passthrough and `aborted|timeout` → `TIMEOUT` mapping now live in `BaseAdapterCore.classify`.
- Tool-result messages flatten through the shared `BaseAdapter.formatToolResult(message)` static rather than an inline `[tool <name> result] <content>` string, so the format is single-sourced across the text-only adapters.

### Added

- Public schema surface: `LanguageModelStaticSchema`, `LanguageModelSessionSchema`, the `LanguageModelStaticInterface` / `LanguageModelSessionInterface` / `PromptOptionsInterface` types, the `*BaseType` derivations, and the `languageModelStaticValidator` / `languageModelSessionValidator`.
- Adds `"browser"` export condition to the `.` entry for bundler target selection.

## 0.21.0

## 0.20.0

## 0.19.0

## 0.17.0

### Minor Changes

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
