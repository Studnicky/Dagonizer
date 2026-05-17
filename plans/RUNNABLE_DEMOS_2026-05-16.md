# Runnable demos on GitHub Pages

The Archivist umbrella page currently shows static code samples. This plan
turns the page into an interactive demo: visitors paste a question, watch
the DAG execute live in their browser, and read the Archivist's response —
all without standing up a server.

The plan is binding; deferral is not permitted. Scope is the in-browser
provider layer plus a `<ArchivistDemo />` widget mounted on the umbrella
page. Other example pages adopt the widget in a follow-on PR.

## Provider matrix

Four backends, probed in priority order, with graceful fallback.

| Priority | Backend | API surface | Cost / key | Browser support | First-paint cost |
|----------|---------|-------------|------------|-----------------|------------------|
| 1 | **Gemini Nano** (Chrome built-in) | `window.LanguageModel.create()` | free, local | Chrome 138+ stable; Chrome 127+ behind `chrome://flags/#prompt-api-for-gemini-nano`; or origin-trial token | 0 — model is pre-cached by Chrome (~2 GB) |
| 2 | **Gemini REST** (free tier) | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}` | free 15 RPM / 1500 RPD on `gemini-2.0-flash`; user pastes their own AI Studio key | any browser | 0 (HTTP) |
| 3 | **WebLLM** (in-browser WebGPU) | `import('@mlc-ai/web-llm')` + `CreateMLCEngine('Phi-3.5-mini-instruct-q4f16_1-MLC')` | free, local | any WebGPU-capable browser (Chrome 113+, Edge, Safari 18+) | 100–800 MB download per visit; cached in OPFS thereafter |
| 4 | **Stub** | hand-coded canned answers | n/a | universal | 0 |

Visitors see a banner: "Running on Gemini Nano (local)" / "Running on
Gemini 2.0 Flash (your key)" / "Running on WebLLM (Phi-3.5, downloading
780 MB)" / "Showing canned responses".

## Detection patterns

### Gemini Nano

The Chrome built-in Prompt API exposes a `LanguageModel` global:

```ts
async function detectGeminiNano(): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'> {
  if (typeof globalThis === 'undefined') return 'unavailable';
  const lm = (globalThis as { LanguageModel?: { availability: () => Promise<string> } }).LanguageModel;
  if (!lm) return 'unavailable';
  try {
    const status = await lm.availability();
    if (status === 'available' || status === 'downloadable' || status === 'downloading' || status === 'unavailable') {
      return status;
    }
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}
```

Usage:

```ts
const session = await LanguageModel.create({
  initialPrompts: [
    { role: 'system', content: 'You are the Archivist, a bookstore librarian.' },
  ],
});
const response = await session.prompt('I want a book about a labyrinth.');
session.destroy();
```

Caveats — the API was at `window.ai.languageModel` in early Chrome and the
session method names changed (`promptStreaming` → `prompt({...,stream})`),
so the adapter wraps multiple call shapes behind one interface.

### Gemini REST (user key)

```ts
async function callGeminiRest(apiKey: string, prompt: string, model = 'gemini-2.0-flash'): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });
  if (!res.ok) throw new Error(`Gemini REST ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}
```

Key storage: `localStorage['dagonizer-gemini-key']`. UI shows a "Bring
your own key" panel with a link to AI Studio and a `<details>` note that
nothing leaves the visitor's browser. CORS is open from any origin so
GitHub Pages can call the endpoint directly.

Rate limit handling — on `429` show the message and disable run for the
backoff window the API returns.

### WebLLM (fully local)

```ts
async function loadWebLlm() {
  const mod = await import('https://esm.run/@mlc-ai/web-llm');
  const engine = await mod.CreateMLCEngine('Phi-3.5-mini-instruct-q4f16_1-MLC', {
    initProgressCallback: (report) => {
      // Drive the "downloading… 42%" UI
    },
  });
  return engine;
}
```

WebGPU detection: `!!navigator.gpu`. If `navigator.gpu` is missing,
WebLLM falls through to the next backend (stub). The first-visit cost
is real — show a clear estimate ("Phi-3.5 mini ~780 MB, cached after
download") and a single "Download model" button so it's never a surprise.

### Stub

Hand-coded canned responses keyed by intent — so the demo always
"works" even on a stripped browser. Communicates exactly what the live
provider would have produced.

## Unified provider interface

The Archivist's services bag accepts any implementation of `LlmClient`
(already defined in `docs/.examples/the-archivist/services.ts`):

```ts
interface LlmClient {
  classifyIntent(query: string): Promise<'search' | 'describe' | 'recommend' | 'off-topic'>;
  extractTerms(query: string): Promise<readonly string[]>;
  compose(query: string, shortlist: readonly Candidate[]): Promise<string>;
  validate(draft: string, shortlist: readonly Candidate[]): Promise<boolean>;
}
```

Each backend implements `LlmClient` by issuing tightly-scoped prompts —
the classifier prompt asks for one of four tokens; the term extractor
asks for a JSON array; compose asks for prose. The contract is the
same regardless of which model answers, so the DAG never changes.

## File layout

```
docs/.examples/the-archivist/
└── providers/
    ├── index.ts                  # detectBestBackend + LlmClient adapter
    ├── GeminiNanoProvider.ts     # window.LanguageModel adapter
    ├── GeminiApiProvider.ts      # REST adapter, key from localStorage
    ├── WebLlmProvider.ts         # lazy WebGPU adapter
    ├── StubProvider.ts           # canned responses, always available
    └── promptTemplates.ts        # the four prompts (classify / extract / compose / validate)
```

## Widget

Vue component `ArchivistDemo.vue` mounted on the umbrella page (and
optionally on each phase page):

- On mount: probe all backends in parallel, pick the best, surface the
  banner.
- Backend picker: dropdown to override the auto-pick.
- "Bring your own key" panel: input + save (to localStorage only) for
  Gemini REST.
- Question textarea + "Ask the Archivist" button.
- Live log: each node emits `onNodeStart` / `onNodeEnd` events that
  stream into a scrolling log panel.
- Mermaid sub-diagram: highlight the active node by injecting a CSS
  class onto the rendered SVG node.
- Final state pane: `draft`, `shortlist`, `lifecycle.kind`, `cursor`.

## Sequencing

1. Detection module + four provider adapters (this PR).
2. Stub-backed demo runnable in any browser (this PR).
3. Vue widget + Mermaid live-highlight (next PR).
4. Reframe each phase example page to embed a smaller demo widget that
   isolates one feature (subsequent PRs).

## Out of scope (this cycle)

- Token streaming UI — first cut waits for full responses.
- Function/tool calling — the Archivist doesn't need it; future agentic
  demos may.
- Multi-turn sessions — the Archivist is single-shot per execution.
- Local-storage rate-limit cache for Gemini REST 429 backoff — surface
  the error, ask the user to retry, don't try to be clever.

## Open questions for the user

1. **WebLLM bundle**: ESM CDN (`esm.run`) is simplest but pulls a 100 KB
   loader on every visit even when unused. Acceptable, or lazy-import
   only when WebLLM is the active backend?
2. **Gemini REST: what model?** `gemini-2.0-flash` is the free-tier
   default with the best RPM/RPD budget. Switch to `gemini-2.5-flash`
   when it lands in free tier?
3. **Stub responses**: hand-author one canned per intent, or generate
   from `runArchivist.ts`'s sample data?
