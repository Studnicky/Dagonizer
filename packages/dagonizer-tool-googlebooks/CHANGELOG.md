# @studnicky/dagonizer-tool-googlebooks

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

## [unreleased]

### Changed

- **Adapter-contract interfaces carry the `Interface` suffix (semver-major).** The framework contracts this package's public surface names are imported under their suffixed names: `ToolInterface` (the exported `GoogleBooksTool` implements it) and `EntityValidatorInterface` (the compiled response validator). The renames are type-only and propagate from `@studnicky/dagonizer`; runtime behavior is unchanged. Consumers typing against the old bare names (`Tool`, `EntityValidator`) update to the suffixed names.
- The Google Books volumes response is a JSON Schema 2020-12 `*Schema` const (`GoogleBooksResponseSchema`) with a `FromSchema`-derived type and a module-load-compiled `EntityValidator` in `GoogleBooksResponse.ts`. The validator compiles through `Validator.compile` from `@studnicky/dagonizer/validation` against the framework's single shared Ajv; the package carries no Ajv dependency of its own. `GoogleBooksTool.execute` passes the validator to `HttpTransport.getJson`, which narrows the `unknown` body and throws `ToolError('PARSE_ERROR')` on a schema mismatch. The hand-written `isGoogleBooksResponse` predicate and wire-shape interfaces are removed.
- Convenience re-exports of `Book`, `Candidate`, `Money`, `CanonicalId` removed from the package barrel. Consumers import these directly from `@studnicky/dagonizer-book-entities`.
- `@studnicky/dagonizer-book-entities` promoted from `peerDependencies` to `dependencies`.

## 0.19.0

## 0.17.0

### Patch Changes

- 34b7155: Apply Clean Code manifesto: static classes replace free functions, named constants replace magic numbers, flag arguments replaced with options objects, SRP extractions from Dagonizer core.

  **Breaking removals:** `detectGeminiNano` (→ `GeminiNanoAdapter.detect()`), `decodeToolCallsJson` (→ `ToolCallCodec.decode()`), `classifyHttp` (→ `LlmError.classifyHttp()`), `asNetworkError` (→ `LlmError.fromNetworkError()`).

  **New:** `DAGValidator`, `StateMapper`, `ScatterCheckpoint`, `PlacementUtils`, `ToolCallCodec`, `OpenLibraryDocs`, `BookEntitiesError`, `ExecutionError.fromSignal()`, `GeminiNanoAdapter.detect()`.

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
