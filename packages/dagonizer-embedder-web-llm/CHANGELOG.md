# @studnicky/dagonizer-embedder-web-llm

## 0.27.0

## [Unreleased]

### Changed

- `listModels()` returns the full static embedding catalog mirroring `@mlc-ai/web-llm`'s `prebuiltAppConfig.model_list` filtered to `ModelType.embedding`: `snowflake-arctic-embed-m-q0f32-MLC-b32` (768), `snowflake-arctic-embed-m-q0f32-MLC-b4` (768), `snowflake-arctic-embed-s-q0f32-MLC-b32` (384), `snowflake-arctic-embed-s-q0f32-MLC-b4` (384). `KNOWN_DIMENSIONS` carries all four ids as the single source of truth for dimensionality, and the catalog is derived from its keys. No network call and no WebGPU is required to enumerate the catalog. The default model remains `snowflake-arctic-embed-s-q0f32-MLC-b4`.

## [0.26.0]

### Added

- `WebLlmEmbedder` class extending `BaseEmbedder` to run in-browser text embeddings via `@mlc-ai/web-llm` over WebGPU. Default model is `snowflake-arctic-embed-s-q0f32-MLC-b4` (384 dimensions); `snowflake-arctic-embed-m-q0f32-MLC-b4` (768 dimensions) is supported via `options.model`.
- `WebLlmEmbedderHost` module: `WebLlmEmbedderModuleSchema` and `WebLlmEmbedderEngineSchema` (JSON Schema 2020-12) with `FromSchema`-derived types and compiled `webLlmEmbedderModuleValidator` / `webLlmEmbedderEngineValidator`. The `@mlc-ai/web-llm` ESM bundle is loaded from the CDN at `https://esm.run/@mlc-ai/web-llm` with no npm dependency; the `unknown` foreign boundary is narrowed exclusively via these validators.
- `probe()` returns true iff `navigator.gpu` is present. In Node (no WebGPU) it returns false, so the `EmbedderCascade` routes around this embedder transparently.
- `connect()` lazy-loads and memoizes the engine; `disconnect()` clears the memoized reference.
- `listModels()` returns a single `{ variant: 'embedding', cloud: false }` descriptor for the currently selected model.
