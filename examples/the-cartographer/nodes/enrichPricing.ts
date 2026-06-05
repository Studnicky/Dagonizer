/**
 * enrichPricing: prices the basket of line items and writes a PricedOrder onto state.
 *
 * Reads state.normalized.lineItems, calls PricingCatalog.order to resolve each
 * productId to name/category/price, sums the basket, and FX-normalises the
 * subtotal to USD minor units (integer cents). Writes state.pricedOrder.
 *
 * Always routes 'priced' — unknown productIds resolve to a 0-cost entry rather
 * than routing to rejected (the pipeline continues; bad products show subtotal 0).
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { PricingCatalog } from '../services.ts';

import type { NodeInterface } from '@noocodex/dagonizer';

// #region enrich-pricing-node
export const enrichPricing: NodeInterface<CartographerState, 'priced', CartographerServices> = {
  'name': 'enrich-pricing',
  'outputs': ['priced'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    state.pricedOrder = PricingCatalog.order(state.normalized.lineItems);
    return { 'output': 'priced' };
  },
};
// #endregion enrich-pricing-node
