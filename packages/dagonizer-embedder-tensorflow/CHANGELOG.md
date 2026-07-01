# @studnicky/dagonizer-embedder-tensorflow

## 0.29.0

### Minor Changes

- 23ec54b: Add the `LocalModelEmbedder<TModule, TModel>` taxonomy and run the on-device embedders fully offline.

  `LocalModelEmbedder` is an abstract intermediate under `BaseEmbedder` (mirroring how `OpenAiCompatibleAdapter` sits under `BaseAdapter`) that centralizes the on-device lifecycle the three local embedders duplicated: a memoized module load plus shape-stable model-handle build, `connect`/`disconnect`/`performEmbed`, and the `loadModule`/`spawnModel`/`embedWith` seams. The transformers, TensorFlow.js, and WebLLM embedders migrate onto it, and each CDN `import('https://esm.run/...')` is replaced with a bundled npm dependency (`@huggingface/transformers`, `@tensorflow-models/universal-sentence-encoder` + `@tensorflow/tfjs`, `@mlc-ai/web-llm`) so the libraries resolve from `node_modules` — no runtime CDN, bundler-friendly, node-resolvable.

  `TransformersEmbedder` additionally loads its model fully offline: it forces transformers.js onto local-only resolution (`env.allowRemoteModels = false`, `env.localModelPath` at the package's vendored `models/` directory) and loads the quantized ONNX weights (`dtype: 'q8'`), with no Hugging Face hub fetch at runtime. The `Xenova/all-MiniLM-L6-v2` weights are vendored by a `fetch-model` script (wired as `prebuild`/`pretest`) into a git-ignored `models/` dir. `localModelPath` and a new `wasmPaths` option are overridable per instance so a consumer can serve the model + onnxruntime WASM from its own bundle.

## 0.28.1

## 0.28.0

## [Unreleased]

### Added

- Adds `"browser"` export condition to the `.` entry for bundler target selection.

## 0.27.0

## [0.26.0]

### Added

- `UniversalSentenceEncoderEmbedder` — in-browser text embedder extending `BaseEmbedder` via TensorFlow.js Universal Sentence Encoder (USE). Lazy-loads the CDN ESM bundle from `esm.run` on first `connect()`; memoizes the loaded model for the lifetime of the instance. Produces 512-dimensional vectors on WASM and WebGL backends; no WebGPU required.
- `UniversalSentenceEncoderHost` — CDN URL constant (`TFJS_USE_ESM`), JSON Schema 2020-12 descriptors for the imported module (`TfjsUseModuleSchema`) and loaded model (`TfjsUseModelSchema`), `FromSchema`-derived base types, entity-narrowing interfaces (`TfjsUseModuleInterface`, `TfjsUseModelInterface`), and compiled validators (`tfjsUseModuleValidator`, `tfjsUseModelValidator`). All validators are compiled once at module load through the engine's shared Ajv (`Validator.compile`).
- `probe()` returns `true` unconditionally (WASM/WebGL availability floor).
- `listModels()` returns a single `{ name, variant: 'embedding', cloud: false }` descriptor for the default USE model.
- Package root barrel (`index.ts`) exports the embedder class, options type, host schemas, validators, and all entity-narrowing types.
