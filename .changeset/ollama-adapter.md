---
"@noocodex/dagonizer-adapter-ollama": minor
---

Ollama local-daemon adapter joins the workspace. Built on
`OpenAiCompatibleAdapter` — talks to the daemon's `/v1/chat/completions`
OpenAI-compatible surface. Defaults to `http://127.0.0.1:11434` and
`llama3.2:latest`; both overridable via `OllamaApiAdapterOptions`.

The Archivist demo gains an `'ollama'` provider id with a `detectOllama()`
probe (600 ms timeout, no-throw) that picks the daemon up when it's
running and CORS-permissive (`OLLAMA_ORIGINS`).
