---
title: 'Example 29: Agent DAG with JSON-LD'
description: 'Author an 8-node agent loop with DAGBuilder, emit JSON-LD, and register it on the dispatcher.'
seeAlso:
  - text: 'Guide: Agent loop'
    link: '../guide/conversational#agent-loop'
    description: '8-node topology, subclassing, and runtime wiring for the reusable loop'
  - text: 'Guide: Chat Event Orchestration'
    link: '../guide/chat-event-orchestration'
    description: 'one registered agent DAG per inbound event or request turn'
  - text: 'Example 26: Tool Use'
    link: './26-tool-use'
    description: 'ToolInterface definition, ToolCallCodec, adapter dispatch'
  - text: 'Example 24: LLM Adapter'
    link: './24-llm-adapter'
    description: 'LlmAdapter, registry, cascade, and chat API'
  - text: 'The Archivist'
    link: './the-archivist'
    description: 'A full multi-branch agent workflow powered by Dagonizer'
---

<script setup lang="ts">
import { archivistDAG } from '../exampleDags.ts';
</script>

# Example 29: Agent DAG with JSON-LD

## Agent Loop Surface

Agent DAG with JSON-LD shows the agent loop as graph data rather than an opaque chat callback. `DAGBuilder` emits JSON-LD topology; concrete nodes, tools, memory, routes, and final response assembly remain visible as placements and routes in the registered DAG.

The practical lesson is simple: an LLM-powered workflow can still have explicit topology. JSON-LD records what can happen; registered nodes decide what does happen for a specific turn.

## Registered Agent Topology

### DAG registration and diagram

The agent graph shown here also appears in [The Archivist](./the-archivist). The diagram below is generated from the same `archivistDAG` document that the interactive Archivist host and CLI register.

<DagJsonMermaid :dag="archivistDAG" title="Archivist agent DAG" aria-label="Archivist agent JSON-LD DAG beside Mermaid generated from it." />

The topology, placement IRIs, display names, route maps, scatter configuration, embedded DAGs, gather barriers, and terminal outcomes stay visible at the authoring site. A user turn is not a hidden callback stack; it is a graph run.

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
                                                         (scatter: DagReference item.dagIri)
                                                         └─ collect-results ──► build-request
```

Terminals:
- `end-done` (`completed`) — the model answered without tool calls; loop exits.
- `end-error` (`failed`) — any unrecoverable error path.

The scatter placement (`dispatch-tools`) uses a dynamic `DagReference`: each
scatter item produced by `BuildToolWorksetsNode` carries a `dagIri` field
(`'urn:noocodec:tool:<name>'`), and the engine resolves the body DAG reference from that field after
validating it against the declared candidates. `CollectToolResultsNode` runs after the first-class gather and loops back to
`build-request` for the next model turn.

### Run

```bash
pnpm run site:dev
```

Visit [The Archivist](./the-archivist) and run a visitor turn.

## Loop Assembly Model

The loop is a normal DAG: build a request, call the model, normalize the response, decode tool calls, build worksets, scatter to registered tool DAGs, collect results, and route back to the next model turn. `DAGBuilder` captures every placement and route in JSON-LD, while abstract base nodes provide reusable execution behavior for concrete agent state classes.

The Archivist expands that skeleton into a domain workflow. It classifies visitor intent, chooses book-search or memory paths, embeds reusable search and compose sub-DAGs, and routes tool-backed results into response composition.

## Code Samples

This example keeps the loop explicit through `DAGBuilder`. The Archivist shows the larger workflow graph that registers real nodes, embedded DAGs, tools, memory, and model services.

<<< @/../examples/dags/29-agent-dag.ts

<<< @/../examples/the-archivist/dag.ts

<<< @/../examples/the-archivist/app/ArchivistRunner.vue#archivist-browser-services

## Operational Uses

Agent DAGs let teams model calls, tool calls, result gathering, memory writes, and final response assembly as serialized graph data instead of opaque callback flows.

This pattern fits products that need the agent loop to be serializable, visualizable, reusable across interactive and CLI interfaces, and extensible through embedded DAGs or plugins.

### Why the agent DAG exists

Every model/tool loop repeats the same structure: build a chat request, send it to the model, inspect the response variant, decode embedded tool calls, validate them, partition them into safe/exclusive worksets, scatter dispatch, gather results, and loop back.

The JSON-LD topology in `examples/dags/29-agent-dag.ts` is emitted by
an explicit `DAGBuilder` chain. The full Archivist workflow version lives in
`examples/the-archivist/dag.ts`, and both the Archivist interactive host and CLI register
their DAGs as first-class runtime artifacts.

## Runtime Notes

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

Use distinct DAG IRIs and versions when multiple agent loops coexist in the same dispatcher. Display names stay useful for humans, but registry identity is the expanded DAG IRI. Your `DAGBuilder` chain owns the model/tool loop topology; the concrete Archivist source in `Code Samples` shows the larger workflow graph with embedded DAGs and domain-specific branches.

### Wiring the dispatcher

The dispatcher wiring follows one runtime rule: register concrete nodes first, register any plugin/tool/embedded DAG bundles they depend on next, then register the parent DAG. The Archivist browser services snippet applies that order in the full UI runner.

### How the Archivist applies this loop
- **Agent DAG authoring from JSON-LD.** The full Archivist topology is a data artifact registered like any other `DAGType`.
- **Template-method pattern** — each abstract base node separates framework
  concerns (execution, error wrapping, routing) from domain concerns (state
  reads and writes). Subclasses override only the abstract template methods.
- **Dynamic DAG reference scatter** — the `dispatch-tools` placement resolves the body DAG reference from each workset's `dagIri` at runtime through the same `dag` field used by literal child DAGs. Register tool DAGs with `toolRegistry.bundle()` before the loop runs.
- **Loop-back edge** — `collect-results → done → build-request` is the turn
  boundary. After gathering tool results, the loop restarts with a new
  `build-request` so the model can see the results.

## Related Concepts

- [Guide: Agent loop](../guide/conversational#agent-loop) - 8-node topology, subclassing, and wiring for conversational agent flows
- [Guide: Chat Event Orchestration](../guide/chat-event-orchestration) - one registered agent DAG per inbound event or request turn
- [Example 26: Tool Use](./26-tool-use) - ToolInterface definition, ToolCallCodec, adapter dispatch
- [Example 24: LLM Adapter](./24-llm-adapter) - LlmAdapter, registry, cascade, and chat API
- [The Archivist](./the-archivist) - A full multi-branch agent workflow powered by Dagonizer
