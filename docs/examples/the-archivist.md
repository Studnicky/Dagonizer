---
title: 'The Archivist'
description: 'A bookstore help-bot built on Dagonizer: multi-branch DAG with hard and soft gates, parallel scouts, RAG fallback, and a bounded compose/validate retry loop. The running demo every Dagonizer example references.'
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
    description: 'wire `ckpt.persist` / `Checkpoint.recall` to a `CheckpointStore`'

  - text: 'json-tology Bookstore domain'

    link: 'https://studnicky.github.io/json-tology/bookstore-domain'
    description: 'the schema vocabulary the Archivist''s `Book` entity mirrors'
---


# The Archivist

The Archivist is the running demo every Dagonizer example refers to. It is a bookstore help-bot: a visitor describes a book or asks for a recommendation, and the Archivist composes a response by classifying the question, scattering four parallel scouts across the shop's local catalog and external sources, merging the candidates, and composing plus validating a draft response in a bounded retry loop.

Try it live below; the demo runs in your browser. The runner uses an `LlmAdapterCascade` over the providers below and surfaces which one is answering. Cloud-first when keys are present (Groq, Cerebras, Gemini API, Mistral, OpenRouter), local-first when reachable (Ollama on desktop), then on-device fallbacks (Gemini Nano, WebLLM), with the offline stub as the last resort. Intent classification runs through a parallel `EmbedderCascade` (Ollama, Gemini API, Mistral) when an embedder is reachable; otherwise the LLM classifies directly.

The Archivist exercises two placement types for nested DAG execution: `EmbeddedDAGNode` for the three search branches and the compose loop (cardinality 1), and `ParallelNode` (`.parallel(...)`) for the within-branch scouts — four sources run concurrently per branch, combined with `collect`. A `PhaseNode` (`phase: 'pre'`, placement name `setup`) runs `pre-run-setup` before the entrypoint: it stamps a `runId` on state and clears any stale draft from a prior interrupted execution. Phase nodes are out-of-band; they do not participate in output routing.

<ArchivistRunner />

Watch the **DAG** pane: each node lights cyan while executing, then settles to "completed" with the taken edge highlighted. The **Memory** pane mirrors `state.intent`, `state.terms`, `state.shortlist`, and the compose retry budget (`state.retriesFor('compose')`) as the dispatcher mutates them. Everything is driven by the dispatcher's `onFlowStart`, `onNodeStart`, `onNodeEnd`, `onError`, `onFlowEnd` hooks; there is no timer-based animation, the runner is a pure observer of the state machine.

## Branches and gates

Three exit conditions, each carrying a different outcome.

| Path | Trigger | Terminal node | What happens |
|------|---------|---------------|--------------|
| **Off-topic hard gate** | `classifyIntent` returns `off-topic` | `decline-off-topic` | Politely redirects the visitor to a book-related question. |
| **Empty soft gate** | `mergeCandidates` produces zero candidates | `compose-empty` | Composes an in-character "nothing came back" message; collects a `EMPTY_SHORTLIST` warning. |
| **Best-effort response** | `validateResponse` exhausts `MAX_COMPOSE_ATTEMPTS` | `respond-to-visitor` | Sends the last draft anyway; the dispatcher never throws. |
| **Approved response** | `validateResponse` returns `approved` | `respond-to-visitor` | Normal happy path. |
| **Retry loop** | `validateResponse` returns `retry` | back to `compose-response` | Bounded by the retry budget on state (`state.retriesFor('compose')`). |

## Backends

The Archivist runs against a real model in any of these environments. `detectBackends()` probes each and `pickBestBackend()` selects the highest-priority runnable backend. On mobile devices, Gemini Nano and WebLLM are excluded from auto-selection (both require desktop Chrome or a WebGPU-capable device). Cloud backends work on every device.

