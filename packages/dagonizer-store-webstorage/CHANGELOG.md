# @studnicky/dagonizer-store-webstorage

## 2.0.0

### Patch Changes

- Updated dependencies [63a6261]
  - @studnicky/dagonizer@2.0.0

## 1.0.1

### Patch Changes

- Updated dependencies [8a57ce4]
  - @studnicky/dagonizer@1.0.1

## 1.0.0

### Patch Changes

- Updated dependencies [fdaa32a]
  - @studnicky/dagonizer@1.0.0

## 0.30.1

### Patch Changes

- Updated dependencies
  - @studnicky/dagonizer@0.30.1

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

## 0.30.0

### Patch Changes

- Updated dependencies [4234bc4]
  - @studnicky/dagonizer@0.30.0

## 0.29.1

### Patch Changes

- Updated dependencies [6bdafa4]
  - @studnicky/dagonizer@0.29.1

## 0.29.0

### Patch Changes

- Updated dependencies [23ec54b]
- Updated dependencies [23ec54b]
- Updated dependencies [23ec54b]
  - @studnicky/dagonizer@0.29.0

## 0.28.1

### Patch Changes

- Updated dependencies [fc7021e]
  - @studnicky/dagonizer@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [6ed7c12]
  - @studnicky/dagonizer@0.28.0

## [unreleased]

### Minor Changes

- Introduces `WebStorageStore` — a `BaseStore` implementation backed by the Web Storage API (`localStorage` / `sessionStorage`). Supports `get`, `set`, `has`, `delete`, `update` (synchronous read-modify-write), `snapshot`, `restore`, `snapshotStream`, and `restoreStream`. `QuotaExceededError` from `setItem` is routed to `StoreError(BACKING_ERROR)` and never escapes uncaught. Static factories `WebStorageStore.local()` and `WebStorageStore.session()` reach browser globals via `Reflect.get(globalThis, …)` and narrow via a structural type guard — no `as` cast, no DOM lib dependency.
- Introduces `WebStorageCheckpointStore` — a `CheckpointStoreInterface` implementation backed by Web Storage. `save` / `load` / `delete` operate on raw JSON strings. Same quota guard as `WebStorageStore`. Static factories `.local()` / `.session()` follow the same `Reflect.get` + structural-guard pattern.
- Introduces `StorageLikeInterface` — a minimal structural contract for the Web Storage API, enabling test doubles and SSR injection without DOM globals.
