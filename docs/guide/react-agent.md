---
title: 'ReAct Agent: Streaming and Provenance Recall'
description: 'Map the 8-node agent loop onto ReAct Thought/Action/Observation/Final, stream the reasoning trace through DagStreamProducer, stream live model tokens via chatStream, and record/recall reasoning with RDF provenance.'
seeAlso:
  - text: 'Conversational Agents'
    link: './conversational#agent-loop'
    description: 'the 8-node agent loop authored as JSON-LD'
  - text: 'Chat Event Orchestration'
    link: './chat-event-orchestration'
    description: 'host one registered agent DAG behind EventTrigger or RequestTrigger'
  - text: 'Streaming Producers'
    link: './streaming-producers'
    description: 'StreamChannel, DagStreamProducer, and the scatter-source idiom this guide reuses'
  - text: 'Example: ReAct agent memory'
    link: '../examples/react-agent-memory'
    description: 'working example: trace streaming, live token deltas, provenance recall'
  - text: 'Example: ReAct agent routing'
    link: '../examples/react-agent-routing'
    description: 'working example: one shared sink demultiplexes two concurrent conversations by routeKey'
  - text: 'Example 29: Agent DAG'
    link: '../examples/29-agent-dag'
    description: 'the 8-node JSON-LD topology this guide annotates as ReAct'
---

