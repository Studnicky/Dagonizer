/**
 * enrichLegBatch: batch counterpart to enrichLeg. Computes the leg distance
 * (legFrom → current scan) for every item in state.normalizedBatch in one pass,
 * writing state.legKmBatch in the same index-parallel layout.
 *
 * Each item's legKm is the haversine distance from the previous scan's coords
 * (norm.legFromLat/Lng) to this scan's coords. Σ legKm across a journey's scans
 * equals the path distance the per-journey summary reports.
 *
 * Always routes 'leg-measured'.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { ShippingCalculator } from '../services.ts';

import {
  NodeOutputBuilder,
  type NodeContextInterface,
  type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region enrich-leg-batch-node
export class EnrichLegBatchNode extends ScalarNode<CartographerState, 'leg-measured', CartographerServices> {
  readonly 'name' = 'enrich-leg-batch';
  readonly 'outputs' = ['leg-measured'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'leg-measured'>> {
    state.legKmBatch = [];

    for (let i = 0; i < state.normalizedBatch.length; i++) {
      // Skip masked items (invalid coords); push 0 as sentinel to preserve alignment.
      if (state.batchSkipMask[i] === true) {
        state.legKmBatch.push(0);
        continue;
      }
      const norm = state.normalizedBatch[i];
      if (norm === undefined) { state.legKmBatch.push(0); continue; }
      // Seq 0 starts at the origin (legFrom == origin), so its leg is the first
      // hop. Distance is min-clamped to ~1 km by ShippingCalculator.
      state.legKmBatch.push(ShippingCalculator.distanceKm(
        norm.legFromLat,
        norm.legFromLng,
        norm.latitude,
        norm.longitude,
      ));
    }

    return NodeOutputBuilder.of('leg-measured');
  }
}

export const enrichLegBatch = new EnrichLegBatchNode();
// #endregion enrich-leg-batch-node
