# RFC 0001 — Plugin Architecture (v0.10.0)

Status: **draft** · Target: v0.10.0 · Author: @Studnicky · Date: 2026-05-20

## Why

Dagonizer is positioned as an ecosystem of deterministic nodes and tools that
users compose into workflows. Today every adapter, every reusable node
pattern, and every tool lives inside `examples/the-archivist/` — the example
IS the plugin catalogue. Users can read the code but cannot `npm install`
the pieces and drop them into their own dispatcher.

The v0.10.0 restructure hoists three tiers of plugins into independently
versioned packages built and released from the same monorepo. The example
continues to demonstrate the full stack but consumes the plugin packages,
not inline code.

## Three plugin tiers

| Tier | Package shape | Why |
|---|---|---|
| **Adapters** | Concrete classes, drop-in | LLM transport — provider-neutral contract by construction |
| **Tools** | Concrete static classes, narrow domain bind | External-service wrappers (HTTP fetch, normalize, return entities) |
| **Patterns** | **Abstract base classes** with override hooks | Reusable DAG node patterns (RAG, graph-recall, fan-out reduce) |

Patterns are the new tier and warrant explanation. Per project standards
("Class extension is the only extension mechanism. Zero callbacks."), each
pattern ships as an abstract base class. Consumers `extends` the base,
override the protected methods that inject their domain (prompts, state
fields, service shapes), and get a working node.

Example: `BaseClassifyIntentNode<TState, TIntent>` — consumers supply the
state shape and intent token union, override `buildPrompt(state)` and
`parseIntent(content)`. The base handles LLM dispatch, retry, and routing.

## Goals

- Three-tier plugin set installable independently from npm. Each tier ships *primitives*; consumers compose those primitives via class extension to build their own flows.
- `@noocodex/dagonizer/adapter`, `@noocodex/dagonizer/patterns`, `@noocodex/dagonizer/tool` are stable public API subpaths governed by semver.
- The example continues to work and demonstrates the full plugin composition — every Archivist node becomes a class that `extends` one of the published bases.
- Internal contributors get a monorepo workflow: pnpm workspaces, one `pnpm install`, one `pnpm build` builds everything in dependency order.
- Per-package CHANGELOGs via changesets so a bug-fix to one adapter does not bump the world.

## Non-goals

- Migration of the example's *domain* code (Archivist state, prompts, ontology, seed library) out of `examples/`. The example stays the reference consumer.
- Re-architecting the dispatcher itself. The plugin model is additive to today's `NodeInterface` / `LlmAdapter` contracts; the contracts move location but do not change shape.
- Publishing patterns for every possible flow shape. The v0.10.0 patterns set is the patterns the Archivist actually uses, generalised. New patterns land as separate packages on demand.

## Package taxonomy

**15 packages total.** Main dagonizer + 8 adapters + 3 tools + 3 patterns.

### Main
```
@noocodex/dagonizer                   (existing — gains ./adapter, ./patterns, ./tool subpaths)
```

### Adapters (8)
```
@noocodex/dagonizer-adapter-gemini-api
@noocodex/dagonizer-adapter-gemini-nano
@noocodex/dagonizer-adapter-web-llm
@noocodex/dagonizer-adapter-groq
@noocodex/dagonizer-adapter-cerebras
@noocodex/dagonizer-adapter-mistral
@noocodex/dagonizer-adapter-openrouter
@noocodex/dagonizer-adapter-stub
```

### Tools (3)
```
@noocodex/dagonizer-tool-openlibrary   (HTTP scout for OpenLibrary search)
@noocodex/dagonizer-tool-googlebooks   (HTTP scout for Google Books search)
@noocodex/dagonizer-tool-wikipedia     (HTTP scout for Wikipedia summaries)
```

Each tool exports a static class with `noun.verb()` API per project standards
— e.g. `OpenLibrarySearchTool.search(query: string): Promise<Candidate[]>`.
No constructor, no state.

