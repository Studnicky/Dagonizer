# @studnicky/dagonizer-embedder-web-llm

## 1.0.0

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

- 23ec54b: Add the `LocalModelEmbedder<TModule, TModel>` taxonomy and run the on-device embedders fully offline.

  `LocalModelEmbedder` is an abstract intermediate under `BaseEmbedder` (mirroring how `OpenAiCompatibleAdapter` sits under `BaseAdapter`) that centralizes the on-device lifecycle the three local embedders duplicated: a memoized module load plus shape-stable model-handle build, `connect`/`disconnect`/`performEmbed`, and the `loadModule`/`spawnModel`/`embedWith` seams. The transformers, TensorFlow.js, and WebLLM embedders migrate onto it, and each CDN `import('https://esm.run/...')` is replaced with a bundled npm dependency (`@huggingface/transformers`, `@tensorflow-models/universal-sentence-encoder` + `@tensorflow/tfjs`, `@mlc-ai/web-llm`) so the libraries resolve from `node_modules` — no runtime CDN, bundler-friendly, node-resolvable.

  `TransformersEmbedder` additionally loads its model fully offline: it forces transformers.js onto local-only resolution (`env.allowRemoteModels = false`, `env.localModelPath` at the package's vendored `models/` directory) and loads the quantized ONNX weights (`dtype: 'q8'`), with no Hugging Face hub fetch at runtime. The `Xenova/all-MiniLM-L6-v2` weights are vendored by a `fetch-model` script (wired as `prebuild`/`pretest`) into a git-ignored `models/` dir. `localModelPath` and a new `wasmPaths` option are overridable per instance so a consumer can serve the model + onnxruntime WASM from its own bundle.

## 0.28.1

## 0.28.0

## 0.27.0

### Added

- Adds `"browser"` export condition to the `.` entry for bundler target selection.

### Changed

- `listModels()` returns the full static embedding catalog mirroring `@mlc-ai/web-llm`'s `prebuiltAppConfig.model_list` filtered to `ModelType.embedding`: `snowflake-arctic-embed-m-q0f32-MLC-b32` (768), `snowflake-arctic-embed-m-q0f32-MLC-b4` (768), `snowflake-arctic-embed-s-q0f32-MLC-b32` (384), `snowflake-arctic-embed-s-q0f32-MLC-b4` (384). `KNOWN_DIMENSIONS` carries all four ids as the single source of truth for dimensionality, and the catalog is derived from its keys. No network call and no WebGPU is required to enumerate the catalog. The default model remains `snowflake-arctic-embed-s-q0f32-MLC-b4`.

## [0.26.0]

### Added

- `WebLlmEmbedder` class extending `BaseEmbedder` to run in-browser text embeddings via `@mlc-ai/web-llm` over WebGPU. Default model is `snowflake-arctic-embed-s-q0f32-MLC-b4` (384 dimensions); `snowflake-arctic-embed-m-q0f32-MLC-b4` (768 dimensions) is supported via `options.model`.
- `WebLlmEmbedderHost` module: `WebLlmEmbedderModuleSchema` and `WebLlmEmbedderEngineSchema` (JSON Schema 2020-12) with `FromSchema`-derived types and compiled `webLlmEmbedderModuleValidator` / `webLlmEmbedderEngineValidator`. The `@mlc-ai/web-llm` ESM bundle is loaded from the CDN at `https://esm.run/@mlc-ai/web-llm` with no npm dependency; the `unknown` foreign boundary is narrowed exclusively via these validators.
- `probe()` returns true iff `navigator.gpu` is present. In Node (no WebGPU) it returns false, so the `EmbedderCascade` routes around this embedder transparently.
- `connect()` lazy-loads and memoizes the engine; `disconnect()` clears the memoized reference.
- `listModels()` returns a single `{ variant: 'embedding', cloud: false }` descriptor for the currently selected model.
