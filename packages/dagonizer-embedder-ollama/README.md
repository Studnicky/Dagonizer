# @studnicky/dagonizer-embedder-ollama

> **Beta:** not yet published to npm. Ships as part of the Dagonizer
> plugin ecosystem (GitHub release only). Live-API smoke testing
> against the provider has not been completed; wire-format checks
> use intercepted fetch.

Local-first embedder for [@studnicky/dagonizer](https://npmjs.com/package/@studnicky/dagonizer)
via Ollama's `/api/embeddings` endpoint.

## Install

```bash
npm install @studnicky/dagonizer @studnicky/dagonizer-embedder-ollama
# host-side
ollama pull nomic-embed-text
ollama serve
```

## Usage

```ts
import { OllamaEmbedder } from '@studnicky/dagonizer-embedder-ollama';

const embedder = new OllamaEmbedder('nomic-embed-text');
const vector = await embedder.embed('the cat sat on the mat');
// vector.length === embedder.dimensions === 768
```

## Options

| Option | Default | Notes |
|---|---|---|
| `model` (positional) | `nomic-embed-text` | Any embedding model pulled to the daemon |
| `baseUrl` | `http://127.0.0.1:11434` | Override for remote daemons / proxies |
| `dimensions` | auto from known table | Required for models not in the built-in table |
| `maxAttempts` | 3 | Retry budget |

## Known model dimensions

| Model | Dimensions |
|---|---|
| `nomic-embed-text` | 768 |
| `mxbai-embed-large` | 1024 |
| `all-minilm` | 384 |
| `snowflake-arctic-embed` | 1024 |

For other models pass `dimensions` explicitly.

## Probe

Hits `GET {baseUrl}/api/tags` with a 500 ms timeout. Symmetric with
`@studnicky/dagonizer-adapter-ollama` so a single Ollama daemon being up
makes both surfaces available to the cascade.

## License

MIT
