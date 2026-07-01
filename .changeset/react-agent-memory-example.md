---
"@studnicky/dagonizer-examples": minor
---

Adds `react-agent-memory`: a ReAct agent loop whose reasoning trace streams through a `DagStreamProducer` into an outer scatter that records each step into a shared `RdfStore` with a `wasInformedBy` provenance chain, and a second run against the same store that recalls the first run's reasoning via graph traversal and injects it as prompt context.

Adds `react-agent-routing`: reuses `react-agent-memory`'s agent loop and node classes unchanged, and demonstrates routing concurrent streamed chat responses through ONE shared `RoutingCallModelNode` instance and ONE shared `StreamChannel<RoutedChatStreamChunkType>` sink. A routing DAG scattering over the same channel classifies each chunk by its stamped `routeKey` and demultiplexes two concurrent conversations into separate, uncontaminated transcripts.
