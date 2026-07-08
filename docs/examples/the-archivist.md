---
title: 'The Archivist'
description: 'A bookstore help-bot powered by Dagonizer: multi-branch DAG with hard and soft gates, parallel scouts, RAG fallback, and a bounded compose/validate retry loop. The running demo every Dagonizer example references.'
seeAlso:

  - text: 'Concepts'

    link: '../concepts'
    description: 'Dagonizer vocabulary the Archivist exercises'

  - text: 'Architecture'

    link: '../architecture'
    description: 'three-tier interface taxonomy'

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

## What It Is

The Archivist is a runnable demo: a real browser-executed DAG application, not a decorative diagram. A bookstore help-bot powered by Dagonizer: multi-branch DAG with hard and soft gates, parallel scouts, RAG fallback, and a bounded compose/validate retry loop. It is the running demo every Dagonizer agent example references.

Use it to see a model-driven workflow become inspectable: model calls are nodes, tool work is routed through DAG placements, retries are visible edges, and memory is a shared store rather than a hidden callback side effect.

## How It Works

The runner wires real node classes, real DAG documents, and browser UI observers together. The visual panes listen to dispatcher lifecycle events, so the page shows execution rather than replaying a canned animation.

## Diagrams, Examples, and Outputs

The live demo is the main diagram. Its graph, state panes, traces, memory views, backend selectors, and outputs are all evidence from the running system.

### Branches and gates

Three exit conditions, each carrying a different outcome.

| Path | Trigger | Terminal node | What happens |
|------|---------|---------------|--------------|
| **Off-topic hard gate** | `classifyIntent` returns `off-topic` | `decline-off-topic` | Politely redirects the visitor to a book-related question. |
| **Empty soft gate** | `mergeCandidates` produces zero candidates | `compose-empty` | Composes an in-character "nothing came back" message; collects a `EMPTY_SHORTLIST` warning. |
| **Best-effort response** | `validateResponse` exhausts `MAX_COMPOSE_ATTEMPTS` | `respond-to-visitor` | Sends the last draft anyway; the dispatcher never throws. |
| **Approved response** | `validateResponse` returns `approved` | `respond-to-visitor` | Normal happy path. |
| **Retry loop** | `validateResponse` returns `retry` | back to `compose-response` | Bounded by the retry budget on state (`state.retriesFor('compose')`). |

### What this proves

The Archivist proves that an LLM agent application can be an inspectable DAG: model calls are nodes, tool dispatch is embedded-DAG/scatter composition, recall uses shared memory, retries are graph edges, and the final response is a lifecycle outcome instead of an opaque callback.

Try it live below; the demo runs in your browser. The browser runner instantiates a single selected backend via `ProviderInstantiator.instantiate()` — the picker surfaces which provider is active. Cloud-first when keys are present (Groq, Cerebras, Gemini API, Mistral, OpenRouter), local-first when reachable (Ollama on desktop), then on-device fallbacks (Gemini Nano, WebLLM). The demo only runs against a real model: when none is reachable it shows a setup gate with links to free backends rather than fabricating a response. The browser demo provisions an on-device embedder (`EmbedderProvisioner` — transformers.js MiniLM, with TensorFlow.js USE and WebLLM behind it); cosine recall, hybrid ranking, and vector-similarity intent classification run client-side, falling back to Jaccard / heuristics only when no embedder probes available. The CLI path (`runArchivist.ts`) uses an `LlmAdapterCascade` and a separate `EmbedderCascade` for the same vector-similarity intent classification.

The Archivist composes reusable work through one interface: a placement points at a DAG through `dag`, either as a literal registered name or as a dynamic `DagReference` with explicit candidates. `EmbeddedDAGNode` invokes one selected DAG once; `ScatterNode` invokes the selected DAG per source item and then folds clone output through gather/reduce policy. `build-book-worksets` converts the decided tool plan into a `bookWorksets` array where each item carries a `dagName` field, the scatter resolves the body DAG through the same `dag` reference surface, the `tool-candidate-merge` gather folds each clone's output into the parent `candidates`, and the `any-success` reducer routes `success` when at least one tool returned results. A `PhaseNode` (`phase: 'pre'`, placement name `setup`) runs `pre-run-setup` before the entrypoint: it stamps a `runId` on state and clears any stale draft from a prior interrupted execution. Phase nodes are out-of-band; they do not participate in output routing.

