/**
 * `@noocodex/dagonizer/core`: pluggable execution primitives.
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
export type { GatherExecution, GatherRecord } from './GatherStrategies.js';

export {
  OutcomeReducer,
  OutcomeReducers,
} from './OutcomeReducers.js';
export type { OutcomeRecord } from './OutcomeReducers.js';
