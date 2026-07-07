# @studnicky/dagonizer-embedder-ollama

## 1.0.1

## 1.0.0

### Patch Changes

- Updated dependencies [fdaa32a]
  - @studnicky/dagonizer@1.0.0

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

## 0.29.1

## 0.29.0

### Minor Changes

- 23ec54b: Add the `CloudEmbedder` taxonomy for the REST cloud embedders.

  `CloudEmbedder extends BaseEmbedder` is the cloud sibling of `LocalModelEmbedder` (mirroring how `OpenAiCompatibleAdapter` sits under `BaseAdapter`). It implements `performEmbed` once — build request → `fetchJson` → parse — behind `endpoint()`/`requestInit(text)`/`vectorFrom(body)` seams. The gemini-api, mistral, and ollama embedders migrate onto it, each reduced to its provider's endpoint, headers, body, and response shape. No wire-behavior change.

## 0.28.1

## 0.28.0

## 0.27.0

## 0.26.0

## 0.25.0

## 0.24.0

## 0.23.0

## 0.22.0

### Changed

- **Mandatory `Type` suffix on the embed-response entity type (semver-major rename).** The `FromSchema`-derived response type is `OllamaEmbedResponseType`; the `OllamaEmbedResponseSchema` const and `OllamaEmbedResponseValidator` keep their names. The renamed type ships from the package root. Type-only; behavior is unchanged.
- The embed response wire shape is schema-backed. `OllamaEmbedResponseSchema` (JSON Schema 2020-12) and its `FromSchema`-derived `OllamaEmbedResponseType` type live in `OllamaEmbedResponse.ts`, with an `OllamaEmbedResponseValidator` compiled once at module load through the framework's shared Ajv via `Validator.compile`. The schema, type, and validator are exported from the package root.
- `performEmbed` routes its HTTP call through the inherited `BaseEmbedder.fetchJson`, narrows the returned body via `OllamaEmbedResponseValidator.is`, and throws an `LlmError` on a missing or empty `embedding`. The hand-written `OllamaEmbedResponse` interface, the `isOllamaEmbedResponse` predicate, and the local `fetch`/network-catch/`!res.ok` scaffold are removed.
- Model, base-URL, and API-key defaults resolve through a module-level `OLLAMA_EMBEDDER_DEFAULTS` const spread over the options object. The private `#apiKey` field is a required `string` (empty-string default) instead of `string | undefined`, keeping the instance shape stable; the Authorization header is gated on a non-empty key.
- `OllamaEmbedderOptions` extends the shared `BaseEmbedderOptions` (re-exported from `@studnicky/dagonizer/adapter`), inheriting `model?`/`dimensions?` and adding only its own `baseUrl?`/`apiKey?` extras instead of re-declaring `model?`/`dimensions?` against `BaseAdapterCoreOptions`. The provider default (`nomic-embed-text`, 768-dim) still resolves through `OLLAMA_EMBEDDER_DEFAULTS` and the `KNOWN_DIMENSIONS` table. Behaviour is unchanged.

## 0.21.0

## 0.20.0

### Added

- `OllamaEmbedderOptions.apiKey` — optional API key for Ollama Cloud authentication. When present, `performEmbed` and `probe` include `Authorization: Bearer <apiKey>` in every request. Absent for local daemon usage (no header sent).
- `baseUrl` documentation updated to describe Ollama Cloud endpoint (`https://api.ollama.ai`) alongside the local default.
- JSDoc on `OllamaEmbedder` and `OllamaEmbedderOptions` documents local-vs-cloud usage patterns.

## 0.19.0

### Changed

- `OllamaEmbedResponse.embedding` is now a required field; response body is narrowed at the ingest boundary via a typed `isOllamaEmbedResponse` guard, replacing the unchecked `as OllamaEmbedResponse` cast.
- Dimension resolution chain removes the dead trailing `?? 768` literal; a module-level `DEFAULT_DIMENSIONS` constant now serves as the explicit final fallback, symmetric with `GeminiApiEmbedder` and `MistralEmbedder`.
- JSDoc on `OllamaEmbedderOptions` and the constructor documents the no-API-key constructor asymmetry relative to the other two embedders.

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
