# @studnicky/dagonizer-store-opfs

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

- `OpfsStore` and `OpfsCheckpointStore` deliver Origin Private File System persistence for `@studnicky/dagonizer`. One file per entry, async `createWritable` path (main-thread compatible), streaming-native `performEntriesStream` via the directory entries iterator. Per-key update serialization via a chained Promise map. The synchronous `createSyncAccessHandle` path (Worker-only) is documented but not used. Real-OPFS smoke testing is deferred to the S3 browser harness.
