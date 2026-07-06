# @studnicky/dagonizer-patterns-graph

## 1.0.0

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

## 0.30.0

## 0.29.1

## 0.29.0

## 0.28.1

## 0.28.0

## 0.27.0

## 0.26.0

## 0.25.0

## 0.24.0

## 0.23.0

## 0.22.0

### Changed

- **Adapter-contract interfaces carry the `Interface` suffix (semver-major).** The framework contracts this package's public surface names are imported under their suffixed names: `StoreInterface` and `TripleStoreInterface` (the service contracts the graph pattern nodes operate against). The renames are type-only and propagate from `@studnicky/dagonizer`; runtime behavior is unchanged. Consumers typing against the old bare names (`Store`, `TripleStore`) update to the suffixed names.
- `RdfStoreOptions.subjectPrefix` and `valuePredicate` resolve via the module-level `RDF_STORE_DEFAULTS` const using the canonical `{ ...RDF_STORE_DEFAULTS, ...options }` pattern. The public input stays partial; the resolved internal value always carries real defaults, so the constructor never threads `?? DEFAULT_*` fallbacks.
- **Naming: domain-class verbs (semver-major).** The pattern override seams are `MemoryDigestNode.composeDigest` and `RecallContextNode.composeQuery`. Subclasses override these names; behavior is unchanged.
- `RdfStore` migrates to the streaming seam (`performEntriesStream` / `performRestoreEntry` / `performClear`) introduced in `@studnicky/dagonizer` S-P1. `performClear` truncates the in-memory quad array (replacing the clear-then-reseed in `performRestoreEntries`). The array-form `snapshot()` and `restore()` behavior is unchanged.

## 0.21.0

## 0.20.0

## 0.19.0

## 0.17.0

## 0.16.0

## 0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [d3a4e7b]
  - @studnicky/dagonizer@0.14.0

## 0.13.2

### Patch Changes

- Updated dependencies [238a94d]
  - @studnicky/dagonizer@0.13.2

## 0.12.0

### Patch Changes

- Updated dependencies [7c0e38a]
- Updated dependencies [3286d07]
  - @studnicky/dagonizer@0.12.0
