# Examples

Runnable end-to-end examples. Each file is self-contained and exits 0.

Run `npm install` (or `pnpm install`) from the repo root before running any example.

---

## Core

| File | Purpose | Run |
|------|---------|-----|
| `01-linear.ts` | Minimal stage chain: linear node sequence, no branching | `npx tsx examples/01-linear.ts` |
| `02-builder.ts` | `DAGBuilder` chainable API for deterministic / ETL authoring | `npx tsx examples/02-builder.ts` |
| `03-schema.ts` | JSON load + Ajv validate + JSON-LD round-trip | `npx tsx examples/03-schema.ts` |
| `05-embedded-dags.ts` | `EmbeddedDAGNode` (sub-DAG body, cardinality 1) + `stateMapping` | `npx tsx examples/05-embedded-dags.ts` |
| `06-cancellation.ts` | `AbortSignal` + `deadlineMs` to interrupt a running flow | `npx tsx examples/06-cancellation.ts` |
| `07-retry.ts` | `RetryPolicy` inside an operation node; backoff strategy | `npx tsx examples/07-retry.ts` |
| `08-checkpoint.ts` | Abort → snapshot → restore → resume across a dispatcher restart | `npx tsx examples/08-checkpoint.ts` |
| `09-terminals.ts` | `TerminalNode`: explicit `completed`/`failed` endpoints; scatter routing | `npx tsx examples/09-terminals.ts` |
| `10-shared-state.ts` | `MemoryStore` on the services bag + checkpoint round-trip | `npx tsx examples/10-shared-state.ts` |
| `11-handoff.ts` | `DAGHandoff` envelope: two DAGs chained via `InMemoryChannel` | `npx tsx examples/11-handoff.ts` |
| `18-observability.ts` | Subclass hooks: `onFlowStart`/`onFlowEnd`/`onNodeStart`/`onNodeEnd`/`onError` | `npx tsx examples/18-observability.ts` |
| `19-phase-nodes.ts` | `DAGBuilder.phase()`: pre and post lifecycle wrapping | `npx tsx examples/19-phase-nodes.ts` |
| `20-streaming.ts` | `Execution<TState>`: await vs `for await` streaming per-node results | `npx tsx examples/20-streaming.ts` |
| `21-per-node-timeout.ts` | Engine-level `timeoutMs` on `NodeInterface`: scoped `NodeTimeoutError` | `npx tsx examples/21-per-node-timeout.ts` |

---

## Scatter / Gather

| File | Purpose | Run |
|------|---------|-----|
| `04-scatter.ts` | `ScatterNode` over a source + `partition` gather | `npx tsx examples/04-scatter.ts` |
| `04b-scatter-collect.ts` | Generate-and-select: `map` gather collects each clone's candidate | `npx tsx examples/04b-scatter-collect.ts` |
| `04c-scatter-workers.ts` | `ScatterNode` with `container` key (in-process without binding) | `npx tsx examples/04c-scatter-workers.ts` |
| `14-gather-strategies.ts` | `collect` vs `discard` side-by-side; same body, different gather | `npx tsx examples/14-gather-strategies.ts` |
| `15-incremental-gather.ts` | `applyIncremental` hook: fold per-clone vs batch at end | `npx tsx examples/15-incremental-gather.ts` |
| `16-scatter-resume.ts` | Durable-inbox checkpoint and resume across a scatter abort | `npx tsx examples/16-scatter-resume.ts` |
| `17-scatter-async-source.ts` | `AsyncIterable` as scatter source with bounded-concurrency backpressure | `npx tsx examples/17-scatter-async-source.ts` |
| `scatter-extensions.ts` | Custom `TopNGatherStrategy` + `ThresholdReducer` installed via registries | `npx tsx examples/scatter-extensions.ts` |

---

## Distribution / Workers

Worker examples require a compile step — worker threads cannot import TypeScript source at runtime.

| File | Purpose | Run |
|------|---------|-----|
| `12-workers.ts` | `WorkerThreadContainer` pool: scatter clone sub-DAGs run in worker threads | `tsc -p examples/tsconfig.workers.json && node examples/dist/12-workers.js` |
| `13-multibackend.ts` | Two container roles (`cpu` + `io`) with per-role Mermaid colors | `tsc -p examples/tsconfig.multibackend.json && node examples/dist/13-multibackend.js` |

Or via npm scripts: `npm run example:12` and `npm run example:13`.

---

## LLM / Agent