<ClientOnly>
  <ArchivistRunner />
</ClientOnly>

Watch the **DAG** pane: each node lights cyan while executing, then settles to "completed" with the taken edge highlighted. The **Memory** pane mirrors `state.intent`, `state.terms`, `state.shortlist`, and the compose retry budget (`state.retriesFor('compose')`) as the dispatcher mutates them. Everything is driven by the dispatcher's `onFlowStart`, `onNodeStart`, `onNodeEnd`, `onError`, `onFlowEnd` hooks; there is no timer-based animation, the runner is a pure observer of the state machine.

## What It Lets You Do

Use the Archivist when you want to see a complete model-backed application as a graph instead of a pile of callbacks. It demonstrates classification, tool selection, scatter fan-out, RAG-style recall, composition, validation, retry, checkpointing, and response delivery in one inspectable run.

For application teams, this page answers a practical question: what does a real Dagonizer agent look like when it has to remember, recover, route, and explain itself?

### What to try

Ask for a book recommendation, an author lookup, a review-oriented query, or an off-topic question. Watch the active backend selector, the DAG pane, and the Memory pane while the same JSON-LD graph routes the turn through classification, search, compose, retry, and response paths.

## Code Samples

The Archivist source is intentionally visible because this demo is the reference point for most numbered examples. Start with the top-level DAG, then drill into the reusable embedded DAGs, state, prompts, and memory model.

### Compositional embedded-DAG sub-DAGs

The Archivist's DAG is composed of two reusable sub-DAGs that ship as independent components. Each is a `DAG` value any application can import, register, and reference via `.embed(name, dagName, routes, options)`.

- **`book-search-scatter`**: extract-query → decide-tools → recall-candidates → build-book-worksets → scatter over `bookWorksets` with a dynamic `DagReference` body (tool-registry dispatch, concurrency 4, `tool-candidate-merge` gather, `any-success` reducer) → rank-candidates → merge-candidates → record-findings → has-citations-gate → recall-past-visits. Used in three intent branches (`on-topic-search`, `author-search`, `similar-search`); one definition, three embedded-DAG placements.
- **`compose-retry-loop`**: compose-response and validate-response, with a bounded retry edge back to compose and a `compose-salvage` recovery node. The sub-DAG produces `state.draft` and exits with `success`; the parent DAG owns the shared `respond-to-visitor` terminal. Every successful search branch funnels through this one shared cluster.

The renderer expands both sub-DAGs inline in the diagram. Compound-graph children render inside the embedded-DAG placement box so the full topology is visible. No opaque boxes.

Reviews and describe branches are inlined in the parent DAG because they substitute `rankByRating` and `pickBestMatch` for `rankCandidates` respectively; the structural variation is explicit rather than hidden behind a sub-DAG parameter.

#### BookSearchScatterDAG

<<< ../../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts

#### ComposeRetryLoopDAG

<<< ../../examples/the-archivist/embedded-dags/ComposeRetryLoopDAG.ts

### Source

#### JSON-LD as the canonical DAG format

The DAG is JSON-LD natively. `DAGBuilder.build()` returns a plain JavaScript object whose wire shape is JSON-LD 1.1; every placement carries a typed IRI under `@type`. `Dagonizer.serialize(dag)` produces the JSON string; `Dagonizer.load(json)` parses and validates it back to an equivalent typed `DAG`.

There is no separate projection layer or dual configuration. The object `DAGBuilder.build()` returns is the same object the engine consumes and the same object that serializes to JSON-LD. Load a DAG from JSON, register it, execute it: one surface throughout.

<<< ../../examples/the-archivist/dag-roundtrip.ts#dag-roundtrip

Embedded-DAG placements in the JSON-LD output look like:

```json
{
  "@type": "EmbeddedDAGNode",
  "name": "on-topic-search",
  "dag": "book-search-scatter",
  "outputs": { "success": "compose-loop", "error": "compose-empty" }
}
```

#### DAG topology

<<< ../../examples/the-archivist/dag.ts

#### State

<<< ../../examples/the-archivist/ArchivistState.ts

#### Prompts (composable directives)

<<< ../../examples/the-archivist/providers/prompts.ts

#### Classification node

<<< ../../examples/the-archivist/nodes/classifyIntent.ts

#### Pre-phase setup node

<<< ../../examples/the-archivist/nodes/preRunSetup.ts#pre-phase-setup

