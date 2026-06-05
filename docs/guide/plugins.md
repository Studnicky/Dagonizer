---
title: 'Plugins'
description: 'Three plugin tiers: adapters (LLM transports), tools (external services), patterns (abstract DAG-node base classes). Each tier consumes a stable subpath: ./adapter, ./tool, ./patterns.'
seeAlso:
  - text: 'Architecture'
    link: '../architecture'
    description: 'how the dispatcher, contracts, and plugins interlock'
  - text: 'The Archivist'
    link: '../examples/the-archivist'
    description: 'in-browser demo wiring adapters, tools, and patterns together'
---

# Plugins

Dagonizer ships three tiers of plugins, each installable independently. Every tier consumes a stable subpath surface on the main `@noocodex/dagonizer` package; the surface stays narrow so an adapter package does not pull in pattern code, a tool package does not pull in adapter internals, and so on.

::: warning Beta
v0.10.0 is GitHub-only. The plugin packages have not been published to npm yet. Install via the repo + workspace path while live-API smoke confirmation lands against each provider. The contracts (`./adapter`, `./tool`, `./patterns`) are stable; minor adjustments are expected on each adapter before 1.0.
:::

## Plugin tiers

| Tier | Subpath consumed | Packages | Shape |
|------|------------------|----------|-------|
| **Adapters** | `@noocodex/dagonizer/adapter` | `@noocodex/dagonizer-adapter-*` (8) | Concrete drop-in classes |
| **Tools** | `@noocodex/dagonizer/tool` (+ `/adapter`) | `@noocodex/dagonizer-tool-*` (3) | Concrete static classes |
| **Patterns** | `@noocodex/dagonizer/patterns` (+ `/adapter`, `/tool`) | `@noocodex/dagonizer-patterns-*` (3) | Abstract base classes consumers extend |

## `@noocodex/dagonizer/adapter`

The adapter subpath exposes everything an LLM-provider adapter needs:

| Symbol | Role |
|--------|------|
| `LlmAdapter` | The contract every adapter implements (`chat(ChatRequest): Promise<ChatResponse>`) |
| `BaseAdapter` | Abstract base with retry, error classification, request normalization |
| `OpenAiCompatibleAdapter` | Concrete base for OpenAI-shaped HTTP backends |
| `LlmAdapterCascade`, `LlmAdapterRegistry`, `AdapterDescriptor` | Multi-adapter routing |
| `EmbedderCascade`, `EmbedderRegistry`, `BaseEmbedder` | Embedding model cascade |
| `ChatRequest`, `ChatResponse`, `ChatRequestBuilder`, `ChatResponseMessageBuilder` | Wire types and value factories |
| `LlmError`, `Classifications` | Error taxonomy — `LlmError.classifyHttp(status, body)` and `LlmError.fromNetworkError(err)` are static methods on `LlmError` |
| `ToolCallCodec` | JSON envelope decoder for models that emit tool calls as text (Gemini Nano, WebLLM) |
| `AdapterCapabilities`, `ToolCall`, `ToolChoice`, `ToolDefinition`, `TokenUsage` | Capability metadata |

### Using an adapter

```ts
import { GroqApiAdapter } from '@noocodex/dagonizer-adapter-groq';
import { ChatRequestBuilder } from '@noocodex/dagonizer/adapter';

const adapter = new GroqApiAdapter({ apiKey: process.env.GROQ_API_KEY! });
const response = await adapter.chat(ChatRequestBuilder.from({
  messages: [{ role: 'user', content: 'Hello', toolCallId: '', toolName: '' }],
}));
if (response.message.kind === 'text') {
  console.log(response.message.content);
}
```

### Writing an adapter

Extend `BaseAdapter` and implement `performChat`:

```ts
import { BaseAdapter, ChatResponseMessageBuilder, ZERO_TOKEN_USAGE } from '@noocodex/dagonizer/adapter';
import type { ChatRequest, ChatResponse } from '@noocodex/dagonizer/adapter';

export class MyAdapter extends BaseAdapter {
  constructor() {
    super('mine', 'My Provider', { toolUse: 'full', structuredOutput: true, jsonMode: true });
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    // Hit the provider, parse response.
    return {
      message: ChatResponseMessageBuilder.from('hello back', []),
      finishReason: 'stop',
      usage: ZERO_TOKEN_USAGE,
    };
  }
}
```

## `@noocodex/dagonizer/tool`

The tool subpath exposes a small surface for external-service wrappers:

