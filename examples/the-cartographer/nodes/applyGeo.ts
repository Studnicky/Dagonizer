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

import { NodeOutputBuilder, type NodeContextInterface, type NodeInterface, type NodeOutputInterface,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';

// #region apply-geo-node
export class ApplyGeoNode implements NodeInterface<CartographerState, 'normalize', CartographerServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly 'name' = 'apply-geo';
  readonly 'outputs' = ['normalize'] as const;

  async execute(state: CartographerState, context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'normalize'>> {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
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
