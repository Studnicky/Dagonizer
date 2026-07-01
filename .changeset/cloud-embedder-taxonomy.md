---
"@studnicky/dagonizer": minor
"@studnicky/dagonizer-embedder-gemini-api": minor
"@studnicky/dagonizer-embedder-mistral": minor
"@studnicky/dagonizer-embedder-ollama": minor
---

Add the `CloudEmbedder` taxonomy for the REST cloud embedders.

`CloudEmbedder extends BaseEmbedder` is the cloud sibling of `LocalModelEmbedder` (mirroring how `OpenAiCompatibleAdapter` sits under `BaseAdapter`). It implements `performEmbed` once — build request → `fetchJson` → parse — behind `endpoint()`/`requestInit(text)`/`vectorFrom(body)` seams. The gemini-api, mistral, and ollama embedders migrate onto it, each reduced to its provider's endpoint, headers, body, and response shape. No wire-behavior change.
