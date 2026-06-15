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

import { NodeOutputBuilder, type NodeContextInterface, type NodeInterface, type NodeOutputInterface,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';

// #region enrich-pricing-node
export class EnrichPricingNode implements NodeInterface<CartographerState, 'priced', CartographerServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly 'name' = 'enrich-pricing';
  readonly 'outputs' = ['priced'] as const;

  async execute(state: CartographerState, context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'priced'>> {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    state.pricedOrder = PricingCatalog.order(state.normalized.lineItems);
    return NodeOutputBuilder.of('priced');
  }
}
// #endregion enrich-pricing-node

export const enrichPricing = new EnrichPricingNode();
