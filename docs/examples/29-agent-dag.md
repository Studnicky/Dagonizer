---
title: 'Example 29: Agent DAG with JSON-LD'
description: 'Author an 8-node agent loop with DAGBuilder, emit JSON-LD, and register it on the dispatcher.'
seeAlso:
  - text: 'Guide: Agent loop'
    link: '../guide/conversational#agent-loop'
    description: 'Full guide: 8-node topology, subclassing, and wiring'
  - text: 'Guide: Chat Event Orchestration'
    link: '../guide/chat-event-orchestration'
    description: 'one registered agent DAG per inbound event or request turn'
  - text: 'Example 26: Tool Use'
    link: './26-tool-use'
    description: 'ToolInterface definition, ToolCallCodec, adapter dispatch'
  - text: 'Example 24: LLM Adapter'
    link: './24-llm-adapter'
    description: 'LlmAdapter, registry, cascade, and chat surface'
  - text: 'The Archivist'
    link: './the-archivist'
    description: 'A full multi-branch agent application powered by Dagonizer'
---

<script setup lang="ts">
import { archivistDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 29: Agent DAG with JSON-LD

## What It Is

Agent DAG with JSON-LD shows the agent loop as graph data rather than an opaque chat callback. `DAGBuilder` emits JSON-LD topology; concrete nodes, tools, memory, fallback paths, and final response assembly remain visible as placements and routes in the registered DAG.

The practical lesson is simple: an LLM-powered application can still have inspectable topology. JSON-LD records what can happen; registered nodes decide what does happen for a specific turn.

## How It Works

The loop is a normal DAG: build a request, call the model, normalize the response, decode tool calls, build worksets, scatter to registered tool DAGs, collect results, and route back to the next model turn. `DAGBuilder` captures every placement and route in JSON-LD, while abstract base nodes provide reusable execution behavior for concrete agent state classes.

The Archivist expands that skeleton into a domain application. It classifies visitor intent, chooses book-search or memory paths, embeds reusable search and compose sub-DAGs, and routes tool-backed results into response composition.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The runnable agent graph is [The Archivist](./the-archivist). The diagram below is generated from the same `archivistDAG` document that the browser and CLI register.

<DagJsonMermaid :dag="archivistDAG" title="Archivist agent DAG" aria-label="Archivist agent JSON-LD DAG beside Mermaid generated from it." />

The topology, placement names, route maps, scatter configuration, embedded DAGs, and terminal outcomes stay visible at the authoring site. A user turn is not a hidden callback stack; it is a graph run.

### The reusable loop skeleton

```
build-request
  └─ ready ──► call-model
                └─ text|tools|mixed ──► normalize-response
                     ├─ text  ──► append-assistant ──► end-done (completed)
                     └─ tools|mixed ──► decode-tools
                                          └─ decoded ──► normalize-tools
                                               └─ valid ──► worksets
                                                    └─ ready ──► dispatch-tools
                                                         (scatter: dagFrom: dagName)
                                                         └─ collect-results ──► build-request
```

Terminals:
- `end-done` (`completed`) — the model answered without tool calls; loop exits.
- `end-error` (`failed`) — any unrecoverable error path.

The scatter placement (`dispatch-tools`) uses `{ dagFrom: 'dagName' }`: each
scatter item produced by `BuildToolWorksetsNode` carries a `dagName` field
(`'tool:<name>'`), and the engine resolves the body DAG from that field at
runtime. `CollectToolResultsNode` runs after the gather and loops back to
`build-request` for the next model turn.

### Run

```bash
npm run docs:dev
```

Open [The Archivist](./the-archivist) and run a visitor turn.

## What It Lets You Do

Agent DAGs let applications model calls, tool calls, result gathering, memory writes, and final response assembly as inspectable graph data instead of opaque framework callbacks.

Use this when a product needs the agent loop to be serializable, visualizable, reusable across browser and CLI hosts, and extensible through embedded DAGs or plugins.

### Why the agent DAG exists

Every model/tool loop repeats the same structure: build a chat request, send it to the model, inspect the response variant, decode embedded tool calls, validate them, partition them into safe/exclusive worksets, scatter dispatch, gather results, and loop back.

The runnable JSON-LD topology in `examples/dags/29-agent-dag.ts` is emitted by
an explicit `DAGBuilder` chain. The full browser-runner proof lives in
`examples/the-archivist/dag.ts`, and both the browser runner and CLI register
their DAGs as first-class runtime artifacts.

## Code Samples

The runnable agent example keeps the loop explicit through `DAGBuilder`. The Archivist shows the larger app-level graph that registers real nodes, embedded DAGs, tools, memory, and model services.

<<< @/../examples/dags/29-agent-dag.ts

<<< @/../examples/the-archivist/dag.ts

<<< @/../docs/.vitepress/theme/components/ArchivistRunner.vue#archivist-browser-services

## Details for Nerds

### Subclassing the 8 abstract base nodes

Each base node declares one or more `protected abstract` template methods. The
subclass fills in state reads and writes; the base class implements the full
execution, error wrapping, and output routing.

| Base class | Abstract methods | Outputs |
|---|---|---|
| `BuildChatRequestNode` | `buildRequest(state, ctx)` | `'ready'` \| `'error'` |
| `CallModelNode` | `getRequest`, `storeResponse` | `'text'` \| `'tools'` \| `'mixed'` \| `'error'` |
| `NormalizeResponseNode` | `getResponse` | `'text'` \| `'tools'` \| `'mixed'` \| `'empty'` \| `'error'` |
| `DecodeTextToolCallsNode` | `getText`, `storeToolCalls` | `'decoded'` \| `'empty'` \| `'error'` |
| `NormalizeToolCallsNode` | `getToolCalls`, `writeNormalized` | `'valid'` \| `'empty'` \| `'error'` |
| `BuildToolWorksetsNode` | `getToolCalls`, `classifyCall`, `writeSafeWorkset`, `writeExclusiveWorkset` | `'ready'` \| `'empty'` \| `'error'` |
| `CollectToolResultsNode` | `getGatheredResults`, `writeResult` | `'done'` \| `'empty'` \| `'error'` |
| `AppendAssistantNode` | `getResponse`, `append` | `'done'` \| `'error'` |

`CallModelNode` receives the `LlmAdapterInterface` through its constructor, matching the same service-injection pattern used by the Archivist runner above.

### Authoring the agent DAG

Use distinct DAG names and versions when multiple agent loops coexist in the same dispatcher. Your `DAGBuilder` chain owns the model/tool loop topology; the concrete Archivist source in `Code Samples` shows the larger application graph with embedded DAGs and domain-specific branches.

### Wiring the dispatcher

The dispatcher wiring follows the same order throughout the docs: register concrete nodes, register any plugin/tool/embedded DAG bundles they depend on, then register the parent DAG. The Archivist browser services snippet shows that order in the real UI runner.

### What the runnable Archivist demonstrates
- **Agent DAG authoring from JSON-LD.** The full Archivist topology is a data artifact registered like any other `DAGType`.
- **Template-method pattern** — each abstract base node separates framework
  concerns (execution, error wrapping, routing) from domain concerns (state
  reads and writes). Subclasses override only the abstract template methods.
- **`dagFrom` scatter** — the `dispatch-tools` placement resolves the body DAG
  from `state.safeWorkset[i].dagName` at runtime. Register tool DAGs with
  `toolRegistry.bundle()` before the loop runs.
- **Loop-back edge** — `collect-results → done → build-request` is the turn
  boundary. After gathering tool results, the loop restarts with a new
  `build-request` so the model can see the results.

## Related Concepts

- [Guide: Agent loop](../guide/conversational#agent-loop) - Full guide: 8-node topology, subclassing, and wiring
- [Guide: Chat Event Orchestration](../guide/chat-event-orchestration) - one registered agent DAG per inbound event or request turn
- [Example 26: Tool Use](./26-tool-use) - ToolInterface definition, ToolCallCodec, adapter dispatch
- [Example 24: LLM Adapter](./24-llm-adapter) - LlmAdapter, registry, cascade, and chat surface
- [The Archivist](./the-archivist) - A full multi-branch agent application powered by Dagonizer
