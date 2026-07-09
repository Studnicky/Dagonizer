/**
 * resolve-timezone: derives `state.geoContext.timezone` (the only field
 * carrying a timezone — `ResolvedGeo` has none) from the FINAL assembled
 * position, after `assemble-resolved-geo` has settled `state.resolvedGeo.lat`/`lng`.
 *
 * Always uses `TimeZoneResolver.zoneFor(lat, lng)` — real geography from the
 * verified/fallback position — never a candidate's self-reported `timezone`
 * string. A candidate's self-reported zone is not authoritative: it is a
 * source's own claim, not a derivation from the position this chain actually
 * settled on. When no real position resolved (`lat === 0 && lng === 0`, the
 * water-with-no-locality case), falls back to `'UTC'`.
 *
 * Runs last in the chain — timezone depends on the FINAL position, not on
 * any individual candidate, so it cannot be computed until position is known.
 * Overwrites the `GeoBaseline.TIMEZONE_SENTINEL` placeholder that
 * `assemble-resolved-geo` left in place. Always routes 'resolved'.
 */

import type { CartographerState } from '../../CartographerState.ts';
import { TimeZoneResolver } from '../../services.ts';
import {
  MonadicNode,
  RoutedBatch,
  type Batch,
  type NodeContextType,
  type RoutedBatchType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

// #region resolve-timezone-node
export class ResolveTimezoneNode extends MonadicNode<CartographerState, 'resolved'> {
  readonly '@id' = 'urn:noocodec:node:resolve-timezone';
  readonly 'name' = 'resolve-timezone';
  readonly 'outputs' = ['resolved'] as const;

  override get outputSchema(): Record<'resolved', SchemaObjectType> {
    return { 'resolved': { 'type': 'object' } };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'resolved', CartographerState>> {
    for (const item of batch) {
      const { lat, lng } = item.state.resolvedGeo;
      const timezone = lat !== 0 || lng !== 0 ? TimeZoneResolver.zoneFor(lat, lng) : 'UTC';

      item.state.geoContext = { ...item.state.geoContext, 'timezone': timezone };
    }
    return RoutedBatch.create('resolved', batch);
  }
}

export const resolveTimezone = new ResolveTimezoneNode();
// #endregion resolve-timezone-node
