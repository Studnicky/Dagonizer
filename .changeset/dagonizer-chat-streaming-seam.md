---
'@studnicky/dagonizer': minor
---

`LlmAdapterInterface.chatStream(request, sink)` adds a streaming seam over `StreamSinkInterface<ChatStreamChunkType>`. `BaseAdapter` ships a provider-agnostic buffered default: one full `chat()` call, then a single chunk pushed to the sink. Concrete streaming adapters override `performChatStream` to push incremental deltas as they arrive.

New `ChatStreamChunk` entity (`ChatStreamChunkSchema` + `ChatStreamChunkType` + `ChatStreamChunkBuilder.of`) carries one incremental text delta from a streaming chat call.

New `ReasoningStep` entity (`ReasoningStepSchema` + `ReasoningStepType` + `ReasoningStepBuilder`) models one step — `thought` / `action` / `observation` / `final` — of an agent's reasoning trace as a discriminated union.

New `ReasoningTraceItem` entity (`ReasoningTraceItemSchema` + `ReasoningTraceItemType` + `ReasoningTraceItemBuilder`) pairs a `ReasoningStepType` with a monotonic `ordinal`, so a streamed step is self-describing — a downstream consumer can derive a `wasInformedBy`-style chain from `ordinal - 1` with no cross-item state.

New `AgentTraceProducer`, a `DagStreamProducer<ReasoningTraceItemType>` subclass, streams a running agent loop's node results as ordinal-tagged `ReasoningTraceItemType` items via a fixed node-name → reasoning-kind dispatch map. The ordinal increments only for emitted items, so the sequence stays contiguous. Consumers extend it and implement `describe(stage)` to supply each step's text.

`CallModelNode` streams its model call via `chatStream`, taking an optional `sink` in its constructor options (`StreamSinkInterface<ChatStreamChunkType>`) that defaults to a no-op `NullStreamSink` when omitted.

New `SseLineParser`, a shared isomorphic Server-Sent-Events framer built on Web Streams + `TextDecoder` only, so it runs unchanged in Node and the browser. `OpenAiCompatibleAdapter` overrides `performChatStream` to POST with `stream: true` and drain the response body through `SseLineParser`, pushing one `ChatStreamChunkType` per non-empty delta; a request carrying tools still falls back to the buffered default.

`chatStream` is a new required method on `LlmAdapterInterface`, covered by a concrete default on `BaseAdapter`. Consumers who extend `BaseAdapter` (the documented extension path) are unaffected; a consumer implementing `LlmAdapterInterface` directly gains a new method to satisfy.

New `RoutedChatStreamChunk` entity (`RoutedChatStreamChunkSchema` + `RoutedChatStreamChunkType` + `RoutedChatStreamChunkBuilder.of`) tags one streamed text delta with a `routeKey` and its originating `{dagName, nodeName}` source, and new `RoutingStreamSink` (`RoutingStreamSink.of`) decorates the per-execution sink handed to `adapter.chatStream`, stamping every pushed chunk before forwarding it to a shared downstream sink. `CallModelNode` gains an overridable `routeKey(state)` seam (default `''`) and constructs a fresh `RoutingStreamSink` per execution, so one shared sink — for example a `StreamChannel<RoutedChatStreamChunkType>` feeding a routing DAG that scatters by `routeKey` — demultiplexes concurrent runs sharing a single node instance.
