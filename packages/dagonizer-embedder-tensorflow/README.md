# @studnicky/dagonizer-embedder-tensorflow

> **Beta:** not yet published to npm. Ships as part of the Dagonizer
> plugin ecosystem (GitHub release only). Browser-only; requires a
> modern browser with WebAssembly or WebGL support. The USE model is
> loaded on first `connect()` call via CDN ESM (`esm.run`).

In-browser embedder for [@studnicky/dagonizer](https://npmjs.com/package/@studnicky/dagonizer)
via TensorFlow.js Universal Sentence Encoder (USE). Produces 512-dimensional
vectors via WASM and WebGL backends — no WebGPU required.

## Install

```bash
npm install @studnicky/dagonizer @studnicky/dagonizer-embedder-tensorflow
```

No additional host-side setup is needed. The USE model and its TensorFlow.js
runtime are loaded on demand from `https://esm.run/@tensorflow-models/universal-sentence-encoder`.

## Usage

```ts
import { UniversalSentenceEncoderEmbedder } from '@studnicky/dagonizer-embedder-tensorflow';

const embedder = new UniversalSentenceEncoderEmbedder();
await embedder.connect();                           // loads CDN model once
const vector = await embedder.embed('the cat sat on the mat');
// vector.length === embedder.dimensions === 512
```

## Options

| Option | Default | Notes |
|---|---|---|
| `model` | `universal-sentence-encoder` | Fixed; USE has a single default model |
| `dimensions` | `512` | Fixed; USE always produces 512-dimensional vectors |
| `maxAttempts` | 3 | Retry budget (inherited from `BaseEmbedder`) |

## Known model dimensions

| Model | Dimensions |
|---|---|
| `universal-sentence-encoder` | 512 |

USE has a single model; `dimensions` is always 512 and never needs to be
overridden in normal usage.

## CDN load

The embedder loads the USE module once from CDN on the first `connect()` or
`embed()` call. The CDN bundle (`esm.run`) pulls the `@tensorflow/tfjs` runtime
transitively — no npm dependency on TensorFlow is required. The loaded module
and model are validated against JSON Schema 2020-12 before use.

To reset the loaded model (e.g. for testing), call `disconnect()`:

```ts
await embedder.disconnect(); // clears memoized model
await embedder.connect();    // reloads on next embed
```

## Probe

Returns `true` unconditionally. USE runs on WASM and WebGL backends, which
are available on every modern browser and in Node.js with
`@tensorflow/tfjs-node`. No WebGPU hardware gate is applied.

## License

MIT
