# @studnicky/dagonizer-store-eventlog

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

### Added

- Adds `"node"` export condition to the `.` entry for bundler target selection.

### Changed

- `EventLogStore.#latest` returns the honest stored type `JsonValueType | undefined` instead of an unchecked `as T` per call site. A single documented caller-expectation boundary cast lives in `#latestAs`, through which both `performGet` and the atomic `update` override read; it is the store's only unchecked cast.
- `EventLogStore` migrates to the streaming seam (`performEntriesStream` / `performRestoreEntry` / `performClear`) introduced in `@studnicky/dagonizer` S-P1. `performEntriesStream` compacts the append-log to a last-write-wins map then yields entries. `performClear` truncates the in-memory log. The array-form `snapshot()` and `restore()` behavior is unchanged.
- Isomorphic split: the in-memory append-log core is extracted into `AppendLogStore`, a new browser-safe class that imports zero `node:*` modules. `EventLogStore` extends `AppendLogStore` and adds file persistence via a dynamic `await import('node:fs/promises')` inside `connect()` — never a top-level import — keeping the static module graph of the in-memory path free of Node-only modules. Existing Node consumers keep `EventLogStore` as their entry point unchanged. `AppendLogStore` is exported from the package root for browser and isomorphic consumers.
- `AppendLogStore.events()` streaming accessor yields every entry in the append log (including tombstones) as an `AsyncIterable<EventLogEntryType>`, enabling streaming-first auditing without materializing the full array.

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
