# @studnicky/dagonizer-embedder-tensorflow

## [0.26.0]

### Added

- `UniversalSentenceEncoderEmbedder` — in-browser text embedder extending `BaseEmbedder` via TensorFlow.js Universal Sentence Encoder (USE). Lazy-loads the CDN ESM bundle from `esm.run` on first `connect()`; memoizes the loaded model for the lifetime of the instance. Produces 512-dimensional vectors on WASM and WebGL backends; no WebGPU required.
- `UniversalSentenceEncoderHost` — CDN URL constant (`TFJS_USE_ESM`), JSON Schema 2020-12 descriptors for the imported module (`TfjsUseModuleSchema`) and loaded model (`TfjsUseModelSchema`), `FromSchema`-derived base types, entity-narrowing interfaces (`TfjsUseModuleInterface`, `TfjsUseModelInterface`), and compiled validators (`tfjsUseModuleValidator`, `tfjsUseModelValidator`). All validators are compiled once at module load through the engine's shared Ajv (`Validator.compile`).
- `probe()` returns `true` unconditionally (WASM/WebGL availability floor).
- `listModels()` returns a single `{ name, variant: 'embedding', cloud: false }` descriptor for the default USE model.
- Package root barrel (`index.ts`) exports the embedder class, options type, host schemas, validators, and all entity-narrowing types.