<script setup lang="ts">
import { reactAgentDAG, reactRoutingDAG, reactTraceDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# ReAct Agent: Streaming and Provenance Recall

## What It Is

ReAct is a vocabulary for an agent loop Dagonizer already represents as a DAG: thought, action, observation, and final answer are observable stages in the registered graph. The engine does not need a separate agent runtime to support it.

This guide maps the 8-node loop onto ReAct, then shows how the runnable examples stream reasoning traces with `DagStreamProducer`, stream live model deltas with `chatStream`, and record/recall reasoning with RDF provenance.

## How It Works

The eight-node agent loop is a DAG. ReAct labels the loop's observable stages as thought, action, observation, and final. Dagonizer streams those stages through `Execution`, `DagStreamProducer`, and `StreamChannel`, then records and routes them with ordinary scatter DAGs.

ReAct (Reason + Act) names a loop already built into `@studnicky/dagonizer`:
the [8-node agent loop](./conversational#agent-loop) authored as
JSON-LD. This guide gives that loop its ReAct vocabulary, then adds
three capabilities on top of surfaces the engine already ships:
streaming ([streaming producers](./streaming-producers)) and graph provenance.
None of this is a new execution mechanism.

## Diagrams, Examples, and Outputs

The runnable ReAct examples expose three DAGs: the inner agent loop, the reasoning-trace memory writer, and the routed stream sink:

<DagJsonMermaid :dag="reactAgentDAG" title="ReAct agent loop DAG" aria-label="ReAct agent loop JSON-LD DAG beside Mermaid generated from it." />

<DagJsonMermaid :dag="reactTraceDAG" title="ReAct reasoning trace memory DAG" aria-label="ReAct reasoning trace memory JSON-LD DAG beside Mermaid generated from it." />

<DagJsonMermaid :dag="reactRoutingDAG" title="ReAct routed stream sink DAG" aria-label="ReAct routed stream sink JSON-LD DAG beside Mermaid generated from it." />

- [Conversational Agents](./conversational#agent-loop) - the 8-node agent loop authored as JSON-LD
- [Chat Event Orchestration](./chat-event-orchestration) - host one registered agent DAG behind EventTrigger or RequestTrigger
- [Streaming Producers](./streaming-producers) - StreamChannel, DagStreamProducer, and the scatter-source idiom this guide reuses
- [Example: ReAct agent memory](../examples/react-agent-memory) - working example: trace streaming, live token deltas, provenance recall
- [Example: ReAct agent routing](../examples/react-agent-routing) - working example: one shared sink demultiplexes two concurrent conversations by routeKey

## What It Lets You Do

### Use when

Use this guide when mapping a ReAct-style agent onto Dagonizer's DAG primitives. It is for applications that need reasoning traces, model token streaming, tool dispatch, provenance, recall, or concurrent stream routing without leaving the JSON-LD graph model.

## Code Samples

The sections below explain how the runnable ReAct examples hang together: the loop mapping, trace streaming, live token deltas, RDF provenance, and stream demultiplexing.

## Details for Nerds

### The 8-node loop IS ReAct

| ReAct moment | Node | What it produces |
|---|---|---|
| **Thought** | `call-model` | The model's reply — either a plan to call a tool, or a direct answer. |
| **Action** | `decode-tools` | The tool call decoded from the model's response (name + arguments). |
| **Observation** | `collect-results` | The gathered tool output, folded back after the scatter dispatch. |
| **Final** | `append-assistant` | The terminal text answer; the loop does not restart. |

The loop-back edge — `collect-results → build-request` — is the "Act, then
reason again" step: after tools run, the request is rebuilt with the tool
observation in history and the model is called again. `append-assistant`
routes to `end-done` (`completed`); no loop-back follows a Final step. Nothing
about this mapping is metaphorical: it names the exact same eight registered
nodes and edges documented in [Conversational Agents § Agent loop](./conversational#agent-loop).

### Streaming the reasoning trace

A running agent loop already emits one `NodeResultType` per node per turn —
`Dagonizer.execute(dagIri, state)` returns an `Execution`, which is both an
`AsyncIterable<NodeResultType<NodeStateInterface>>` and a `PromiseLike`. To
observe the ReAct trace live, organize it as a stream using the framework from
[Streaming Producers](./streaming-producers): no new mechanism, the same
`DagStreamProducer` → `StreamChannel.driven` → outer scatter idiom used
everywhere else in the docs.

`AgentTraceProducer` (exported from `@studnicky/dagonizer/patterns`) is a
`DagStreamProducer<ReasoningTraceItemType>` purpose-built for this. Each
emitted item pairs a `ReasoningStepType` with a monotonic `ordinal` assigned
at emission time — so a downstream recorder can derive a `wasInformedBy`-style
chain from `item.ordinal - 1` alone, with no cross-item state and no
dependence on the order items are actually recorded in. Subclass it:

```ts
import { AgentTraceProducer } from '@studnicky/dagonizer/patterns';
import type { NodeResultType } from '@studnicky/dagonizer';
import type { NodeStateInterface } from '@studnicky/dagonizer';

class ReActTraceProducer extends AgentTraceProducer {
  protected describe(stage: NodeResultType<NodeStateInterface>): string {
    // Map the stage's state back to a human-readable string for this step.
    // AgentTraceProducer already decides WHICH kind (thought/action/
    // observation/final) the stage represents from its fixed node-name map.
    return stage.nodeName; // replace with your state-shaped extraction
  }
}
```

The constructor takes the running loop's `Execution` directly:

```ts
const execution = agentDispatcher.execute('urn:noocodec:dag:react-agent', agentState);
const traceState = new TraceState();
traceState.source = StreamChannel.driven(new ReActTraceProducer(execution));
```

`AgentTraceProducer` maps `call-model → thought`, `decode-tools → action`,
`collect-results → observation`, `append-assistant → final` — the same four
rows from the table above. `select(stage)` is fully implemented on the base
class; you only implement `describe(stage)`.

The outer DAG is an ordinary scatter over `traceState.source`, with a body
node that records or renders each `ReasoningTraceItemType` as it arrives:

```
ReActTraceProducer (DagStreamProducer<ReasoningTraceItemType>)
  → StreamChannel.driven(producer)
    → traceState.source
      → outer ScatterNode (body: your per-step node)
```

Because every item carries its own `ordinal`, the outer scatter's
`concurrency` is a free performance choice, not a correctness constraint —
raising it above `1` does not corrupt the chain.

Draining the outer scatter is what pulls the inner agent loop forward — the
same back-pressure contract every `DagStreamProducer` reader relies on.

### Live token streaming

`CallModelNode` accepts a `{ sink }` option in its constructor and forwards it
to `adapter.chatStream(request, sink)` instead of the buffered `adapter.chat(request)`:

```ts
class MyCallModelNode extends CallModelNode<AgentState> {
  readonly name = 'call-model';
  constructor(llm: LlmAdapterInterface, options: { sink?: StreamSinkInterface<ChatStreamChunkType> } = {}) {
    super(llm, options);
  }
  // … getRequest / storeResponse …
}

const sink: StreamSinkInterface<ChatStreamChunkType> = {
  async push(chunk) { process.stdout.write(chunk.delta); },
};
new MyCallModelNode(llm, { sink });
```

`ChatStreamChunkType` carries one field, `delta` — the text fragment produced
since the previous chunk. Every `LlmAdapterInterface` implements
`chatStream(request, sink): Promise<ChatResponseType>`:

- `BaseAdapter`'s default `performChatStream` is buffered — it runs the same
  guarded/classified/retried path as `chat()`, then pushes one chunk carrying
  the full response text. An adapter that never overrides `performChatStream`
  still works with `{ sink }`; it just never streams more than one chunk.
- The anthropic, gemini-api, gemini-nano, web-llm, and ollama adapters
  override `performChatStream` with real provider token streaming —
  the sink receives one push per token/fragment as the provider emits it.
- Tool-turn responses (`variant: 'tools' | 'mixed'`) use a buffered
  push in every adapter — there is no per-token text to stream when the model
  is emitting a structured tool call.

No other node or wiring changes; the sink is purely an observation channel
alongside the returned `ChatResponseType`, which `storeResponse` still writes
to state exactly as it does without streaming.

### Capturing thoughts to a graph with provenance, and recalling them

Each `ReasoningTraceItemType` scattered by the outer DAG can be asserted into a
triple store as a `dag:Reasoning`-shaped provenance record, chained with
`wasGeneratedBy` (links a step to the run that produced it) and
`wasInformedBy` (links a step to the item at `item.ordinal - 1` in the same
run). A body node like `RecordReasoningStepNode` in the example writes these
quads per scattered item, deriving the subject IRI and the `wasInformedBy`
link purely from `item.ordinal` — no instance state, correct at any scatter
concurrency.

A later run recalls prior reasoning by walking the same graph: find the prior
run's `final` step, follow `wasInformedBy` backward to the first step, and
format the chain as a one-line hint. That hint is injected as a leading
`system` message on the next run's `build-request`, so the model sees what it
concluded last time before reasoning again.

This is exactly the pattern [the Archivist](../examples/the-archivist) uses in
production: its `recall-context` node walks prior `dag:Reasoning` provenance
quads to inform new decisions, and its recording node asserts the same
`wasGeneratedBy` / `wasInformedBy` chain documented here.

See [Example: ReAct agent memory](../examples/react-agent-memory) for the
complete, runnable version of trace streaming, live token deltas, provenance
recording, and cross-run recall.

### Routing concurrent streams — the sink is a DAG

The `{ sink }` option on `CallModelNode` is bound once, per node INSTANCE —
not per execution. That is deliberate: `CallModelNode.execute` wraps
`this.sink` in fresh `RoutingStreamSink` instances for the batch items it processes, via
`RoutingStreamSink.of(this.sink, this.routeKey(state), source)`. Each pushed
`ChatStreamChunkType` (`{delta}`) becomes a self-describing
`RoutedChatStreamChunkType` at the downstream sink — `{routeKey, delta,
source}` — where `source` is `{dagName, nodeName}` read from the executing
`NodeContextType`. One shared node instance, streaming into one shared sink,
is therefore safe for many CONCURRENT runs: every chunk already carries
enough information for a downstream subscriber to tell whose run it belongs to.
The `dagName` property is provenance metadata from the execution context; the
registered DAG identity still comes from the DAG IRI.

`routeKey(state)` is the seam that supplies the demultiplexing key. The
default returns `''` (a single unrouted stream, the case covered above).
Override it to read a per-run id from state:

```ts
class RoutingCallModelNode extends MyCallModelNode {
  protected override routeKey(state: AgentState): string {
    return state.conversationId;
  }
}
```

Because the routing key comes from `state`, not from the node instance, ONE
`RoutingCallModelNode` registered on ONE dispatcher correctly demultiplexes
as many concurrent `dispatcher.execute('urn:noocodec:dag:react-agent', state)` calls as are
run in parallel — each `state` carries its own `conversationId`.

The sink itself does not need to be a passive buffer. Because
`RoutedChatStreamChunkType` is a JSON Schema-derived entity like any other,
a `StreamChannel<RoutedChatStreamChunkType>` — the same channel type used for
[streaming producers](./streaming-producers) — can be handed to `CallModelNode`
as the shared sink, and ALSO passed as the source of an ordinary `ScatterNode`
that classifies each chunk by `routeKey` and routes it into a per-conversation
destination (here, a `TranscriptStore.append(routeKey, delta)`):

```
channel: StreamChannel<RoutedChatStreamChunkType>   ← shared sink AND shared scatter source
  → RoutingCallModelNode (one instance, { sink: channel })
      conversation 'c1' → chatStream(...) → RoutingStreamSink → channel.push({routeKey:'c1', delta, source})
      conversation 'c2' → chatStream(...) → RoutingStreamSink → channel.push({routeKey:'c2', delta, source})
  → routing DAG: ScatterNode over channel
      → body: RouteChunkNode — appends item.delta into TranscriptStore[item.routeKey]
```

This is the same `DagStreamProducer` → `StreamChannel` → outer-scatter idiom
used for the reasoning-trace stream above; the difference is that the source
here is a live, concurrently-fed sink rather than a single producer's output,
and the scatter body classifies each item by a field on its own payload
(`routeKey`) instead of accumulating everything into one bucket.

The runnable [Example: ReAct agent routing](../examples/react-agent-routing)
starts the routing DAG's drain first (so the channel's bounded buffer never
backs up two conversations' pushes), runs two conversations concurrently
against the one shared node and one shared channel, closes the channel once
both conversations finish, then awaits the routing drain — reconstructing
each conversation's transcript separately from the interleaved chunk stream.

## Related Concepts

- [Conversational Agents](./conversational#agent-loop) - the 8-node agent loop authored as JSON-LD
- [Streaming Producers](./streaming-producers) - StreamChannel, DagStreamProducer, and the scatter-source idiom this guide reuses
- [Example: ReAct agent memory](../examples/react-agent-memory) - working example: trace streaming, live token deltas, provenance recall
- [Example: ReAct agent routing](../examples/react-agent-routing) - working example: one shared sink demultiplexes two concurrent conversations by routeKey
- [Example 29: Agent DAG](../examples/29-agent-dag) - the 8-node JSON-LD topology this guide annotates as ReAct
