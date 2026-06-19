/**
 * apply-geo: the skip-geo adapter — materialise GeoContext from carried geo.
 *
 * Runs only on the route-geo 'has-geo' branch: the canonical event already
 * carries source-resolved country/region, so this builds state.geoContext from
 * them (deriving only the cheap, local timezone + jurisdiction) WITHOUT the
 * grid-zone lookup. This is the work the DAG SKIPS when a source pre-resolves geo.
 *
 * Routes 'normalize' (converges with the lookup path).
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { GeoLookup } from '../services.ts';

import { NodeOutputBuilder, type NodeContextType, type NodeOutputType,
  ScalarNode,
} from '@studnicky/dagonizer';

// #region apply-geo-node
export class ApplyGeoNode extends ScalarNode<CartographerState, 'normalize', CartographerServices> {
  readonly 'name' = 'apply-geo';
  readonly 'outputs' = ['normalize'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextType<CartographerServices>): Promise<NodeOutputType<'normalize'>> {
    const geo = state.canonical.geo;
    // route-geo guarantees geo is present on this branch; fall back defensively.
    const country   = geo?.country ?? state.raw.recipientCountry;
    const continent = geo?.continent ?? 'Unmapped';
    const region    = geo?.region ?? 'Unmapped';
    state.geoContext = GeoLookup.fromResolved(country, continent, region, state.raw.latitude, state.raw.longitude);
    return NodeOutputBuilder.of('normalize');
  }
}
// #endregion apply-geo-node

export const applyGeo = new ApplyGeoNode();
