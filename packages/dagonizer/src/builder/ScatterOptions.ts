/**
 * ScatterOptions: static factory that materialises build-time defaults for
 * `ScatterOptionsType`.
 *
 * Two of the optional fields on `ScatterOptionsType` have static
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
 *   ⦿ `execution`  — defaults to `{ mode: 'item', concurrency: 1 }` at
 *                     runtime (`ScatterNodeDefaults.executionPolicy`); there
 *                     is no meaningful static default to materialise at build time.
 *   ⦿ `inputs`     — absence is semantically meaningful ("no clone seeding");
 *                     materialising an empty `stateMapping` object changes the
 *                     wire shape without adding information.
 *   ⦿ `container`  — absence means "run in-process"; a present string is a
 *                     role name; there is no meaningful static default.
 *
 * Callers: `DAGBuilder.scatter` calls `ScatterOptions.resolve(options)` before
 * constructing the `ScatterNode` so every builder-produced placement carries
 * the resolved `itemKey` and `reducer` without a runtime `?? default` guard.
 */

import type { NodeStateInterface } from '../NodeStateBase.js';

import type { ScatterOptionsType } from './DAGBuilder.js';

/** Default metadata key written to each clone before its body runs. */
export const SCATTER_ITEM_KEY_DEFAULT = 'currentItem' as const;

/** Default outcome-reducer name applied after all clones complete. */
export const SCATTER_REDUCER_DEFAULT = 'aggregate' as const;

/** Co-located defaults for the two statically-defaultable scatter fields. */
const SCATTER_OPTION_DEFAULTS = {
  'itemKey': SCATTER_ITEM_KEY_DEFAULT,
  'reducer': SCATTER_REDUCER_DEFAULT,
} as const;

/**
 * Resolved `ScatterOptionsType` with `itemKey` and `reducer`
 * guaranteed present. All other optional fields retain their optionality.
 */
export type ResolvedScatterOptionsType<TState extends NodeStateInterface> =
  ScatterOptionsType<TState> & {
    itemKey: string;
    reducer: string;
  };

/**
 * Static factory for scatter placement options.
 *
 * `ScatterOptions.resolve(partial)` fills `itemKey` and `reducer`
 * with their static defaults when the caller omits them, returning a
 * `ResolvedScatterOptionsType<TState>` that is safe to spread onto a `ScatterNode`
 * without a downstream `?? 'default'` guard.
 */
export class ScatterOptions {
  private constructor() { /* static class */ }

  /**
   * Resolve scatter placement options with static defaults applied.
   *
   * @param partial - Caller-supplied options.
   * @returns Options with `itemKey` and `reducer` always present.
   */
  static resolve<TState extends NodeStateInterface>(
    partial: ScatterOptionsType<TState>,
  ): ResolvedScatterOptionsType<TState> {
    // Resolve only the statically-defaultable fields via spread; all other
    // fields (execution, inputs, container) pass through from partial.
    const { itemKey, reducer } = {
      ...SCATTER_OPTION_DEFAULTS,
      ...(partial.itemKey !== undefined ? { 'itemKey': partial.itemKey } : {}),
      ...(partial.reducer !== undefined ? { 'reducer': partial.reducer } : {}),
    };
    return {
      ...partial,
      itemKey,
      reducer,
    };
  }
}
