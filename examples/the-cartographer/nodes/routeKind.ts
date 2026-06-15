/**
 * route-kind: per-kind enrichment dispatch (heterogeneous routing).
 *
 * Different canonical `kind`s need different enrichment; this node routes each
 * to ONLY the lane it needs, skipping irrelevant work:
 *   - position-ping        → 'geo-only'   : location/time only (SKIP pricing/eta)
 *   - sensor-reading       → 'sensor'     : cold-chain breach check, then leg
 *                                           (SKIP pricing/eta)
 *   - facility-scan        → 'order'      : full pricing → shipping → eta
 *   - delivery-confirmation→ 'order'      : full pricing → shipping → eta
 *   - customs-event        → 'customs'    : customs dwell (SKIP pricing/eta)
 *
 * Records the path + the per-kind skip tallies on state.routing so the parent's
 * summarize totals the compute saved. Deterministic dispatch-map routing — not a
 * runtime callback.
 *
 * Routes 'geo-only' | 'sensor' | 'order' | 'customs'.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import type { CanonicalEvent } from '../entities/CanonicalEvent.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeInterface, type NodeOutputInterface,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';

// #region route-kind-node
type KindRoute = 'geo-only' | 'sensor' | 'order' | 'customs';

const KIND_ROUTE: Readonly<Record<CanonicalEvent['kind'], KindRoute>> = {
  'position-ping':         'geo-only',
  'sensor-reading':        'sensor',
  'facility-scan':         'order',
  'delivery-confirmation': 'order',
  'customs-event':         'customs',
};

export class RouteKindNode implements NodeInterface<CartographerState, KindRoute, CartographerServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly 'name' = 'route-kind';
  readonly 'outputs' = ['geo-only', 'sensor', 'order', 'customs'] as const;

  async execute(state: CartographerState, context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<KindRoute>> {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const route = KIND_ROUTE[state.canonical.kind];
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
// #endregion route-kind-node
