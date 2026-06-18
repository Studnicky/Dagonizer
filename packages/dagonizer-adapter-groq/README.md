# @studnicky/dagonizer-adapter-groq

> **Beta:** not yet published to npm. Ships in v0.10.0 as part of the Dagonizer plugin ecosystem (GitHub release only). Live-API smoke testing against the provider has not been completed; wire-format compatibility is verified via intercepted-fetch smoke tests. Expect minor adjustments before 1.0.

Groq REST adapter for [@studnicky/dagonizer](https://npmjs.com/package/@studnicky/dagonizer). Targets `llama-3.3-70b-versatile` on Groq's LPU hardware (300–800 tok/s at the free tier).

## Install

```bash
npm install @studnicky/dagonizer @studnicky/dagonizer-adapter-groq
```

## Usage

```ts
import { GroqApiAdapter } from '@studnicky/dagonizer-adapter-groq';
import { ChatRequestBuilder } from '@studnicky/dagonizer/adapter';

const llm = new GroqApiAdapter({ apiKey: process.env.GROQ_API_KEY! });

const response = await llm.chat(ChatRequestBuilder.from({
  messages: [{ role: 'user', content: 'Hello', toolCallId: '', toolName: '' }],
}));
```

## Options

| Option | Default | Notes |
|---|---|---|
| `apiKey` | required | Free key at [console.groq.com/keys](https://console.groq.com/keys) |
| `model` | `llama-3.3-70b-versatile` | Any Groq-hosted model |
| `maxAttempts` | 3 | Retry budget for transient failures |

## Capabilities

```ts
{ toolUse: 'full', structuredOutput: true, jsonMode: true }
```

Llama 3.3 70B has solid tool-calling format adherence; pattern bases that consume `services.llm` dispatch `tools` reliably.

## Wire format

- Endpoint: `POST https://api.groq.com/openai/v1/chat/completions`
- Token cap field: `max_completion_tokens` (Groq does not accept `max_tokens`)
- Headers: `Authorization: Bearer <key>`, `Content-Type: application/json`

## Rate limits

Free tier: ~30 RPM / 6000 TPM as of 2026-05. Burst-friendly; sustained throughput will throttle. `BaseAdapter`'s retry policy catches 429s.

## License

MIT
