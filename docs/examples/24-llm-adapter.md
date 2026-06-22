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

## Builder

`LlmAdapterCascadeBuilder.build(catalogue)` assembles a cascade from data. Async discovery runs **before** the builder call — resolve models, filter nulls, then pass the finished catalogue. Each factory closes over the already-constructed adapter; `probe()` runs lazily inside `cascade.select()`.

```ts
import { LlmAdapterCascadeBuilder, type CatalogueEntryType } from '@studnicky/dagonizer/adapter';

// Async discovery step — happens before build()
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
  const groqAdapter = new GroqApiAdapter(process.env.GROQ_API_KEY);
  const groqModel = await groqAdapter.selectChatModel();
  if (groqModel !== null) {
    catalogue.push({
      descriptor: { provider: 'groq', model: groqModel, capabilities: { toolUse: 'full', structuredOutput: true, jsonMode: true } },
      factory:    () => groqAdapter,
    });
  }
}

// build() is synchronous — catalogue is already resolved
const cascade = LlmAdapterCascadeBuilder.build(catalogue);
const adapter  = await cascade.select(); // probes in catalogue order
```

The Archivist CLI (`examples/the-archivist/runArchivist.ts`) uses this exact pattern across six providers.

## Run

```bash
npx tsx examples/24-llm-adapter.ts
```

Ollama must be running and `llama3.2` (or the model you set) must be pulled.
