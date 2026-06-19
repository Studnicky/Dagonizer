/**
 * routeEventType: dispatches state.canonicalVariant.eventType to one of FIVE
 * per-type outputs (one per CanonicalEventVariant member). Sets state.routing
 * path and run/skip flags so downstream records carry correct lane metadata
 * (mirrors what routeKind did for the legacy fat-CanonicalEvent pipeline).
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
import type { CartographerServices } from '../CartographerServices.ts';
import type { CanonicalEventVariant } from '../entities/CanonicalEvent.ts';

import { NodeOutputBuilder, type NodeContextType, type NodeOutputType,
  ScalarNode,
} from '@studnicky/dagonizer';

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

export class RouteEventTypeNode extends ScalarNode<CartographerState, VariantRoute, CartographerServices> {
  readonly 'name' = 'route-event-type-variant';
  readonly 'outputs' = ['position-ping', 'sensor-reading', 'customs-event', 'facility-scan', 'delivery-confirmation'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextType<CartographerServices>): Promise<NodeOutputType<VariantRoute>> {
    const variant = state.getMetadata<CanonicalEventVariant>('canonical-event');
    const t = (variant !== null && variant !== undefined) ? variant.eventType : state.canonicalVariant.eventType;

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

    return NodeOutputBuilder.of(VARIANT_ROUTE[t]);
  }
}

export const routeEventType = new RouteEventTypeNode();
// #endregion route-event-type-variant-node
