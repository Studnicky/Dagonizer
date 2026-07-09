---
title: 'Example 26: Tool Use'
description: 'Tool-use surface: Tool definition with JSON-Schema ToolDefinition, OllamaApiAdapter driving the native tool_calls channel, ToolCallCodec for text-channel extraction, and DAG routing on tool dispatch success or failure.'
seeAlso:
  - text: 'Example 24: LLM Adapter'
    link: './24-llm-adapter'
    description: 'LlmAdapter, registry, cascade, and chat surface'
  - text: 'Example 25: Embedder'
    link: './25-embedder'
    description: 'EmbedderRegistry, EmbedderCascade, cosine similarity'
  - text: 'The Archivist'
    link: './the-archivist'
    description: 'Tool dispatch in the Archivist scout phase'
  - text: 'Reference: Contracts'
    link: '../reference/contracts'
    description: 'Tool, ToolDefinition, ToolCallCodec contracts'
---

<script setup lang="ts">
import { BookSearchScatterDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 26: Tool Use

## What It Is

Tool Use lets a model request an application capability without letting the model execute arbitrary code. The Archivist exposes book-search tools through JSON Schema definitions, decodes model-selected tool calls, and routes the actual work through registered DAGs.

The boundary is important: the model chooses a capability and arguments; the application validates, dispatches, gathers outputs, and decides what happens on success or failure.

## How It Works

The model returns tool calls through the adapter response. The host decodes those calls into worksets, each workset carries a `urn:noocodec:tool:<name>` DAG IRI, and the scatter body resolves that reference via a dynamic `DagReference` with explicit candidates. The model chooses intent; the dispatcher still owns node execution, route outcomes, gathering, and terminal behavior.

This makes tool use compositional. A tool can be a typed function, but the runnable Archivist packages each tool as an embeddable tool DAG IRI so scatter, gather, retry, checkpoint, and visualization all work through the same runtime surface.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The graph shows the model/tool dispatch boundary. [The Archivist](./the-archivist) is the in-browser owner: its book-search scatter dispatches registered tool DAGs through a dynamic `DagReference`.

<DagJsonMermaid :dag="BookSearchScatterDAG" title="Archivist tool-use scatter DAG" aria-label="Archivist tool-use JSON-LD DAG beside Mermaid generated from it." />

The Archivist registers book-search tools once, converts each tool into an embeddable tool DAG IRI, then scatters worksets whose `dagIri` field carries the target tool DAG IRI at runtime.

### Run

```bash
npm run docs:dev
```

Open [The Archivist](./the-archivist) and ask a book-search question that uses external sources.

## What It Lets You Do

Tool use lets applications expose external capabilities to a model while keeping actual execution inside registered DAGs. Use it when the model should choose a capability, but the application must validate inputs, route work, gather outputs, and enforce deterministic failure paths.

In practice this keeps the risky part small. The model proposes a structured call; Dagonizer runs the graph you registered and produces normal node outcomes.

## Code Samples

The browser registry snippet shows tool DAG registration. The scatter DAG snippet shows runtime `DagReference` dispatch over tool worksets.

<<< @/../docs/.vitepress/theme/components/ArchivistRunner.vue#archivist-browser-tool-registry

<<< @/../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts

## Details for Nerds

- **`Tool<TInput, TOutput>`.** Declares `name`, a JSON-Schema `ToolDefinition` (forwarded to the model via the adapter's `tools` parameter), and an `execute(input)` method that returns `TOutput`. The type parameters enforce that the decoded call input matches the schema.
- **`ToolDefinition`.** JSON Schema–compatible object forwarded to the LLM's `tools` parameter. The schema describes the tool's input shape so the model can emit a valid call.
- **Tool registry bundle.** The browser runner registers the tool bundle before the parent DAG so tool DAG IRIs resolve.
- **Dynamic DAG dispatch.** Each workset carries the tool DAG reference; the scatter body resolves it at runtime and validates it against the declared candidate DAG set.
- **Tool dispatch.** The selected tool DAG calls the matching tool implementation and gathers candidates back into the parent state.

## Related Concepts

- [Example 24: LLM Adapter](./24-llm-adapter) - LlmAdapter, registry, cascade, and chat surface
- [Example 25: Embedder](./25-embedder) - EmbedderRegistry, EmbedderCascade, cosine similarity
- [The Archivist](./the-archivist) - Tool dispatch in the Archivist scout phase
- [Reference: Contracts](../reference/contracts) - Tool, ToolDefinition, ToolCallCodec contracts
