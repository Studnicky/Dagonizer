---
title: 'Example: ReAct agent routing'
description: 'One shared RoutingCallModelNode and one shared StreamChannel<RoutedChatStreamChunkType> sink serve two concurrent conversations; a routing DAG scattering over the channel classifies each chunk by routeKey and demultiplexes it into a separate per-conversation transcript.'
seeAlso:
  - text: 'Guide: ReAct agent § Routing concurrent streams'
    link: '../guide/react-agent#routing-concurrent-streams-the-sink-is-a-dag'
    description: 'Full guide: RoutedChatStreamChunk, routeKey(state), and the routing DAG'
  - text: 'Streaming producers guide'
    link: '../guide/streaming-producers'
    description: 'DagStreamProducer, StreamChannel.driven, and the scatter-source idiom this example reuses'
  - text: 'Example: ReAct agent memory'
    link: './react-agent-memory'
    description: 'the agent loop, ScriptedAdapter, and node classes this example reuses unchanged'
  - text: 'Example 29: Agent DAG'
    link: './29-agent-dag'
    description: 'the 8-node JSON-LD agent loop this example runs'
---

# Example: ReAct agent routing

Reuses `AgentState` and the eight agent-loop node subclasses from
[Example: ReAct agent memory](./react-agent-memory) unchanged, and adds one
subclassed node (`RoutingCallModelNode`, overriding `routeKey(state)`) plus a
second, small DAG that scatters over a shared `StreamChannel` to demultiplex
two conversations running concurrently against ONE shared node instance and
ONE shared sink.

## What it demonstrates

- **One node instance, many concurrent runs.** `CallModelNode.execute`
  wraps its constructor-bound `{ sink }` in fresh `RoutingStreamSink` instances
  for the batch items it processes, stamping every pushed chunk with `routeKey(state)` and
  `{dagName, nodeName}`. A single `RoutingCallModelNode` instance, registered
  once, correctly serves as many concurrent `dispatcher.execute('react-agent',
  state)` calls as are run in parallel — no per-run node instance or
  dispatcher clone is needed.
- **The sink is itself a DAG.** `RoutedChatStreamChunkType` is a JSON
  Schema-derived entity like any other, so the same `StreamChannel` passed to
  `CallModelNode` as `{ sink }` is ALSO passed as a `ScatterNode`'s source.
  The scatter's body (`RouteChunkNode`) classifies each item by its own
  `routeKey` field and routes it into a per-conversation destination
  (`TranscriptStore.append`) — this is the same `DagStreamProducer` →
  `StreamChannel` → outer-scatter idiom used everywhere else in the docs, fed
  by a live concurrently-written sink instead of a single producer.
- **Deadlock-free lifecycle ordering.** The routing DAG's drain is started
  (not awaited) BEFORE the two conversations run, so the channel's bounded
  buffer is always being drained and `push` never blocks. The channel is
  closed only after BOTH conversations finish pushing, which is what ends
  the routing scatter's async-iterable source; only then is the routing
  drain awaited.
- **Behaviorally verified demultiplexing.** `examples/tests/react-agent-routing.test.ts`
  asserts every routed chunk is owned by exactly one conversation, that
  `TranscriptStore.keys()` is exactly `{c1, c2}`, that every chunk's `source`
  is stamped `{dagName, nodeName}`, and that each conversation's recorded
  transcript equals the exact concatenation of only its own routed chunks.

## Topology

```
channel: StreamChannel<RoutedChatStreamChunkType>       ← shared sink AND shared scatter source
  → RoutingCallModelNode (ONE instance, { sink: channel })
      conversation 'c1' → adapter.chatStream(...) → RoutingStreamSink → channel.push({routeKey:'c1', delta, source})
      conversation 'c2' → adapter.chatStream(...) → RoutingStreamSink → channel.push({routeKey:'c2', delta, source})
  → routing DAG ('react-agent-routing'): ScatterNode ('scatter-chunks', concurrency 4)
      → body: RouteChunkNode ('route-chunk')
          → TranscriptStore.append(item.routeKey, item.delta)
```

Lifecycle, in order:

1. `routingDispatcher.execute('react-agent-routing', routingState)` starts
   (not awaited) — the routing scatter begins pulling from `channel`
   immediately.
2. `Promise.all([agentDispatcher.execute('react-agent', c1State),
   agentDispatcher.execute('react-agent', c2State)])` runs both
   conversations concurrently against the one shared node and channel.
3. `channel.close()` — only after both conversations finish pushing.
4. `await routingDone` — the routing drain completes once the channel is
   closed and empty.

## Code

<<< @/../examples/react-agent-routing.ts

## DAG definitions and reusable classes

<<< @/../examples/dags/react-agent-routing.ts

## Run

```bash
npx tsx examples/react-agent-routing.ts
```

## Output

```
--- react-agent-routing: two concurrent conversations, one shared sink ---

Total routed chunks observed: 26

c1 transcript: "Based on the lookup, {"result":"Dagonizer is a type-safe, abortable DAG dispatcher for TypeScript."} "
c2 transcript: "Based on the lookup, {"result":"Dagonizer is a type-safe, abortable DAG dispatcher for TypeScript."} "

Route keys with recorded transcripts: ["c1","c2"]

Lesson: one shared StreamChannel, fed by one shared RoutingCallModelNode instance,
        carried BOTH conversations' chunks interleaved. A routing DAG scattering
        over that same channel classified each chunk by its stamped routeKey and
        demultiplexed it into a separate, uncontaminated transcript per conversation
        — the sink itself is a DAG that routes by payload, not a passive buffer.
```

`ScriptedAdapter`'s final answer text is prompt-INSENSITIVE (a fixed tool
observation), so c1 and c2's printed transcripts are legitimately identical
strings — that alone is not proof of correct routing. The actual proof is at
the chunk level (see the test suite): every one of the 26 routed chunks is
owned by exactly one `routeKey`, and each conversation's recorded transcript
equals the exact concatenation of only its own chunks, with zero loss and
zero cross-contamination under concurrent execution on a single shared node
instance and a single shared sink.
