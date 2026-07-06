# @studnicky/dagonizer-tool-wikipedia

## 0.30.1

### Patch Changes

- @studnicky/dagonizer-book-entities@0.30.1

## 0.30.0

### Patch Changes

- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
- Updated dependencies [4639f9b]
  - @studnicky/dagonizer@1.0.0
  - @studnicky/dagonizer-book-entities@1.0.0

## 0.30.0

### Patch Changes

- @studnicky/dagonizer-book-entities@0.30.0

## 0.29.1

### Patch Changes

- @studnicky/dagonizer-book-entities@0.29.1

## 0.29.0

### Patch Changes

- @studnicky/dagonizer-book-entities@0.29.0

## 0.28.1

### Patch Changes

- @studnicky/dagonizer-book-entities@0.28.1

## 0.28.0

### Patch Changes

- @studnicky/dagonizer-book-entities@0.28.0

## 0.27.0

### Patch Changes

- @studnicky/dagonizer-book-entities@0.27.0

## 0.26.0

### Patch Changes

- @studnicky/dagonizer-book-entities@0.26.0

## 0.25.0

### Patch Changes

- @studnicky/dagonizer-book-entities@0.25.0

## 0.24.0

### Patch Changes

- @studnicky/dagonizer-book-entities@0.24.0

## 0.23.0

### Patch Changes

- @studnicky/dagonizer-book-entities@0.23.0

## 0.22.0

### Patch Changes

- @studnicky/dagonizer-book-entities@0.22.0

## 0.21.0

### Patch Changes

- @studnicky/dagonizer-book-entities@0.21.0

## 0.20.0

### Patch Changes

- @studnicky/dagonizer-book-entities@0.20.0

### Changed

- **Adapter-contract interfaces carry the `Interface` suffix (semver-major).** The framework contracts this package's public surface names are imported under their suffixed names: `ToolInterface` (the exported `WikipediaSummaryTool` implements it) and `EntityValidatorInterface` (the compiled response validator). The renames are type-only and propagate from `@studnicky/dagonizer`; runtime behavior is unchanged. Consumers typing against the old bare names (`Tool`, `EntityValidator`) update to the suffixed names.
- `WikipediaSummaryTool.execute` replaces `(err as { status?: number }).status` with `err instanceof ToolError && err.status === 404`; imports `ToolError` from `@studnicky/dagonizer/tool`.
- The Wikipedia REST `page/summary` response is a JSON Schema 2020-12 `*Schema` const (`WikipediaSummaryResponseSchema`) with a `FromSchema`-derived type and a module-load-compiled `EntityValidator` in `WikipediaSummaryResponse.ts`. The validator compiles through `Validator.compile` from `@studnicky/dagonizer/validation` against the framework's single shared Ajv; the package carries no Ajv dependency of its own. `WikipediaSummaryTool.execute` passes the validator to `HttpTransport.getJson`, which narrows the `unknown` body and throws `ToolError('PARSE_ERROR')` on a schema mismatch. The hand-written `isWikiSummary` predicate and `WikiSummary` interface are removed.
- Convenience re-exports of `Book`, `Candidate`, `Money`, `CanonicalId` removed from the package barrel. Consumers import these directly from `@studnicky/dagonizer-book-entities`.
- `@studnicky/dagonizer-book-entities` promoted from `peerDependencies` to `dependencies`.

## 0.19.0

## 0.17.0

## 0.16.0

## 0.15.0

### Minor Changes

- b5b931f: Audit-driven cleanup across the monorepo (performance, V8 shape, consistency) — every confirmed and advisory finding addressed.

  Core (`@studnicky/dagonizer`):

  - perf: `Scheduler.current()` returns the active provider directly (no per-call wrapper allocation on the node/scatter hot path); `SchedulerProvider` structurally satisfies `SchedulerHandle`, so the public return type is unchanged.
  - perf: gather strategies (`map`/`append`/`partition`) no longer re-sort `execution.records` — records are now documented as an invariant to be source-index ordered (the scatter loop builds them so on every path including resume), eliminating a redundant `.slice().sort()` per gather. `executeScatter` builds the reducer input by iterating the outputs map directly (no intermediate spread).
  - fix(v8-shape): `ToolError.status` is `number | null`, always initialised, so every instance shares one hidden class.
  - consistency: wire-format helpers in `OpenAiCompatibleAdapter` are private methods (no freestanding `toX`/`parseX` functions); removed the forbidden `SearchTool` alias from `./patterns` (use canonical `Tool` from `./tool`).

  Plugin packages: provider adapters' wire-format/error helpers consolidated onto their adapter classes; `StubAdapter` constructor arg `opts`→`options`; redundant `public` modifier dropped; `OpenLibrarySearchTool` populates `notes` provenance consistently with the other tools.

  Tool packages (`-tool-googlebooks`, `-tool-wikipedia`): now re-export the `@studnicky/dagonizer-book-entities` types (`Book`, `Candidate`, `Money`, `CanonicalId`) they expose in their public surface, matching `-tool-openlibrary`.

## 0.14.0

### Patch Changes

- Updated dependencies [d3a4e7b]
  - @studnicky/dagonizer@0.14.0
  - @studnicky/dagonizer-book-entities@0.14.0

## 0.13.2

### Patch Changes

- Updated dependencies [238a94d]
  - @studnicky/dagonizer@0.13.2
  - @studnicky/dagonizer-book-entities@0.13.2

## 0.12.0

### Patch Changes

- Updated dependencies [7c0e38a]
- Updated dependencies [3286d07]
  - @studnicky/dagonizer@0.12.0
