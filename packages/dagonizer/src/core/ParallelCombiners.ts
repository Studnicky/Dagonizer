/**
 * ParallelCombiners: pluggable strategy registry that decides the
 * group-level output of a `parallel` placement.
 *
 * A `ParallelCombiner` is a class with a `name` and a `combine` method.
 * The dispatcher resolves a combiner by `name` from the registry and
 * calls `.combine(outputs, results, state)` once every concurrent node
 * has reported.
 *
 * Three defaults register at module load: `all-success`, `any-success`,
 * `collect`. Consumers extend `ParallelCombiner` and call
 * `ParallelCombiners.register(new MyCombiner())` to add their own.
 *
 * @example
 * ```ts
 * class WeightedSuccessCombiner extends ParallelCombiner {
 *   readonly name = 'weighted-success';
 *   combine(outputs: readonly string[]): string {
 *     const successes = outputs.filter((o) => o === 'success').length;
 *     return successes / outputs.length >= 0.66 ? 'success' : 'error';
 *   }
 * }
 *
 * ParallelCombiners.register(new WeightedSuccessCombiner());
 * ```
 */

import { DAGError } from '../errors/DAGError.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

/**
 * One per-node result handed to a `ParallelCombiner`. Carries the output
 * the node reported and the placement's name (for `collect`-style
 * combiners that index per-node).
 */
export interface ParallelResult {
  readonly opResult: { readonly output: string };
  readonly node: { readonly name: string };
}

/**
 * Extension point for parallel-group combine strategies.
 *
 * Subclass and override `combine`. The class registers in
 * `ParallelCombiners` under its `name`; the dispatcher resolves it via
 * `ParallelCombiners.resolve(name)` when a `parallel` placement reports.
 */
export abstract class ParallelCombiner {
  /** Wire-shape identifier; matches the placement's `combine` field. */
  abstract readonly name: string;

  /**
   * Reduce the per-node outputs into a single group-level output name.
   * The dispatcher routes on the returned value via the placement's
   * `outputs` map.
   *
   * Combiners may also mutate `state` (e.g. `state.setMetadata(...)`)
   * to expose the underlying per-node data to downstream nodes.
   */
  abstract combine(
    outputs: readonly string[],
    results: readonly ParallelResult[],
    state: NodeStateInterface,
  ): string;
}

class AllSuccessCombiner extends ParallelCombiner {
  readonly name = 'all-success';
  combine(outputs: readonly string[]): string {
    return outputs.every((output) => output === 'success') ? 'success' : 'error';
  }
}

class AnySuccessCombiner extends ParallelCombiner {
  readonly name = 'any-success';
  combine(outputs: readonly string[]): string {
    return outputs.some((output) => output === 'success') ? 'success' : 'error';
  }
}

class CollectCombiner extends ParallelCombiner {
  readonly name = 'collect';
  combine(
    _outputs: readonly string[],
    results: readonly ParallelResult[],
    state: NodeStateInterface,
  ): string {
    state.setMetadata(
      'parallelOutputs',
      Object.fromEntries(results.map(({ opResult, node }) => [node.name, opResult.output])),
    );
    return 'success';
  }
}

/**
 * Static registry of `ParallelCombiner` instances. Defaults register at
 * module load. Consumers add more via `ParallelCombiners.register`.
 */
export class ParallelCombiners {
  private constructor() { /* static class */ }

  private static readonly registry = new Map<string, ParallelCombiner>([
    ['all-success', new AllSuccessCombiner()],
    ['any-success', new AnySuccessCombiner()],
    ['collect', new CollectCombiner()],
  ]);

  /**
   * Register a combiner. Replaces any prior registration with the same
   * `name`: last-write-wins, matching the `nodes` and `dags` registry
   * semantics on the dispatcher.
   */
  static register(combiner: ParallelCombiner): void {
    ParallelCombiners.registry.set(combiner.name, combiner);
  }

  /**
   * Resolve a combiner by name. Throws `DAGError` when no combiner is
   * registered under `name`.
   */
  static resolve(name: string): ParallelCombiner {
    const combiner = ParallelCombiners.registry.get(name);
    if (combiner === undefined) {
      throw new DAGError(`Unknown parallel combine strategy: ${name}`);
    }
    return combiner;
  }

  /** Names of every registered combiner, in registration order. */
  static list(): readonly string[] {
    return [...ParallelCombiners.registry.keys()];
  }
}
