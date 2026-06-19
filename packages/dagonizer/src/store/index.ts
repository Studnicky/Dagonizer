/**
 * @studnicky/dagonizer/store: shared key-value store public surface.
 *
 * Plugin authors implement `StoreInterface` (typically by extending `BaseStore`)
 * to swap the backing without touching DAG topology. `MemoryStore` is the
 * reference implementation and the default for single-process DAG runs.
 */

export { BASE_STORE_DEFAULTS, BaseStore } from './BaseStore.js';
export type { BaseStoreOptionsType } from './BaseStore.js';

export { MemoryStore } from './MemoryStore.js';

export { StoreError } from './StoreError.js';
export type { StoreErrorClassificationType } from './StoreError.js';

export { TypedStore } from './TypedStore.js';

// Re-export the contract from /contracts for ergonomic single-import:
export type { StoreInterface } from '../contracts/StoreInterface.js';
export type { StoreSnapshotType, StoreSnapshotEntryType } from '../contracts/SnapshottableInterface.js';
