# @studnicky/dagonizer-embedder-transformers

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

- 23ec54b: Add the `LocalModelEmbedder<TModule, TModel>` taxonomy and run the on-device embedders fully offline.

  `LocalModelEmbedder` is an abstract intermediate under `BaseEmbedder` (mirroring how `OpenAiCompatibleAdapter` sits under `BaseAdapter`) that centralizes the on-device lifecycle the three local embedders duplicated: a memoized module load plus shape-stable model-handle build, `connect`/`disconnect`/`performEmbed`, and the `loadModule`/`spawnModel`/`embedWith` seams. The transformers, TensorFlow.js, and WebLLM embedders migrate onto it, and each CDN `import('https://esm.run/...')` is replaced with a bundled npm dependency (`@huggingface/transformers`, `@tensorflow-models/universal-sentence-encoder` + `@tensorflow/tfjs`, `@mlc-ai/web-llm`) so the libraries resolve from `node_modules` — no runtime CDN, bundler-friendly, node-resolvable.

  `TransformersEmbedder` additionally loads its model fully offline: it forces transformers.js onto local-only resolution (`env.allowRemoteModels = false`, `env.localModelPath` at the package's vendored `models/` directory) and loads the quantized ONNX weights (`dtype: 'q8'`), with no Hugging Face hub fetch at runtime. The `Xenova/all-MiniLM-L6-v2` weights are vendored by a `fetch-model` script (wired as `prebuild`/`pretest`) into a git-ignored `models/` dir. `localModelPath` and a new `wasmPaths` option are overridable per instance so a consumer can serve the model + onnxruntime WASM from its own bundle.

## 0.28.1

## 0.28.0

## 0.27.0

### Added

- Adds `"browser"` export condition to the `.` entry for bundler target selection.

### Changed

- `TransformersEmbedder.listModels()` returns the curated known-good embedding
  catalog — the `KNOWN_DIMENSIONS` subset (`Xenova/all-MiniLM-L6-v2`,
  `Xenova/bge-small-en-v1.5`, `Xenova/gte-small`, all `cloud: false`,
  `variant: 'embedding'`) — instead of only the currently-selected model.
  transformers.js can load any HF feature-extraction model; this catalog is the
  subset with known output dimensions, derived from `Object.keys(KNOWN_DIMENSIONS)`
  as the single source of truth.

## [0.26.0] - 2026-06-23

### Added

- `TransformersEmbedder`: in-browser text embedder backed by transformers.js
  (Hugging Face) running on ONNX Runtime WASM. Extends `BaseEmbedder` and
  satisfies `EmbedderInterface` for plug-in use with `EmbedderRegistry` and
  `EmbedderCascade`.
- Default model is `Xenova/all-MiniLM-L6-v2` (384 dimensions). Known-dimensions
  table covers `Xenova/all-MiniLM-L6-v2`, `Xenova/bge-small-en-v1.5`, and
  `Xenova/gte-small` (all 384-dim); unknown models fall through to 384 default
  or accept an explicit `dimensions` override.
- `TransformersHost.ts`: JSON Schema 2020-12 (`TransformersModuleSchema`) and
  compiled `Validator` (`transformersModuleValidator`) for the dynamically-imported
  `@huggingface/transformers` ESM bundle. Foreign module is imported once from
  `https://esm.run/@huggingface/transformers` via `import(/* @vite-ignore */ URL)`
  and narrowed through the schema at the import boundary. No npm dependency on
  the foreign library.
- `probe()` always returns `true`: ONNX Runtime WASM runs in every modern browser
  without WebGPU. `listModels()` returns the single configured embedding model
  with `cloud: false`.
- Package index exports the class, options type, host schema, validator, and
  all entity-narrowing types.
