/**
 * enrichShipping: batch-native shipping cost node for the order lane.
 *
 * Shipping is a shipment-level fact: distance is origin → destination (the full
 * journey), not the current leg. Every scan of a journey computes the same
 * quote deterministically. Reads state.normalized origin/dest coords + carrier +
 * weight + serviceTier, writes state.shippingQuote per item.
 *
 * Implemented as a MonadicNode for batch-native processing: a single
 * execute call covers the whole batch, amortising carrier rate table
 * lookups across all items in one pass rather than dispatching N
 * separate per-item base-class iterations.
 *
 * Always routes 'shipping-quoted'.
 */

import type { CartographerState } from '../CartographerState.ts';
import { ShippingCalculator } from '../services.ts';

import type { NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';
import { MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, RoutedBatchType } from '@studnicky/dagonizer';

// #region enrich-shipping-node
export class EnrichShippingNode extends MonadicNode<CartographerState, 'shipping-quoted'> {
  readonly 'name' = 'enrich-shipping';
  readonly 'outputs' = ['shipping-quoted'] as const;

  override get outputSchema(): Record<'shipping-quoted', SchemaObjectType> {
    return {
      'shipping-quoted': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'shipping-quoted', CartographerState>> {
    for (const item of batch) {
      const norm = item.state.normalized;
      const distanceKm = ShippingCalculator.distanceKm(
        norm.originLat,
        norm.originLng,
        norm.destLat,
        norm.destLng,
      );
      item.state.shippingQuote = ShippingCalculator.quote(
        distanceKm,
        norm.weightGrams,
        norm.serviceTier,
        norm.carrierId,
      );
    }
    return RoutedBatch.create('shipping-quoted', batch);
  }
}
// #endregion enrich-shipping-node

export const enrichShipping = new EnrichShippingNode();
