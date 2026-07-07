# @studnicky/dagonizer-book-entities

## 1.0.1

## 1.0.0

## 0.30.1

## 0.30.0

## 0.30.0

## 0.29.1

## 0.29.0

## 0.28.1

## 0.28.0

## 0.27.0

## 0.26.0

## 0.25.0

## 0.24.0

## 0.23.0

## 0.22.0

## 0.21.0

## 0.20.0

### Changed

- **Mandatory `Type` suffix on every entity type (semver-major rename).** The six `FromSchema`-derived book entity types carry a `Type` suffix: `MoneyType`, `BookIdentityType`, `BookPublicationType`, `BookAvailabilityType`, `BookType`, `CandidateType`. The `*Schema` consts and the `BookBuilder` factory class keep their names, and the `BookInput` input interface keeps its bare name. All six types ship from the package root. The rename is type-only; runtime behavior is unchanged.
- `BookType`, `CandidateType`, `MoneyType` and the `BookIdentityType`/`BookPublicationType`/`BookAvailabilityType` sub-entities derive from JSON Schema 2020-12 `*Schema` consts via `FromSchema`; the schema is the single source of truth. `MoneySchema`, `BookIdentitySchema`, `BookPublicationSchema`, `BookAvailabilitySchema`, `BookSchema`, and `CandidateSchema` ship from the package root.
- `firstPublishYear`, `summary`, and `inStock` use null sentinels (`T | null`, required key), keeping V8 hidden-class shape stable under `exactOptionalPropertyTypes`. `BookBuilder.from` fills `null` for absent values.
- `CanonicalId` is a sealed static class (`private constructor`); direct instantiation is a compile error.
- `CandidateType.source` is typed `string` (honest type, not the no-op `'web-search' | string` union).
- **Naming: domain-class verbs (semver-major).** The canonical materializers are `CanonicalId.ofIsbns` and `CanonicalId.ofWork`. The `noun.of<Source>()` form reads as materialising a canonical id from a source; behavior is unchanged.

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