#### Services

<<< ../../examples/the-archivist/services.ts#services-shape

#### Memory + ontology

<<< ../../examples/the-archivist/memory/MemoryStore.ts

#### Ontology (TBox + ABox)

<<< ../../examples/the-archivist/ontology/ArchivistOntology.ts

## Details for Nerds

### Backends

The Archivist runs against a real model in any of these environments. `detectBackends()` probes each and `pickBestBackend()` selects the highest-priority runnable backend. On mobile devices, Gemini Nano and WebLLM are excluded from auto-selection (both require desktop Chrome or a WebGPU-capable device). Cloud backends work on every device.

| Priority | Backend | What it needs |
|---|---|---|
| 1 | **Groq** (cloud, free tier) | Free key from [console.groq.com/keys](https://console.groq.com/keys). `selectChatModel()` discovers the available chat catalogue. ~30 RPM on the free tier. Works on any device. |
| 2 | **Cerebras** (cloud, free tier) | Free key from [cloud.cerebras.ai](https://cloud.cerebras.ai/?utm=arch). `selectChatModel()` confirms the live chat model before registration. Works on any device. |
| 3 | **Gemini API** (Google AI Studio free tier) | Paste-into-form (browser). Free tier access, CORS open from any origin, and model selection through Gemini's `ListModels` response. Works on any device. |
| 4 | **Mistral** (cloud, free tier) | Free key from [console.mistral.ai/api-keys/](https://console.mistral.ai/api-keys/). `selectChatModel()` discovers the live catalogue. Works on any device. |
| 5 | **OpenRouter** (cloud, free tier) | Free key from [openrouter.ai/keys](https://openrouter.ai/keys). Routes through OpenRouter's model catalogue. Works on any device. |
| 6 | **Browser built-in model** (local, via `window.LanguageModel`) | Chrome 138+ or Edge. No key, no network, ~2 GB one-shot model download. Desktop only. |
| 7 | **WebLLM** (in-browser, WebGPU) | Browser with `navigator.gpu`. Lazy-loads `@mlc-ai/web-llm` + Phi-3.5 mini (~780 MB) on first use; cached after. Desktop only. |

When none of these is reachable, the runner renders a no-model gate (with links to the free cloud keys above) instead of running. There is no canned-response fallback.

### Cross-agent memory and live model swapping

The Archivist demonstrates two capabilities that extend beyond single-turn, single-model interaction: persistent cross-agent memory and live model swapping mid-conversation.

#### Persistent cross-agent memory

A single `MemoryStore` instance is created when the runner component initializes and lives for the entire browser session. It is not scoped to a run or a backend — it accumulates across every turn, regardless of which model composed the response. Three named graphs partition the data:

- `urn:dagonizer:memory` — the durable cross-run graph. `record-findings` writes every shortlisted book here as RDF triples: `<book> dag:title / dag:source / dag:score / dag:inShortlist`, and `<run> dag:shortlisted <book>` linking the run to each book it shortlisted.
- `urn:dagonizer:state:<runId>` — a per-run mirror of `ArchivistState`, written by `StateProjection.project()` after every node end. `recall-context` queries these graphs to surface prior intents, recently-seen candidates, and Jaccard-similar prior queries.
- `urn:dagonizer:prov:<runId>` — the per-run PROV-O activity graph written by `RdfProvObserver` (covered below).

`recall-context` executes first in the DAG, before `classify-intent`. It SPARQL-queries the accumulated state graphs for prior visitor queries, intents, and shortlisted books, and injects a plain-text summary into `state.recalledContext`. Every downstream LLM node — classification, tool selection, composition — receives the recalled context in its prompt. This means the second turn knows what the first turn found, and the third turn knows what the first two found, without the visitor having to restate prior topics.

#### Provenance: which agent wrote what

Each run stamps a `dispatcherAgentId` of the form `dispatcher:<providerId>` on the `RdfProvObserver`. The observer writes one `prov:Activity` per node execution into `urn:dagonizer:prov:<runId>` and types `dispatcher:<providerId>` as a `prov:SoftwareAgent`. Each activity is `prov:wasAssociatedWith` that agent (`dispatcher:groq`, `dispatcher:anthropic`, `dispatcher:gemini-api`, etc.), and activities chain via `prov:wasInformedBy`. When a visitor changes backends between turns, the accumulated provenance graphs record findings from multiple agents, each distinguishable by its IRI. The Memory tab's graph view makes this visible: provenance edges connect each run's activities to the agent that performed them.

#### Live model swapping

The `BackendPicker` component emits `update:active-id` events; the runner wires `@update:active-id="activeBackend = $event"` so the `activeBackend` ref updates immediately. The `makeLlm()` call inside `ask()` reads `activeBackend.value` at run time, so the very next run after a picker change uses the newly selected backend.

A backend swap only updates the `activeBackend` ref (and persists it to `localStorage`). It does not clear conversation, memory, or trace state — those are component-level and outlive any single run. The picker is disabled while a run is in flight (`:disabled="isRunning"`), so a swap always takes effect on the next turn, never mid-run.

| What a backend swap changes | What it leaves intact |
|---|---|
| The active LLM client (`currentLlm` re-derives via `makeLlm()`) | `conversation` (full turn history) |
| The persisted `dagonizer-active-backend` preference | `memoryStore` (all RDF triples, all named graphs) |
| | `trace` and `logEvents` |
| | Checkpoint state (`lastResult`, `checkpointNode`) |

This is the core point of the demo, not an incidental feature: a visitor can start a session on Gemini Nano, switch to a cloud Groq key when they want faster responses, and continue on Anthropic — every backend reads and writes the same shared `MemoryStore`, each run's provenance is recorded under its own `dispatcher:<providerId>` agent, and `recall-context` feeds each backend the findings from all prior backends.

### Seed library

On mount, 18 sci-fi and philosophy titles are pre-loaded into `urn:dagonizer:memory` so the Memory tab has content from first paint. The seed covers:

- **Science fiction**: Liu Cixin, William Gibson, Ursula K. Le Guin (×2), Stanisław Lem, Ted Chiang, Jeff VanderMeer, Dan Simmons, Vernor Vinge, the Strugatsky brothers.
- **Philosophy and philosophical literature**: Borges, Wittgenstein, Camus, Foucault, Deleuze, Hofstadter, Marcus Aurelius, Hegel.

`SeedLibrary.loadInto(memoryStore)` clears `urn:dagonizer:memory` and reasserts all 18 books as RDF triples using the same `dag:title`, `dag:author`, `dag:subject`, `dag:firstPublishYear`, `dag:summary`, and `rdf:type dag:Book` predicates that `StateProjection` uses for run candidates. Because the vocabulary is shared, the MemoryGraph renders seed books and run candidates uniformly.

Every backend receives the pre-seeded triples through the `recall-memories` node's SPARQL digest; the library is a shared starting point for every run. `reset()` restores the seed alongside the TBox ontology so a manual reset never leaves the Memory tab empty.

#### Intent classification (vector-similarity)

The CLI runner builds an `EmbedderCascade` alongside the LLM cascade: `Ollama` (loopback) → `Gemini API` → `Mistral`. The browser runner provisions one through `EmbedderProvisioner.provision()`, a memoized cascade over on-device browser embedders: `transformers.js` MiniLM (WASM, always available) → TensorFlow.js Universal Sentence Encoder → WebLLM (WebGPU). Whichever path supplies the embedder, `IntentClassifier.create(embedder)` precomputes label embeddings once; `classifyIntent` then routes by cosine similarity against the visitor's query in O(labels). Should provisioning fail (no candidate probes available, CDN import error), the provisioner returns `embedder: null` and the node delegates to the LLM classifier directly (same routing, slower path).

#### Visitor language

`UserLanguage.detect()` reads the device locale (`navigator.language` in the browser, `LANG` / `LC_ALL` env vars on the CLI), normalises it to an IETF tag, and threads it into the system prompt. The composer drafts the response in the visitor's language without an explicit toggle.

#### Conversational composition

Drafts ship as conversational prose. The composer prompt forbids markdown headings, bullet lists, and structured layout: the response reads like a knowledgeable shop assistant talking out loud, not a search result page. The validator rejects drafts that leak markup back into the conversation.

#### Mobile detection

`MobileDetection.isLikelyMobile()` triangulates three signals: touch points (`navigator.maxTouchPoints > 1`), coarse pointer media query (`(pointer: coarse)`), and narrow viewport (`innerWidth < 900`). All three must indicate mobile; a single signal is not enough. A "Treat as desktop" link in the mobile banner lets tablet visitors opt out of mobile detection and stores the override in `localStorage` (`dagonizer-device-override`).

The on-device and WebGPU backends are desktop-only, so on mobile the demo needs a cloud API key (Groq, Cerebras, Gemini API, Mistral, or OpenRouter). Until one is set, the no-model gate is shown with links to free keys; the demo does not run without a real backend. Once a key is entered the mobile banner reads "using cloud backend [name]", and adding any cloud key causes `pickBestBackend` to re-rank and swap the active backend automatically.

#### Enable the browser built-in model + tool calling

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

#### Bring-your-own Gemini API key

When Gemini Nano is unavailable, the next-best option is the **Google AI Studio
free tier**:

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and
   click *Create API key*. The free tier covers 15 requests/min and
   1500 requests/day on the free tier. Plenty for the demo.
2. Paste the key into the *Bring your own Gemini API key* drawer below the
   backend picker. It's stored in `localStorage` only; the request itself
   goes straight from your browser to Google.
3. The runner picks `gemini-api` automatically once a key is present.

CORS is open on the Gemini REST endpoint, so this works from GitHub Pages
or any other static host without a proxy.

---

```bash
# CLI: cascade is Ollama (localhost) → Gemini API → Cerebras → Groq; first reachable wins.
# Throws NO_ADAPTER_AVAILABLE if none is reachable — there is no canned fallback.
npx tsx examples/the-archivist/runArchivist.ts

# Force Gemini REST with your key:
GEMINI_API_KEY=AIza... npx tsx examples/the-archivist/runArchivist.ts
```

### What the first examples cover

The first eight example pages isolate one Dagonizer feature against the Archivist domain:

| Example | Feature | Page |
|-------|---------|------|
| 01 | Linear intake + terminal routing | [Example 01: Linear Intake](./01-linear) |
| 02 | DAGBuilder authoring | [Example 02: DAGBuilder](./02-builder) |
| 03 | Tool schema design (JSON Schema 2020-12 inputSchema) | [Example 03: Tool Schemas](./03-schema) |
| 04 | Scatter scout with partition gather | [Example 04: Scatter Scout](./04-scatter) |
| 05 | EmbeddedDAGNode composition | [Example 05: Embedded DAGs](./05-embedded-dags) |
| 06 | Abortable visitor request | [Example 06: Cancellation](./06-cancellation) |
| 07 | Retry as a flow shape (retry/salvage loop) | [Example 07: Retry Flow](./07-retry) |
| 08 | Checkpoint mid-draft and resume | [Example 08: Checkpoint and Resume](./08-checkpoint) |

Every page starts from the same `ArchivistState` + `services` + node set; only the DAG variation and the registered subset change.

## Related Concepts

Read these next when you want to unpack the Archivist into vocabulary, architecture, visualization, persistence, and domain schema pieces.

- [Concepts](../concepts) - Dagonizer vocabulary the Archivist exercises
- [Architecture](../architecture) - three-tier interface taxonomy
- [Visualization](../guide/visualization) - render the Archivist DAG with `MermaidRenderer.render(dag)`
- [Persistence](../guide/persistence) - wire `ckpt.persist` / `Checkpoint.recall` to a `CheckpointStore`
- [json-tology Bookstore domain](https://studnicky.github.io/json-tology/bookstore-domain) - the schema vocabulary the Archivist's `Book` entity mirrors

### Archivist Feature Map

These numbered examples are owned by the Archivist domain because the live demo exposes the same principle in its runnable DAG:

| Example | Principle in the runnable Archivist |
|---------|--------------------------------------|
| [Example 22: Retry Timing and Salvage](./22-backoff-strategies) | The `compose-retry-loop` DAG shows retry/salvage routing; the example page isolates the timing policy that controls retry waits. |
| [Example 24: LLM Adapter](./24-llm-adapter) | Provider selection and fallback happen before `compose-response` / intent-classification nodes call the active adapter. |
| [Example 25: Embedder](./25-embedder) | Semantic recall and intent support use the same embedder-registry surface against book and memory text. |
| [Example 26: Tool Use](./26-tool-use) | `book-search-scatter` turns tool decisions into `bookWorksets`; each workset selects a registered tool DAG through a dynamic `DagReference`. |
| [Example 29: Agent DAG with JSON-LD](./29-agent-dag) | The Archivist is the full in-browser agent application: request classification, model/tool work, memory recall, and response composition are all DAG placements. |
