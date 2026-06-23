---
"@studnicky/dagonizer": minor
---

OpenAiCompatibleAdapter gains four static factory methods: .groq(apiKey, options?),
.cerebras(apiKey, options?), .mistral(apiKey, options?), .openRouter(apiKey, options?).
These replace the separate dagonizer-adapter-groq, dagonizer-adapter-cerebras,
dagonizer-adapter-mistral, and dagonizer-adapter-openrouter packages which are removed.

Migration: replace `new GroqApiAdapter(key)` with `OpenAiCompatibleAdapter.groq(key)`;
similarly for Cerebras, Mistral, and OpenRouter. All options that the removed adapters
accepted (model, referer, title, timeoutMs) are available on the factory options object.
