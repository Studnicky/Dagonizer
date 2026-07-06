# @studnicky/dagonizer-adapter-ollama

> **Beta:** not yet published to npm. Ships in v0.10.0 as part of the Dagonizer plugin ecosystem (GitHub release only). Live-API smoke testing against the provider has not been completed; wire-format compatibility is verified via intercepted-fetch smoke tests. Expect minor adjustments before 1.0.

Local-first Ollama adapter for [@studnicky/dagonizer](https://npmjs.com/package/@studnicky/dagonizer). Targets the [Ollama daemon](https://ollama.com/) on the loopback by default; any model pulled to the host is selectable by name.

## Install

```bash
npm install @studnicky/dagonizer @studnicky/dagonizer-adapter-ollama
```

Pull a model on the host:

```bash
ollama pull llama3.2
# or any model you prefer: mistral, qwen2, gemma, codellama, etc.
```

## Usage

```ts
import { OllamaApiAdapter } from '@studnicky/dagonizer-adapter-ollama';
import { ChatRequest } from '@studnicky/dagonizer/adapter';

const llm = new OllamaApiAdapter({ model: 'llama3.2:latest' });

const response = await llm.chat(ChatRequest.create({
  messages: [{ role: 'user', content: 'Hello', toolCallId: '', toolName: '' }],
}));
```

## Options

| Option | Default | Notes |
|---|---|---|
| `model` | `llama3.2:latest` | Fallback only — pass a model you have actually pulled (`ollama list`). The default is not guaranteed to be installed; to pick one at runtime, query `GET /api/tags` and pass an installed name. |
| `baseUrl` | `http://127.0.0.1:11434` | Override for remote Ollama or proxy |
| `apiKey` | `ollama` (placeholder) | Override only when proxying behind a gateway that enforces auth |
| `maxAttempts` | 3 | Retry budget for transient failures |

## Capabilities

```ts
{ toolUse: 'partial', structuredOutput: true, jsonMode: true }
```

Tool-call adherence varies sharply by model. Llama 3.2 and 3.3 produce well-formed `tool_calls` most of the time; older or smaller models (qwen2 7B, gemma 2B) may emit malformed calls or refuse silently. Validate `tool_calls.arguments` against the declared `inputSchema` aggressively, or set `toolChoice: { type: 'none' }` to bypass tool routing when the model is unreliable.

## Wire format

- Endpoint: `POST <baseUrl>/v1/chat/completions` (Ollama's OpenAI-compatible surface)
- Token cap field: `max_tokens`
- Headers: `Authorization: Bearer <apiKey>` (placeholder by default), `Content-Type: application/json`

Ollama-native options that the OpenAI surface doesn't expose (`keep_alive`, `num_ctx`, `num_predict`) are configured at the daemon or model layer rather than per-request.

## License

MIT
