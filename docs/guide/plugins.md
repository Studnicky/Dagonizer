# Plugins

> **Beta — v0.10.0 is GitHub-only.** The plugin packages haven't been published to npm yet. Install via the repo + workspace path while we collect live-API smoke confirmation against each provider. The contracts (`./adapter`, `./tool`, `./patterns`) are stable; minor adjustments are expected on each adapter before 1.0.

Dagonizer ships three tiers of plugins, each installable independently from npm:

| Tier | Packages | Shape |
|---|---|---|
| **Adapters** | `@noocodex/dagonizer-adapter-*` (8) | Concrete drop-in classes |
| **Tools** | `@noocodex/dagonizer-tool-*` (3) | Concrete static classes |
| **Patterns** | `@noocodex/dagonizer-patterns-*` (3) | Abstract base classes consumers extend |

Every plugin builds on a stable subpath surface exposed by the main `@noocodex/dagonizer` package:

- `@noocodex/dagonizer/adapter` — `LlmAdapter`, `BaseAdapter`, `ChatRequest`/`Response`, `AdapterCapabilities`, error taxonomy
- `@noocodex/dagonizer/tool` — `Tool` interface, `ToolError`, `HttpTransport`
- `@noocodex/dagonizer/patterns` — `MonadicNode` root, service contracts (`LlmClient`, `TripleStore`, `SearchTool`)

## Adapters

An adapter wraps one LLM provider's transport. The contract is provider-neutral by construction — every adapter takes a `ChatRequest` and returns a `ChatResponse`.

Install:

```bash
npm install @noocodex/dagonizer @noocodex/dagonizer-adapter-groq
```

Use:

```ts
import { GroqApiAdapter } from '@noocodex/dagonizer-adapter-groq';
import { ChatRequestBuilder } from '@noocodex/dagonizer/adapter';

const adapter = new GroqApiAdapter({ apiKey: process.env.GROQ_API_KEY! });
const response = await adapter.chat(ChatRequestBuilder.from({
  messages: [{ role: 'user', content: 'Hello', toolCallId: '', toolName: '' }],
}));
console.log(response.message);
```

Write your own adapter by extending `BaseAdapter` and implementing `performChat`:

```ts
import { BaseAdapter, ChatResponseMessageBuilder, ZERO_TOKEN_USAGE } from '@noocodex/dagonizer/adapter';
import type { ChatRequest, ChatResponse } from '@noocodex/dagonizer/adapter';

export class MyAdapter extends BaseAdapter {
  constructor() {
    super({
      id: 'mine',
      displayName: 'My Provider',
      capabilities: { toolUse: 'full', structuredOutput: true, jsonMode: true },
    });
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    // Hit your provider, parse response.
    return {
      message: ChatResponseMessageBuilder.from('hello back', []),
      finishReason: 'stop',
      usage: ZERO_TOKEN_USAGE,
    };
  }
}
```

## Tools

Tools wrap external services (HTTP APIs, databases, file systems). Every tool ships a `ToolDefinition` (the JSON-Schema surface the LLM sees) plus an `execute()` the dispatcher invokes.

```ts
import { OpenLibrarySearchTool } from '@noocodex/dagonizer-tool-openlibrary';

const candidates = await OpenLibrarySearchTool.execute({ query: 'labyrinths' });
```

Write your own tool by implementing `Tool<TInput, TOutput>`:

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

`HttpTransport` handles retry on 429/5xx/network, abort propagation, JSON parsing, and timeout — every tool gets it for free.

## Patterns

Patterns are abstract base classes for the recurring shapes a DAG node takes (decide, compose, scout, recall, dedupe, gate, etc.). Each pattern owns the dispatch loop; the consumer injects the domain-specific pieces via abstract methods.

The taxonomy:

```
MonadicNode<TState, TOutput, TServices>            (root — main package)
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
    ├── ReduceNode → DedupeByKeyNode, GroupByFieldNode, FanInReducerNode
    ├── PredicateGateNode
    ├── ExtractFieldNode
    └── RespondNode
```

Example — classify visitor intent into one of four tokens:

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

- An **adapter package** depends on `@noocodex/dagonizer/adapter` only — never pulls in the pattern surface.
- A **tool package** depends on `@noocodex/dagonizer/tool` + `/adapter` (for `ToolDefinition`) — never pulls in patterns.
- A **pattern package** depends on `@noocodex/dagonizer/patterns` (root) + occasionally `/adapter` (RAG patterns need LLM types) + `/tool` (ScoutNode references `Tool`).

You install only what you use. The dependency graph stays acyclic.

## See also

- [Architecture](../architecture) — how the dispatcher, contracts, and plugins interlock
- [The Archivist](../examples/the-archivist) — full working consumer of every tier
