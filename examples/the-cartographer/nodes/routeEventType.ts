/**
 * routeEventType: dispatches state.canonicalVariant.eventType to one of FIVE
 * per-type outputs (one per CanonicalEventVariant member). Sets state.routing
 * path and run/skip flags so downstream records carry correct lane metadata
 * (matches the routeKind behavior for CanonicalEvent variants).
 *
 * Lane mapping:
 *   position-ping         → 'geo-only'  (geometry only; no order/sensor/customs)
 *   sensor-reading        → 'sensor'    (cold-chain telemetry; no pricing/ETA)
 *   customs-event         → 'customs'   (dwell + release; no pricing/ETA)
 *   facility-scan         → 'order'     (full pricing, ETA, recipient PII)
 *   delivery-confirmation → 'order'     (terminal order-lane event; no pricing/ETA —
 *                                        those are computed at facility-scan/dispatch)
 *
 * Routes 'position-ping' | 'sensor-reading' | 'customs-event' | 'facility-scan'
 * | 'delivery-confirmation'.
 */

import type { CartographerState } from '../CartographerState.ts';
import { CanonicalEventVariantBuilder } from '../entities/CanonicalEvent.ts';
import type { CanonicalEventVariant } from '../entities/CanonicalEvent.ts';

import { Batch, MonadicNode, NodeOutput } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, NodeOutputType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region route-event-type-variant-node
type VariantRoute = CanonicalEventVariant['eventType'];

const VARIANT_ROUTE: Readonly<Record<VariantRoute, VariantRoute>> = {
  'position-ping':         'position-ping',
  'sensor-reading':        'sensor-reading',
  'customs-event':         'customs-event',
  'facility-scan':         'facility-scan',
  'delivery-confirmation': 'delivery-confirmation',
};

/** Routing path per event type. */
type RoutingPath = CartographerState['routing']['path'];

const ROUTING_PATH: Readonly<Record<VariantRoute, RoutingPath>> = {
  'position-ping':         'geo-only',
  'sensor-reading':        'sensor',
  'customs-event':         'customs',
  'facility-scan':         'order',
  'delivery-confirmation': 'order',
};

export class RouteEventTypeNode extends MonadicNode<CartographerState, VariantRoute> {
  readonly '@id' = 'urn:noocodec:node:route-event-type-variant';
  readonly 'name' = 'route-event-type-variant';
  readonly 'outputs' = ['position-ping', 'sensor-reading', 'customs-event', 'facility-scan', 'delivery-confirmation'] as const;

  override get outputSchema(): Record<'position-ping' | 'sensor-reading' | 'customs-event' | 'facility-scan' | 'delivery-confirmation', SchemaObjectType> {
    return {
      'position-ping':         { 'type': 'object' },
      'sensor-reading':        { 'type': 'object' },
      'customs-event':         { 'type': 'object' },
      'facility-scan':         { 'type': 'object' },
      'delivery-confirmation': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<VariantRoute, CartographerState>> {
    const acc = new Map<VariantRoute, ItemType<CartographerState>[]>();

    for (const item of batch) {
      const result = this.routeItem(item.state);
      for (const error of result.errors) {
        item.state.collectError(error);
      }
      const bucket = acc.get(result.output);
      if (bucket === undefined) {
        acc.set(result.output, [item]);
      } else {
        bucket.push(item);
      }
    }

    const routed = new Map<VariantRoute, Batch<CartographerState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }

  private routeItem(state: CartographerState): NodeOutputType<VariantRoute> {
    const raw = state.getMetadata('canonical-event');
    const t = CanonicalEventVariantBuilder.is(raw) ? raw.eventType : state.canonicalVariant.eventType;

    const path = ROUTING_PATH[t];
    // facility-scan is the only event type that runs full order enrichment
    // (pricing + shipping + ETA). delivery-confirmation is 'order' path but skips
    // enrichment — it records the delivery fact, not a new cost/ETA estimate.
    const runsOrderEnrichment = t === 'facility-scan';
    state.routing = {
      ...state.routing,
      'path':            path,
      'pricingRun':      runsOrderEnrichment,
      'pricingSkipped':  !runsOrderEnrichment,
      'etaRun':          runsOrderEnrichment,
      'etaSkipped':      !runsOrderEnrichment,
      'coldChainRun':    path === 'sensor',
      'customsDwellRun': path === 'customs',
    };

    return NodeOutput.create(VARIANT_ROUTE[t]);
  }
}

export const routeEventType = new RouteEventTypeNode();
// #endregion route-event-type-variant-node
