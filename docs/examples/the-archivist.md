---
title: 'The Archivist'
description: 'A bookstore help-bot built on Dagonizer — multi-branch DAG with hard and soft gates, parallel scouts, RAG fallback, and a bounded compose/validate retry loop. The running demo every Dagonizer example references.'
seeAlso:

  - text: 'Concepts'

    link: '../concepts'
    description: 'Dagonizer vocabulary the Archivist exercises'

  - text: 'Architecture'

    link: '../architecture'
    description: 'three-tier interface taxonomy'

  - text: 'Contract-derived flows'

    link: '../guide/derive'
    description: 'generate the Archivist DAG from `OperationContract`s'

  - text: 'Visualization'

    link: '../guide/visualization'
    description: 'render the Archivist DAG with `MermaidRenderer.render(dag)`'

  - text: 'Persistence'

    link: '../guide/persistence'
    description: 'wire `Checkpoint.persist` / `Checkpoint.recall` to a `CheckpointStore`'

  - text: 'json-tology Bookstore domain'

    link: 'https://studnicky.github.io/json-tology/bookstore-domain'
    description: 'the schema vocabulary the Archivist''s `Book` entity mirrors'
---


# The Archivist

The Archivist is the running demo every Dagonizer example refers to. It is a bookstore help-bot — a visitor describes a book or asks for a recommendation, and the Archivist composes a response by classifying the question, fanning out across the shop's local catalog and an external RAG provider, merging the candidates, and composing + validating a draft response in a bounded retry loop.

