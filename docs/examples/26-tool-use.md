---
title: 'Example 26: Tool use'
description: 'Tool-use surface: Tool definition with JSON-Schema ToolDefinition, ToolCallCodec for text-channel fallback extraction, and adapter dispatch routing tool calls to registered Tool instances inside a DAG node.'
seeAlso:
  - text: 'Example 24: LLM adapter'
    link: './24-llm-adapter'
    description: 'LlmAdapter, registry, cascade, and chat surface'
  - text: 'Example 25: Embedder'
    link: './25-embedder'
    description: 'EmbedderRegistry, EmbedderCascade, cosine similarity'
  - text: 'The Archivist (in-browser demo)'
    link: './the-archivist'
    description: 'tool dispatch in the Archivist scout phase'
  - text: 'Reference: Contracts'
    link: '../reference/contracts'
    description: 'Tool, ToolDefinition, ToolCallCodec contracts'
---

# Example 26: Tool use

The tool-use surface provides typed tool definitions that the adapter forwards to the model's tool channel. This example demonstrates both dispatch paths without credentials:

1. **`Tool<TInput, TOutput>`.** A typed tool with a JSON-Schema `ToolDefinition` that the adapter surface forwards to the model's tool channel.
2. **`StubAdapter` in two modes.** (a) Native tools channel: adapter emits a typed `ToolCall[]`. (b) Text-channel fallback: adapter embeds JSON in prose; `ToolCallCodec.decode` extracts the `{ tool_calls: [...] }` envelope — tolerant of surrounding text.
3. **Dispatch to a registered `Tool`.** The DAG node decodes the tool call, dispatches to the matching registered `Tool` instance, and routes on whether the call succeeded or failed.

## Code

<<< @/../examples/26-tool-use.ts

## What it demonstrates

- **`Tool<TInput, TOutput>`.** Declares `name`, a JSON-Schema `ToolDefinition` (forwarded to the model), and an `execute(input)` method that returns `TOutput`. The type parameters enforce that the decoded call input matches the schema.
- **`ToolDefinition`.** JSON Schema–compatible object forwarded to the LLM's `tools` parameter. The schema describes the tool's input shape so the model can emit a valid call.
- **Native tools channel.** When the adapter emits a `{ kind: 'tool_call', calls: ToolCall[] }` response, the DAG node receives a typed array directly. No string parsing required.
- **`ToolCallCodec.decode(text)`.** When the adapter emits `{ kind: 'text', text: string }` with JSON embedded in prose, `ToolCallCodec.decode` extracts the `{ tool_calls: [...] }` envelope. Tolerant of surrounding text before and after the JSON object.
- **Tool dispatch.** After decoding, the node looks up the matching `Tool` by name in a registry, calls `tool.execute(input)`, and routes the DAG on success or failure.

## Run

```bash
npx tsx examples/26-tool-use.ts
```

No credentials required — `StubAdapter` returns canned tool calls offline.
