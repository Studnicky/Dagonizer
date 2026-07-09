# @studnicky/dagonizer-embedder-gemini-api

> **Beta:** not yet published to npm. Ships as part of the Dagonizer
> plugin ecosystem (GitHub release only). Live-API smoke testing
> against the provider has not been completed; wire-format checks
> use intercepted fetch.

Google AI Studio REST embedder for [@studnicky/dagonizer](https://npmjs.com/package/@studnicky/dagonizer).
Targets `text-embedding-004` (768 dimensions) by default.

## Install

```bash
npm install @studnicky/dagonizer @studnicky/dagonizer-embedder-gemini-api
```

## Usage

```ts
import { GeminiApiEmbedder } from '@studnicky/dagonizer-embedder-gemini-api';

const embedder = new GeminiApiEmbedder(process.env.GEMINI_API_KEY!);
const vector = await embedder.embed('the cat sat on the mat');
// vector.length === embedder.dimensions === 768
```

## Options

| Option | Default | Notes |
|---|---|---|
| `apiKey` (positional) | required | Free key at [aistudio.google.com](https://aistudio.google.com/) |
| `model` | `text-embedding-004` | Any Gemini embedding model |
| `dimensions` | 768 | Override when targeting a different model |
| `maxAttempts` | 3 | Retry budget |

## Wire format

- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent`
- Auth: `?key=<apiKey>` query parameter

## License

MIT
