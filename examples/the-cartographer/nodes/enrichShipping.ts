/**
 * enrichShipping: shipment-level shipping cost for the whole journey.
 *
 * Shipping is a shipment-level fact: distance is origin → destination (the full
 * journey), not the current leg. Every scan of a journey computes the same
 * quote deterministically. Reads state.normalized origin/dest coords + carrier +
 * weight + serviceTier, writes state.shippingQuote.
 *
 * Always routes 'shipping-quoted'.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { ShippingCalculator } from '../services.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region enrich-shipping-node
export class EnrichShippingNode extends ScalarNode<CartographerState, 'shipping-quoted', CartographerServices> {
  readonly 'name' = 'enrich-shipping';
  readonly 'outputs' = ['shipping-quoted'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'shipping-quoted'>> {
    const norm = state.normalized;
    const distanceKm = ShippingCalculator.distanceKm(
      norm.originLat,
      norm.originLng,
      norm.destLat,
      norm.destLng,
    );
    state.shippingQuote = ShippingCalculator.quote(
      distanceKm,
      norm.weightGrams,
      norm.serviceTier,
      norm.carrierId,
    );
    return NodeOutputBuilder.of('shipping-quoted');
  }
}
// #endregion enrich-shipping-node

export const enrichShipping = new EnrichShippingNode();
