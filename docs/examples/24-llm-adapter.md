---
title: 'Example 24: LLM adapter (registry, cascade, chat)'
description: 'LLM adapter surface: register OllamaApiAdapter instances in an LlmAdapterRegistry, wire an LlmAdapterCascade that walks the preference list probing each adapter, and call .chat() inside a DAG node that routes on the response variant.'
seeAlso:
  - text: 'The Archivist (in-browser demo)'
    link: './the-archivist'
    description: 'LlmAdapterCascade over Groq, Cerebras, Gemini, Ollama, WebLLM'
  - text: 'Example 25: Embedder'
    link: './25-embedder'
    description: 'EmbedderRegistry, EmbedderCascade, cosine similarity'
  - text: 'Example 26: Tool use'
    link: './26-tool-use'
    description: 'Tool definition, ToolCallCodec, and adapter dispatch'
  - text: 'Reference: Contracts'
    link: '../reference/contracts'
    description: 'LlmAdapter, LlmAdapterRegistry, LlmAdapterCascade contracts'
---

# Example 24: LLM adapter (registry, cascade, chat)

The LLM adapter surface provides a provider-agnostic interface for chat completion. This example demonstrates all three layers against a real local Ollama backend:

1. **`OllamaApiAdapter` (primary, unreachable).** Points at port 1. `probe()` contacts `/api/tags` at that port, gets a connection error, and returns `false` — the cascade skips it. This models the real-world shape: a cloud or remote endpoint that is down at runtime.
2. **`OllamaApiAdapter` (fallback, local).** Points at the default loopback (`127.0.0.1:11434`). `probe()` returns `true` when Ollama is running — the cascade selects it.
3. **`LlmAdapterRegistry`.** Registers both adapters under different `(provider, model)` keys.
4. **`LlmAdapterCascade`.** Walks the preference list in order, probes each adapter, and selects the first available one.
5. **DAG node calling `.chat()`.** Injects the selected adapter into state and routes on the response variant (`text` vs `tools`).

## Prerequisites

```bash
# Install Ollama from https://ollama.com
ollama pull llama3.2
# Ollama must be running: ollama serve (or the desktop app)
```

Change `OLLAMA_MODEL` in the example to any model you have pulled.

## Code

<<< @/../examples/24-llm-adapter.ts

## What it demonstrates

- **`OllamaApiAdapter`.** Wraps Ollama's OpenAI-compatible endpoint (`/v1/chat/completions`). Constructed with `{ model, baseUrl? }`: `model` is required (Ollama models are pulled per-host); `baseUrl` defaults to `http://127.0.0.1:11434`. No API key required for local usage.
- **`probe()`.** Each adapter implementation overrides `probe()` to report availability. `OllamaApiAdapter.probe()` issues a `GET /api/tags` with a short timeout (500 ms); returns `true` when the daemon answers `2xx`, `false` on timeout or connection error. Never throws.
- **`LlmAdapterCascade.create`.** Static factory that assembles an `LlmAdapterCascade` from a preference-ordered catalogue. Each `CatalogueEntryType` pairs an `AdapterDescriptorShapeType` (provider + model + capabilities) with a zero-arg factory. The factory creates a fresh `LlmAdapterRegistry`, registers every entry in catalogue order, and returns the configured cascade. Import both from `@studnicky/dagonizer/adapter`.
- **`LlmAdapterRegistry`.** Stores adapters keyed by `(provider, model)` pairs. Created internally by the builder; access it directly only when you need dynamic runtime registration.
- **`LlmAdapterCascade`.** Accepts a preference list and a registry. `cascade.select()` walks the list in order, calls `adapter.probe()` on each, and returns the first available adapter. Throws when no adapter is available.
- **Response routing.** `response.message.variant` is `'text'` for a plain completion or `'tools'` when the model makes tool calls. The DAG node routes on `variant` to separate the two paths.

## Adapter options

Every adapter extends `BaseAdapter`, so two options are uniform across the whole surface — the cloud HTTP adapters (`OpenAiCompatibleAdapter` and its `groq` / `cerebras` / `mistral` / `openRouter` presets, `anthropic`, `gemini-api`, `ollama`) and the on-device adapters (`gemini-nano`, `web-llm`) alike:

- **`systemPrompt`.** A default directive the base injects as the leading system message of any request that carries no system message. Leading position is load-bearing for on-device backends (the Chrome Prompt API rejects a system turn at any index but 0). A caller-supplied system turn is never overridden; an empty string is a no-op.
- **`timeoutMs`** (default `60_000`). A per-request deadline. The HTTP adapters enforce it around the network call; `gemini-nano` composes it into the `LanguageModel.create()` / `session.prompt()` abort signal, and `web-llm` races the non-cancellable MLC generation against it. On expiry the adapter rejects with a `TIMEOUT`-classified `LlmError`, so a cascade falls through to the next adapter instead of hanging.

```ts
import { OpenAiCompatibleAdapter } from '@studnicky/dagonizer/adapter';

const adapter = OpenAiCompatibleAdapter.groq(process.env.GROQ_API_KEY ?? '', {
  systemPrompt: 'You are the Archivist. Answer concisely.',
  timeoutMs:    30_000,
});
```

## Cascade creation

`LlmAdapterCascade.create(catalogue)` assembles a cascade from data. Async discovery runs **before** the create call — resolve models, filter nulls, then pass the finished catalogue. Each factory closes over the already-constructed adapter; `probe()` runs lazily inside `cascade.select()`.

```ts
import { LlmAdapterCascade, OpenAiCompatibleAdapter, type CatalogueEntryType } from '@studnicky/dagonizer/adapter';

// Async discovery step — happens before create()
const catalogue: CatalogueEntryType[] = [];

const ollamaAdapter = new OllamaApiAdapter();
const ollamaModel = await ollamaAdapter.selectChatModel();
if (ollamaModel !== null) {
  catalogue.push({
    descriptor: { provider: 'ollama', model: ollamaModel, capabilities: { toolUse: 'partial', structuredOutput: true, jsonMode: true } },
    factory:    () => ollamaAdapter,   // synchronous; closes over already-constructed adapter
  });
}

if (process.env.GROQ_API_KEY) {
  const groqAdapter = OpenAiCompatibleAdapter.groq(process.env.GROQ_API_KEY);
  const groqModel = await groqAdapter.selectChatModel();
  if (groqModel !== null) {
    catalogue.push({
      descriptor: { provider: 'groq', model: groqModel, capabilities: { toolUse: 'partial', structuredOutput: true, jsonMode: true } },
      factory:    () => groqAdapter,
    });
  }
}

// create() is synchronous — catalogue is already resolved
const cascade = LlmAdapterCascade.create(catalogue);
const adapter  = await cascade.select(); // probes in catalogue order
```

The Archivist CLI (`examples/the-archivist/runArchivist.ts`) uses this exact pattern across six providers.

## Run

```bash
npx tsx examples/24-llm-adapter.ts
```

Ollama must be running and `llama3.2` (or the model you set) must be pulled.

## See also

For live per-token streaming (`chatStream`, a `{ sink }`-configured
`CallModelNode`, and routing concurrent conversations through one shared
sink), see [ReAct agent: live token streaming](../guide/react-agent#live-token-streaming)
and [Reference: Adapters](../reference/adapters).
