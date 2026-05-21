/**
 * `@noocodex/dagonizer/core` — pluggable execution primitives.
 *
 *   - `ParallelCombiners` registry + `ParallelCombiner` extension point
 *   - `FanInStrategies` registry + `FanInStrategy` extension point
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
  FanInStrategies,
  FanInStrategy,
} from './FanInStrategies.js';
export type { FanInExecution } from './FanInStrategies.js';
