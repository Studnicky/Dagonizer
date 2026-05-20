# RFC 0001 — Plugin Architecture (v0.10.0)

Status: **draft** · Target: v0.10.0 · Author: @Studnicky · Date: 2026-05-20

## Why

Dagonizer is positioned as an ecosystem of deterministic nodes and tools that
users compose into workflows. Today every adapter and node lives inside
`examples/the-archivist/` — the example IS the plugin catalogue. Users can
read the code but cannot `npm install` a Groq adapter and drop it into their
own dispatcher.

The v0.10.0 restructure hoists the adapter set from the example into
independently-versioned `@noocodex/dagonizer-adapter-*` packages built and
released from the same monorepo. The example continues to demonstrate the
full stack but consumes the plugin packages, not inline code.

## Goals

- Adapters become independently installable: `npm install @noocodex/dagonizer-adapter-groq`.
- `LlmAdapter` contract surface lives at `@noocodex/dagonizer/adapter` and is treated as a stable public API governed by semver.
- The example continues to work and demonstrates the full plugin composition.
- Internal contributors get a monorepo workflow: pnpm workspaces, one `pnpm install`, one `pnpm build` builds everything in dependency order.
- Per-package CHANGELOGs via changesets so a bug-fix to one adapter does not bump the world.

## Non-goals

- Reusable node packages (`@noocodex/dagonizer-nodes-rag` etc.). Defer until the patterns prove out in the example; tracked separately.
- Tool packages (OpenLibrary / Google Books / Wikipedia scouts). Defer.
- Migration of the example's domain code (Archivist state, prompts, ontology) out of `examples/`.
- Re-architecting the dispatcher itself. The plugin model is additive to today's `NodeInterface` / `LlmAdapter` contracts; the contracts move location but do not change shape.

## Package taxonomy

```
@noocodex/dagonizer                   (existing — gains ./adapter subpath)
@noocodex/dagonizer-adapter-gemini-api
@noocodex/dagonizer-adapter-gemini-nano
@noocodex/dagonizer-adapter-web-llm
@noocodex/dagonizer-adapter-groq
@noocodex/dagonizer-adapter-cerebras
@noocodex/dagonizer-adapter-mistral
@noocodex/dagonizer-adapter-openrouter
@noocodex/dagonizer-adapter-stub
```

Nine packages total. The main `@noocodex/dagonizer` ships the dispatcher,
contracts, and the new `./adapter` subpath; each adapter package depends on
`@noocodex/dagonizer` for the contract types and `@noocodex/dagonizer/adapter`
for `BaseAdapter`, `LlmError`, `RetryPolicy`, etc.

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

## Adapter contract surface

A new subpath export on `@noocodex/dagonizer`:

```jsonc
{
  "exports": {
    "./adapter": {
      "default": "./dist/adapter/index.js",
      "types": "./dist/adapter/index.d.ts"
    }
  }
}
```

Contents of `./adapter` (moved from `examples/the-archivist/providers/adapters/`):

- `LlmAdapter` interface
- `AdapterCapabilities` interface
- `ChatRequest`, `ChatResponse`, `ChatMessage`, `ToolDefinition`, `ToolCall`, `ToolChoice`, `OutputSchema`
- `BaseAdapter` abstract class (provides retry + classification)
- `LlmError`, `Classifications`, `ErrorClassification`

`BaseLlmClient` (prompt choreography) stays in the Archivist example since
it's domain-specific. The contract surface is provider-neutral.

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

Phased so each phase commits cleanly and the example keeps working:

### Phase 1 — Monorepo skeleton

- Add `pnpm-workspace.yaml` at root.
- Move every current root file into `packages/dagonizer/` EXCEPT `docs/`, `examples/`, `.github/`, `.gitignore`, `README.md`, `LICENSE`, `CHANGELOG.md`, `pnpm-workspace.yaml`, root `package.json`.
- Root `package.json` becomes a workspace-only manifest (`"private": true`, no `main`, no `exports`).
- All existing npm scripts proxy to the workspace package via `pnpm --filter`.
- Switch lockfile from npm to pnpm. Verify `pnpm install` + `pnpm build` + `pnpm test` all green.

