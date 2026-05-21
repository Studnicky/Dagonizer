# @noocodex/dagonizer-adapter-mistral

Mistral REST adapter for [@noocodex/dagonizer](https://npmjs.com/package/@noocodex/dagonizer). Targets `mistral-small-latest` on Mistral's la Plateforme.

## Install

```bash
npm install @noocodex/dagonizer @noocodex/dagonizer-adapter-mistral
```

## Usage

```ts
import { MistralApiAdapter } from '@noocodex/dagonizer-adapter-mistral';
import { ChatRequestBuilder } from '@noocodex/dagonizer/adapter';

const llm = new MistralApiAdapter({ apiKey: process.env.MISTRAL_API_KEY! });

const response = await llm.chat(ChatRequestBuilder.from({
  messages: [{ role: 'user', content: 'Hello', toolCallId: '', toolName: '' }],
}));
```

## Options

| Option | Default | Notes |
|---|---|---|
| `apiKey` | required | Free key at [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys/) |
| `model` | `mistral-small-latest` | Any Mistral-hosted model |
| `maxAttempts` | 3 | Retry budget |

## Capabilities

```ts
{ toolUse: 'full', structuredOutput: true, jsonMode: true }
```

Mistral Small's tool-call format adherence is slightly weaker than Llama 3.3 70B at the parameter-validation layer; pattern bases should validate `tool_calls.arguments` against the declared `inputSchema` aggressively.

## Wire format

- Endpoint: `POST https://api.mistral.ai/v1/chat/completions`
- Token cap field: `max_tokens` (Mistral uses the original OpenAI spec)
- Headers: `Authorization: Bearer <key>`, `Content-Type: application/json`

## License

MIT
