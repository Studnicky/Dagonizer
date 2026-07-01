---
"@studnicky/dagonizer": minor
"@studnicky/dagonizer-embedder-transformers": minor
"@studnicky/dagonizer-embedder-tensorflow": minor
"@studnicky/dagonizer-embedder-web-llm": minor
---

Add the `LocalModelEmbedder<TModule, TModel>` taxonomy and run the on-device embedders fully offline.

`LocalModelEmbedder` is an abstract intermediate under `BaseEmbedder` (mirroring how `OpenAiCompatibleAdapter` sits under `BaseAdapter`) that centralizes the on-device lifecycle the three local embedders duplicated: a memoized module load plus shape-stable model-handle build, `connect`/`disconnect`/`performEmbed`, and the `loadModule`/`spawnModel`/`embedWith` seams. The transformers, TensorFlow.js, and WebLLM embedders migrate onto it, and each CDN `import('https://esm.run/...')` is replaced with a bundled npm dependency (`@huggingface/transformers`, `@tensorflow-models/universal-sentence-encoder` + `@tensorflow/tfjs`, `@mlc-ai/web-llm`) so the libraries resolve from `node_modules` — no runtime CDN, bundler-friendly, node-resolvable.

`TransformersEmbedder` additionally loads its model fully offline: it forces transformers.js onto local-only resolution (`env.allowRemoteModels = false`, `env.localModelPath` at the package's vendored `models/` directory) and loads the quantized ONNX weights (`dtype: 'q8'`), with no Hugging Face hub fetch at runtime. The `Xenova/all-MiniLM-L6-v2` weights are vendored by a `fetch-model` script (wired as `prebuild`/`pretest`) into a git-ignored `models/` dir. `localModelPath` and a new `wasmPaths` option are overridable per instance so a consumer can serve the model + onnxruntime WASM from its own bundle.