Try it live below — the demo runs in your browser. The runner detects the best LLM backend available (Chrome's built-in Gemini Nano, your Gemini AI Studio key, or the offline stub) and surfaces which one is answering.

<ArchivistRunner />

Watch the **DAG** pane: each node lights cyan while executing, then settles to "completed" with the taken edge highlighted. The **Memory** pane mirrors `state.intent`, `state.terms`, `state.shortlist`, `state.attempts.compose` as the dispatcher mutates them. Everything is driven by the dispatcher's `onFlowStart` / `onNodeStart` / `onNodeEnd` / `onError` / `onFlowEnd` hooks — there is no timer-based animation, the runner is a pure observer of the state machine.

## Branches and gates

Three exit conditions, each carrying a different outcome.

| Path | Trigger | Terminal node | What happens |
|------|---------|---------------|--------------|
| **Off-topic hard gate** | `classifyIntent` returns `off-topic` | `decline-off-topic` | Politely redirects the visitor to a book-related question. |
| **Empty soft gate** | `mergeCandidates` produces zero candidates | `decline-empty` | Asks the visitor for more detail; collects a `EMPTY_SHORTLIST` warning. |
| **Best-effort response** | `validateResponse` exhausts `MAX_COMPOSE_ATTEMPTS` | `respond-to-visitor` | Sends the last draft anyway — the dispatcher never throws. |
| **Approved response** | `validateResponse` returns `approved` | `respond-to-visitor` | Normal happy path. |
| **Retry loop** | `validateResponse` returns `retry` | back to `compose-response` | Bounded by the counter on `state.attempts.compose`. |

## Backends

The Archivist runs against a real model in any of these environments — `detectBackends()` probes each and `pickBestBackend()` selects the highest-priority runnable backend. On mobile devices, Gemini Nano and WebLLM are excluded from auto-selection (both require desktop Chrome or a WebGPU-capable device). Cloud backends work on every device.

| Priority | Backend | What it needs |
|---|---|---|
| 1 | **Groq** (cloud, free tier) | Free key from [console.groq.com/keys](https://console.groq.com/keys). Runs llama-3.3-70b-versatile. ~30 RPM on the free tier. Works on any device. |
| 2 | **Cerebras** (cloud, free tier) | Free key from [cloud.cerebras.ai](https://cloud.cerebras.ai/?utm=arch). Runs llama-3.3-70b on Wafer-Scale Engine. Works on any device. |
| 3 | **Gemini API** (Google AI Studio free tier) | Paste-into-form (browser). Free 15 RPM / 1500 RPD on `gemini-2.0-flash`. CORS open from any origin. Works on any device. |
| 4 | **Mistral** (cloud, free tier) | Free key from [console.mistral.ai/api-keys/](https://console.mistral.ai/api-keys/). Runs mistral-small-latest. Works on any device. |
| 5 | **OpenRouter** (cloud, free tier) | Free key from [openrouter.ai/keys](https://openrouter.ai/keys). Routes to llama-3.3-70b-instruct:free. Works on any device. |
| 6 | **Gemini Nano** (Chrome built-in, local) | Chrome 138+ stable, or any Chrome with the flags below. No key, no network, ~2 GB one-shot model download by Chrome. Desktop only. |
| 7 | **WebLLM** (in-browser, WebGPU) | Browser with `navigator.gpu`. Lazy-loads `@mlc-ai/web-llm` + Phi-3.5 mini (~780 MB) on first use; cached after. Desktop only. |
| 8 | **Stub** | Always available. Hand-coded canned answers. |

### Mobile detection

`MobileDetection.isLikelyMobile()` triangulates three signals — touch points (`navigator.maxTouchPoints > 1`), coarse pointer media query (`(pointer: coarse)`), and narrow viewport (`innerWidth < 900`). All three must indicate mobile; a single signal is not enough. A "Treat as desktop" link in the mobile banner lets tablet visitors opt out of mobile detection and stores the override in `localStorage` (`dagonizer-device-override`).

### Enable Gemini Nano + tool calling in Chrome

The Archivist asks the LLM to **invoke tools** (currently `web_search_books`,
backed by openlibrary.org). Gemini API uses native `functionDeclarations`;
Chrome's on-device Gemini Nano honours the same plan via the Prompt API's
`responseConstraint` JSON-schema field, which arrived behind feature flags.

1. **Open `chrome://flags`** and enable each of:

   - `#prompt-api-for-gemini-nano` → **Enabled**
   - `#prompt-api-for-gemini-nano-multimodal-input` → **Enabled** (newer flag name in some channels)
   - `#optimization-guide-on-device-model` → **EnabledBypassPerfRequirement**

2. **Restart Chrome.**
3. **Trigger the download.** Visit any page that calls `LanguageModel.create()`
   (this demo will, but you can also paste the snippet below into DevTools):
   ```js
   await LanguageModel.create();
   ```
   Chrome downloads ~2 GB. Status is visible at `chrome://components` — look for
   *Optimization Guide On Device Model*. The widget on this page also surfaces
   `availability()` as **"downloading…"** until ready.
4. **Reload this page** — the backend banner should now read
   *Gemini Nano (Chrome on-device)*.

If the model is still `downloadable` rather than `available` after the steps
above, leave Chrome open for a few minutes — the download runs in the
background and is gated by Chrome's network-condition heuristics.

### Bring-your-own Gemini API key

When Gemini Nano is unavailable, the next-best option is the **Google AI Studio
free tier**:

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and
   click *Create API key*. The free tier covers 15 requests/min and
   1500 requests/day on `gemini-2.0-flash` — plenty for the demo.
2. Paste the key into the *Bring your own Gemini API key* drawer below the
   backend picker. It's stored in `localStorage` only; the request itself
   goes straight from your browser to Google.
3. The runner picks `gemini-api` automatically once a key is present.

CORS is open on the Gemini REST endpoint, so this works from GitHub Pages
or any other static host without a proxy.

### Use the offline stub

If you just want to watch the DAG animate without an LLM, pick
*Canned responses (offline stub)* from the backend dropdown. The stub adapter
pattern-matches the visitor's query and emits a `web_search_books` tool call
when it sees ISBN-like patterns or quoted titles — exercising the same
tool-calling path the real models take, just without the GPU.

---

```bash
# CLI — picks the offline stub when no key is set, Gemini REST when GEMINI_API_KEY is present.
npx tsx examples/the-archivist/runArchivist.ts

# Force Gemini REST with your key:
GEMINI_API_KEY=AIza... npx tsx examples/the-archivist/runArchivist.ts
```

## What each phase example covers

The eight per-phase example pages each isolate one Dagonizer feature against this domain:

| Phase | Feature | Page |
|-------|---------|------|
| 01 | Linear intake + terminal routing | [Phase 01 · Linear intake](./01-linear) |
| 02 | DAGBuilder authoring | [Phase 02 · DAGBuilder](./02-builder) |
| 03 | Tool schema design (JSON Schema 2020-12 inputSchema) | [Phase 03 · Tool schemas](./03-schema) |
| 04 | Fan-out scout with partition fan-in | [Phase 04 · Fan-out scout](./04-fanout) |
| 05 | Deep-DAG composition | [Phase 05 · Deep-DAG composition](./05-deepflows) |
| 06 | Abortable visitor request | [Phase 06 · Cancellation](./06-cancellation) |
| 07 | RetryPolicy against the LLM composer | [Phase 07 · Retry](./07-retry) |
| 08 | Checkpoint mid-draft and resume | [Phase 08 · Checkpoint + resume](./08-checkpoint) |

Every page starts from the same `ArchivistState` + `services` + node set; only the DAG variation and the registered subset change.

## Compositional deep-DAGs

The Archivist's DAG is composed of two reusable deep-DAGs that ship as independent components. Each is a `DAG` value any consumer can import, register, and reference as a `.deepDAG(...)` placement in their own DAG.

- **`book-search-fanout`** — extract-query + decide-tools + 4-source parallel scout cluster (OpenLibrary, Google Books, Subject, Wikipedia) + rank-candidates + merge-candidates + record-findings + has-citations-gate + recall-past-visits. Used in three intent branches (`on-topic-search`, `author-search`, `similar-search`); one definition, three placements.
- **`compose-retry-loop`** — compose-response + validate-response (with bounded retry loop back to compose) + respond-to-visitor. Every successful search branch funnels through this one shared cluster.

The renderer expands both deep-DAGs inline in the diagram — compound-graph children render inside the placement box so the full topology is visible. No opaque boxes.

Reviews and describe branches are inlined in the parent DAG because they substitute `rankByRating` and `pickBestMatch` for `rankCandidates` respectively — the structural variation is explicit rather than hidden behind a deep-DAG parameter.

### BookSearchFanoutDAG

<<< ../../examples/the-archivist/deepdags/BookSearchFanoutDAG.ts

### ComposeRetryLoopDAG

<<< ../../examples/the-archivist/deepdags/ComposeRetryLoopDAG.ts

## Source

### JSON-LD as the canonical DAG format

The DAG is JSON-LD natively. `DAGBuilder.build()` returns a plain JavaScript object whose wire shape is JSON-LD 1.1 — every placement carries a typed IRI under `@type`. `Dagonizer.serialize(dag)` produces the JSON string; `Dagonizer.load(json)` parses and validates it back to an equivalent typed `DAG`.

There is no separate projection layer or dual configuration. The object `DAGBuilder.build()` returns is the same object the engine consumes and the same object that serializes to JSON-LD. Load a DAG from JSON, register it, execute it — one surface throughout.

```ts
import { Dagonizer } from '@noocodex/dagonizer';

// Serialize the Archivist DAG to JSON for persistence or transfer:
const json = Dagonizer.serialize(archivistDAG);

// Restore it in another process or reload:
const dag = Dagonizer.load(json);
dispatcher.registerDAG(dag);
```

Deep-DAG placements in the JSON-LD output look like:

```json
{
  "@type": "DeepDAGNode",
  "name": "on-topic-search",
  "dag": "book-search-fanout",
  "outputs": { "success": "compose-loop", "error": "decline-empty" }
}
```

### DAG topology

<<< ../../examples/the-archivist/dag.ts

### State

<<< ../../examples/the-archivist/ArchivistState.ts

### Prompts (composable directives)

<<< ../../examples/the-archivist/providers/prompts.ts

### Classification node

<<< ../../examples/the-archivist/nodes/classifyIntent.ts

### Memory + ontology

<<< ../../examples/the-archivist/memory/MemoryStore.ts

### Ontology (TBox + ABox)

<<< ../../examples/the-archivist/ontology/ArchivistOntology.ts
