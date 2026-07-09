---
title: 'Example 24: LLM Adapter'
description: 'LLM adapter surface: register OllamaApiAdapter instances in an LlmAdapterRegistry, wire an LlmAdapterCascade that walks the preference list probing each adapter, and call .chat() inside a DAG node that routes on the response variant.'
seeAlso:
  - text: 'The Archivist'
    link: './the-archivist'
    description: 'LlmAdapterCascade over Groq, Cerebras, Gemini, Ollama, WebLLM'
  - text: 'Example 25: Embedder'
    link: './25-embedder'
    description: 'EmbedderRegistry, EmbedderCascade, cosine similarity'
  - text: 'Example 26: Tool Use'
    link: './26-tool-use'
    description: 'Tool definition, ToolCallCodec, and adapter dispatch'
  - text: 'Reference: Contracts'
    link: '../reference/contracts'
    description: 'LlmAdapter, LlmAdapterRegistry, LlmAdapterCascade contracts'
---

<script setup lang="ts">
import { archivistDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 24: LLM Adapter

## What It Is

LLM Adapter is the provider boundary for model-backed DAG nodes. The Archivist can run against local Ollama, browser models, or cloud APIs because nodes depend on an `LlmAdapterInterface`, not on a provider SDK.

The application builds an adapter or cascade before execution, injects it through services, and lets DAG routes handle the response variant. Provider probing, request timeout, system prompt injection, and tool-call support stay behind the adapter boundary.

## How It Works

Nodes depend on an `LlmAdapterInterface` supplied through services. The host builds an adapter or cascade before execution, injects it into node constructors, and lets DAG routes handle the model response variant. Provider probing, request timeout, system prompt injection, and tool-call support stay behind the adapter boundary.

This keeps provider choice outside the graph. The DAG still says "classify," "extract," "rank," and "compose"; the service layer decides whether those calls go to a local model, a browser runtime, or a cloud backend.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The adapter is injected service state; the DAG shows where model-backed nodes sit in the flow. [The Archivist](./the-archivist) is the in-browser owner for adapter selection.

<DagJsonMermaid :dag="archivistDAG" title="Archivist LLM adapter DAG" aria-label="Archivist JSON-LD DAG beside Mermaid generated from it." />

The LLM adapter surface provides a provider-agnostic interface for chat completion. The browser Archivist lets the user select among configured backends, instantiates the selected adapter, and injects it into `ArchivistServices` for classify/extract/rank/compose nodes.

### Run

```bash
npm run docs:dev
```

Open [The Archivist](./the-archivist) and choose a backend in the Config panel.

## What It Lets You Do

LLM adapters let applications swap model providers without changing DAG topology or node contracts. Use them when the same graph should run against local Ollama, browser models, cloud APIs, or a cascade that selects the first available backend.

They also give the application one place to enforce provider policy: request timeout, system prompt defaults, tool-call support, JSON mode, and capability probing.

## Code Samples

The browser snippets show provider selection and service injection. The CLI snippet shows a preference-ordered cascade across multiple providers.

<<< @/../docs/.vitepress/theme/components/ArchivistRunner.vue#archivist-browser-llm-client

<<< @/../docs/.vitepress/theme/components/ArchivistRunner.vue#archivist-browser-services

<<< @/../examples/the-archivist/runArchivist.ts#adapter-cascade

## Details for Nerds

### Adapter options

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

### Cascade creation

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

- **`OllamaApiAdapter`.** Wraps Ollama's OpenAI-compatible endpoint (`/v1/chat/completions`). Constructed with `{ model, baseUrl? }`: `model` is required (Ollama models are pulled per-host); `baseUrl` defaults to `http://127.0.0.1:11434`. No API key required for local usage.
- **`probe()`.** Each adapter implementation overrides `probe()` to report availability. `OllamaApiAdapter.probe()` issues a `GET /api/tags` with a short timeout (500 ms); returns `true` when the daemon answers `2xx`, `false` on timeout or connection error. Never throws.
- **`LlmAdapterCascade.create`.** Static factory that assembles an `LlmAdapterCascade` from a preference-ordered catalogue. Each `CatalogueEntryType` pairs an `AdapterDescriptorShapeType` (provider + model + capabilities) with a zero-arg factory. The factory creates a fresh `LlmAdapterRegistry`, registers every entry in catalogue order, and returns the configured cascade. Import both from `@studnicky/dagonizer/adapter`.
- **`LlmAdapterRegistry`.** Stores adapters keyed by `(provider, model)` pairs. Created internally by the builder; access it directly only when you need dynamic runtime registration.
- **`LlmAdapterCascade`.** Accepts a preference list and a registry. `cascade.select()` walks the list in order, calls `adapter.probe()` on each, and returns the first available adapter. Throws when no adapter is available.
- **Response routing.** `response.message.variant` is `'text'` for a plain completion or `'tools'` when the model makes tool calls. The DAG node routes on `variant` to separate the two paths.

## Related Concepts

- [The Archivist](./the-archivist) - LlmAdapterCascade over Groq, Cerebras, Gemini, Ollama, WebLLM
- [Example 25: Embedder](./25-embedder) - EmbedderRegistry, EmbedderCascade, cosine similarity
- [Example 26: Tool Use](./26-tool-use) - Tool definition, ToolCallCodec, and adapter dispatch
- [Reference: Contracts](../reference/contracts) - LlmAdapter, LlmAdapterRegistry, LlmAdapterCascade contracts
- [ReAct agent: live token streaming](../guide/react-agent#live-token-streaming) - `chatStream`, `{ sink }` configured model calls, and routed concurrent conversations
- [Reference: Adapters](../reference/adapters) - adapter API details beyond the Archivist example
