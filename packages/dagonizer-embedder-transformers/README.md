# @studnicky/dagonizer-embedder-transformers

> **Beta:** not yet published to npm. Ships as part of the Dagonizer
> plugin ecosystem (GitHub release only). Live-API smoke testing
> against the provider has not been completed; identity and model-list
> verification runs under Node via tsx.

In-browser embedder for [@studnicky/dagonizer](https://npmjs.com/package/@studnicky/dagonizer)
via [transformers.js](https://huggingface.co/docs/transformers.js) (Hugging Face),
running on ONNX Runtime WASM. No WebGPU required; works in every modern browser.

## Install

```bash
npm install @studnicky/dagonizer @studnicky/dagonizer-embedder-transformers
```

No additional host-side setup is required. The transformers.js bundle and the
selected ONNX model are loaded from the CDN on first `embed()` call.

## Usage

```ts
import { TransformersEmbedder } from '@studnicky/dagonizer-embedder-transformers';

const embedder = new TransformersEmbedder();
const vector = await embedder.embed('the cat sat on the mat');
// vector.length === embedder.dimensions === 384
```

With an explicit model:

```ts
const embedder = new TransformersEmbedder({ model: 'Xenova/bge-small-en-v1.5' });
```

## Options

| Option | Default | Notes |
|---|---|---|
| `model` | `Xenova/all-MiniLM-L6-v2` | Any transformers.js-compatible embedding model |
| `dimensions` | auto from known table | Required for models not in the built-in table |
| `maxAttempts` | 3 | Retry budget inherited from `BaseEmbedder` |

## Known model dimensions

| Model | Dimensions |
|---|---|
| `Xenova/all-MiniLM-L6-v2` | 384 |
| `Xenova/bge-small-en-v1.5` | 384 |
| `Xenova/gte-small` | 384 |

For other models pass `dimensions` explicitly.

## Probe

Always returns `true`. transformers.js runs on ONNX Runtime WASM, which is
available in every modern browser without WebGPU. The WASM runtime is the
universal floor; no probe round-trip is needed.

## Browser-only / CDN note

This embedder is designed for the browser. The transformers.js bundle is
loaded at runtime from `https://esm.run/@huggingface/transformers` via a
dynamic `import()`. No npm dependency on `@huggingface/transformers` is
added to this package; the CDN load is the only dependency at runtime.

## License

MIT
