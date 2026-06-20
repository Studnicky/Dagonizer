---
"@studnicky/dagonizer": minor
---

LLM model discovery as a first-class adapter lifecycle capability. `listModels(options?): Promise<readonly LlmModelType[]>` joins `chat`/`connect`/`disconnect`/`probe` on `LlmAdapterInterface` and `EmbedderInterface`; like `probe`, it never throws and returns `[]` when the provider is unreachable. `LlmModelType` is the new schema-backed descriptor (`LlmModelSchema`/`FromSchema`/`Validator.llmModel`) with `name`, `variant` (`'chat' | 'embedding' | 'unknown'`), and `cloud` (provider-routed vs fully local), shipped through `./entities`, `./adapter`, and `./types`.

Selection lives once on the base classes. `BaseAdapter.selectChatModel(options?: { preferred? })` lists models, drops embedders, honors an installed `preferred`, prefers local over cloud, sets the chosen model on the live adapter, and returns its name (or `null`). `BaseEmbedder.selectEmbeddingModel(options?)` is the symmetric embedding-model picker. The constructor `model` is now optional across every adapter and embedder; `chat()`/`embed()` throws a clear `MODEL_NOT_FOUND` `LlmError` until a model is selected, so discovery happens on the same instance the node runs.

Every provider discovers its own models: `OpenAiCompatibleAdapter` reads `GET /v1/models` (covering Groq, Mistral, Cerebras, OpenRouter), Ollama reads `GET /api/tags` and classifies chat vs embedding and local vs `:cloud`, Gemini reads `GET /v1beta/models` and maps `supportedGenerationMethods` to `variant`, web-llm enumerates its prebuilt catalog, and gemini-nano reports its single on-device descriptor. The Ollama, Gemini, and Mistral embedders list embedding models the same way. `Validator.openAiModelsResponse` (and per-provider response schemas) validate each wire shape through the shared Ajv.

Consumers no longer name a model. Examples 24/25/26 and the Archivist cascade discover and select through the contract — every hardcoded model string is gone, with `preferred` env/URL overrides where a specific model is wanted. The Archivist's bespoke `OllamaModels.pickChat` / `OllamaProbe.listModels` duplication is removed in favor of the inherited `selectChatModel`.
