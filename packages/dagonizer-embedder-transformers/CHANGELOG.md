# @studnicky/dagonizer-embedder-transformers

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
