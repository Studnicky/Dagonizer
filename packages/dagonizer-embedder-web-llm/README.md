# @studnicky/dagonizer-embedder-web-llm

In-browser text embedder for `@studnicky/dagonizer`.

Runs `@mlc-ai/web-llm` embedding models over WebGPU in the browser — no
server required. Extends `BaseEmbedder` and satisfies `EmbedderInterface`
so it slots directly into `EmbedderRegistry` and `EmbedderCascade`.

## Requirements

- **Browser with WebGPU** (`navigator.gpu` must be present). Chrome 113+ and
  Edge 113+ support WebGPU; Safari 17.4+ has experimental support.
- `@studnicky/dagonizer` peer dependency.
- **No npm dependency on `@mlc-ai/web-llm`** — the ESM bundle is loaded at
  runtime from `https://esm.run/@mlc-ai/web-llm` (CDN dynamic import).

## Usage

```ts
import { WebLlmEmbedder } from '@studnicky/dagonizer-embedder-web-llm';

// Default: snowflake-arctic-embed-s-q0f32-MLC-b4 (384 dimensions)
const embedder = new WebLlmEmbedder();

// connect() lazy-loads the model from CDN (may take several seconds on first
// call while the model weights download)
await embedder.connect();
const vector = await embedder.embed('hello world');
```

## Models

| Model ID | Dimensions |
|---|---|
| `snowflake-arctic-embed-s-q0f32-MLC-b4` | 384 (default) |
| `snowflake-arctic-embed-m-q0f32-MLC-b4` | 768 |

Override the model at construction:

```ts
const embedder = new WebLlmEmbedder({
  model: 'snowflake-arctic-embed-m-q0f32-MLC-b4',
});
```

## Probe and cascade

`probe()` returns `true` when `navigator.gpu` is present. In Node.js (no
WebGPU) it returns `false` so `EmbedderCascade` transparently skips this
embedder and falls through to the next registered option.

## Engine lazy-loading

The WebLLM ESM bundle and model weights are loaded on the first `connect()`
or `embed()` call. The engine is memoized for the lifetime of the embedder
instance. Call `disconnect()` to release the reference and allow reload on
the next use.
