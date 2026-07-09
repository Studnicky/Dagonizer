# the-archivist: Dagonizer demo

A visitor asks the archivist about books. The DAG decides intent, runs
scouts (OpenLibrary, Google Books, Subject search, Wikipedia), ranks
candidates, composes a response, and records findings as RDF triples.

## Cross-agent memory + model swapping

Both entry points share one `MemoryStore` across every turn of a session. `record-findings` writes each shortlisted book into the persistent `urn:dagonizer:memory` graph as RDF triples, and `recall-context` runs first on every turn — SPARQL-querying the accumulated memory for prior intents and shortlisted books and feeding that recalled context into each turn's prompts. Memory therefore carries forward regardless of which model produced it.

The browser entry below (`main.ts`) selects one backend per session via the adapter cascade. The hosted [GitHub Pages demo](https://studnicky.github.io/dagonizer/examples/the-archivist#cross-agent-memory-and-live-model-swapping) extends this with a backend picker and per-run provenance: each run stamps `dispatcherAgentId: dispatcher:<providerId>` via `RdfProvObserver`, so a visitor can switch models between turns and watch the next model recall — over the same shared memory — what the previous model found, with each finding attributed to the agent that produced it.

## Browser mode

```
cd examples/the-archivist
pnpm dev
```

Open <http://localhost:5174>. The page runs the seed question on load.

Default cascade:

1. **Browser built-in LanguageModel:** Chrome 138+ or Edge with the on-device Prompt API enabled
   (`chrome://flags/#prompt-api-for-gemini-nano`).
2. **WebLLM:** any WebGPU-capable browser. Lazy-downloads a ~700 MB
   quantized model on first use; subsequent runs reuse it.
3. **Gemini API:** REST access. Pass the key via
   `http://localhost:5174/?apiKey=YOUR_KEY` or accept the `prompt()`
   dialog on first use.
4. **Ollama:** only when the daemon is running locally with CORS
   allowed: `OLLAMA_ORIGINS='http://localhost:5174' ollama serve`.

If no adapter is reachable, the page renders the cascade's
`NO_ADAPTER_AVAILABLE` message and disables the input.

## CLI mode

```
npx tsx examples/the-archivist/runArchivist.ts
```

Default cascade:

1. **Ollama:** `http://127.0.0.1:11434` (override via `OLLAMA_BASE_URL`,
   `OLLAMA_MODEL`).
2. **Gemini API:** `GEMINI_API_KEY`
3. **Cerebras:** `CEREBRAS_API_KEY`
4. **Groq:** `GROQ_API_KEY`
5. **Mistral:** `MISTRAL_API_KEY`
6. **OpenRouter:** `OPENROUTER_API_KEY`

Throws `LlmError(NO_ADAPTER_AVAILABLE)` if none are reachable. The CLI uses the stub only in tests.

Recommended local setup: install any Ollama chat model first. The runner
auto-detects an installed chat model from `/api/tags`, or honors `OLLAMA_MODEL`
when that model is present.

```
ollama serve
npx tsx examples/the-archivist/runArchivist.ts
```
