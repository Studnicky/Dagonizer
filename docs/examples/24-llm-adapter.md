---
title: 'Example 24: LLM adapter (registry, cascade, chat)'
description: 'LLM adapter surface: subclass BaseAdapter for credential-free stub responses, register adapters in an LlmAdapterRegistry, wire an LlmAdapterCascade that walks the preference list, and call .chat() inside a DAG node.'
seeAlso:
  - text: 'The Archivist (in-browser demo)'
    link: './the-archivist'
    description: 'LlmAdapterCascade over Groq, Cerebras, Gemini, Ollama, WebLLM, and stub'
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

The LLM adapter surface provides a provider-agnostic interface for chat completion. This example demonstrates all three layers without credentials:

1. **`BaseAdapter` subclass.** `StubAdapter` returns canned responses offline. Override `probe()` to return `false` on the primary stub so the cascade skips it and picks the fallback — demonstrating preference ordering.
2. **`LlmAdapterRegistry`.** Registers two adapters under different `(provider, model)` keys.
3. **`LlmAdapterCascade`.** Walks the preference list in order, probes each adapter, and selects the first available one.
4. **DAG node calling `.chat()`.** Injects the selected adapter into state and routes on the response kind (`text` vs `tool_call`).

## Code

<<< @/../examples/24-llm-adapter.ts

## What it demonstrates

- **`BaseAdapter`.** Abstract base for all LLM adapters. Implement `probe()` (returns whether the adapter is reachable) and `chat(messages, options)` (returns an `LlmResponse`). The adapter surface is provider-agnostic; swap providers by changing the registered adapter.
- **`StubAdapter`.** A concrete `BaseAdapter` subclass that returns canned responses without network access. Use in tests and offline development. Override `probe()` to return `false` to simulate an unavailable provider.
- **`LlmAdapterRegistry`.** Stores adapters keyed by `(provider, model)` pairs. `registry.get(provider, model)` returns the matching adapter or `null`. `registry.list()` returns all registered entries.
- **`LlmAdapterCascade`.** Accepts a preference list of `(provider, model)` keys and an `LlmAdapterRegistry`. On `cascade.select()`, walks the list in order, calls `adapter.probe()` on each, and returns the first available adapter. Throws when no adapter is available.
- **Response routing.** `LlmResponse.kind` is `'text'` for a plain completion or `'tool_call'` for a model-initiated tool invocation. The DAG node routes on `kind` to separate the text and tool-call paths.

## Run

```bash
npx tsx examples/24-llm-adapter.ts
```

No credentials required — `StubAdapter` runs entirely offline.
