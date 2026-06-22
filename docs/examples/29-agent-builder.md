---
title: 'Example 29: AgentBuilder'
description: 'AgentBuilder.loop — assemble the canonical 8-node agent loop into a DAGType in one call.'
seeAlso:
  - text: 'Guide: Agent loop'
    link: '../guide/conversational#agent-loop'
    description: 'Full guide: 8-node topology, subclassing, and wiring'
  - text: 'Example 26: Tool use'
    link: './26-tool-use'
    description: 'ToolInterface definition, ToolCallCodec, adapter dispatch'
  - text: 'Example 24: LLM adapter'
    link: './24-llm-adapter'
    description: 'LlmAdapter, registry, cascade, and chat surface'
  - text: 'The Archivist (in-browser demo)'
    link: './the-archivist'
    description: 'A full multi-branch agent application built on Dagonizer'
---

# Example 29: AgentBuilder

`AgentBuilder.loop(nodes, options?)` assembles the canonical 8-node agent
loop into a `DAGType` ready for `dispatcher.registerDAG(dag)`. The topology —
placement names, route maps, scatter configuration, terminal outcomes — is
owned by `AgentBuilder`; callers only subclass the 8 abstract base nodes to
adapt how state is read and written.

## Why AgentBuilder exists

Every LLM agent loop repeats the same structure: build a chat request, send
it to the model, inspect the variant of the response, decode any embedded tool
calls, validate them, partition them into safe/exclusive worksets, scatter
dispatch, gather results, loop back. Three independent consumers rebuilt this
topology from scratch before `AgentBuilder` was introduced.

`AgentBuilder.loop` captures the verified topology in one place. Consumers
subclass; they do not re-wire.

## The 8-node topology

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

## Import

```ts
import {
  AgentBuilder,
  AppendAssistantNode,
  BuildChatRequestNode,
  BuildToolWorksetsNode,
  CallModelNode,
  CollectToolResultsNode,
  DecodeTextToolCallsNode,
  NormalizeResponseNode,
  NormalizeToolCallsNode,
} from '@studnicky/dagonizer/patterns';
import type { AgentLoopNodesType, AgentLoopOptionsType } from '@studnicky/dagonizer/patterns';
```

## Subclassing the 8 abstract base nodes

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

`CallModelNode` receives the `LlmAdapterInterface` via its constructor:

```ts
class MyCallModelNode extends CallModelNode<AgentState> {
  readonly name = 'call-model';
  constructor(llm: LlmAdapterInterface) { super(llm); }
  // …
}
```

## Calling AgentBuilder.loop

```ts
const nodes: AgentLoopNodesType = {
  chatRequest:         new MyBuildChatRequestNode(),
  callModel:           new MyCallModelNode(llm),
  normalizeResponse:   new MyNormalizeResponseNode(),
  decodeTextToolCalls: new MyDecodeTextToolCallsNode(),
  normalizeToolCalls:  new MyNormalizeToolCallsNode(),
  toolWorksets:        new MyBuildToolWorksetsNode(),
  collectToolResults:  new MyCollectToolResultsNode(),
  appendAssistant:     new MyAppendAssistantNode(),
};

const dag = AgentBuilder.loop(nodes, { name: 'my-agent', version: '1' });
```

`options.name` defaults to `'agent-loop'`; `options.version` defaults to `'1'`.
Override both when multiple agent loops coexist in the same dispatcher.

## Wiring the dispatcher

```ts
const dispatcher = new Dagonizer<AgentState>();

// Register all 8 nodes.
dispatcher.registerNode(nodes.chatRequest);
dispatcher.registerNode(nodes.callModel);
dispatcher.registerNode(nodes.normalizeResponse);
dispatcher.registerNode(nodes.decodeTextToolCalls);
dispatcher.registerNode(nodes.normalizeToolCalls);
dispatcher.registerNode(nodes.toolWorksets);
dispatcher.registerNode(nodes.collectToolResults);
dispatcher.registerNode(nodes.appendAssistant);

// Register tool DAGs (each tool:<name> synthesized by ToolRegistry).
dispatcher.registerBundle(toolRegistry.bundle());

// Register the assembled agent-loop DAG.
dispatcher.registerDAG(dag);
```

## Code

<<< @/../examples/29-agent-builder.ts

## What it demonstrates

- **`AgentBuilder.loop(nodes, options?)`** — one call assembles the full 8-node
  agent loop topology. The returned `DAGType` is data-only; it carries no
  runtime state.
- **Template-method pattern** — each abstract base node separates framework
  concerns (execution, error wrapping, routing) from domain concerns (state
  reads and writes). Subclasses override only the abstract template methods.
- **`dagFrom` scatter** — the `dispatch-tools` placement resolves the body DAG
  from `state.safeWorkset[i].dagName` at runtime. Register tool DAGs with
  `toolRegistry.bundle()` before the loop runs.
- **Loop-back edge** — `collect-results → done → build-request` is the turn
  boundary. After gathering tool results, the loop restarts with a new
  `build-request` so the model can see the results.

## Run

```bash
npx tsx examples/29-agent-builder.ts
```

No external dependencies required; the example uses a stub LLM adapter that
always returns a canned text response.