| Symbol | Role |
|--------|------|
| `Tool<TInput, TOutput>` | Contract: `definition` (the JSON-Schema LLM-facing surface) + `execute(input, signal)` |
| `ToolError` | Error type with `classification.reason` |
| `HttpTransport` | Built-in retry, timeout, abort propagation, JSON parsing for HTTP-backed tools |

### Using a tool

```ts
import { OpenLibrarySearchTool } from '@noocodex/dagonizer-tool-openlibrary';

const candidates = await OpenLibrarySearchTool.execute({ query: 'labyrinths' });
```

### Writing a tool

```ts
import type { Tool } from '@noocodex/dagonizer/tool';
import { HttpTransport, ToolError } from '@noocodex/dagonizer/tool';

export const MyTool: Tool<{ q: string }, readonly string[]> = {
  definition: {
    name: 'mine',
    description: 'Search my service',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    strict: true,
  },
  async execute(input, signal) {
    const data = await HttpTransport.getJson<{ items: string[] }>(
      `https://api.example.com/search?q=${encodeURIComponent(input.q)}`,
      { signal },
    );
    return data.items;
  },
};
```

`HttpTransport` handles retry on 429/5xx/network, abort propagation, JSON parsing, and timeout; every tool gets it for free.

## `@noocodex/dagonizer/patterns`

The patterns subpath exposes the abstract `MonadicNode` root plus the service contracts pattern packages depend on:

| Symbol | Role |
|--------|------|
| `MonadicNode<TState, TOutput, TServices>` | Abstract base class. Owns the dispatch loop; subclasses inject domain pieces via abstract methods |
| `LlmClient` | Service contract: `chat(ChatRequest): Promise<ChatResponse>` (subset of `LlmAdapter`) |
| `TripleStore` | Service contract: `assert`, `ask`, `select`, `count`, `clearGraph`, `triples` |
| `Binding`, `Quad`, `SlotPattern`, `Term` | RDF value types used by `TripleStore` |

### Pattern taxonomy

```
MonadicNode<TState, TOutput, TServices>            (root: main package)
│
├── DecisionNode<TState, TChoice>                  [patterns-rag]
├── ComposeNode<TState>                            [patterns-rag]
├── ScoutNode<TState, TIn, TOut, TItem>            [patterns-rag]
├── GraphNode<TState>                              [patterns-graph]
│   ├── RecallContextNode
│   ├── RecordFindingsNode
│   └── MemoryDigestNode
└── FlowNode<TState>                               [patterns-flow]
    ├── SelectNode → PickByScoreNode, SortByNode
    ├── ReduceNode → DedupeByKeyNode, GroupByFieldNode, MergeReducerNode
    ├── PredicateGateNode
    ├── ExtractFieldNode
    └── RespondNode
```

### Example: classifying intent

```ts
import { DecisionNode } from '@noocodex/dagonizer-patterns-rag';
import { NodeStateBase } from '@noocodex/dagonizer';

type Intent = 'search' | 'describe' | 'recommend' | 'off-topic';

class MyState extends NodeStateBase {
  query = '';
  intent: Intent = 'off-topic';
}

class IntentClassifier extends DecisionNode<MyState, Intent> {
  readonly name = 'classify-intent';
  readonly outputs = ['search', 'describe', 'recommend', 'off-topic'] as const;

  protected buildPrompt(s: MyState): string {
    return `Classify: "${s.query}" → search | describe | recommend | off-topic. Reply with one word.`;
  }

  protected parseChoice(content: string): Intent {
    const t = content.trim().toLowerCase();
    if (t === 'search' || t === 'describe' || t === 'recommend') return t;
    return 'off-topic';
  }

  protected routeFor(intent: Intent): Intent { return intent; }
  protected applyChoice(s: MyState, intent: Intent): void { s.intent = intent; }
}
```

The pattern handles LLM dispatch, retry, abort propagation, contract field forwarding. The 15 lines above are everything the consumer writes.

## Why three subpaths

Each contract subpath is independently consumable:

- An **adapter package** depends on `@noocodex/dagonizer/adapter` only; never pulls in the pattern surface.
- A **tool package** depends on `@noocodex/dagonizer/tool` + `/adapter` (for `ToolDefinition`); never pulls in patterns.
- A **pattern package** depends on `@noocodex/dagonizer/patterns` (root) + occasionally `/adapter` (RAG patterns need LLM types) + `/tool` (ScoutNode references `Tool`).

Consumers install only what they use. The dependency graph stays acyclic.

## Related reference

- [Architecture](../architecture)
- [Demo: The Archivist](../examples/the-archivist)
- [Reference: Contracts](../reference/contracts)
