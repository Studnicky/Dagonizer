# @studnicky/dagonizer-adapter-gemini-api

## [Unreleased]

### Changed

- The Gemini `generateContent` response body is now schema-backed. `GeminiResponseBodySchema` (JSON Schema 2020-12) is the source of truth and `GeminiResponseBodyType` derives from it via `FromSchema`. The `geminiResponseBodyValidator`, compiled once at module load through the engine's shared `Validator.compile` (`@studnicky/dagonizer/validation`), narrows the `unknown` HTTP body at the network boundary. The hand-written `GeminiResponseBody`/`GeminiPart` interfaces and the `isGeminiResponseBody` predicate are removed.

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
