---
title: 'Example 26: Tool use'
description: 'Tool-use surface: Tool definition with JSON-Schema ToolDefinition, OllamaApiAdapter driving the native tool_calls channel, ToolCallCodec for text-channel fallback extraction, and DAG routing on tool dispatch success or failure.'
seeAlso:
  - text: 'Example 24: LLM adapter'
    link: './24-llm-adapter'
    description: 'LlmAdapter, registry, cascade, and chat surface'
  - text: 'Example 25: Embedder'
    link: './25-embedder'
    description: 'EmbedderRegistry, EmbedderCascade, cosine similarity'
  - text: 'The Archivist (in-browser demo)'
    link: './the-archivist'
    description: 'Tool dispatch in the Archivist scout phase'
  - text: 'Reference: Contracts'
    link: '../reference/contracts'
    description: 'Tool, ToolDefinition, ToolCallCodec contracts'
---

# Example 26: Tool use

The tool-use surface provides typed tool definitions that the adapter forwards to the model's tool channel. This example demonstrates both dispatch paths with a real Ollama backend:

1. **`Tool<TInput, TOutput>`.** A `calculator` tool with a JSON-Schema `ToolDefinition` that the adapter forwards to the model's `tools` parameter.
2. **`OllamaApiAdapter` driving the native tools channel.** Sends the tool definition to `llama3.2`. When the model calls the tool, the adapter returns `response.message.variant === 'tools'` with a typed `ToolCall[]`. The DAG node dispatches the call directly.
3. **`ToolCallCodec.decode` text-channel fallback.** Fed a fixed assistant message string with embedded tool-call JSON — the format emitted by models that encode tool calls in prose. The codec extracts the `{ tool_calls: [...] }` envelope from arbitrary surrounding text. This path requires no model call and demonstrates the codec independently.
4. **Dispatch to a registered `Tool`.** The DAG node dispatches to the matching `Tool` instance and routes on whether the call succeeded or failed.

## Prerequisites

```bash
# Install Ollama from https://ollama.com
ollama pull llama3.2
# Ollama must be running: ollama serve (or the desktop app)
```

Change `OLLAMA_MODEL` in the example to any tool-capable model you have pulled.

## Code

<<< @/../examples/26-tool-use.ts

## What it demonstrates

- **`Tool<TInput, TOutput>`.** Declares `name`, a JSON-Schema `ToolDefinition` (forwarded to the model via the adapter's `tools` parameter), and an `execute(input)` method that returns `TOutput`. The type parameters enforce that the decoded call input matches the schema.
- **`ToolDefinition`.** JSON Schema–compatible object forwarded to the LLM's `tools` parameter. The schema describes the tool's input shape so the model can emit a valid call.
- **Native tools channel.** When the adapter receives a tool-call completion from the model, it returns `{ message: { variant: 'tools', toolCalls: ToolCall[] } }`. The DAG node receives a typed array directly with no string parsing required.
- **`ToolCallCodec.decode(text, context)`.** When a model embeds tool calls in prose rather than using the structured channel, `ToolCallCodec.decode` extracts the `{ tool_calls: [...] }` envelope. Tolerant of surrounding text before and after the JSON object. Useful for nano models and WebLLM.
- **Tool dispatch.** After decoding, the node looks up the matching `Tool` by name in a registry, calls `tool.execute(input)`, and routes the DAG on success or failure.

## Run

```bash
npx tsx examples/26-tool-use.ts
```

Ollama must be running and `llama3.2` (or the model you set) must be pulled.
