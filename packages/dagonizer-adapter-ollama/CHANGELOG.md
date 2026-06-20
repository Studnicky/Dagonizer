# @studnicky/dagonizer-adapter-ollama

## 0.24.0

## 0.23.0

## 0.22.0

### Minor Changes

- e4a84bc: Add Ollama model discovery to `OllamaApiAdapter`. `OllamaApiAdapter.listModels(baseUrl?)` reads the daemon's `GET /api/tags` installed-model list, validated against the new schema-backed `OllamaTagsResponseSchema`/`OllamaTagsResponseType` through the framework's shared Ajv. `OllamaApiAdapter.firstChatModel(baseUrl?, { preferred? })` discovers the first installed chat model, skipping embedding-only models and honoring a preferred tag when installed; both return safely (`[]` / `null`) when the daemon is down. The new symbols ship through the package entrypoint. Examples 24 and 26 discover an installed model from the running daemon (override with the `OLLAMA_MODEL` env var) instead of hardcoding a tag, and the Archivist demo's `OllamaProbe.listModels` delegates to `OllamaApiAdapter.listModels` rather than duplicating the `/api/tags` fetch.

## 0.21.0

## 0.20.0

## 0.19.0

## 0.17.0

## 0.16.0

## 0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [d3a4e7b]
  - @studnicky/dagonizer@0.14.0

## 0.13.2

### Patch Changes

- Updated dependencies [238a94d]
  - @studnicky/dagonizer@0.13.2

## 0.12.0

### Patch Changes

- Updated dependencies [7c0e38a]
- Updated dependencies [3286d07]
  - @studnicky/dagonizer@0.12.0

## 0.11.1

### Patch Changes

- 01014fe: The Archivist demo: backend cascade now prioritizes cloud APIs (Groq, Cerebras, Gemini API, Mistral, OpenRouter) over local daemons (Ollama) and on-device models (Gemini Nano, WebLLM). BackendPicker auto-selects the highest-priority reachable backend at mount time instead of hardcoding `gemini-nano`. IntentClassifier and the `classifyIntent` prompt are sharpened so tool-related queries do not misroute to `off-topic`; the scout safety net in `decideTools` now forces all four web search scouts when the LLM-proposed tool plan is sparse on `on-topic` intents. Ollama adapter surfaces `model 'X' not found` 404 responses with a `Run: ollama pull X` hint.
