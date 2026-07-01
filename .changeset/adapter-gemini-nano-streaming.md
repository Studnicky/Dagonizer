---
'@studnicky/dagonizer-adapter-gemini-nano': minor
---

`GeminiNanoAdapter` overrides `performChatStream` with real on-device token streaming: drains `session.promptStreaming()`, pushing one `ChatStreamChunkType` per delta on the caller's sink as the on-device model generates. A request carrying tools still falls back to the buffered default.
