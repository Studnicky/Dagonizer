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

Dagonizer ships three tiers of plugins, each installable independently. Every tier consumes a stable subpath surface on the main `@studnicky/dagonizer` package; the surface stays narrow so an adapter package does not pull in pattern code, a tool package does not pull in adapter internals, and so on.

::: warning Beta
The plugin packages are GitHub-only and not yet published to npm. Install via the repo + workspace path while live-API confirmation lands against each provider. The contracts (`./adapter`, `./tool`, `./patterns`) are stable.
:::

## Plugin tiers

| Tier | Subpath consumed | Packages | Shape |
|------|------------------|----------|-------|
| **Adapters** | `@studnicky/dagonizer/adapter` | `@studnicky/dagonizer-adapter-*` (8) | Concrete drop-in classes |
| **Tools** | `@studnicky/dagonizer/tool` (+ `/adapter`) | `@studnicky/dagonizer-tool-*` (3) | Concrete classes implementing `ToolInterface<TInput, TOutput>` |
| **Patterns** | `@studnicky/dagonizer/patterns` (+ `/adapter`, `/tool`) | `@studnicky/dagonizer-patterns-*` (3) | Abstract base classes consumers extend |

## `@studnicky/dagonizer/adapter`

The adapter subpath exposes everything an LLM-provider adapter needs:

| Symbol | Role |
|--------|------|
| `LlmAdapterInterface` | The contract every adapter implements (`chat(ChatRequestType): Promise<ChatResponseType>`) |
| `BaseAdapter` | Abstract base with retry, error classification, request normalization |
| `OpenAiCompatibleAdapter` | Concrete base for OpenAI-shaped HTTP backends |
| `LlmAdapterCascade`, `LlmAdapterRegistry`, `AdapterDescriptor` | Multi-adapter routing |
| `EmbedderCascade`, `EmbedderRegistry`, `BaseEmbedder` | Embedding model cascade |
| `ChatRequestType`, `ChatResponseType`, `ChatRequestBuilder`, `ChatResponseMessageBuilder` | Wire types and value factories |
| `LlmError`, `Classifications` | Error taxonomy — `LlmError.classifyHttp(status, body)` and `LlmError.ofNetworkError(err)` are static methods on `LlmError` |
| `ToolCallCodec` | JSON envelope decoder for models that emit tool calls as text (Gemini Nano, WebLLM) |
| `AdapterCapabilitiesType`, `ToolCall`, `ToolChoiceType`, `ToolDefinition`, `TokenUsage` | Capability metadata |

### Using an adapter

<<< @/../examples/24-llm-adapter.ts#adapter-usage

### Writing an adapter

Extend `BaseAdapter` and implement the one abstract method, `performChat`. The adapter below is complete and runnable — it echoes the last user message instead of calling a provider, so it needs no network:

<<< @/../examples/dags/custom-adapter.ts#custom-adapter

A production adapter fills `performChat` with a real HTTP call; retry, error classification, and `probe()` come from `BaseAdapter` for free. The `custom-adapter` example drives this adapter through a `chat()` call; run it with `npx tsx examples/custom-adapter.ts`.

## `@studnicky/dagonizer/tool`

The tool subpath exposes a small surface for external-service wrappers:

| Symbol | Role |
|--------|------|
| `ToolInterface<TInput, TOutput>` | Contract: `definition` (the JSON-Schema LLM-facing surface) + `execute(input, options?)` |
| `ToolError` | Error type with `classification.reason` |
| `HttpTransport` | Built-in retry, timeout, abort propagation, JSON parsing for HTTP-backed tools |

### Using a tool

<<< @/../examples/dags/26-tool-use.ts#tool-usage

### Writing a tool

<<< @/../examples/dags/26-tool-use.ts#tool-impl

`HttpTransport` handles retry on 429/5xx/network, abort propagation, JSON parsing, and timeout; every tool gets it for free.

## `@studnicky/dagonizer/patterns`

The patterns subpath exposes the abstract `MonadicNode` root plus the service contracts pattern packages depend on:

| Symbol | Role |
|--------|------|
| `MonadicNode<TState, TOutput>` | Abstract base class. Owns the dispatch loop; subclasses inject domain pieces via abstract methods |
| `LlmClientInterface` | Service contract: `chat(ChatRequestType): Promise<ChatResponseType>` (subset of `LlmAdapterInterface`) |
| `TripleStoreInterface` | Service contract: `assert`, `ask`, `select`, `count`, `clearGraph`, `triples` |
| `Binding`, `Quad`, `SlotPattern`, `Term` | RDF value types used by `TripleStoreInterface` |

### Pattern taxonomy

```
MonadicNode<TState, TOutput>                       (root: main package)
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

<<< @/../examples/dags/pattern-node.ts#pattern-node

The pattern handles LLM dispatch, retry, abort propagation, and contract field forwarding. The lines above are everything the consumer writes. The `pattern-node` example runs this `IntentClassifier` inside a DAG against an in-process LLM; run it with `npx tsx examples/pattern-node.ts`.

## Why three subpaths

Each contract subpath is independently consumable:

- An **adapter package** depends on `@studnicky/dagonizer/adapter` only; never pulls in the pattern surface.
- A **tool package** depends on `@studnicky/dagonizer/tool` + `/adapter` (for `ToolDefinition`); never pulls in patterns.
- A **pattern package** depends on `@studnicky/dagonizer/patterns` (root) + occasionally `/adapter` (RAG patterns need LLM types) + `/tool` (ScoutNode references `Tool`).

Consumers install only what they use. The dependency graph stays acyclic.

## Related reference

- [Architecture](../architecture)
- [Demo: The Archivist](../examples/the-archivist)
- [Reference: Contracts](../reference/contracts)
