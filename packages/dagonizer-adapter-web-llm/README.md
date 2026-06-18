# @studnicky/dagonizer-adapter-web-llm

> **Beta:** not yet published to npm. Ships in v0.10.0 as part of the Dagonizer plugin ecosystem (GitHub release only). Live-API smoke testing against the provider has not been completed; wire-format compatibility is verified via intercepted-fetch smoke tests. Expect minor adjustments before 1.0.

WebLLM in-browser adapter for [@studnicky/dagonizer](https://npmjs.com/package/@studnicky/dagonizer). Runs a quantized open model entirely in the browser via [@mlc-ai/web-llm](https://npmjs.com/package/@mlc-ai/web-llm) on WebGPU.

## Install

```bash
npm install @studnicky/dagonizer @studnicky/dagonizer-adapter-web-llm @mlc-ai/web-llm
```

## Usage

```ts
import { WebLlmAdapter, type WebLlmInitReport } from '@studnicky/dagonizer-adapter-web-llm';

if (!WebLlmAdapter.detectWebGpu()) throw new Error('WebGPU not supported by this browser');

class LoggingWebLlmAdapter extends WebLlmAdapter {
  protected override onInitProgress(report: WebLlmInitReport): void {
    console.log(report);
  }
}

const llm = new LoggingWebLlmAdapter({ model: 'Phi-3.5-mini-instruct-q4f16_1-MLC' });
```

## Browser requirements

- WebGPU (Chrome / Edge / Brave with hardware acceleration on; Safari TP)
- 1–4 GB lazy-loaded model download (cached in IndexedDB after first run)
- Desktop strongly preferred; mobile GPUs can't sustain the working set

## Options

| Option | Default | Notes |
|---|---|---|
| `model` | `Phi-3.5-mini-instruct-q4f16_1-MLC` | Any model id from `prebuiltAppConfig.model_list` |
| `maxAttempts` | 2 | Retry budget (lower than cloud; local failures rarely recover) |

To observe model-download progress, subclass `WebLlmAdapter` and override `protected onInitProgress(report: WebLlmInitReport): void`.

## Capabilities

```ts
{ toolUse: 'partial', structuredOutput: true, jsonMode: true }
```

Phi-3.5's tool-call format adherence is inconsistent; the model occasionally responds in prose instead of JSON when given a `tools` parameter. Consumers should validate aggressively or treat tool output as advisory.

## License

MIT
