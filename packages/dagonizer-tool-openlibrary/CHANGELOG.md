# @studnicky/dagonizer-tool-openlibrary

## 2.0.0

### Patch Changes

- Updated dependencies [63a6261]
  - @studnicky/dagonizer@2.0.0
  - @studnicky/dagonizer-book-entities@2.0.0

## 1.0.1

### Patch Changes

- @studnicky/dagonizer-book-entities@1.0.1

## 1.0.0

### Patch Changes

- Updated dependencies [fdaa32a]
  - @studnicky/dagonizer@1.0.0
  - @studnicky/dagonizer-book-entities@1.0.0

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

- **Adapter-contract interfaces carry the `Interface` suffix (semver-major).** The framework contracts this package's public surface names are imported under their suffixed names: `ToolInterface` (the exported `OpenLibrarySearchTool` and `SubjectSearchTool` implement it) and `EntityValidatorInterface` (the compiled response validator). The renames are type-only and propagate from `@studnicky/dagonizer`; runtime behavior is unchanged. Consumers typing against the old bare names (`Tool`, `EntityValidator`) update to the suffixed names.
- The OpenLibrary `search.json` response is a JSON Schema 2020-12 `*Schema` const (`OpenLibraryResponseSchema`) with `FromSchema`-derived types and a module-load-compiled `EntityValidator` in `OpenLibraryResponse.ts`. The validator compiles through `Validator.compile` from `@studnicky/dagonizer/validation` against the framework's single shared Ajv; the package carries no Ajv dependency of its own. `OpenLibrarySearchTool` and `SubjectSearchTool` pass the validator to `HttpTransport.getJson`, which narrows the `unknown` body and throws `ToolError('PARSE_ERROR')` on a schema mismatch. The freestanding `narrowOpenLibraryResponse` and `isOpenLibraryResponse` are removed; direct-narrowing callers use the `OpenLibraryDocs.narrowResponse` static.
- `OpenLibrarySearchTool.inputSchema` drops the empty `'required': []` array (no-op; absence is equivalent under JSON Schema).
- `SubjectSearchTool` removes `// #region` / `// #endregion` fold markers (no other tool uses them).
- Convenience re-exports of `Book`, `Candidate`, `Money`, `CanonicalId` removed from the package barrel. Consumers import these directly from `@studnicky/dagonizer-book-entities`.
- `@studnicky/dagonizer-book-entities` promoted from `peerDependencies` to `dependencies`.

## 0.19.0

## 0.17.0

### Minor Changes

- 34b7155: Apply Clean Code manifesto: static classes replace free functions, named constants replace magic numbers, flag arguments replaced with options objects, SRP extractions from Dagonizer core.

  **Breaking removals:** `detectGeminiNano` (→ `GeminiNanoAdapter.detect()`), `decodeToolCallsJson` (→ `ToolCallCodec.decode()`), `classifyHttp` (→ `LlmError.classifyHttp()`), `asNetworkError` (→ `LlmError.fromNetworkError()`).

  **New:** `DAGValidator`, `StateMapper`, `ScatterCheckpoint`, `PlacementUtils`, `ToolCallCodec`, `OpenLibraryDocs`, `BookEntitiesError`, `ExecutionError.fromSignal()`, `GeminiNanoAdapter.detect()`.

## 0.16.0

## 0.15.0

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
