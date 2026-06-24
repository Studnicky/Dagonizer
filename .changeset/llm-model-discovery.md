---
"@studnicky/dagonizer": minor
---

Promotes listModels() to LlmAdapterInterface and EmbedderInterface. OpenAiCompatibleAdapter implements /v1/models discovery covering Groq, Mistral, Cerebras, and OpenRouter. AnthropicApiAdapter implements /v1/models. All embedder packages implement listModels(). BaseEmbedder gains selectEmbeddingModel(). Adapters that already had listModels() (Ollama, Gemini, Nano, WebLLM) are unchanged. Hardcoded model strings removed from examples.
