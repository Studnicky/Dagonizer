# @studnicky/dagonizer-store-opfs

## [unreleased]

### Minor Changes

- `OpfsStore` and `OpfsCheckpointStore` deliver Origin Private File System persistence for `@studnicky/dagonizer`. One file per entry, async `createWritable` path (main-thread compatible), streaming-native `performEntriesStream` via the directory entries iterator. Per-key update serialization via a chained Promise map. The synchronous `createSyncAccessHandle` path (Worker-only) is documented but not used. Real-OPFS smoke testing is deferred to the S3 browser harness.