### Phase 2 — Adapter subpath

- Inside `packages/dagonizer/`, create `src/adapter/` and move the contract files from `examples/the-archivist/providers/adapters/` into it: `LlmAdapter.ts`, `BaseAdapter.ts`, `LlmError.ts`.
- Add the `./adapter` subpath to `packages/dagonizer/package.json` exports.
- Update the Archivist example to import the contract from `@noocodex/dagonizer/adapter` (was relative).
- Verify build, tests, smoke, docs all green.

### Phase 3 — Extract adapter packages

For each of the eight adapters, create a package under `packages/dagonizer-adapter-<name>/`:

- `src/<Name>ApiAdapter.ts` (moved from example).
- `src/index.ts` (re-exports).
- `package.json` with `dependencies: { "@noocodex/dagonizer": "workspace:^" }`.
- `tsconfig.json` extending the root.
- Per-package tests covering the wire-format smoke checks we already have.

Update the Archivist example to import each adapter from its plugin package
(`import { GroqApiAdapter } from '@noocodex/dagonizer-adapter-groq'`).
Workspace resolution handles the in-repo references.

Delete the original adapter files from `examples/the-archivist/providers/adapters/`. Keep `BaseLlmClient.ts` and provider-matrix/MobileDetection there — those are domain-specific to the example.

### Phase 4 — Changesets + release pipeline

- Add `@changesets/cli` as a workspace devDependency.
- `.changeset/config.json` configured for independent versioning.
- Replace `release.yml` GitHub release workflow with a changesets-based release workflow that creates a "Version Packages" PR.
- Document the changeset workflow in `CONTRIBUTING.md`.

### Phase 5 — Docs + README

- New `docs/guide/plugins.md` documenting the plugin model with a worked example: "Write your own adapter in 50 lines."
- Update `docs/examples/the-archivist.md` to mention each adapter is its own installable package.
- README links to the new plugin guide.
- Each adapter package gets its own `README.md` with install + usage + capability table.

## Open questions

1. **Lockfile migration**: pnpm + npm lockfiles can't coexist. We commit pnpm-lock.yaml and delete package-lock.json — but anyone with `npm install` muscle memory needs a one-time pivot. Recommend a banner in the README + a `preinstall` script that errors out if `npm` is detected.

2. **VitePress + workspaces**: VitePress is currently a docs-site dep. Confirm it resolves correctly from the workspace root and links to `packages/dagonizer/dist/` if the docs site uses TypeDoc.

3. **Capability metadata**: should adapter packages export their capability declarations as constants so consumers can introspect without instantiating? Probably yes — add `export const GROQ_CAPABILITIES: AdapterCapabilities = {...}` per package.

4. **Backwards compatibility window**: do we keep the old in-example adapter exports working for one minor version after the move so consumers depending on `examples/the-archivist/...` paths get a deprecation warning, or do we cut clean at v0.10.0? Recommend cutting clean since v0.x consumers shouldn't pin to `examples/` paths.

5. **Single repository or split**: stay in the current monorepo or split adapters into their own GitHub org? Stay for now; revisit if external contributors emerge.

## Rollout

- v0.10.0 ships the restructure + plugin packages as their first published versions (each adapter `0.1.0`).
- `@noocodex/dagonizer` bumps to `0.10.0` (minor — new subpath, no breaking change to existing public API).
- Old adapter file paths under `examples/` removed; consumers must `npm install @noocodex/dagonizer-adapter-<name>` going forward.

## Rejected alternatives

- **Reusable node packages now**: too early; node patterns are example-specific until proven in a second example.
- **Tool packages now**: OpenLibrary/Google Books/Wikipedia scouts are demo-specific. Hoisting them would inflate the surface area we maintain for marginal value.
- **Locked versioning**: simpler but punishes single-adapter fixes.
- **Dedicated `@noocodex/dagonizer-adapter-contract` package**: extra publishing step for no real benefit; subpath export on the main package is one source of truth.
- **Turborepo/Nx**: caching is nice-to-have at 9 packages; revisit if build times become a pain point.
