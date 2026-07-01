# @studnicky/dagonizer-adapter-ollama

## 0.29.1

## 0.29.0

## 0.28.1

## 0.28.0

## [unreleased]

### Minor Changes

- `OllamaApiAdapter` overrides `performChatStream` to apply the same 404 → "model not pulled" translation to the streaming path that `performChat` already applies to the buffered path, wrapping the inherited `OpenAiCompatibleAdapter` SSE streaming (`super.performChatStream`) so a missing-model error is identical whether the caller streams or buffers.

### Patch Changes

- Add a consumer-configurable `systemPrompt` option, forwarded through `OpenAiCompatibleAdapter` to the `BaseAdapter` seam: when set, it is injected as the leading system turn of any request that carries no system message of its own (never overriding an explicit one, no-op when empty). Lets a consumer frame persona/format once at construction instead of hand-prepending a system message to every call.
- Forward `request.maxTokens` to Ollama's OpenAI-compatible `max_tokens` field (Ollama maps it to `num_predict`).
- Inherit the `timeoutMs` deadline (default 60s) enforced by `OpenAiCompatibleAdapter` around the `/v1/chat/completions` POST. An expired deadline surfaces as a `TIMEOUT` classification rather than `NETWORK`, so a cascade falls through to the next adapter instead of hanging.

## 0.27.0

## 0.26.0

## 0.25.0

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
