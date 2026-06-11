# @noocodex/dagonizer-tool-wikipedia

## 0.20.0

### Patch Changes

- @noocodex/dagonizer-book-entities@0.20.0

## [unreleased]

### Changed

- `WikipediaSummaryTool.execute` replaces `(err as { status?: number }).status` with `err instanceof ToolError && err.status === 404`; imports `ToolError` from `@noocodex/dagonizer/tool`.
- API response narrowed via `isWikiSummary` typed guard at the `HttpTransport.getJson` boundary; throws `ToolError('PARSE_ERROR')` on shape mismatch.
- Convenience re-exports of `Book`, `Candidate`, `Money`, `CanonicalId` removed from the package barrel. Consumers import these directly from `@noocodex/dagonizer-book-entities`.
- `@noocodex/dagonizer-book-entities` promoted from `peerDependencies` to `dependencies`.

## 0.19.0

## 0.17.0

## 0.16.0

## 0.15.0

### Minor Changes

- b5b931f: Audit-driven cleanup across the monorepo (performance, V8 shape, consistency) — every confirmed and advisory finding addressed.

  Core (`@noocodex/dagonizer`):

  - perf: `Scheduler.current()` returns the active provider directly (no per-call wrapper allocation on the node/scatter hot path); `SchedulerProvider` structurally satisfies `SchedulerHandle`, so the public return type is unchanged.
  - perf: gather strategies (`map`/`append`/`partition`) no longer re-sort `execution.records` — records are now documented as an invariant to be source-index ordered (the scatter loop builds them so on every path including resume), eliminating a redundant `.slice().sort()` per gather. `executeScatter` builds the reducer input by iterating the outputs map directly (no intermediate spread).
  - fix(v8-shape): `ToolError.status` is `number | null`, always initialised, so every instance shares one hidden class.
  - consistency: wire-format helpers in `OpenAiCompatibleAdapter` are private methods (no freestanding `toX`/`parseX` functions); removed the forbidden `SearchTool` alias from `./patterns` (use canonical `Tool` from `./tool`).

  Plugin packages: provider adapters' wire-format/error helpers consolidated onto their adapter classes; `StubAdapter` constructor arg `opts`→`options`; redundant `public` modifier dropped; `OpenLibrarySearchTool` populates `notes` provenance consistently with the other tools.

  Tool packages (`-tool-googlebooks`, `-tool-wikipedia`): now re-export the `@noocodex/dagonizer-book-entities` types (`Book`, `Candidate`, `Money`, `CanonicalId`) they expose in their public surface, matching `-tool-openlibrary`.

## 0.14.0

### Patch Changes

- Updated dependencies [d3a4e7b]
  - @noocodex/dagonizer@0.14.0
  - @noocodex/dagonizer-book-entities@0.14.0

## 0.13.2

### Patch Changes

- Updated dependencies [238a94d]
  - @noocodex/dagonizer@0.13.2
  - @noocodex/dagonizer-book-entities@0.13.2

## 0.12.0

### Patch Changes

- Updated dependencies [7c0e38a]
- Updated dependencies [3286d07]
  - @noocodex/dagonizer@0.12.0
