# @studnicky/dagonizer-adapter-anthropic

> **Beta:** not yet published to npm. Ships as part of the Dagonizer plugin ecosystem (GitHub release only). Live-API smoke testing against the provider has not been completed; wire-format checks use intercepted fetch. Expect minor adjustments before 1.0.

Anthropic Messages API adapter for [@studnicky/dagonizer](https://npmjs.com/package/@studnicky/dagonizer). Targets `claude-haiku-4-5` by default.

Unlike the OpenAI-compatible adapters (Groq, Mistral, etc.), this adapter extends `BaseAdapter` directly because Anthropic's Messages API uses a distinct wire format: a top-level `system` field for system prompts, `tool_result` content blocks for tool responses, `input_schema` in tool definitions, and typed `content[]` response blocks.

## Install

```bash
npm install @studnicky/dagonizer @studnicky/dagonizer-adapter-anthropic
```

## Usage

```ts
import { AnthropicApiAdapter } from '@studnicky/dagonizer-adapter-anthropic';
import { ChatRequest } from '@studnicky/dagonizer/adapter';

const llm = new AnthropicApiAdapter(process.env.ANTHROPIC_API_KEY!);

const response = await llm.chat(ChatRequest.create({
  messages: [{ role: 'user', content: 'Hello' }],
}));
```

## Options

| Option | Default | Notes |
|---|---|---|
| `model` | `claude-haiku-4-5` | Any Anthropic-hosted model |
| `maxAttempts` | 3 | Retry budget |
| `baseUrl` | `https://api.anthropic.com` | Override for proxies |
| `anthropicVersion` | `2023-06-01` | Anthropic API version header |
| `timeoutMs` | 60000 | Per-request timeout in ms |

## Capabilities

```ts
{ toolUse: 'full', structuredOutput: false, jsonMode: false }
```

Anthropic models have strong native tool-use support via `tool_use` content blocks. Structured output (JSON Schema constraint on prose) is not natively supported by the Messages API; use tool definitions with `input_schema` to enforce structured data shapes instead.

## Wire format

- Endpoint: `POST https://api.anthropic.com/v1/messages`
- Auth: `x-api-key: <key>` (not `Authorization: Bearer`)
- Protocol: `anthropic-version: 2023-06-01`
- System: top-level `system` field (extracted from `role: 'system'` messages)
- Tool definitions: `input_schema` field (not `parameters`)
- Tool responses: `tool_result` content block inside a `user` turn
- Response: typed `content[]` blocks (`text`, `tool_use`)
- Stop signals: `stop_reason` field (`end_turn` → `stop`, `tool_use` → `tool_call`, `max_tokens` → `length`)

## License

MIT
