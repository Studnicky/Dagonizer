# @noocodex/dagonizer-adapter-cerebras

Cerebras REST adapter for [@noocodex/dagonizer](https://npmjs.com/package/@noocodex/dagonizer). Defaults to `gpt-oss-120b` on Cerebras's Wafer-Scale Engine inference hardware.

## Install

```bash
npm install @noocodex/dagonizer @noocodex/dagonizer-adapter-cerebras
```

## Usage

```ts
import { CerebrasApiAdapter } from '@noocodex/dagonizer-adapter-cerebras';
import { ChatRequestBuilder } from '@noocodex/dagonizer/adapter';

const llm = new CerebrasApiAdapter({ apiKey: process.env.CEREBRAS_API_KEY! });

const response = await llm.chat(ChatRequestBuilder.from({
  messages: [{ role: 'user', content: 'Hello', toolCallId: '', toolName: '' }],
}));
```

## Options

| Option | Default | Notes |
|---|---|---|
| `apiKey` | required | Free key at [cloud.cerebras.ai](https://cloud.cerebras.ai) |
| `model` | `gpt-oss-120b` | Cerebras catalog: `llama3.1-8b`, `gpt-oss-120b`, `qwen-3-235b-a22b-instruct-2507`, `zai-glm-4.7` |
| `maxAttempts` | 3 | Retry budget |

## Capabilities

```ts
{ toolUse: 'partial', structuredOutput: true, jsonMode: true }
```

`toolUse: 'partial'` — Cerebras model coverage for `tools`/`tool_choice` varies; the adapter retries as plain chat when the model signals tools are unsupported (try/catch fallback inside `performChat`).

## Wire format

- Endpoint: `POST https://api.cerebras.ai/v1/chat/completions`
- Token cap field: `max_completion_tokens`
- Headers: `Authorization: Bearer <key>`, `Content-Type: application/json`

## Notes

There is no `llama-3.3` variant in Cerebras's current catalog. Earlier prereleases of this adapter defaulted to an invalid model id; from v0.10.0 the default is `gpt-oss-120b` (production tier, strong tool-call adherence).

## License

MIT
