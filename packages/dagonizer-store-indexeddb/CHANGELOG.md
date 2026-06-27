# @studnicky/dagonizer-store-indexeddb

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

- `IndexedDbStore` ships as the durable default browser-store adapter for HITL/resume. Implements `BaseStore` with cursor-streamed `performEntriesStream` (no `getAll`), transactional `update` (single `readwrite` transaction for atomic RMW), and `connect`/`disconnect` for the DB open/close lifecycle. Values stored as JSON strings; codec matches SQLite and OPFS adapters. No DOM lib — IndexedDB API surface is defined via minimal structural interfaces in `IdbTypes.ts`; the `indexedDB` global is reached via `Reflect.get(globalThis, 'indexedDB')` + the `IdbFactory.is` type-predicate guard.
- `IndexedDbCheckpointStore` ships as a `CheckpointStoreInterface` implementation backed by a dedicated IndexedDB object store. Strings-only codec; same factory-injection pattern as `IndexedDbStore`. Defaults to its own database (`dagonizer-checkpoints`), distinct from `IndexedDbStore`'s `dagonizer`, so the two compose with default options — each store class creates its single object store in its own `onupgradeneeded`, and a shared database at one version would leave the second store's object store uncreated.
- `IdbFactory.is` and `IdbRequest.toPromise` are exported for consumers who inject a custom factory (e.g. `fake-indexeddb` in tests).
