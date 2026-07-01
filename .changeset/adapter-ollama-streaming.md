---
'@studnicky/dagonizer-adapter-ollama': minor
---

`OllamaApiAdapter` overrides `performChatStream` to apply the same 404 → "model not pulled" translation to the streaming path that `performChat` already applies to the buffered path, wrapping the inherited `OpenAiCompatibleAdapter` real SSE streaming.
