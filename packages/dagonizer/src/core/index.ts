/**
 * `@studnicky/dagonizer/core`: pluggable execution primitives.
 *
 *   - `GatherStrategies` registry + `GatherStrategy` extension point
 *   - `OutcomeReducers` registry + `OutcomeReducer` extension point
 *
 * Defaults register at module load; consumers extend the abstract
 * classes and add via `Registry.register(new MyClass())`.
 */

export {
  GatherStrategies,
  GatherStrategy,
} from './GatherStrategies.js';

export {
  OutcomeReducer,
  OutcomeReducers,
} from './OutcomeReducers.js';

// `GatherExecution`/`GatherRecord`/`OutcomeRecord` are adapter contracts.
// They have a single authoritative subpath — `@studnicky/dagonizer/contracts`.
// `./core` no longer re-exports them.

// `Batch`/`Item`/`ItemId`/`RoutedBatch` are entities. They live at
// `entities/batch/` so `contracts/` can import them inward without reaching up
// into `core/`; re-exported here to preserve the `./core` public subpath.
export { Batch } from '../entities/batch/Batch.js';
export type { Item, ItemId } from '../entities/batch/Item.js';
export { RoutedBatchBuilder } from '../entities/batch/RoutedBatch.js';
export type { RoutedBatch } from '../entities/batch/RoutedBatch.js';
export { MonadicNode } from './MonadicNode.js';
export { ScalarNode } from './ScalarNode.js';
export { NodeRunner } from './NodeRunner.js';
