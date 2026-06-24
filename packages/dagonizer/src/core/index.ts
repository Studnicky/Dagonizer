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

// `GatherExecutionType`/`GatherRecordType`/`OutcomeRecordType` are adapter contracts.
// They have a single authoritative subpath — `@studnicky/dagonizer/contracts`.
// `./core` no longer re-exports them.

// `Batch`/`Item`/`ItemIdType`/`RoutedBatchType` are entities. They live at
// `entities/batch/` so `contracts/` can import them inward without reaching up
// into `core/`; re-exported here to preserve the `./core` public subpath.
export { Batch } from '../entities/batch/Batch.js';
export type { ItemType, ItemIdType } from '../entities/batch/Item.js';
export { RoutedBatchBuilder } from '../entities/batch/RoutedBatchType.js';
export type { RoutedBatchType } from '../entities/batch/RoutedBatchType.js';
export { MonadicNode } from './MonadicNode.js';
export { PlaceholderNode } from './PlaceholderNode.js';
export { ScalarNode } from './ScalarNode.js';
export { LoggedScalarNode } from './LoggedScalarNode.js';
export type { LoggedScalarNodeOptionsType } from './LoggedScalarNode.js';
export { NodeRunner } from './NodeRunner.js';
