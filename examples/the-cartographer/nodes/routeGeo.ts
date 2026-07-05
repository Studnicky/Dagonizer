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

import { Batch, MonadicNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, NodeOutputType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region route-geo-node
export class RouteGeoNode extends MonadicNode<CartographerState, 'has-geo' | 'needs-geo'> {
  readonly 'name' = 'route-geo';
  readonly 'outputs' = ['has-geo', 'needs-geo'] as const;

  override get outputSchema(): Record<'has-geo' | 'needs-geo', SchemaObjectType> {
    return {
      'has-geo':   { 'type': 'object' },
      'needs-geo': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'has-geo' | 'needs-geo', CartographerState>> {
    const acc = new Map<'has-geo' | 'needs-geo', ItemType<CartographerState>[]>();

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

    const routed = new Map<'has-geo' | 'needs-geo', Batch<CartographerState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }

  private routeItem(state: CartographerState): NodeOutputType<'has-geo' | 'needs-geo'> {
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
