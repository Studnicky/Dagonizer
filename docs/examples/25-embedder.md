---
title: 'Example 25: Embedder (registry, cascade, cosine similarity)'
description: 'Embedding surface: register OllamaEmbedder instances in an EmbedderRegistry, wire an EmbedderCascade that probes and selects the first available embedder, and compute cosine similarity between vectors inside a DAG node.'
seeAlso:
  - text: 'Example 24: LLM adapter'
    link: './24-llm-adapter'
    description: 'LlmAdapterRegistry, LlmAdapterCascade, and chat surface'
  - text: 'Example 26: Tool use'
    link: './26-tool-use'
    description: 'Tool definition, ToolCallCodec, and adapter dispatch'
  - text: 'The Archivist (in-browser demo)'
    link: './the-archivist'
    description: 'EmbedderCascade for intent classification'
  - text: 'Reference: Contracts'
    link: '../reference/contracts'
    description: 'Embedder, EmbedderRegistry, EmbedderCascade contracts'
---

# Example 25: Embedder (registry, cascade, cosine similarity)

The embedding surface provides a provider-agnostic interface for text embedding. This example demonstrates all three layers against a real local Ollama backend:

1. **`OllamaEmbedder` (primary, unreachable).** Points at port 1. `probe()` returns `false` — the cascade skips it.
2. **`OllamaEmbedder` (fallback, local).** Points at the default loopback, using the `nomic-embed-text` model (768-dimensional). `probe()` returns `true` when Ollama is running — the cascade selects it.
3. **`EmbedderRegistry`.** Registers both embedders under `(provider, model)` keys.
4. **`EmbedderCascade`.** Walks the preference list, probes, and selects the first available embedder.
5. **DAG node calling `.embed()`.** Injects the selected embedder into state, embeds two text strings, and computes cosine similarity between their vectors.

## Prerequisites

```bash
# Install Ollama from https://ollama.com
ollama pull nomic-embed-text
# Ollama must be running: ollama serve (or the desktop app)
```

## Code

<<< @/../examples/25-embedder.ts

## What it demonstrates

- **`OllamaEmbedder`.** Calls Ollama's `/api/embeddings` endpoint. Constructed with `{ model?, baseUrl?, dimensions? }`: defaults to `nomic-embed-text` (768-dim) at the local loopback. No API key required for local usage. Known model dimensions are resolved from a built-in table; unknown models require `dimensions` explicitly.
- **`probe()`.** Issues `GET /api/tags` with a 500 ms timeout against the configured base URL. Returns `true` when the daemon answers `2xx`, `false` on timeout or connection error. Symmetric with `OllamaApiAdapter.probe()` so a single running Ollama daemon makes both surfaces available.
- **`EmbedderRegistry`.** Stores embedders keyed by `(provider, model)` pairs. API mirrors `LlmAdapterRegistry` for consistency.
- **`EmbedderCascade`.** Walks the preference list and returns the first available embedder. Throws when no embedder probes as available.
- **Cosine similarity.** The example computes `dot(a, b) / (|a| × |b|)` directly on the returned vectors. Identical strings score 1.0; semantically related strings score higher than unrelated ones.

## Run

```bash
npx tsx examples/25-embedder.ts
```

Ollama must be running and `nomic-embed-text` must be pulled.
