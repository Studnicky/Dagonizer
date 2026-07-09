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
import { ShippingCalculator } from '../services.ts';

import { MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region enrich-leg-node
export class EnrichLegNode extends MonadicNode<CartographerState, 'leg-measured'> {
  readonly '@id' = 'urn:noocodec:node:enrich-leg';
  readonly 'name' = 'enrich-leg';
  readonly 'outputs' = ['leg-measured'] as const;

  override get outputSchema(): Record<'leg-measured', SchemaObjectType> {
    return {
      'leg-measured': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'leg-measured', CartographerState>> {
    for (const item of batch) {
      const norm = item.state.normalized;
      // Seq 0 starts at the origin (legFrom == origin), so its leg is the first
      // hop. Distance is min-clamped to ~1 km by ShippingCalculator.
      item.state.legKm = ShippingCalculator.distanceKm(
        norm.legFromLat,
        norm.legFromLng,
        norm.latitude,
        norm.longitude,
      );
    }
    return RoutedBatch.create('leg-measured', batch);
  }
}
// #endregion enrich-leg-node

export const enrichLeg = new EnrichLegNode();