### Patterns (3)
```
@noocodex/dagonizer-patterns-rag       (LLM-driven node bases — classify, decide, rank, compose, validate, empty, scout)
@noocodex/dagonizer-patterns-graph     (Triple-store node bases — recall, record, digest)
@noocodex/dagonizer-patterns-flow      (Pure flow primitives — fan-in reducer, dedupe-by-key, gates, group-by, sort, pick)
```

**What ships vs what stays.** A pattern package ships *only* the genuinely
reusable primitive — the abstract base whose shape is domain-agnostic. The
Archivist's concrete nodes that are domain-specific (`rankByRating` weights
Google Books ratings, `recallPastVisits` queries `dag:Book` triples,
`declineOffTopic` emits Archivist persona text) **stay in the example** and
extend the appropriate base. The library exists to provide primitives;
class extension is how consumers compose them into a specific flow.

Concrete example:

```ts
// In the plugin package — primitive only:
export abstract class BaseClassifyTokenNode<TState, TToken extends string>
  extends BaseNode<TState, TToken, RagServices>
{
  protected abstract buildPrompt(state: TState): string;
  protected abstract parseToken(content: string): TToken;
  async execute(state, ctx) { /* LLM dispatch + retry handled here */ }
}

// In the Archivist example — domain concrete, extends primitive:
export class ClassifyIntentNode extends BaseClassifyTokenNode<ArchivistState, ArchivistIntent> {
  readonly outputs = INTENT_TOKENS;
  protected buildPrompt(state) { return prompts.classifyIntent(state.query); }
  protected parseToken(content) { return normaliseIntent(content); }
}
```

This is the only sustainable boundary: the lib ships shapes, the consumer
ships domain.

The main `@noocodex/dagonizer` ships the dispatcher, contracts, and three
new subpaths. Each plugin package depends on `@noocodex/dagonizer` for the
relevant contract types.

## Monorepo layout

```
.
├── docs/                            (existing — VitePress docs site)
├── examples/                        (existing — the Archivist demo, consumes plugins)
├── packages/
│   ├── dagonizer/                   (main package, was the repo root)
│   │   ├── src/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── …
│   ├── dagonizer-adapter-groq/
│   │   ├── src/GroqApiAdapter.ts
│   │   ├── src/index.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tests/
│   ├── dagonizer-adapter-cerebras/
│   ├── dagonizer-adapter-mistral/
│   ├── dagonizer-adapter-openrouter/
│   ├── dagonizer-adapter-gemini-api/
│   ├── dagonizer-adapter-gemini-nano/
│   ├── dagonizer-adapter-web-llm/
│   └── dagonizer-adapter-stub/
├── pnpm-workspace.yaml
├── package.json                     (workspace root only)
├── .changeset/
│   └── config.json
└── …
```

`docs/` and `examples/` remain at the root; they consume packages but are not
themselves packages.

## Public contract surfaces (subpaths on the main package)

Three new subpath exports on `@noocodex/dagonizer`:

```jsonc
{
  "exports": {
    "./adapter":  { "default": "./dist/adapter/index.js",  "types": "./dist/adapter/index.d.ts" },
    "./patterns": { "default": "./dist/patterns/index.js", "types": "./dist/patterns/index.d.ts" },
    "./tool":     { "default": "./dist/tool/index.js",     "types": "./dist/tool/index.d.ts" }
  }
}
```

### `./adapter` (moved from `examples/the-archivist/providers/adapters/`)

- `LlmAdapter` interface
- `AdapterCapabilities` interface
- `ChatRequest`, `ChatResponse`, `ChatMessage`, `ToolDefinition`, `ToolCall`, `ToolChoice`, `OutputSchema`
- `BaseAdapter` abstract class (retry + classification)
- `LlmError`, `Classifications`, `ErrorClassification`

### `./patterns` (new)

Base classes + service contracts every pattern package depends on:

