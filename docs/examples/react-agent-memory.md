---
title: 'Example: ReAct agent memory'
description: 'Stream a ReAct agent loop reasoning trace via AgentTraceProducer, stream live model tokens via CallModelNode { sink }, record each step into an RdfStore with wasGeneratedBy/wasInformedBy provenance, and recall a prior run via graph traversal.'
seeAlso:
  - text: 'Guide: ReAct agent'
    link: '../guide/react-agent'
    description: 'Full guide: 8-node loop as ReAct, streaming, live tokens, provenance recall'
  - text: 'Streaming producers guide'
    link: '../guide/streaming-producers'
    description: 'DagStreamProducer, StreamChannel.driven, and the scatter-source idiom this example reuses'
  - text: 'Example 29: Agent DAG'
    link: './29-agent-dag'
    description: 'the 8-node JSON-LD agent loop whose trace this example streams'
  - text: 'The Archivist (in-browser demo)'
    link: './the-archivist'
    description: 'production use of the same reasoning-provenance + recall pattern'
---

# Example: ReAct agent memory

Runs the canonical 8-node [agent DAG](./29-agent-dag) and streams the
agent's ReAct reasoning trace through a second, outer DAG. The outer DAG records
each step into a shared `RdfStore` with provenance and recalls a prior run's
reasoning via graph traversal to inform the next.

## What it demonstrates

- **Organizing a reasoning trace as a stream.** `ReActTraceProducer` (a
  subclass of `AgentTraceProducer`) consumes the agent loop's `Execution` — the
  `AsyncIterable<NodeResultType>` returned by `dispatcher.execute(...)` — and
  maps each relevant node result (`call-model`, `decode-tools`,
  `collect-results`, `append-assistant`) to a `ReasoningStepType`
  (`thought` / `action` / `observation` / `final`), tagged with a monotonic
  `ordinal` as a `ReasoningTraceItemType`.
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

## Topology

```
dispatcher.execute('react-agent', agentState)     → Execution (AsyncIterable<NodeResultType>)
  → new ReActTraceProducer(execution)               → DagStreamProducer<ReasoningTraceItemType>
    → StreamChannel.driven(producer)                  → AsyncIterable<ReasoningTraceItemType>
      → traceState.source
        → outer ScatterNode ('scatter-steps', concurrency 1)
          → body: RecordReasoningStepNode ('record-step')
            → asserts kind/value/wasGeneratedBy/wasInformedBy quads into the shared RdfStore
```

Draining `outerDispatcher.execute('react-agent-memory-trace', traceState)` is
what pulls the agent loop forward — the inner `agentDispatcher.execute(...)`
call is never awaited or drained directly.

## Code

<<< @/../examples/react-agent-memory.ts

## DAG definitions and reusable classes

<<< @/../examples/dags/react-agent-memory.ts

## Run

```bash
npx tsx examples/react-agent-memory.ts
```

## Output

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
