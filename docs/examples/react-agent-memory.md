---
title: 'ReAct Agent Memory'
description: 'Stream a ReAct agent loop reasoning trace via AgentTraceProducer, stream live model tokens via CallModelNode { sink }, record each step into an RdfStore with wasGeneratedBy/wasInformedBy provenance, and recall a prior run via graph traversal.'
seeAlso:
  - text: 'Guide: ReAct agent'
    link: '../guide/react-agent'
    description: '8-node loop as ReAct, streamed traces, live tokens, and provenance recall'
  - text: 'Streaming Producers'
    link: '../guide/streaming-producers'
    description: 'DagStreamProducer, StreamChannel.driven, and the scatter-source path behind the trace recorder'
  - text: 'Example 29: Agent DAG'
    link: './29-agent-dag'
    description: 'the 8-node JSON-LD agent loop that emits the reasoning trace'
  - text: 'The Archivist'
    link: './the-archivist'
    description: 'the same provenance-backed recall pattern in a full workflow'
---

<script setup lang="ts">
import { reactAgentDAG, reactTraceDAG } from '../exampleDags.ts';
</script>

# ReAct Agent Memory

## Shared Memory Surface

ReAct Agent Memory records a reasoning trace while an agent loop runs, then recalls that trace on a later run. The example streams model tokens, maps selected node results into `thought`, `action`, `observation`, and `final` steps, records those steps into an RDF store, and recalls the prior chain through provenance traversal.

This is the reusable memory pattern behind teams that need "what happened last time?" context without hiding the agent loop inside callbacks or transport glue.

## Semantic Recall Flow

### DAG registration and diagram

The memory flow registers two DAGs: the canonical ReAct agent loop and the outer trace-recording DAG that drains the agent loop through `ReActTraceProducer`.

<DagJsonMermaid :dag="reactAgentDAG" title="ReAct agent loop DAG" aria-label="ReAct agent loop JSON-LD DAG beside Mermaid generated from it." />

<DagJsonMermaid :dag="reactTraceDAG" title="ReAct reasoning trace memory DAG" aria-label="ReAct reasoning trace memory JSON-LD DAG beside Mermaid generated from it." />

`agentDag` is the inner reasoning loop. `traceDag` is the memory writer: it scatters over a stream of `ReasoningTraceItemType` values and records each item into the shared RDF store with `wasGeneratedBy` and `wasInformedBy` provenance.

`ReActTraceProducer` consumes the agent loop's `Execution` — the `AsyncIterable<NodeResultType>` returned by `dispatcher.execute(...)` — and maps relevant node results (`call-model`, `decode-tools`, `collect-results`, `append-assistant`) to `ReasoningStepType` values tagged with a monotonic `ordinal`.
### Run

```bash
npx tsx examples/react-agent-memory.ts
```

### Output

```
--- react-agent-memory: run-1 (no prior memory) ---

Final answer: "Based on the lookup, {"result":"Dagonizer is a type-safe, abortable DAG dispatcher for TypeScript."}"
Streamed deltas (13): ["Based ","on ","the ","lookup, ","{\"result\":\"Dagonizer ","is ","a ","type-safe, ","abortable ","DAG ","dispatcher ","for ","TypeScript.\"} "]

Recalled hint for run-2: "Prior reasoning (run-1): thought: planning to invoke a tool; action: lookup({}); observation: {"result":"Dagonizer is a type-safe, abortable DAG dispatcher for TypeScript."}; thought: Based on the lookup, {"result":"Dagonizer is a type-safe, abortable DAG dispatcher for TypeScript."}; final: Based on the lookup, {"result":"Dagonizer is a type-safe, abortable DAG dispatcher for TypeScript."}"

--- react-agent-memory: run-2 (recalling run-1) ---

Final answer: "Based on the lookup, {"result":"Dagonizer is a type-safe, abortable DAG dispatcher for TypeScript."}"
Streamed deltas (13): ["Based ","on ","the ","lookup, ","{\"result\":\"Dagonizer ","is ","a ","type-safe, ","abortable ","DAG ","dispatcher ","for ","TypeScript.\"} "]

Lesson: the ReAct reasoning trace streams through a DagStreamProducer into an
        outer scatter that records each step into a shared RdfStore with a
        wasInformedBy provenance chain; a second run recalls the first run's
        chain via graph traversal and injects it as prompt context.
```

