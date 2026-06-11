# @noocodex/dagonizer-tool-openlibrary

## [unreleased]

### Changed

- `OpenLibrarySearchTool` and `SubjectSearchTool` both narrow the API response via `narrowOpenLibraryResponse` (typed guard in `openLibraryTypes.ts`) at the `HttpTransport.getJson` boundary; throws `ToolError('PARSE_ERROR')` on shape mismatch.
- `OpenLibrarySearchTool.inputSchema` drops the empty `'required': []` array (no-op; absence is equivalent under JSON Schema).
- `SubjectSearchTool` removes `// #region` / `// #endregion` fold markers (no other tool uses them).
- Convenience re-exports of `Book`, `Candidate`, `Money`, `CanonicalId` removed from the package barrel. Consumers import these directly from `@noocodex/dagonizer-book-entities`.
- `@noocodex/dagonizer-book-entities` promoted from `peerDependencies` to `dependencies`.

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