These examples run against a real local model. Install [Ollama](https://ollama.com), then `ollama pull llama3.2` (chat) and `ollama pull nomic-embed-text` (embeddings) before running.

| File | Purpose | Run |
|------|---------|-----|
| `24-llm-adapter.ts` | `BaseAdapter`, `LlmAdapterRegistry`, `LlmAdapterCascade`, `.chat()` in a DAG node | `npx tsx examples/24-llm-adapter.ts` |
| `25-embedder.ts` | `BaseEmbedder`, `EmbedderRegistry`, `EmbedderCascade`, cosine similarity | `npx tsx examples/25-embedder.ts` |
| `26-tool-use.ts` | `Tool`, `ToolDefinition`, `ToolCallCodec` text-fallback, adapter dispatch | `npx tsx examples/26-tool-use.ts` |

---

## Patterns / Modules

| File | Purpose | Run |
|------|---------|-----|
| `derive.ts` | `DAGDeriver`: contract-derived DAG + `embeddedDAGs` annotation | `npx tsx examples/derive.ts` |
| `22-backoff-strategies.ts` | `RetryPolicy` with all four `BackoffStrategy` values via `VirtualScheduler` | `npx tsx examples/22-backoff-strategies.ts` |
| `23-checkpoint-store.ts` | `MemoryCheckpointStore` persist / recall round-trip across a restart | `npx tsx examples/23-checkpoint-store.ts` |
| `constants-usage.ts` | Every typed constant from `@noocodex/dagonizer/constants` as runtime guards | `npx tsx examples/constants-usage.ts` |
| `monadic-node.ts` | `MonadicNode` abstract base: subclass, outputs contract, route-not-throw | `npx tsx examples/monadic-node.ts` |
| `state-accessor.ts` | `DottedPathAccessor` + custom `PrefixAccessor` wired via `accessor` option | `npx tsx examples/state-accessor.ts` |
| `store-remote.ts` | `GrpcStore` stub: `BaseStore` + `RemoteStore` with lease + snapshot | `npx tsx examples/store-remote.ts` |
| `virtual-clock.ts` | `VirtualClockProvider` + `VirtualScheduler`: deterministic retry in zero real time | `npx tsx examples/virtual-clock.ts` |

---

## Applications

### The Archivist

A bookstore help-bot: multi-branch DAG with hard/soft gates, parallel scouts, RAG fallback, and a bounded compose/validate retry loop.

```bash
# Run with Ollama (or any available LLM adapter — cascades through available providers):
npx tsx examples/the-archivist/runArchivist.ts

# The in-browser live demo is at:
#   https://studnicky.github.io/Dagonizer/examples/the-archivist
```

**Credential needs:** `LlmAdapterCascade` tries Groq, Cerebras, Gemini API, Mistral, OpenRouter (API keys via env), then Ollama (local), then Gemini Nano / WebLLM (browser only). If none is reachable the cascade throws `NO_ADAPTER_AVAILABLE` — there is no canned fallback. The zero-setup path is a local Ollama (`ollama serve`).

### The Cartographer

A deterministic data-orchestration pipeline: multi-format satellite tracking feed ingestion, branching conditional routing, offline country-coder geo-resolution, GDPR redaction, and continent-level insights.

```bash
# Run with live IP geolocation (network reachable):
npx tsx examples/the-cartographer/runCartographer.ts

# Force offline / recorded mode (no network calls):
npx tsx examples/the-cartographer/runCartographer.ts --recorded

# Custom event count:
npx tsx examples/the-cartographer/runCartographer.ts --events 50

# Worker path (compile first — workers cannot import TypeScript):
tsc -p examples/tsconfig.workers.json && \
  CARTO_WORKERS=4 node examples/dist/the-cartographer/runCartographer.js --recorded
```

**Offline geo:** GPS reverse-geocode uses the offline `@rapideditor/country-coder` dataset — no HTTP, no key. IP geolocation uses `freeipapi.com` (CORS-enabled, no key) or the committed fixture replay via `--recorded`.

---

## npm scripts

```bash
npm run example:01     # 01-linear
npm run example:02     # 02-builder
npm run example:03     # 03-schema
npm run example:04     # 04-scatter
npm run example:04b    # 04b-scatter-collect
npm run example:04c    # 04c-scatter-workers
npm run example:05     # 05-embedded-dags
npm run example:06     # 06-cancellation
npm run example:07     # 07-retry
npm run example:08     # 08-checkpoint
npm run example:09     # 09-terminals
npm run example:10     # 10-shared-state
npm run example:11     # 11-handoff
npm run example:12     # compile + run 12-workers (worker threads)
npm run example:13     # compile + run 13-multibackend (worker threads)
npm run example:derive # derive
```

Examples 14–26 and the module-entry examples have no dedicated npm script; run them directly with `npx tsx`.