The streamed deltas show `MyCallModelNode`'s `{ sink }` option observing
`ScriptedAdapter.performChatStream`'s word-by-word emission on both turns. The
recalled hint shows `ReActRecall.hint` walking run-1's `wasInformedBy` chain
(thought → action → observation → thought → final) into a single string that
run-2 seeds as a leading system message — the same production pattern
[the Archivist](./the-archivist) uses for cross-run recall.

## Streaming and Recall

The inner agent DAG returns an `Execution` async iterable. `ReActTraceProducer` maps selected node results into reasoning trace items, `StreamChannel.driven(...)` exposes those items as a scatter source, and the outer DAG records each item into an RDF store. A later run traverses provenance edges to recall the prior chain.

The agent loop and the memory writer are separate DAGs. The memory DAG drains the agent execution stream, so recording provenance is part of the graph, not an after-the-fact log scrape.

## Code Samples

The executable entry point wires both DAGs, the trace producer, and the shared store:

<<< @/../examples/react-agent-memory.ts

### DAG definitions and reusable classes

The DAG module contains the canonical agent loop, the trace-memory DAG, the deterministic adapter, and the reusable trace/recall classes:

<<< @/../examples/dags/react-agent-memory.ts

## Operational Uses

ReAct agent memory lets hosts stream an agent's reasoning trace into durable graph memory while the agent runs. It fits systems where thoughts, actions, observations, final answers, and provenance need to become queryable state for later runs.

Runs the canonical 8-node [agent DAG](./29-agent-dag) and streams the
agent's ReAct reasoning trace through a second, outer DAG. The outer DAG records
each step into a shared `RdfStore` with provenance and recalls a prior run's
reasoning via graph traversal to inform the next.

## Runtime Notes

- **Organizing a reasoning trace as a stream.** `ReActTraceProducer` maps selected inner DAG node results into ordered `ReasoningTraceItemType` values.
- **Reusing the streaming-producer framework, not a new mechanism.**
  `StreamChannel.driven(producer)` bridges the trace producer into an
  ordinary outer `ScatterNode`'s source. Draining the outer DAG is what pulls
  the inner agent loop forward.
- **Live token streaming.** `MyCallModelNode` is constructed with
  `{ sink: tokenCollectorSink }`; `ScriptedAdapter.performChatStream` streams
  the final answer word-by-word, so the sink observes multiple deltas instead
  of one buffered chunk.
- **Provenance-chained recording.** `RecordReasoningStepNode` (the outer
  scatter's body) asserts each step's `kind` and `value` into the store, plus
  `wasGeneratedBy` (links the step to its run) and `wasInformedBy` (links the
  step to the item at `item.ordinal - 1` in the same run). The chain is
  derived entirely from each item's own `ordinal` field, so it stays correct
  regardless of the order items are actually recorded in — the scatter's
  `execution: { mode: 'item', concurrency: 1 }` here is a default, not a correctness requirement.
- **Cross-run recall via graph traversal.** `ReActRecall.hint(store, priorRunId)`
  finds the prior run's `final` step, walks `wasInformedBy` backward to the
  first step, and formats the chain as a one-line hint — injected as a
  leading `system` message on the next run's first `build-request`.

### Topology

```
dispatcher.execute('urn:noocodec:dag:react-agent', agentState)     → Execution (AsyncIterable<NodeResultType>)
  → new ReActTraceProducer(execution)               → DagStreamProducer<ReasoningTraceItemType>
    → StreamChannel.driven(producer)                  → AsyncIterable<ReasoningTraceItemType>
      → traceState.source
        → outer ScatterNode ('scatter-steps', concurrency 1)
          → body: RecordReasoningStepNode ('record-step')
            → asserts kind/value/wasGeneratedBy/wasInformedBy quads into the shared RdfStore
```

Draining `outerDispatcher.execute('urn:noocodec:dag:react-agent-memory-trace', traceState)` is
what pulls the agent loop forward — the inner `agentDispatcher.execute(...)`
call is never awaited or drained directly.

## Related Concepts

- [Guide: ReAct agent](../guide/react-agent) - 8-node loop as ReAct, streamed traces, live tokens, and provenance recall
- [Streaming Producers](../guide/streaming-producers) - DagStreamProducer, StreamChannel.driven, and the scatter-source path behind the trace recorder
- [Example 29: Agent DAG](./29-agent-dag) - the 8-node JSON-LD agent loop that emits the reasoning trace
- [The Archivist](./the-archivist) - the same provenance-backed recall pattern in a full workflow
