/**
 * geo-baseline: writes the empty-resolution baseline when the scatter source
 * array is empty and the engine short-circuits without invoking the gather.
 *
 * The scatter executor skips the gather entirely (initial/reduce/finalize never
 * run) when `state.geoSignals` is empty. This node is wired to the scatter's
 * `empty` outcome so `state.resolvedGeo` and `state.geoContext` are always
 * populated before `resolved` routes to the parent's next node.
 *
 * Values match `GeoBaseline.resolvedGeo()` / `GeoBaseline.geoContext()` — the
 * same baseline used by `GeoWeightedFusionGather` on the zero-candidates path.
 * Browser-safe: pure object literals, no Node.js APIs.
 */

import type { CartographerState } from '../../CartographerState.ts';
import { GeoBaseline } from '../../core/GeoBaseline.ts';

import {
  MonadicNode,
  RoutedBatch,
  type Batch,
  type NodeContextType,
  type RoutedBatchType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

// #region geo-baseline-node
export class GeoBaselineNode extends MonadicNode<CartographerState, 'baselined'> {
  readonly '@id' = 'urn:noocodec:node:geo-baseline';
  readonly 'name' = 'geo-baseline';
  readonly 'outputs' = ['baselined'] as const;

  override get outputSchema(): Record<'baselined', SchemaObjectType> {
    return {
      'baselined': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'baselined', CartographerState>> {
    for (const item of batch) {
      item.state.resolvedGeo = GeoBaseline.resolvedGeo();
      item.state.geoContext  = GeoBaseline.geoContext();
    }
    return RoutedBatch.create('baselined', batch);
  }
}

export const geoBaseline = new GeoBaselineNode();
// #endregion geo-baseline-node
