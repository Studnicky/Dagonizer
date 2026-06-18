---
"@noocodex/dagonizer": minor
---

Remove the `@noocodex/dagonizer-adapter-stub` package and every stub backend. The Archivist demo, its CLI, and the LLM/embedder/tool-use examples now run only against real models (Ollama locally, or a cloud key); when no real backend is reachable the demo shows its no-model gate and the CLI throws `NO_ADAPTER_AVAILABLE` rather than returning canned responses. Examples 24–26 are rewritten against `OllamaApiAdapter` / `OllamaEmbedder`.
