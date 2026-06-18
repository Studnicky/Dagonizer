/**
 * route-geo: conditional geo branch (the first headline skip).
 *
 * If the canonical event already carries source-resolved geo (the RICH JSON API
 * position-pings do; CSV / NDJSON / customs do not), there is no need to run the
 * grid lookup again — route to `apply-geo` (a tiny adapter) and SKIP
 * `validate-coords` / `geo-grid` / `geo-context`. Otherwise run the lookup chain.
 *
 * Records the decision on state.routing so the parent's summarize can total the
 * geo-lookup savings (no shared counters across scatter clones).
 *
 * Routes 'has-geo' (skip the lookup) or 'needs-geo' (run the lookup).
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@studnicky/dagonizer';

// #region route-geo-node
export class RouteGeoNode extends ScalarNode<CartographerState, 'has-geo' | 'needs-geo', CartographerServices> {
  readonly 'name' = 'route-geo';
  readonly 'outputs' = ['has-geo', 'needs-geo'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'has-geo' | 'needs-geo'>> {
    const geo = state.canonical.geo;
    // A source's pre-resolved geo only lets us skip the lookup when it actually
    // resolved a location — an 'UNK'/'Unmapped' placeholder (e.g. a ping whose
    // coords were out of range at the source) is NOT resolved, so it must run
    // the lookup path where validate-coords can reject the bad coords.
    const hasResolvedGeo =
      geo !== undefined &&
      geo.country.length > 0 &&
      geo.country !== 'UNK' &&
      geo.region.length > 0 &&
      geo.region !== 'Unmapped';

    if (hasResolvedGeo) {
      state.routing = { ...state.routing, 'geoLookupSkipped': true, 'geoLookupRun': false };
      return NodeOutputBuilder.of('has-geo');
    }
    state.routing = { ...state.routing, 'geoLookupRun': true, 'geoLookupSkipped': false };
    return NodeOutputBuilder.of('needs-geo');
  }
}
// #endregion route-geo-node

export const routeGeo = new RouteGeoNode();
