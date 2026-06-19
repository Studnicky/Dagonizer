---
"@studnicky/dagonizer-adapter-ollama": minor
---

Add Ollama model discovery to `OllamaApiAdapter`. `OllamaApiAdapter.listModels(baseUrl?)` reads the daemon's `GET /api/tags` installed-model list, validated against the new schema-backed `OllamaTagsResponseSchema`/`OllamaTagsResponseType` through the framework's shared Ajv. `OllamaApiAdapter.firstChatModel(baseUrl?, { preferred? })` discovers the first installed chat model, skipping embedding-only models and honoring a preferred tag when installed; both return safely (`[]` / `null`) when the daemon is down. The new symbols ship through the package entrypoint. Examples 24 and 26 discover an installed model from the running daemon (override with the `OLLAMA_MODEL` env var) instead of hardcoding a tag, and the Archivist demo's `OllamaProbe.listModels` delegates to `OllamaApiAdapter.listModels` rather than duplicating the `/api/tags` fetch.
