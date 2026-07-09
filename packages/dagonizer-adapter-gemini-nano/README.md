# @studnicky/dagonizer-adapter-gemini-nano

> **Beta:** not yet published to npm. Ships in v0.10.0 as part of the Dagonizer plugin ecosystem (GitHub release only). Live-API smoke testing against the provider has not been completed; wire-format checks use intercepted fetch. Expect minor adjustments before 1.0.

Browser built-in LanguageModel adapter for [@studnicky/dagonizer](https://npmjs.com/package/@studnicky/dagonizer). Uses the [Prompt API](https://developer.chrome.com/docs/ai/prompt-api) (`window.LanguageModel`) implemented by Chrome 138+ and Edge.

## Install

```bash
npm install @studnicky/dagonizer @studnicky/dagonizer-adapter-gemini-nano
```

## Usage

```ts
import { GeminiNanoAdapter, detectGeminiNano } from '@studnicky/dagonizer-adapter-gemini-nano';

const status = await detectGeminiNano(); // 'available' | 'downloadable' | 'downloading' | 'unavailable'
if (status !== 'available') {
  throw new Error(`Browser built-in LanguageModel not ready: ${status}`);
}

const llm = new GeminiNanoAdapter();
```

## Browser requirements

- Chrome 138+ or Edge (or earlier Chrome with `chrome://flags/#prompt-api-for-gemini-nano` enabled)
- The ~2 GB on-device model: visit `chrome://components` to trigger the download
- Desktop only; no mobile browser exposes the Prompt API

## Capabilities

```ts
{ toolUse: 'none', structuredOutput: true, jsonMode: false }
```

Nano lacks a native function-calling channel. The adapter uses `responseConstraint` (JSON Schema constraint on the output) to emulate tool calls: it encodes the tool list as a `{ tool_calls: [...] }` schema and decodes the JSON response back into `ToolCall[]`. This works but is less reliable than native tool calling; `toolUse` is declared `'none'` to signal that pattern bases should prefer a different route when available.

## Performance

On-device inference; no network round-trip. Latency is ~100–500 ms for short prompts on Apple Silicon / modern Intel hardware. The model is small (~2 GB quantized) so context and reasoning depth are limited.

## License

MIT
