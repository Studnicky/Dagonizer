# @studnicky/dagonizer-embedder-mistral

## 0.27.0

## 0.26.0

## 0.25.0

## 0.24.0

## 0.23.0

## 0.22.0

### Changed

- **Mandatory `Type` suffix on the embed-response entity type (semver-major rename).** The `FromSchema`-derived response type is `MistralEmbedResponseType`; the `MistralEmbedResponseSchema` const and `MistralEmbedResponseValidator` keep their names. The renamed type ships from the package root. Type-only; behavior is unchanged.
- The embed response wire shape is schema-backed. `MistralEmbedResponseSchema` (JSON Schema 2020-12) and its `FromSchema`-derived `MistralEmbedResponseType` type live in `MistralEmbedResponse.ts`, with a `MistralEmbedResponseValidator` compiled once at module load through the framework's shared Ajv via `Validator.compile`. The schema, type, and validator are exported from the package root.
- `performEmbed` routes its HTTP call through the inherited `BaseEmbedder.fetchJson`, narrows the returned body via `MistralEmbedResponseValidator.is`, and throws an `LlmError` on a missing or empty `data[0].embedding`. The hand-written `MistralEmbedResponse` interface, the `isMistralEmbedResponse` predicate, and the local `fetch`/network-catch/`!res.ok` scaffold are removed.
- Model and dimension defaults resolve through a module-level `MISTRAL_EMBEDDER_DEFAULTS` const spread over the options object.
- `MistralEmbedderOptions` derives its `model?`/`dimensions?` overrides from the shared `BaseEmbedderOptions` (re-exported from `@studnicky/dagonizer/adapter`) instead of re-declaring them locally on `BaseAdapterCoreOptions`. The provider default (`mistral-embed`, 1024-dim) still lives in `MISTRAL_EMBEDDER_DEFAULTS`. The public type stays `MistralEmbedderOptions`; behaviour is unchanged.

## 0.21.0

## 0.20.0

## 0.19.0

### Changed

- `MistralEmbedResponse` fields are now required (non-optional) and narrowed at the ingest boundary via a typed `isMistralEmbedResponse` guard, replacing the unchecked `as MistralEmbedResponse` cast.

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
