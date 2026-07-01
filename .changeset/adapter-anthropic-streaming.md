---
'@studnicky/dagonizer-adapter-anthropic': minor
---

`AnthropicApiAdapter` overrides `performChatStream` with real token streaming: POSTs `/v1/messages` with `stream: true` and drains the SSE body through the shared `SseLineParser`, dispatching Anthropic's named events into `ChatStreamChunkType` pushes on the caller's sink as they arrive. A request carrying tools still falls back to the buffered default.
