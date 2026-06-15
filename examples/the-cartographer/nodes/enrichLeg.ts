/**
 * enrichLeg: computes this scan's leg distance (legFrom → current scan).
 *
 * Each scan moves the entity one leg along its journey; `legKm` is the haversine
 * distance from the previous scan's coords (state.normalized.legFromLat/Lng) to
 * this scan's coords. Σ legKm across a journey's scans = the path distance the
 * per-journey summary reports. Writes state.legKm.
 *
 * Always routes 'leg-measured'.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { ShippingCalculator } from '../services.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region enrich-leg-node
export class EnrichLegNode extends ScalarNode<CartographerState, 'leg-measured', CartographerServices> {
  readonly 'name' = 'enrich-leg';
  readonly 'outputs' = ['leg-measured'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'leg-measured'>> {
    const norm = state.normalized;
    // Seq 0 starts at the origin (legFrom == origin), so its leg is the first
    // hop. Distance is min-clamped to ~1 km by ShippingCalculator.
    state.legKm = ShippingCalculator.distanceKm(
      norm.legFromLat,
      norm.legFromLng,
      norm.latitude,
      norm.longitude,
    );
    return NodeOutputBuilder.of('leg-measured');
  }
}
// #endregion enrich-leg-node

export const enrichLeg = new EnrichLegNode();
