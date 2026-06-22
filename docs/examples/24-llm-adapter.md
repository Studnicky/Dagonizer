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
- **`LlmAdapterCascadeBuilder`.** Static factory that assembles an `LlmAdapterCascade` from a preference-ordered catalogue. Each `CatalogueEntryType` pairs an `AdapterDescriptorShapeType` (provider + model + capabilities) with a zero-arg factory. The builder creates a fresh `LlmAdapterRegistry`, registers every entry in catalogue order, and returns the configured cascade. Import both from `@studnicky/dagonizer/adapter`.
- **`LlmAdapterRegistry`.** Stores adapters keyed by `(provider, model)` pairs. Created internally by the builder; access it directly only when you need dynamic runtime registration.
- **`LlmAdapterCascade`.** Accepts a preference list and a registry. `cascade.select()` walks the list in order, calls `adapter.probe()` on each, and returns the first available adapter. Throws when no adapter is available.
- **Response routing.** `response.message.variant` is `'text'` for a plain completion or `'tools'` when the model makes tool calls. The DAG node routes on `variant` to separate the two paths.

## Builder vs manual construction

`LlmAdapterCascadeBuilder.build(catalogue)` is the preferred path when your provider set is known at startup and every factory is a synchronous zero-arg function:

```ts
import { LlmAdapterCascadeBuilder, type CatalogueEntryType } from '@studnicky/dagonizer/adapter';

const catalogue: CatalogueEntryType[] = [
  {
    descriptor: { provider: 'ollama-remote', model: 'llama3.2:3b', capabilities: { toolUse: 'partial', structuredOutput: true, jsonMode: true } },
    factory:    () => new OllamaApiAdapter({ model: 'llama3.2:3b', baseUrl: 'http://remote:11434' }),
  },
  {
    descriptor: { provider: 'ollama-local', model: 'llama3.2:3b', capabilities: { toolUse: 'partial', structuredOutput: true, jsonMode: true } },
    factory:    () => new OllamaApiAdapter({ model: 'llama3.2:3b' }),
  },
];

const cascade = LlmAdapterCascadeBuilder.build(catalogue);
const adapter = await cascade.select(); // probes in preference order
```

Use the lower-level `LlmAdapterRegistry` + `LlmAdapterCascade` directly when you need **async conditional registration** — for example, probing or discovering available models before deciding which entries to register:

```ts
// Async discovery: only register providers whose env keys are present
// and whose models are available right now.
const registry = new LlmAdapterRegistry();
for (const provider of PROVIDERS) {
  if (!process.env[provider.envKey]) continue;
  const model = await provider.selectModel(); // async probe/discovery
  if (model === null) continue;
  registry.register({ provider: provider.name, model, capabilities: provider.caps }, provider.factory(model));
}
const cascade = new LlmAdapterCascade(registry, preferences);
```

The Archivist demo (`examples/the-archivist/`) uses this pattern: each provider awaits `selectChatModel()` and is skipped entirely when no model is available — a step that cannot be expressed as a synchronous factory.

## Run

```bash
npx tsx examples/24-llm-adapter.ts
```

Ollama must be running and `llama3.2` (or the model you set) must be pulled.
