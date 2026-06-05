---
'@noocodex/dagonizer': minor
'@noocodex/dagonizer-adapter-gemini-nano': minor
'@noocodex/dagonizer-adapter-gemini-api': patch
'@noocodex/dagonizer-adapter-web-llm': patch
'@noocodex/dagonizer-book-entities': minor
'@noocodex/dagonizer-tool-openlibrary': minor
'@noocodex/dagonizer-tool-googlebooks': patch
---

Apply Clean Code manifesto: static classes replace free functions, named constants replace magic numbers, flag arguments replaced with options objects, SRP extractions from Dagonizer core.

**Breaking removals:** `detectGeminiNano` (→ `GeminiNanoAdapter.detect()`), `decodeToolCallsJson` (→ `ToolCallCodec.decode()`), `classifyHttp` (→ `LlmError.classifyHttp()`), `asNetworkError` (→ `LlmError.fromNetworkError()`).

**New:** `DAGValidator`, `StateMapper`, `ScatterCheckpoint`, `PlacementUtils`, `ToolCallCodec`, `OpenLibraryDocs`, `BookEntitiesError`, `ExecutionError.fromSignal()`, `GeminiNanoAdapter.detect()`.
