---
'@studnicky/dagonizer': minor
---

`MemoryCheckpointStore` now backs its entries with `@studnicky/cache`'s `LruCache<string, string>` instead of a bare `Map`, so a long-running process that never explicitly deletes checkpoints stops growing this in-process store without bound. Capacity defaults to `DEFAULT_CHECKPOINT_CAPACITY` (500 distinct checkpoint keys) and is configurable via `new MemoryCheckpointStore({ capacity })`; `MemoryCheckpointStore.defaultOptions` exposes the resolved default. `save`/`load`/`delete` keep their existing async signatures. `MEMORY_CHECKPOINT_STORE_DEFAULTS` and `MemoryCheckpointStoreOptionsType` are new exports from `@studnicky/dagonizer/checkpoint`.

`package.json` gains `@studnicky/cache` as a dependency.
