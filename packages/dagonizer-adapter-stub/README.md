# @noocodex/dagonizer-adapter-stub

> **Beta:** not yet published to npm. Ships in v0.10.0 as part of the Dagonizer plugin ecosystem (GitHub release only). Live-API smoke testing against the provider has not been completed; wire-format compatibility is verified via intercepted-fetch smoke tests. Expect minor adjustments before 1.0.

Offline canned-response adapter for [@noocodex/dagonizer](https://npmjs.com/package/@noocodex/dagonizer). Useful for CLI smoke tests, offline previews, and as an extension point for domain-grounded fake LLMs.

## Install

```bash
npm install @noocodex/dagonizer @noocodex/dagonizer-adapter-stub
```

## Usage

Bare default: returns a single placeholder string regardless of prompt:

```ts
import { StubAdapter } from '@noocodex/dagonizer-adapter-stub';

const llm = new StubAdapter();
// or with a custom default:
const llm = new StubAdapter({ defaultResponse: 'Hello from stub.' });
```

## Extending for domain-grounded stubs

The stub is built for subclassing. Override `respond(request)` for simple text responses, or `performChat(request)` for full control (tool calls, structured output, etc.):

```ts
import { StubAdapter, ZERO_TOKEN_USAGE } from '@noocodex/dagonizer-adapter-stub';
import type { ChatRequest, ChatResponse } from '@noocodex/dagonizer/adapter';
import { ChatResponseMessageBuilder } from '@noocodex/dagonizer/adapter';

class MyStub extends StubAdapter {
  protected override async performChat(request: ChatRequest): Promise<ChatResponse> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const reply = lookupCannedAnswer(lastUser?.content ?? '');
    return {
      message: ChatResponseMessageBuilder.from(reply, []),
      finishReason: 'stop',
      usage: ZERO_TOKEN_USAGE,
    };
  }
}
```

See [`examples/the-archivist/providers/adapters/ArchivistStub.ts`](https://github.com/Studnicky/Dagonizer/blob/main/examples/the-archivist/providers/adapters/ArchivistStub.ts) for a worked extension that grounds canned responses in a seed-library RDF graph.

## Options

| Option | Default | Notes |
|---|---|---|
| `defaultResponse` | `'(stub adapter: no model attached)'` | Text returned by the default `respond` |
| `maxAttempts` | 1 | No real network, no retry needed |

## Capabilities

```ts
{ toolUse: 'none', structuredOutput: false, jsonMode: false }
```

The default declares `'none'` so consumers know there's no real intelligence. Subclasses that emit structured tool calls or JSON should re-declare via the `super({ capabilities: { ... } })` call.

## License

MIT
