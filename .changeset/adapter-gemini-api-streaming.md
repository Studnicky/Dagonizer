---
'@studnicky/dagonizer-adapter-gemini-api': minor
---

`GeminiApiAdapter` overrides `performChatStream` with real token streaming: calls the `streamGenerateContent` endpoint and drains the SSE body through the shared `SseLineParser`, pushing one `ChatStreamChunkType` per non-empty text delta on the caller's sink. A request carrying tools still falls back to the buffered default.
