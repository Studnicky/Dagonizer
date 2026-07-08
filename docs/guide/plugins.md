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

<script setup lang="ts">
import { ingestSourceDAG, normalizeCsvDAG, normalizeJsonDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Plugins

## What It Is

Plugins package reusable Dagonizer parts without creating a second execution model. A plugin can ship nodes, DAG JSON-LD, namespace context, and named exports. The host registers the plugin once, then embeds exported DAG names exactly like locally-authored child DAGs.

Adapters, tools, and patterns are still plugin tiers, but the main assembly rule is simpler: if a reusable flow can be embedded, ship it as a DAG.

## How It Works

A plugin declares an ID, optional context, nodes, DAGs, and exports. `registerPlugin` scopes and registers those parts into the same registries used by local bundles. Higher-level DAGs embed plugin DAG names through normal `EmbeddedDAGNode` placements; there is no plugin-specific execution path.

Dagonizer ships three tiers of plugins, each installable independently. Every tier consumes a stable subpath surface on the main `@studnicky/dagonizer` package; the surface stays narrow so an adapter package does not pull in pattern code, a tool package does not pull in adapter internals, and so on.

::: warning Beta
The plugin packages are GitHub-only and not yet published to npm. Install via the repo + workspace path while live-API confirmation lands against each provider. The contracts (`./adapter`, `./tool`, `./patterns`) are stable.
:::

## Diagrams, Examples, and Outputs

The Cartographer packages source-normalization child DAGs as a plugin. The ingest DAG embeds those plugin-provided DAG names through normal `EmbeddedDAGNode` placements:

<DagJsonMermaid :dag="ingestSourceDAG" title="Cartographer ingest DAG embedding plugin DAGs" aria-label="Cartographer ingest JSON-LD DAG beside Mermaid generated from it." />

<DagJsonMermaid :dag="normalizeCsvDAG" title="plugin-provided normalize-csv DAG" aria-label="Plugin-provided CSV normalization JSON-LD DAG beside Mermaid generated from it." />

<DagJsonMermaid :dag="normalizeJsonDAG" title="plugin-provided normalize-json DAG" aria-label="Plugin-provided JSON normalization JSON-LD DAG beside Mermaid generated from it." />

- [Architecture](../architecture) - how the dispatcher, contracts, and plugins interlock
- [The Archivist](../examples/the-archivist) - in-browser demo wiring adapters, tools, and patterns together
- [Example 33: Plugin-Defined DAGs](../examples/33-plugin) - Cartographer normalization plugin in a runnable DAG
- [The Cartographer](../examples/the-cartographer) - browser runner that registers the normalization plugin before execution

## What It Lets You Do

Use plugins when reusable nodes, DAGs, adapters, tools, or abstract patterns should be packaged independently and installed into a higher-level DAG. Plugin-defined DAGs and hand-authored embedded DAGs use the same registry and the same JSON-LD assembly interface.

## Code Samples

The snippets below show the public plugin tiers, the high-level plugin definition helper, and the registry/discovery utilities.

### Plugin tiers

| Tier | Subpath consumed | Packages | Shape |
|------|------------------|----------|-------|
| **Adapters** | `@studnicky/dagonizer/adapter` | `@studnicky/dagonizer-adapter-*` (8) | Concrete drop-in classes |
| **Tools** | `@studnicky/dagonizer/tool` (+ `/adapter`) | `@studnicky/dagonizer-tool-*` (3) | Concrete classes implementing `ToolInterface<TInput, TOutput>` |
| **Patterns** | `@studnicky/dagonizer/patterns` (+ `/adapter`, `/tool`) | `@studnicky/dagonizer-patterns-*` (3) | Abstract base classes applications extend |

### `@studnicky/dagonizer/adapter`

The adapter subpath exposes everything an LLM-provider adapter needs:

| Symbol | Role |
|--------|------|
| `LlmAdapterInterface` | The contract every adapter implements (`chat(ChatRequestType): Promise<ChatResponseType>`) |
| `BaseAdapter` | Abstract base with retry, error classification, request normalization |
| `OpenAiCompatibleAdapter` | Concrete base for OpenAI-shaped HTTP backends |
| `LlmAdapterCascade`, `LlmAdapterRegistry`, `AdapterDescriptor` | Multi-adapter routing |
| `EmbedderCascade`, `EmbedderRegistry`, `BaseEmbedder` | Embedding model cascade |
| `ChatRequestType`, `ChatResponseType`, `ChatRequest`, `ChatResponseMessage` | Wire types and value factories via `.create(...)` |
| `LlmError`, `Classifications` | Error taxonomy — `LlmError.classifyHttp(status, body)` and `LlmError.ofNetworkError(err)` are static methods on `LlmError` |
| `ToolCallCodec` | JSON envelope decoder for models that emit tool calls as text (Gemini Nano, WebLLM) |
| `AdapterCapabilitiesType`, `ToolCall`, `ToolChoiceType`, `ToolDefinition`, `TokenUsage` | Capability metadata |

#### Using an adapter

<<< @/../examples/24-llm-adapter.ts#adapter-usage

#### Writing an adapter

Extend `BaseAdapter` and implement the one abstract method, `performChat`. The adapter below is complete and runnable — it echoes the last user message instead of calling a provider, so it needs no network:

<<< @/../examples/dags/custom-adapter.ts#custom-adapter

A production adapter fills `performChat` with a real HTTP call; retry, error classification, and `probe()` come from `BaseAdapter` for free. The `custom-adapter` example drives this adapter through a `chat()` call; run it with `npx tsx examples/custom-adapter.ts`.

### `@studnicky/dagonizer/tool`

The tool subpath exposes a small surface for external-service wrappers:

| Symbol | Role |
|--------|------|
| `ToolInterface<TInput, TOutput>` | Contract: `definition` (the JSON-Schema LLM-facing surface) + `execute(input, options?)` |
| `ToolError` | Error type with `classification.reason` |
| `HttpTransport` | Built-in retry, timeout, abort propagation, optional token bucket / circuit breaker composition, JSON parsing for HTTP-backed tools |

#### Using a tool

<<< @/../examples/dags/26-tool-use.ts#tool-usage

#### Writing a tool

<<< @/../examples/dags/26-tool-use.ts#tool-impl

`HttpTransport` handles retry on 429/5xx/network, abort propagation, JSON parsing, timeout, and optional substrate `TokenBucket` / `CircuitBreaker` guards; every HTTP-backed tool gets the same logical-request ordering. See [Execution tuning](/guide/execution-tuning) for when to apply those guards.

### `@studnicky/dagonizer/patterns`

The patterns subpath exposes the abstract `MonadicNode` root plus the service contracts pattern packages depend on:

| Symbol | Role |
|--------|------|
| `MonadicNode<TState, TOutput>` | Abstract base class. Owns the dispatch loop; subclasses inject domain pieces via abstract methods |
| `LlmClientInterface` | Service contract: `chat(ChatRequestType): Promise<ChatResponseType>` (subset of `LlmAdapterInterface`) |
| `TripleStoreInterface` | Service contract: `assert`, `ask`, `select`, `count`, `clearGraph`, `triples` |
| `Binding`, `Quad`, `SlotPattern`, `Term` | RDF value types used by `TripleStoreInterface` |

#### Pattern taxonomy

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

#### Example: classifying intent

<<< @/../examples/dags/pattern-node.ts#pattern-node

The pattern handles LLM dispatch, retry, abort propagation, and contract field forwarding. The lines above are everything the application writes. The `pattern-node` example runs this `IntentClassifier` inside a DAG against an in-process LLM; run it with `npx tsx examples/pattern-node.ts`.

### Why three subpaths

Each contract subpath is independently consumable:

- An **adapter package** depends on `@studnicky/dagonizer/adapter` only; never pulls in the pattern surface.
- A **tool package** depends on `@studnicky/dagonizer/tool` + `/adapter` (for `ToolDefinition`); never pulls in patterns.
- A **pattern package** depends on `@studnicky/dagonizer/patterns` (root) + occasionally `/adapter` (RAG patterns need LLM types) + `/tool` (ScoutNode references `Tool`).

Applications install only what they use. The dependency graph stays acyclic.

## Details for Nerds

### Plugin loader

#### `PluginInterface`

A plugin package implements `PluginInterface` — a stable `id` plus `register(dispatcher)` — to install its nodes and DAGs onto any dispatcher. The receiver is typed as `PluginReceiverType`, a narrow view that only exposes `registerBundle`. The plugin cannot reach any other dispatcher surface.

```ts
import type { PluginInterface, PluginReceiverType, DispatcherBundleType, NodeStateInterface } from '@studnicky/dagonizer';

export class NormalizePlugin implements PluginInterface {
  readonly id = '@acme/dagonizer-normalize';

  private bundle(): DispatcherBundleType<NodeStateInterface> {
    return {
      specifier: this.id,
      nodes: [new NormalizeNode(), new SummarizeNode()],
      dags:  [pluginDag],
    };
  }

  register(dispatcher: PluginReceiverType): void {
    dispatcher.registerBundle(this.bundle());
  }
}
```

#### `defineDagonizerPlugin`

`defineDagonizerPlugin()` is the high-level authoring helper for plugin packages. It returns a valid `PluginInterface` plus typed `exports` that point at DAG names inside the plugin bundle.

Use it when the plugin packages reusable DAGs:

```ts
import { defineDagonizerPlugin } from '@studnicky/dagonizer/plugin';

export const retrievalPlugin = defineDagonizerPlugin({
  id: '@acme/dagonizer-retrieval',
  context: {
    retrieval: 'https://noocodex.dev/plugins/retrieval#',
  },
  nodes: [
    new EmbedQueryNode(),
    new VectorSearchNode(),
  ],
  dags: [
    retrievalSearchDag,
  ],
  exports: {
    search: 'retrieval:search',
  },
});
```

The `id` is the plugin package/specifier owner for its context prefixes. The export values are plain DAG names. The helper validates that every exported DAG name exists in `dags` before it returns.

Authoring rule:

- If an application can embed it, it should be a DAG.
- If a plugin ships it, it exports the DAG name.
- There is no separate plugin runtime object graph.

Collision rule:

- Registered DAGs are keyed by their resolved IRI.
- The same IRI with a different implementation is a hard registration error.
- The same IRI with the same object is idempotent.
- To compose plugins that would otherwise overlap on internal names, give each plugin its own namespace prefix in `@context` and export names through that prefix.

#### `Dagonizer.registerPlugin(plugin)`

The caller installs a plugin with a single call. Order matters: register plugins before the parent DAG that references their sub-DAG names.

```ts
import { Dagonizer } from '@studnicky/dagonizer';

const dispatcher = new Dagonizer<MyState>();
dispatcher.registerPlugin(new NormalizePlugin());   // installs nodes + sub-DAG
dispatcher.registerDAG(parentDag);                  // parent references plugin's sub-DAG
```

#### `PluginDiscovery` (static DAG-walker)

`PluginDiscovery` from `@studnicky/dagonizer/plugin` provides two static utilities for discovering which plugin DAGs a given entry DAG transitively needs:

```ts
import { PluginDiscovery } from '@studnicky/dagonizer/plugin';

// Immediate literal dag references in one DAG's placement graph
const names = PluginDiscovery.referencedDagNames(myDag);

// Breadth-first walk of the full reachable forest
const registry = new Map(dispatcher.listDAGs().map(d => [d.name, d]));
const all = PluginDiscovery.walk(myDag, registry);
```

Dynamic `DagReference` candidates are projected into the graph and participate in discovery. Literal DAG references and dynamic candidate DAGs use the same graph query path, so plugin DAGs and local DAGs stay on one registry surface.

When applications want to render or inspect a whole reachable forest, the registry should be keyed by DAG name, not by plugin object identity. That keeps plugin DAGs and local DAGs on the same interface.

#### `PluginLoader` — type-safe dynamic import

When loading a plugin from an npm package or a dynamic path, the return type of `import()` is `unknown`. `PluginLoader` from `@studnicky/dagonizer` validates the default export against the `PluginInterface` structural contract — no casts required at the call site.

```ts
import { PluginLoader } from '@studnicky/dagonizer';

// Dynamic import: validates default export, throws DAGError('PLUGIN_INVALID') if invalid
const plugin = await PluginLoader.load('my-dagonizer-plugin');
dispatcher.registerPlugin(plugin);
```

Three entry points are available:

| Method | Signature | Purpose |
|--------|-----------|---------|
| `PluginLoader.load(specifier)` | `(specifier: string) => Promise<PluginInterface>` | Dynamic import + validation in one call |
| `PluginLoader.validate(mod, specifier?)` | `(mod: unknown) => PluginInterface` | Validate an already-imported module namespace |
| `PluginLoader.isPlugin(value)` | `(value: unknown) => value is PluginInterface` | Structural type-guard predicate |

`PluginLoader.validate` accepts a module namespace object (`{ default: plugin }`) or the plugin object directly. `PluginLoader.isPlugin` is the schema-validation boundary: it checks that the value is a non-null object with a non-empty string `id` and a callable `register` method. JSON Schema cannot express "has a method", so the structural predicate is the correct approach.

On failure, both `load` and `validate` throw a `DAGError` with `code: 'PLUGIN_INVALID'`.

#### `PluginDiscovery.loadAll` — batch walk + register

To walk a DAG forest, load each referenced plugin module, and register the plugins on a dispatcher in a single call:

```ts
import { PluginDiscovery } from '@studnicky/dagonizer/plugin';

const registry = new Map(dispatcher.listDAGs().map(d => [d.name, d]));
await PluginDiscovery.loadAll(
  entryDag,
  registry,
  dispatcher,
  (dagName) => `@myorg/dagonizer-plugin-${dagName}`,
);
```

`loadAll` uses `PluginLoader.load` internally; validation and `registerPlugin` are called for each name returned by `PluginDiscovery.walk`.

#### Full example

<<< @/../examples/33-plugin.ts#plugin-registration

Run: `npx tsx examples/33-plugin.ts`

## Related Concepts

- [Example 33: Plugin-Defined DAGs](../examples/33-plugin) - the smallest runnable plugin registration and embedding path
- [The Cartographer](../examples/the-cartographer) - browser demo registering plugin-defined normalization DAGs before execution
- [IRI Identity](./iri-identity) - prefix expansion rules that keep independently-authored plugins from colliding
- [DAGBuilder](./builder) - the `.embed()` API used by plugin-host DAGs
- [Reference: Contracts](../reference/contracts) - plugin, bundle, node, store, and adapter contracts