- `BaseNode<TState, TOutput, TServices>` — abstract class implementing `NodeInterface`; subclasses override `execute()`. Provides timeout helpers, abort propagation, and the `contract` field.
- `LlmClient` interface — what RAG patterns expect on `services.llm`.
- `TripleStore` interface — what graph patterns expect on `services.memory`. Methods: `assert`, `select`, `clearGraph`, `triples`.
- `SearchTool<TEntity>` interface — what fan-out scouts expect.

Each pattern *package* (the four listed above) depends on `./patterns` for
these base classes and contracts.

### `./tool` (new)

- `Tool<TInput, TOutput>` interface — `static run(input): Promise<output>` shape every tool implements.
- `ToolError` — narrow error class for tool failures (HTTP, parse, rate-limit).
- `HttpTransport` — shared fetch wrapper with retry + abort propagation.

`BaseLlmClient` (prompt choreography for the Archivist) stays in the example
— it's domain-specific. The three subpaths are provider-neutral.

## Versioning

**Independent** via [changesets](https://github.com/changesets/changesets):

- `pnpm changeset` in feature branches records what changed and at what bump level.
- `pnpm changeset version` consumes the queue, bumps `package.json` versions, and updates per-package CHANGELOGs.
- `release.yml` runs `pnpm publish -r` to publish every package whose version differs from npm registry.

A bug fix to `@noocodex/dagonizer-adapter-groq` bumps that one package by a patch; the main package and other adapters stay where they are.

## Publishing

- npm registry (primary).
- GitHub Packages (mirror, already configured).
- Each package's `prepublishOnly` runs the workspace-wide `pnpm ci` so a single failing typecheck blocks all publishes.

## Migration plan

Nine phases. Each phase is a single PR; the example keeps working through every phase.

### Phase 1 — Monorepo skeleton

- Add `pnpm-workspace.yaml` at root listing `packages/*` and `examples/*`.
- Move every current root file into `packages/dagonizer/` EXCEPT `docs/`, `examples/`, `.github/`, `.gitignore`, `README.md`, `LICENSE`, `CHANGELOG.md`, `pnpm-workspace.yaml`, root `package.json`.
- Root `package.json` becomes a workspace-only manifest (`"private": true`, no `main`, no `exports`).
- Existing npm scripts proxy to the workspace package via `pnpm --filter`.
- Switch lockfile from npm to pnpm. Add `preinstall` guard that errors on bare `npm install`.
- Verify `pnpm install` + `pnpm build` + `pnpm test` + smoke all green.

### Phase 2 — Adapter subpath

- Inside `packages/dagonizer/`, create `src/adapter/` and move the contract files from `examples/the-archivist/providers/adapters/` into it: `LlmAdapter.ts`, `BaseAdapter.ts`, `LlmError.ts`.
- Add the `./adapter` subpath to `packages/dagonizer/package.json` exports.
- Update the Archivist example to import the contract from `@noocodex/dagonizer/adapter` (was relative).
- Verify build, tests, smoke, docs all green.

### Phase 3 — Patterns subpath + `BaseNode`

- Inside `packages/dagonizer/src/`, create `patterns/` and ship the base classes + service contracts:
  - `BaseNode<TState, TOutput, TServices>` abstract class (implements `NodeInterface`, provides timeout helpers and contract-field forwarding).
  - `LlmClient`, `TripleStore`, `SearchTool<TEntity>` interfaces.
- Add `./patterns` subpath export.
- Adapt the Archivist's existing nodes to extend `BaseNode` instead of implementing `NodeInterface` directly (proves the base works against real-world code).

### Phase 4 — Tool subpath

- Inside `packages/dagonizer/src/`, create `tool/`:
  - `Tool<TInput, TOutput>` interface.
  - `ToolError` class.
  - `HttpTransport` static class.
- Add `./tool` subpath export.
- No example wiring change yet; just ships the contract.

### Phase 5 — Extract adapter packages (8)

For each adapter, create a package under `packages/dagonizer-adapter-<name>/`:

- `src/<Name>ApiAdapter.ts` (moved from example).
- `src/capabilities.ts` exports the `AdapterCapabilities` constant alongside the class.
- `src/index.ts` re-exports both.
- `package.json` with `dependencies: { "@noocodex/dagonizer": "workspace:^" }`.
- `tsconfig.json` extending the root.
- Per-package wire-format smoke test (existing checks split per adapter).
- `README.md`: install + usage + capability table.

Update the Archivist example to import each adapter from its plugin package.

### Phase 6 — Extract tool packages (3)

For each scout, create a package under `packages/dagonizer-tool-<name>/`:

- `src/<Name>SearchTool.ts` (moved from `examples/the-archivist/tools/`).
- `src/index.ts`.
- `package.json` depending on `@noocodex/dagonizer/tool`.
- Per-package tests (HTTP transport mock + normalization).
- `README.md`.

Update the Archivist example to import each tool from its plugin package.

### Phase 7 — Extract patterns packages (3)

Most invasive phase — designs the abstract base classes. Each pattern package
exports abstract classes + service contracts. **Only genuinely reusable
primitives ship; domain-specific concretes stay in the example and extend
these bases.**

**`@noocodex/dagonizer-patterns-rag`**
- `BaseClassifyTokenNode<TState, TToken>` — LLM picks one of N tokens; consumer overrides `buildPrompt` + `parseToken`.
- `BaseDecideToolsNode<TState>` — LLM picks tool calls; consumer overrides `buildPrompt` + `availableTools`.
- `BaseRankItemsNode<TState, TItem>` — LLM ranks a list; consumer overrides `buildPrompt` + `extractScores`.
- `BaseComposeResponseNode<TState>` — LLM composes a reply; consumer overrides `buildPrompt`.
- `BaseValidateResponseNode<TState>` — LLM judges draft yes/no; consumer overrides `buildPrompt`.
- `BaseEmptyResponseNode<TState>` — LLM composes when no data; consumer overrides `buildPrompt`.
- `BaseScoutNode<TState, TItem, TToolInput, TToolOutput>` — calls a Tool, normalises, writes back; consumer overrides `buildInput` + `normalize` + `writeBack`.
- Services contract: `RagServices = { llm: LlmClient }`.

**`@noocodex/dagonizer-patterns-graph`**
- `BaseRecallContextNode<TState, TBinding>` — SPARQL select; consumer overrides `buildQuery` + `mapBindings`.
- `BaseRecordFindingsNode<TState, TEntity>` — writes entities as quads; consumer overrides `toQuads`.
- `BaseMemoryDigestNode<TState>` — assembles a recent-activity digest; consumer overrides `buildDigest`.
- Services contract: `GraphServices = { memory: TripleStore }`.

**`@noocodex/dagonizer-patterns-flow`**
- `BaseFanInReducerNode<TState, TItem>` — fan-out reducer; consumer overrides `reduce`.
- `BaseDedupeByKeyNode<TItem>` — dedupes by computed key; consumer overrides `keyOf`.
- `BasePredicateGateNode<TState>` — boolean gate; consumer overrides `predicate`.
- `BaseGroupByFieldNode<TItem, TKey>` — groups items by a field; consumer overrides `fieldOf`.
- `BaseSortByNode<TItem>` — sorts a list; consumer overrides `compare`.
- `BasePickByNode<TItem>` — picks one item; consumer overrides `score`.
- Services contract: none (pure).

**Stays in example** (Archivist-specific, extends one of the bases above):
- `ClassifyIntentNode extends BaseClassifyTokenNode<ArchivistState, ArchivistIntent>` — Book domain prompt + intent union.
- `RankByRatingNode extends BaseSortByNode<Candidate>` — Google Books rating comparator.
- `RecallContextNode extends BaseRecallContextNode<ArchivistState, BookBinding>` — `dag:Book` SPARQL query.
- `RecallPastVisitsNode`, `RecommendSimilarNode`, `DeclineOffTopicNode`, `DeclineEmptyNode`, `RespondToVisitorNode`, `ExtractQueryNode`, `MergeCandidatesNode`, `HasCitationsGateNode` — every one is a one-class extension of a base above. The example demonstrates exactly the composition pattern the library is built around.

### Phase 8 — Changesets + release pipeline

- Add `@changesets/cli` as a workspace devDependency.
- `.changeset/config.json` configured for independent versioning across the 16 packages.
- Replace `release.yml` with a changesets-based workflow that creates a "Version Packages" PR.
- Document the changeset workflow in a new `CONTRIBUTING.md`.

### Phase 9 — Docs + README

- New `docs/guide/plugins.md`: how to write an adapter, a tool, and a pattern (one worked example each).
- New `docs/guide/patterns.md`: the four pattern packages, what they ship, the abstract methods to override.
- Update `docs/examples/the-archivist.md` to mention each piece is its own installable package.
- Each plugin package gets its own `README.md`.
- README at the repo root summarises the three-tier model with install snippets.

## Open questions

1. **Lockfile migration**: pnpm + npm lockfiles can't coexist. We commit pnpm-lock.yaml and delete package-lock.json — but anyone with `npm install` muscle memory needs a one-time pivot. Recommend a banner in the README + a `preinstall` script that errors out if `npm` is detected.

2. **VitePress + workspaces**: VitePress is currently a docs-site dep. Confirm it resolves correctly from the workspace root and links to `packages/dagonizer/dist/` if the docs site uses TypeDoc.

3. **Capability metadata**: should adapter packages export their capability declarations as constants so consumers can introspect without instantiating? Probably yes — add `export const GROQ_CAPABILITIES: AdapterCapabilities = {...}` per package.

4. **Backwards compatibility window**: do we keep the old in-example adapter exports working for one minor version after the move so consumers depending on `examples/the-archivist/...` paths get a deprecation warning, or do we cut clean at v0.10.0? Recommend cutting clean since v0.x consumers shouldn't pin to `examples/` paths.

5. **Single repository or split**: stay in the current monorepo or split adapters into their own GitHub org? Stay for now; revisit if external contributors emerge.

## Rollout

- v0.10.0 ships the restructure + 14 plugin packages as their first published versions (each plugin `0.1.0`).
- `@noocodex/dagonizer` bumps to `0.10.0` (minor — three new subpaths, no breaking change to the existing public API on `.` , `./contracts`, `./derive` etc.).
- Old adapter / tool / node file paths under `examples/` removed; consumers must `npm install @noocodex/dagonizer-{adapter,tool,patterns}-*` going forward.

## Rejected alternatives

- **Locked versioning**: simpler but punishes single-adapter fixes.
- **Dedicated `@noocodex/dagonizer-adapter-contract` package**: extra publishing step for no real benefit; subpath export on the main package is one source of truth.
- **Turborepo/Nx**: caching is nice-to-have at 16 packages; revisit if build times become a pain point.
- **Ship adapters only in v0.10.0, patterns later**: explicitly rejected. Dagonizer's value proposition is the full ecosystem (adapters + tools + patterns). Shipping one tier without the others would tell consumers "you can swap LLMs but everything else is still example code." All three tiers ship together so the v0.10.0 narrative is coherent: install plugins for every layer of your DAG.
- **Concrete RAG node packages instead of abstract bases**: would couple prompts and state shape to the plugin, defeating reuse. Patterns ship as abstract classes per project standards.
- **Ship the Archivist's domain-specific nodes as plugins**: explicitly rejected. `RankByRatingNode` weights Google Books ratings — that's an Archivist choice, not a primitive. `DeclineOffTopicNode` emits Archivist persona text. Shipping these as plugins would mean consumers either fork them or live with someone else's domain choices baked in. The library ships primitives; domain concretes stay where the domain lives.
