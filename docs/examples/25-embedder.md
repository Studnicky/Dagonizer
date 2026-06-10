---
title: 'Example 25: Embedder (registry, cascade, cosine similarity)'
description: 'Embedding surface: subclass BaseEmbedder for a deterministic stub, register in an EmbedderRegistry, wire an EmbedderCascade, and compute cosine similarity between vectors inside a DAG node.'
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

The embedding surface provides a provider-agnostic interface for text embedding. This example demonstrates all three layers without credentials:

1. **`BaseEmbedder` subclass.** Deterministic stub embedder — no API key, no network. Produces a fixed-dimension vector where each element is a hash-derived value. Identical strings yield the same vector; similar strings yield measurably higher cosine similarity than unrelated ones.
2. **`EmbedderRegistry`.** Registers the stub under a `(provider, model)` key.
3. **`EmbedderCascade`.** Walks the preference list, probes, and selects the first available embedder.
4. **DAG node calling `.embed()`.** Injects the selected embedder into state, embeds two text strings, and computes cosine similarity between their vectors.

## Code

<<< @/../examples/25-embedder.ts

## What it demonstrates

- **`BaseEmbedder`.** Abstract base for all embedding adapters. Implement `probe()` and `embed(texts)` (returns a 2D array of `number[]` vectors, one per input). The surface is provider-agnostic; swap embedders by changing the registered adapter.
- **Deterministic stub.** The stub produces a fixed-dimension vector using a hash-derived value per element. Identical strings → identical vectors → cosine similarity 1.0. Unrelated strings → low cosine similarity. No network calls.
- **`EmbedderRegistry`.** Stores embedders keyed by `(provider, model)` pairs. API mirrors `LlmAdapterRegistry` for consistency.
- **`EmbedderCascade`.** Walks the preference list and returns the first available embedder. Throws when no embedder probes as available.
- **Cosine similarity.** The example computes `dot(a, b) / (|a| × |b|)` directly on the returned vectors to verify that similar text pairs score higher than unrelated pairs.

## Run

```bash
npx tsx examples/25-embedder.ts
```

No credentials required — the stub embedder runs entirely offline.
