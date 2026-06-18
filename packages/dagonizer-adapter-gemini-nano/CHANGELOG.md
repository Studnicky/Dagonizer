# @studnicky/dagonizer-adapter-gemini-nano

## [Unreleased]

### Changed

- The browser `window.LanguageModel` host object is now schema-backed. `LanguageModelStaticSchema` and `LanguageModelSessionSchema` (JSON Schema 2020-12) describe the host members; the base types derive via `FromSchema` and the tier-3 narrowing interfaces `LanguageModelStaticInterface` / `LanguageModelSessionInterface` add the call signatures the schema cannot express. The adapter reads `globalThis.LanguageModel` as `unknown` and narrows it through `languageModelStaticValidator` (and the live session through `languageModelSessionValidator`) before use. Both validators are compiled once at module load through the engine's shared `Validator.compile` (`@studnicky/dagonizer/validation`). The hand-written `LanguageModelStatic`/`LanguageModelSession`/`PromptOptions` interfaces and the cast-based `getLanguageModel` accessor are removed.
- `GeminiNanoAvailability` is renamed to `GeminiNanoAvailabilityType`. This is a breaking rename of the exported type.
- The `classify` override keeps only the provider-specific `MODEL_NOT_FOUND` (`availability|not present`) branch and delegates everything else to `super.classify`. The shared `LlmError` passthrough and `aborted|timeout` → `TIMEOUT` mapping now live in `BaseAdapterCore.classify`.
- Tool-result messages flatten through the shared `BaseAdapter.formatToolResult(message)` static rather than an inline `[tool <name> result] <content>` string, so the format is single-sourced across the text-only adapters.

### Added

- Public schema surface: `LanguageModelStaticSchema`, `LanguageModelSessionSchema`, the `LanguageModelStaticInterface` / `LanguageModelSessionInterface` / `PromptOptionsInterface` types, the `*BaseType` derivations, and the `languageModelStaticValidator` / `languageModelSessionValidator`.

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
