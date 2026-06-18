# @studnicky/dagonizer-embedder-gemini-api

## [Unreleased]

### Changed

- The embed response wire shape is schema-backed. `GeminiApiEmbedResponseSchema` (JSON Schema 2020-12) and its `FromSchema`-derived `GeminiApiEmbedResponse` type live in `GeminiApiEmbedResponse.ts`, with a `GeminiApiEmbedResponseValidator` compiled once at module load through the framework's shared Ajv via `Validator.compile`. The schema, type, and validator are exported from the package root.
- `performEmbed` routes its HTTP call through the inherited `BaseEmbedder.fetchJson`, narrows the returned body via `GeminiApiEmbedResponseValidator.is`, and throws an `LlmError` on a missing or empty `embedding.values`. The hand-written `GeminiEmbedResponse` interface, the `isGeminiEmbedResponse` predicate, and the local `fetch`/network-catch/`!res.ok` scaffold are removed.
- Model and dimension defaults resolve through a module-level `GEMINI_API_EMBEDDER_DEFAULTS` const spread over the options bag.
- `GeminiApiEmbedderOptions` derives its `model?`/`dimensions?` overrides from the shared `BaseEmbedderOptions` (re-exported from `@studnicky/dagonizer/adapter`) instead of re-declaring them locally on `BaseAdapterCoreOptions`. The provider default (`text-embedding-004`, 768-dim) still lives in `GEMINI_API_EMBEDDER_DEFAULTS`. The public type stays `GeminiApiEmbedderOptions`; behaviour is unchanged.

## 0.21.0

## 0.20.0

## 0.19.0

### Changed

- `GeminiEmbedResponse` fields are now required (non-optional) and narrowed at the ingest boundary via a typed `isGeminiEmbedResponse` guard, replacing the unchecked `as GeminiEmbedResponse` cast.

## 0.17.0

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
