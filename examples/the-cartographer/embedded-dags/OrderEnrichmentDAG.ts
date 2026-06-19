/**
 * OrderEnrichmentDAG: the order-lane value enrichment sub-DAG.
 *
 * Runs only for 'facility-scan' and 'delivery-confirmation' events (the order
 * lane, as dispatched by route-event-type). The three nodes form a tight value-chain:
 *   enrich-pricing  — price the basket: lineItems → PricedOrder + FX-normalised USD
 *   enrich-shipping — haversine origin→dest distance + carrier rate → ShippingQuote
 *   enrich-eta      — transit time, ETA vs SLA promise → DeliveryEstimate
 *
 *   enrich-pricing
 *     └─priced─► enrich-shipping
 *   enrich-shipping
 *     └─shipping-quoted─► enrich-eta
 *   enrich-eta
 *     └─eta-estimated─► enriched  (TerminalNode completed)
 *
 * Embedded in event-pipeline's order lane:
 *   .embeddedDAG('order-enrichment', 'order-enrichment',
 *     { 'success': 'enrich-leg', 'error': 'enrich-leg' },
 *     {
 *       'inputs':  { 'normalized': 'normalized' },
 *       'outputs': { 'pricedOrder': 'pricedOrder', 'shippingQuote': 'shippingQuote', 'deliveryEstimate': 'deliveryEstimate', 'routing': 'routing' },
 *     })
 *
 * The child state is seeded with the parent's normalized scan (which carries
 * lineItems, origin/dest coords, carrier, serviceTier, and timing). On
 * completion, the three enriched entities and the updated routing record are
 * copied back to the parent clone for enrich-leg and aggregate-event to consume.
 */

// #region order-enrichment-dag
import { enrichPricing }  from '../nodes/enrichPricing.ts';
import { enrichShipping } from '../nodes/enrichShipping.ts';
import { enrichEta }      from '../nodes/enrichEta.ts';
import type { CartographerState }   from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';
import type { DAGType }              from '@studnicky/dagonizer/entities';

export const orderEnrichmentDAG: DAGType = new DAGBuilder('order-enrichment', '1.0')

  // 1. enrich-pricing: basket → PricedOrder with FX normalisation.
  .node('enrich-pricing', enrichPricing, {
    'priced': 'enrich-shipping',
  })

  // 2. enrich-shipping: origin→dest haversine + carrier rate → ShippingQuote.
  .node('enrich-shipping', enrichShipping, {
    'shipping-quoted': 'enrich-eta',
  })

  // 3. enrich-eta: SLA promise vs disrupted ETA → DeliveryEstimate.
  .node('enrich-eta', enrichEta, {
    'eta-estimated': 'enriched',
  })

  // Terminal
  .terminal('enriched', { outcome: 'completed' })

  .build();

export const orderEnrichmentBundle: DispatcherBundleType<CartographerState, CartographerServices> = {
  'nodes': [enrichPricing, enrichShipping, enrichEta],
  'dags':  [orderEnrichmentDAG],
};
// #endregion order-enrichment-dag
