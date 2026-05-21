# @noocodex/dagonizer-adapter-openrouter

OpenRouter REST adapter for [@noocodex/dagonizer](https://npmjs.com/package/@noocodex/dagonizer). Defaults to the free-tier Llama 3.3 70B Instruct route.

## Install

```bash
npm install @noocodex/dagonizer @noocodex/dagonizer-adapter-openrouter
```

## Usage

```ts
import { OpenRouterApiAdapter } from '@noocodex/dagonizer-adapter-openrouter';
import { ChatRequestBuilder } from '@noocodex/dagonizer/adapter';

const llm = new OpenRouterApiAdapter({ apiKey: process.env.OPENROUTER_API_KEY! });

const response = await llm.chat(ChatRequestBuilder.from({
  messages: [{ role: 'user', content: 'Hello', toolCallId: '', toolName: '' }],
}));
```

## Options

| Option | Default | Notes |
|---|---|---|
| `apiKey` | required | Free key at [openrouter.ai/keys](https://openrouter.ai/keys) |
| `model` | `meta-llama/llama-3.3-70b-instruct:free` | Any OpenRouter model id (`:free` for free-tier routes) |
| `maxAttempts` | 3 | Retry budget |

## Capabilities

```ts
{ toolUse: 'partial', structuredOutput: true, jsonMode: true }
```

`toolUse: 'partial'` — OpenRouter's `:free` tier sometimes routes to backend providers that strip the `tools` parameter. The adapter forwards tools optimistically; consumers should validate aggressively or treat tool output as advisory.

## Wire format

- Endpoint: `POST https://openrouter.ai/api/v1/chat/completions`
- Token cap field: `max_tokens`
- Headers: `Authorization: Bearer <key>`, `Content-Type: application/json`, `HTTP-Referer: https://studnicky.github.io/Dagonizer/`, `X-Title: Dagonizer`

The HTTP-Referer + X-Title headers register your app with OpenRouter's leaderboard and are required for the `:free` tier routing rules.

## License

MIT
