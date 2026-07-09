---
title: 'Example 25: Embedder'
description: 'Embedding surface: register OllamaEmbedder instances in an EmbedderRegistry, wire an EmbedderCascade that probes and selects the first available embedder, and compute cosine similarity between vectors inside a DAG node.'
seeAlso:
  - text: 'Example 24: LLM Adapter'
    link: './24-llm-adapter'
    description: 'LlmAdapterRegistry, LlmAdapterCascade, and chat surface'
  - text: 'Example 26: Tool Use'
    link: './26-tool-use'
    description: 'Tool definition, ToolCallCodec, and adapter dispatch'
  - text: 'The Archivist'
    link: './the-archivist'
    description: 'EmbedderCascade for intent classification'
  - text: 'Reference: Contracts'
    link: '../reference/contracts'
    description: 'Embedder, EmbedderRegistry, EmbedderCascade contracts'
---

<script setup lang="ts">
import { archivistDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 25: Embedder

## What It Is

Embedder is the provider boundary for semantic comparison inside DAG nodes. The Archivist provisions an embedder cascade, injects the selected embedder through services, and uses vectors for intent classification, memory recall, ranking, and similarity checks.

The graph does not need to know whether vectors come from local Ollama, a browser-capable backend, or a cloud service. Nodes ask for an `EmbedderInterface`; application bootstrapping decides which implementation is available.

## How It Works

The host provisions an `EmbedderInterface` before DAG execution and passes it through service injection. Nodes call the embedder to produce vectors, then apply domain logic such as cosine similarity or threshold routing. The registry and cascade mirror the LLM adapter surface, so availability probing and provider selection happen outside the graph.

That symmetry is deliberate. If your application can configure chat providers through an adapter cascade, it can configure embedding providers through the same registry/cascade style.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The embedder is injected service state; the graph shows where semantic recall and ranking fit in the live flow. [The Archivist](./the-archivist) and [The Dispatcher](./the-dispatcher) own this principle through intent classification and semantic recall.

<DagJsonMermaid :dag="archivistDAG" title="Archivist embedder DAG" aria-label="Archivist JSON-LD DAG beside Mermaid generated from it." />

The embedding surface provides a provider-agnostic interface for text embedding. The browser Archivist provisions an offline-capable embedder cascade, builds an intent classifier, and injects the selected embedder into `ArchivistServices`.

### Run

```bash
npm run docs:dev
```

Open [The Archivist](./the-archivist); the browser runner provisions the embedder during session boot when supported.

## What It Lets You Do

Embedders let applications add semantic comparison to DAG nodes without tying the graph to one vector provider. Use them for intent classification, memory recall, deduplication, ranking, and similarity checks that should work across browser, local, or cloud embedding backends.

The application benefit is portability: change vector providers, dimensions, or selection order in service setup while keeping DAG topology and node routes stable.

## Code Samples

The provisioner snippet builds the embedder cascade. The browser services snippet shows how the selected embedder becomes part of the Archivist service record passed to node constructors.

<<< @/../examples/the-archivist/providers/EmbedderProvisioner.ts

<<< @/../docs/.vitepress/theme/components/ArchivistRunner.vue#archivist-browser-services

## Details for Nerds

- **`OllamaEmbedder`.** Calls Ollama's `/api/embeddings` endpoint. Constructed with `{ model?, baseUrl?, dimensions? }`: no API key required for local usage. `selectEmbeddingModel()` discovers an installed embedding model from `/api/tags`; known model dimensions are resolved from a built-in table, and unknown models require `dimensions` explicitly.
- **`probe()`.** Issues `GET /api/tags` with a 500 ms timeout against the configured base URL. Returns `true` when the daemon answers `2xx`, `false` on timeout or connection error. Symmetric with `OllamaApiAdapter.probe()` so a single running Ollama daemon makes both surfaces available.
- **`EmbedderRegistry`.** Stores embedders keyed by `(provider, model)` pairs. API mirrors `LlmAdapterRegistry` for consistency.
- **`EmbedderCascade`.** Walks the preference list and returns the first available embedder. Throws when no embedder probes as available.
- **Cosine similarity.** The example computes `dot(a, b) / (|a| × |b|)` directly on the returned vectors. Identical strings score 1.0; semantically related strings score higher than unrelated ones.

## Related Concepts

- [Example 24: LLM Adapter](./24-llm-adapter) - LlmAdapterRegistry, LlmAdapterCascade, and chat surface
- [Example 26: Tool Use](./26-tool-use) - Tool definition, ToolCallCodec, and adapter dispatch
- [The Archivist](./the-archivist) - EmbedderCascade for intent classification
- [Reference: Contracts](../reference/contracts) - Embedder, EmbedderRegistry, EmbedderCascade contracts
