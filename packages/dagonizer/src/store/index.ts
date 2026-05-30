/**
 * @noocodex/dagonizer/store: shared key-value store public surface.
 *
 * Plugin authors implement `Store` (typically by extending `BaseStore`)
 * to swap the backing without touching DAG topology. `MemoryStore` is the
 * reference implementation and the default for single-process DAG runs.
 */

export { BaseStore } from './BaseStore.js';
export type { BaseStoreOptions } from './BaseStore.js';

export { MemoryStore } from './MemoryStore.js';

export { StoreError } from './StoreError.js';
export type { StoreErrorClassification } from './StoreError.js';

export { TypedStore } from './TypedStore.js';

// Re-export the contract from /contracts for ergonomic single-import:
export type { Store } from '../contracts/Store.js';
export type { StoreSnapshot, StoreSnapshotEntry } from '../contracts/Snapshottable.js';
