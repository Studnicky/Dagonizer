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
import { GeoLookup } from '../services.ts';

import { MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region apply-geo-node
export class ApplyGeoNode extends MonadicNode<CartographerState, 'normalize'> {
  readonly 'name' = 'apply-geo';
  readonly 'outputs' = ['normalize'] as const;

  override get outputSchema(): Record<'normalize', SchemaObjectType> {
    return {
      'normalize': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'normalize', CartographerState>> {
    for (const item of batch) {
      const geo = item.state.canonical.geo;
      // route-geo guarantees geo is present on this branch; fall back defensively.
      const country   = geo?.country ?? item.state.raw.recipientCountry;
      const continent = geo?.continent ?? 'Unmapped';
      const region    = geo?.region ?? 'Unmapped';
      item.state.geoContext = GeoLookup.fromResolved(country, continent, region, item.state.raw.latitude, item.state.raw.longitude);
    }
    return RoutedBatch.create('normalize', batch);
  }
}
// #endregion apply-geo-node

export const applyGeo = new ApplyGeoNode();
