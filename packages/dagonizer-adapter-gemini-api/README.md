# @noocodex/dagonizer-adapter-gemini-api

> **Beta:** not yet published to npm. Ships in v0.10.0 as part of the Dagonizer plugin ecosystem (GitHub release only). Live-API smoke testing against the provider has not been completed; wire-format compatibility is verified via intercepted-fetch smoke tests. Expect minor adjustments before 1.0.

Google Gemini REST adapter for [@noocodex/dagonizer](https://npmjs.com/package/@noocodex/dagonizer). Targets `gemini-2.0-flash` via the AI Studio API.

## Install

```bash
npm install @noocodex/dagonizer @noocodex/dagonizer-adapter-gemini-api
```

## Usage

```ts
import { GeminiApiAdapter } from '@noocodex/dagonizer-adapter-gemini-api';
import { ChatRequestBuilder } from '@noocodex/dagonizer/adapter';

const llm = new GeminiApiAdapter({ apiKey: process.env.GEMINI_API_KEY! });

const response = await llm.chat(ChatRequestBuilder.from({
  messages: [{ role: 'user', content: 'Hello', toolCallId: '', toolName: '' }],
}));
```

## Options

| Option | Default | Notes |
|---|---|---|
| `apiKey` | required | Free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `model` | `gemini-2.0-flash` | Any Gemini-hosted model |
| `maxAttempts` | 3 | Retry budget |

## Capabilities

```ts
{ toolUse: 'full', structuredOutput: true, jsonMode: true }
```

Gemini's native `functionDeclarations` channel produces well-formed tool calls. JSON-schema output via `responseSchema` is supported.

## Wire format

- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`
- Auth via `?key=<apiKey>` query parameter (not a Bearer header)
- Tool channel: `tools[].functionDeclarations[]`

## License

MIT
