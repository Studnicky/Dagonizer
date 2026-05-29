/**
 * `@noocodex/dagonizer/core` — pluggable execution primitives.
 *
 *   - `ParallelCombiners` registry + `ParallelCombiner` extension point
 *   - `GatherStrategies` registry + `GatherStrategy` extension point
 *   - `OutcomeReducers` registry + `OutcomeReducer` extension point
 *
 * Defaults register at module load; consumers extend the abstract
 * classes and add via `Registry.register(new MyClass())`.
 */

export {
  ParallelCombiner,
  ParallelCombiners,
} from './ParallelCombiners.js';
export type { ParallelResult } from './ParallelCombiners.js';

export {
  GatherStrategies,
  GatherStrategy,
} from './GatherStrategies.js';
export type { GatherExecution, GatherRecord } from './GatherStrategies.js';

export {
  OutcomeReducer,
  OutcomeReducers,
} from './OutcomeReducers.js';
export type { OutcomeRecord } from './OutcomeReducers.js';
