---
'@studnicky/dagonizer-adapter-web-llm': minor
---

`WebLlmAdapter` overrides `performChatStream` to surface real MLC engine token deltas on the caller's sink as `ChatStreamChunkType` pushes, instead of discarding them into a single accumulated string; `usage` is captured from the engine's final chunk when available.
