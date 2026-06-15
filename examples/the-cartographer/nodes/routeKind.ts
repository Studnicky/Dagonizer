/**
 * route-event-type: per-event-type enrichment dispatch (heterogeneous routing).
 *
 * Different canonical `eventType`s need different enrichment; this node routes each
 * to ONLY the lane it needs, skipping irrelevant work:
 *   - position-ping        → 'geo-only'   : location/time only (SKIP pricing/eta)
 *   - sensor-reading       → 'sensor'     : cold-chain breach check, then leg
 *                                           (SKIP pricing/eta)
 *   - facility-scan        → 'order'      : full pricing → shipping → eta
 *   - delivery-confirmation→ 'order'      : full pricing → shipping → eta
 *   - customs-event        → 'customs'    : customs dwell (SKIP pricing/eta)
 *
 * Records the path + the per-event-type skip tallies on state.routing so the
 * parent's summarize totals the compute saved. Deterministic dispatch-map
 * routing — not a runtime callback.
 *
 * Routes 'geo-only' | 'sensor' | 'order' | 'customs'.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import type { CanonicalEvent } from '../entities/CanonicalEvent.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region route-event-type-node
type EventTypeRoute = 'geo-only' | 'sensor' | 'order' | 'customs';

const EVENT_TYPE_ROUTE: Readonly<Record<CanonicalEvent['eventType'], EventTypeRoute>> = {
  'position-ping':         'geo-only',
  'sensor-reading':        'sensor',
  'facility-scan':         'order',
  'delivery-confirmation': 'order',
  'customs-event':         'customs',
};

export class RouteKindNode extends ScalarNode<CartographerState, EventTypeRoute, CartographerServices> {
  readonly 'name' = 'route-event-type';
  readonly 'outputs' = ['geo-only', 'sensor', 'order', 'customs'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<EventTypeRoute>> {
    const route = EVENT_TYPE_ROUTE[state.canonical.eventType];
    // The 'order' lane runs pricing + eta; every other lane skips them.
    const runsOrder = route === 'order';

    state.routing = {
      ...state.routing,
      'path':           route,
      'pricingRun':     runsOrder,
      'pricingSkipped': !runsOrder,
      'etaRun':         runsOrder,
      'etaSkipped':     !runsOrder,
      'coldChainRun':   route === 'sensor',
      'customsDwellRun': route === 'customs',
    };

    return NodeOutputBuilder.of(route);
  }
}

export const routeKind = new RouteKindNode();
// #endregion route-event-type-node
