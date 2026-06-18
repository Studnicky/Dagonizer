# @studnicky/dagonizer-book-entities

## 0.21.0

## 0.20.0

## [unreleased]

### Changed

- `Book`, `Candidate`, `Money` and the `BookIdentity`/`BookPublication`/`BookAvailability` sub-entities derive from JSON Schema 2020-12 `*Schema` consts via `FromSchema`; the schema is the single source of truth. `MoneySchema`, `BookIdentitySchema`, `BookPublicationSchema`, `BookAvailabilitySchema`, `BookSchema`, and `CandidateSchema` ship from the package root.
- `firstPublishYear`, `summary`, and `inStock` use null sentinels (`T | null`, required key) instead of `T | undefined`, keeping V8 hidden-class shape stable under `exactOptionalPropertyTypes`. `BookBuilder.from` fills `null` for absent values.
- `CanonicalId` is now a sealed static class (`private constructor`); direct instantiation is a compile error.
- `Candidate.source` type changed from the no-op `'web-search' | string` union to `string` (honest type).
- **Naming: domain-class verbs (semver-major).** `CanonicalId.fromIsbns` → `CanonicalId.ofIsbns` and `CanonicalId.fromWork` → `CanonicalId.ofWork`. The `noun.of<Source>()` form reads as materialising a canonical id from a source; behavior is unchanged.

## 0.19.0

## 0.17.0

### Minor Changes

- 34b7155: Apply Clean Code manifesto: static classes replace free functions, named constants replace magic numbers, flag arguments replaced with options objects, SRP extractions from Dagonizer core.

  **Breaking removals:** `detectGeminiNano` (→ `GeminiNanoAdapter.detect()`), `decodeToolCallsJson` (→ `ToolCallCodec.decode()`), `classifyHttp` (→ `LlmError.classifyHttp()`), `asNetworkError` (→ `LlmError.fromNetworkError()`).

  **New:** `DAGValidator`, `StateMapper`, `ScatterCheckpoint`, `PlacementUtils`, `ToolCallCodec`, `OpenLibraryDocs`, `BookEntitiesError`, `ExecutionError.fromSignal()`, `GeminiNanoAdapter.detect()`.

## 0.16.0

## 0.15.0

## 0.14.0

## 0.13.2
