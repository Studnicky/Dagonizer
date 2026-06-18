# @studnicky/dagonizer-embedder-mistral

> **Beta:** not yet published to npm. Ships as part of the Dagonizer
> plugin ecosystem (GitHub release only). Live-API smoke testing
> against the provider has not been completed; wire-format
> compatibility is verified via intercepted-fetch smoke tests.

Mistral la Plateforme embedder for [@studnicky/dagonizer](https://npmjs.com/package/@studnicky/dagonizer).
Targets `mistral-embed` (1024 dimensions) by default.

## Install

```bash
npm install @studnicky/dagonizer @studnicky/dagonizer-embedder-mistral
```

## Usage

```ts
import { MistralEmbedder } from '@studnicky/dagonizer-embedder-mistral';

const embedder = new MistralEmbedder(process.env.MISTRAL_API_KEY!);
const vector = await embedder.embed('the cat sat on the mat');
// vector.length === embedder.dimensions === 1024
```

## Options

| Option | Default | Notes |
|---|---|---|
| `apiKey` (positional) | required | Free key at [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys/) |
| `model` | `mistral-embed` | Any Mistral embedding model |
| `dimensions` | 1024 | Override when targeting a different model |
| `maxAttempts` | 3 | Retry budget |

## Wire format

- Endpoint: `POST https://api.mistral.ai/v1/embeddings`
- Auth: `Authorization: Bearer <apiKey>` header
- Batch-native (the API always takes an array as `input`)

## License

MIT
