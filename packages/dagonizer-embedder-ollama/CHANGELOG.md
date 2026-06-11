# @noocodex/dagonizer-embedder-ollama

## [unreleased]

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
  - @noocodex/dagonizer@0.14.0

## 0.13.2

### Patch Changes

- Updated dependencies [238a94d]
  - @noocodex/dagonizer@0.13.2

## 0.12.0

### Patch Changes

- Updated dependencies [7c0e38a]
- Updated dependencies [3286d07]
  - @noocodex/dagonizer@0.12.0
