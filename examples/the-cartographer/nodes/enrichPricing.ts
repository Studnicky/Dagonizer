/**
 * enrichPricing: batch-native pricing node for the order lane.
 *
 * Reads state.normalized.lineItems for each item in the batch, calls
 * PricingCatalog.order to resolve each productId to name/category/price,
 * sums the basket, and FX-normalises the subtotal to USD minor units
 * (integer cents). Writes state.pricedOrder per item.
 *
 * Implemented as a MonadicNode for batch-native processing: a single
 * execute call covers the whole batch, amortising catalog map lookups
 * and FX rate table access across all items in one pass rather than
 * dispatching N separate ScalarNode iterations.
 *
 * Always routes 'priced' — unknown productIds resolve to a 0-cost entry
 * rather than routing to rejected (the pipeline continues; bad products
 * show subtotal 0).
 */

import type { CartographerState } from '../CartographerState.ts';
import { PricingCatalog } from '../services.ts';

import type { NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';
import { MonadicNode, RoutedBatchBuilder } from '@studnicky/dagonizer';
import type { Batch, RoutedBatchType } from '@studnicky/dagonizer';

// #region enrich-pricing-node
export class EnrichPricingNode extends MonadicNode<CartographerState, 'priced'> {
  readonly 'name' = 'enrich-pricing';
  readonly 'outputs' = ['priced'] as const;

  override get outputSchema(): Record<'priced', SchemaObjectType> {
    return {
      'priced': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'priced', CartographerState>> {
    for (const item of batch) {
      item.state.pricedOrder = PricingCatalog.order(item.state.normalized.lineItems);
    }
    return RoutedBatchBuilder.of('priced', batch);
  }
}
// #endregion enrich-pricing-node

export const enrichPricing = new EnrichPricingNode();
