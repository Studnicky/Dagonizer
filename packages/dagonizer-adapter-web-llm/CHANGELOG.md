# @studnicky/dagonizer-adapter-web-llm

## 0.22.0

## [Unreleased]

### Changed

- **Adapter-contract interfaces carry the `Interface` suffix (semver-major).** The framework contracts this package's public surface names are imported under their suffixed names: `EntityValidatorInterface` (the compiled host/response validator) and `ToolInterface` (the tool contract the adapter's tool-call dispatch operates against). The renames are type-only and propagate from `@studnicky/dagonizer`; runtime behavior is unchanged. Consumers typing against the old bare names (`EntityValidator`, `Tool`) update to the suffixed names.
- The dynamically-imported `@mlc-ai/web-llm` module and its engine are now schema-backed. `WebLlmModuleSchema` and `WebLlmEngineSchema` (JSON Schema 2020-12) describe the host members; the base types derive via `FromSchema` and the tier-3 narrowing interfaces `WebLlmModuleInterface` / `WebLlmEngineInterface` add the call signatures the schema cannot express. `#boot` validates the imported module and the created engine through `webLlmModuleValidator` / `webLlmEngineValidator` at the import boundary. Both validators are compiled once at module load through the engine's shared `Validator.compile` (`@studnicky/dagonizer/validation`). The `navigator.gpu` probe narrows the WebGPU global structurally via `Reflect` instead of a fabricated cast. The hand-written `WebLlmEngine`/`WebLlmModule` interfaces are removed.
- The lazy engine promise moves from a `Promise | null` instance field to a module-level `WeakMap` keyed on the adapter instance, fixing the V8 hidden-class transition: every `WebLlmAdapter` instance shape is now fixed at construction.
- `WebLlmInitReport` is renamed to `WebLlmInitReportInterface`. This is a breaking rename of the exported type.
- The `classify` override keeps only the provider-specific `MODEL_NOT_FOUND` (`webgpu`) branch and delegates everything else to `super.classify`. The shared `LlmError` passthrough and `aborted|timeout` → `TIMEOUT` mapping now live in `BaseAdapterCore.classify`.
- Tool-result messages flatten through the shared `BaseAdapter.formatToolResult(message)` static rather than an inline `[tool <name> result] <content>` string, so the format is single-sourced across the text-only adapters.

### Added

- Public schema surface: `WebLlmModuleSchema`, `WebLlmEngineSchema`, the `WebLlmModuleInterface` / `WebLlmEngineInterface` / `WebLlmCompletionParamsInterface` / `WebLlmCompletionResultInterface` / `WebLlmInitReportInterface` types, the `*BaseType` derivations, and the `webLlmModuleValidator` / `webLlmEngineValidator`.

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
