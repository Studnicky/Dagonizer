# @studnicky/dagonizer-store-indexeddb

## [unreleased]

### Minor Changes

- `IndexedDbStore` ships as the durable default browser-store adapter for HITL/resume. Implements `BaseStore` with cursor-streamed `performEntriesStream` (no `getAll`), transactional `update` (single `readwrite` transaction for atomic RMW), and `connect`/`disconnect` for the DB open/close lifecycle. Values stored as JSON strings; codec matches SQLite and OPFS adapters. No DOM lib — IndexedDB API surface is defined via minimal structural interfaces in `IdbTypes.ts`; the `indexedDB` global is reached via `Reflect.get(globalThis, 'indexedDB')` + the `IdbFactory.is` type-predicate guard.
- `IndexedDbCheckpointStore` ships as a `CheckpointStoreInterface` implementation backed by a dedicated IndexedDB object store. Strings-only codec; same factory-injection pattern as `IndexedDbStore`.
- `IdbFactory.is` and `IdbRequest.toPromise` are exported for consumers who inject a custom factory (e.g. `fake-indexeddb` in tests).
