# @studnicky/dagonizer-store-webstorage

## [unreleased]

### Minor Changes

- Introduces `WebStorageStore` — a `BaseStore` implementation backed by the Web Storage API (`localStorage` / `sessionStorage`). Supports `get`, `set`, `has`, `delete`, `update` (synchronous read-modify-write), `snapshot`, `restore`, `snapshotStream`, and `restoreStream`. `QuotaExceededError` from `setItem` is routed to `StoreError(BACKING_ERROR)` and never escapes uncaught. Static factories `WebStorageStore.local()` and `WebStorageStore.session()` reach browser globals via `Reflect.get(globalThis, …)` and narrow via a structural type guard — no `as` cast, no DOM lib dependency.
- Introduces `WebStorageCheckpointStore` — a `CheckpointStoreInterface` implementation backed by Web Storage. `save` / `load` / `delete` operate on raw JSON strings. Same quota guard as `WebStorageStore`. Static factories `.local()` / `.session()` follow the same `Reflect.get` + structural-guard pattern.
- Introduces `StorageLikeInterface` — a minimal structural contract for the Web Storage API, enabling test doubles and SSR injection without DOM globals.
