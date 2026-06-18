# @studnicky/dagonizer-patterns-graph

## [Unreleased]

### Changed

- `RdfStoreOptions.subjectPrefix` and `valuePredicate` resolve via the module-level `RDF_STORE_DEFAULTS` const using the canonical `{ ...RDF_STORE_DEFAULTS, ...options }` pattern. The public input stays partial; the resolved internal value always carries real defaults, so the constructor never threads `?? DEFAULT_*` fallbacks.
- **Naming: domain-class verbs (semver-major).** The pattern override seams `MemoryDigestNode.buildDigest` → `composeDigest` and `RecallContextNode.buildQuery` → `composeQuery`. Subclasses override the new names; behavior is unchanged.

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