| Priority | Backend | What it needs |
|---|---|---|
| 1 | **Groq** (cloud, free tier) | Free key from [console.groq.com/keys](https://console.groq.com/keys). Runs llama-3.3-70b-versatile. ~30 RPM on the free tier. Works on any device. |
| 2 | **Cerebras** (cloud, free tier) | Free key from [cloud.cerebras.ai](https://cloud.cerebras.ai/?utm=arch). Runs llama-3.3-70b on Wafer-Scale Engine. Works on any device. |
| 3 | **Gemini API** (Google AI Studio free tier) | Paste-into-form (browser). Free 15 RPM / 1500 RPD on `gemini-2.0-flash`. CORS open from any origin. Works on any device. |
| 4 | **Mistral** (cloud, free tier) | Free key from [console.mistral.ai/api-keys/](https://console.mistral.ai/api-keys/). Runs mistral-small-latest. Works on any device. |
| 5 | **OpenRouter** (cloud, free tier) | Free key from [openrouter.ai/keys](https://openrouter.ai/keys). Routes to llama-3.3-70b-instruct:free. Works on any device. |
| 6 | **Browser built-in model** (local, via `window.LanguageModel`) | Chrome 138+ or Edge. No key, no network, ~2 GB one-shot model download. Desktop only. |
| 7 | **WebLLM** (in-browser, WebGPU) | Browser with `navigator.gpu`. Lazy-loads `@mlc-ai/web-llm` + Phi-3.5 mini (~780 MB) on first use; cached after. Desktop only. |
| 8 | **Stub** | Always available. Hand-coded canned answers. Always available on mobile as a zero-setup fallback; hidden from the desktop picker since on-device options exist. |

## Seed library

On mount, 18 sci-fi and philosophy titles are pre-loaded into `urn:dagonizer:memory` so the Memory tab has content from first paint and stub responses cite real books from the visible graph. The seed covers:

- **Science fiction**: Liu Cixin, William Gibson, Ursula K. Le Guin (×2), Stanisław Lem, Ted Chiang, Jeff VanderMeer, Dan Simmons, Vernor Vinge, the Strugatsky brothers.
- **Philosophy and philosophical literature**: Borges, Wittgenstein, Camus, Foucault, Deleuze, Hofstadter, Marcus Aurelius, Hegel.

`SeedLibrary.loadInto(memoryStore)` clears `urn:dagonizer:memory` and reasserts all 18 books as RDF triples using the same `dag:title`, `dag:author`, `dag:subject`, `dag:firstPublishYear`, `dag:summary`, and `rdf:type dag:Book` predicates that `StateProjection` uses for run candidates. Because the vocabulary is shared, the MemoryGraph renders seed books and run candidates uniformly.

The seed is not stub-specific. Real LLM backends receive the pre-seeded triples through the `recall-memories` node's SPARQL digest; the library is a shared starting point for every backend. `reset()` restores the seed alongside the TBox ontology so a manual reset never leaves the Memory tab empty.

### Intent classification (vector-similarity)

The runner builds an `EmbedderCascade` alongside the LLM cascade: `Ollama` (loopback) → `Gemini API` → `Mistral`. When one probes available, `IntentClassifier.create(embedder)` precomputes label embeddings; `classifyIntent` then routes by cosine similarity against the visitor's query in O(labels). When no embedder is reachable in the browser the cascade falls through and the node delegates to the LLM classifier (same routing, slower path).

### Visitor language

`UserLanguage.detect()` reads the device locale (`navigator.language` in the browser, `LANG` / `LC_ALL` env vars on the CLI), normalises it to an IETF tag, and threads it into the system prompt. The composer drafts the response in the visitor's language without an explicit toggle.

### Conversational composition

Drafts ship as conversational prose. The composer prompt forbids markdown headings, bullet lists, and structured layout: the response reads like a knowledgeable shop assistant talking out loud, not a search result page. The validator rejects drafts that leak markup back into the conversation.

### Mobile detection

`MobileDetection.isLikelyMobile()` triangulates three signals: touch points (`navigator.maxTouchPoints > 1`), coarse pointer media query (`(pointer: coarse)`), and narrow viewport (`innerWidth < 900`). All three must indicate mobile; a single signal is not enough. A "Treat as desktop" link in the mobile banner lets tablet visitors opt out of mobile detection and stores the override in `localStorage` (`dagonizer-device-override`).

If no API key is set on a mobile device, the demo runs with canned stub responses so the DAG still executes. The mobile banner makes the canned-vs-real distinction explicit: it reads "running with canned responses (not real AI)" when stub is active, and "using cloud backend [name]" once a key is entered and a cloud backend takes over. Adding any cloud key causes `pickBestBackend` to re-rank and swap the active backend automatically.

### Enable the browser built-in model + tool calling

The Archivist asks the LLM to **invoke tools** (currently `web_search_books`,
backed by openlibrary.org). Gemini API uses native `functionDeclarations`;
the browser built-in model honours the same plan via the Prompt API's
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
   Chrome downloads ~2 GB. Status is visible at `chrome://components`; look for
   *Optimization Guide On Device Model*. The widget on this page also surfaces
   `availability()` as **"downloading…"** until ready.
4. **Reload this page**. The backend banner should now read
   *Browser built-in LanguageModel (on-device)*.

If the model is still `downloadable` rather than `available` after the steps
above, leave Chrome open for a few minutes; the download runs in the
background and is gated by the browser's network-condition heuristics.

### Bring-your-own Gemini API key

When Gemini Nano is unavailable, the next-best option is the **Google AI Studio
free tier**:

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and
   click *Create API key*. The free tier covers 15 requests/min and
   1500 requests/day on `gemini-2.0-flash`. Plenty for the demo.
2. Paste the key into the *Bring your own Gemini API key* drawer below the
   backend picker. It's stored in `localStorage` only; the request itself
   goes straight from your browser to Google.
3. The runner picks `gemini-api` automatically once a key is present.

CORS is open on the Gemini REST endpoint, so this works from GitHub Pages
or any other static host without a proxy.

### Use the offline stub

To watch the DAG animate without an LLM, pick
*Canned responses (offline stub)* from the backend dropdown. The stub adapter
pattern-matches the visitor's query and emits a `web_search_books` tool call
when it sees ISBN-like patterns or quoted titles, exercising the same
tool-calling path the real models take, without the GPU.

---

```bash
# CLI: picks the offline stub when no key is set, Gemini REST when GEMINI_API_KEY is present.
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
| 04 | Scatter scout with partition gather | [Phase 04 · Scatter scout](./04-scatter) |
| 05 | EmbeddedDAGNode composition | [Phase 05 · EmbeddedDAGNode composition](./05-embedded-dags) |
| 06 | Abortable visitor request | [Phase 06 · Cancellation](./06-cancellation) |
| 07 | Retry as a flow shape (retry/salvage loop) | [Phase 07 · Retry](./07-retry) |
| 08 | Checkpoint mid-draft and resume | [Phase 08 · Checkpoint + resume](./08-checkpoint) |

Every page starts from the same `ArchivistState` + `services` + node set; only the DAG variation and the registered subset change.

## Compositional embedded-DAG sub-DAGs

The Archivist's DAG is composed of two reusable sub-DAGs that ship as independent components. Each is a `DAG` value any consumer can import, register, and reference via `.embeddedDAG(name, dagName, routes, options)`.

- **`book-search-scatter`**: extract-query, decide-tools, 4-source parallel scout cluster (OpenLibrary, Google Books, Subject, Wikipedia), rank-candidates, merge-candidates, record-findings, has-citations-gate, recall-past-visits. Used in three intent branches (`on-topic-search`, `author-search`, `similar-search`); one definition, three embedded-DAG placements.
- **`compose-retry-loop`**: compose-response and validate-response, with a bounded retry edge back to compose and a `compose-salvage` recovery node. The sub-DAG produces `state.draft` and exits with `success`; the parent DAG owns the shared `respond-to-visitor` terminal. Every successful search branch funnels through this one shared cluster.

The renderer expands both sub-DAGs inline in the diagram. Compound-graph children render inside the embedded-DAG placement box so the full topology is visible. No opaque boxes.

Reviews and describe branches are inlined in the parent DAG because they substitute `rankByRating` and `pickBestMatch` for `rankCandidates` respectively; the structural variation is explicit rather than hidden behind a sub-DAG parameter.

### BookSearchScatterDAG

<<< ../../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts

### ComposeRetryLoopDAG

<<< ../../examples/the-archivist/embedded-dags/ComposeRetryLoopDAG.ts

## Source

### JSON-LD as the canonical DAG format

The DAG is JSON-LD natively. `DAGBuilder.build()` returns a plain JavaScript object whose wire shape is JSON-LD 1.1; every placement carries a typed IRI under `@type`. `Dagonizer.serialize(dag)` produces the JSON string; `Dagonizer.load(json)` parses and validates it back to an equivalent typed `DAG`.

There is no separate projection layer or dual configuration. The object `DAGBuilder.build()` returns is the same object the engine consumes and the same object that serializes to JSON-LD. Load a DAG from JSON, register it, execute it: one surface throughout.

```ts
import { Dagonizer } from '@noocodex/dagonizer';

// Serialize the Archivist DAG to JSON for persistence or transfer:
const json = Dagonizer.serialize(archivistDAG);

// Restore it in another process or reload:
const dag = Dagonizer.load(json);
dispatcher.registerDAG(dag);
```

Embedded-DAG placements in the JSON-LD output look like:

```json
{
  "@type": "EmbeddedDAGNode",
  "name": "on-topic-search",
  "dag": "book-search-scatter",
  "outputs": { "success": "compose-loop", "error": "compose-empty" }
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

### Pre-phase setup node

<<< ../../examples/the-archivist/nodes/preRunSetup.ts#pre-phase-setup

### Services

<<< ../../examples/the-archivist/services.ts#services-shape

### Memory + ontology

<<< ../../examples/the-archivist/memory/MemoryStore.ts

### Ontology (TBox + ABox)

<<< ../../examples/the-archivist/ontology/ArchivistOntology.ts
