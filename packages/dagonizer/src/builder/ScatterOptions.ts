/**
 * ScatterOptions: static factory that materialises build-time defaults for
 * `ScatterOptionsInterface`.
 *
 * Two of the five optional fields on `ScatterOptionsInterface` have static
 * defaults that are known at build time and belong on the produced `ScatterNode`
 * wire shape immediately:
 *
 *   ⦿ `itemKey`   — defaults to `'currentItem'` (the metadata key each clone
 *                   reads for the current item). Static string; runtime-default
 *                   at `Dagonizer.executeScatter` is the canonical source but
 *                   materialising it on the placement makes the default visible
 *                   in the serialised DAG.
 *   ⦿ `reducer`   — defaults to `'aggregate'` (the outcome-reduction strategy).
 *                   Static string; same reasoning as `itemKey`.
 *
 * Three fields are intentionally left optional:
 *
 *   ⦿ `concurrency` — defaults to `source.length` at runtime; the array is
 *                     not available at build time, so no static default exists.
 *   ⦿ `inputs`     — absence is semantically meaningful ("no clone seeding");
 *                     materialising an empty `stateMapping` object changes the
 *                     wire shape without adding information.
 *   ⦿ `container`  — absence means "run in-process"; a present string is a
 *                     role name; there is no meaningful static default.
 *
 * Callers: `DAGBuilder.scatter` calls `ScatterOptions.from(options)` before
 * constructing the `ScatterNode` so every builder-produced placement carries
 * the resolved `itemKey` and `reducer` without the runtime `?? default` guard.
 */

import type { NodeStateInterface } from '../NodeStateBase.js';

import type { ScatterOptionsInterface } from './DAGBuilder.js';

/** Default metadata key written to each clone before its body runs. */
export const SCATTER_ITEM_KEY_DEFAULT = 'currentItem' as const;

/** Default outcome-reducer name applied after all clones complete. */
export const SCATTER_REDUCER_DEFAULT = 'aggregate' as const;

/**
 * Resolved `ScatterOptionsInterface` with `itemKey` and `reducer` guaranteed
 * present. All other optional fields retain their optionality.
 */
export type ResolvedScatterOptions<TState extends NodeStateInterface> =
  ScatterOptionsInterface<TState> & {
    readonly itemKey: string;
    readonly reducer: string;
  };

/**
 * Static factory for scatter placement options.
 *
 * `ScatterOptions.from(partial)` fills `itemKey` and `reducer` with their
 * static defaults when the caller omits them, returning a
 * `ResolvedScatterOptions<TState>` that is safe to spread onto a `ScatterNode`
 * without a downstream `?? 'default'` guard.
 */
export class ScatterOptions {
  private constructor() { /* static class */ }

  /**
   * Materialise scatter placement options with static defaults applied.
   *
   * @param partial - Caller-supplied options. `gather` is required.
   * @returns Options with `itemKey` and `reducer` always present.
   */
  static from<TState extends NodeStateInterface>(
    partial: ScatterOptionsInterface<TState>,
  ): ResolvedScatterOptions<TState> {
    return {
      ...partial,
      'itemKey': partial.itemKey ?? SCATTER_ITEM_KEY_DEFAULT,
      'reducer': partial.reducer ?? SCATTER_REDUCER_DEFAULT,
    };
  }
}
