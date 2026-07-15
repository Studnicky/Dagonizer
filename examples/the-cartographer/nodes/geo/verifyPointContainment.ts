/**
 * verify-point-containment: reverse-geocodes the highest-weight valid-point
 * `GeoResolution` candidate (real WGS-84 lat/lng, matching the validity gate
 * in `score-signals`) via `OfflineGeoResolver`, and checks it against the
 * `geo-consensus` country.
 *
 *   - Point resolves to the consensus country (or there is no consensus
 *     country to check against) → VERIFIED: the point becomes the precise
 *     position.
 *   - Point resolves to a DIFFERENT country/water status than consensus →
 *     genuine disagreement. The point is still used as the position (it is
 *     real information), but `conflict` is recorded rather than silently
 *     preferring one side — the next node lowers confidence accordingly.
 *   - No valid point candidate at all → fall back to the consensus country's
 *     centroid (`Geo.centroidForCountry`) when a consensus country exists;
 *     otherwise the position stays empty.
 *
 * Writes `state.setMetadata('geo-position', ...)`. Always routes 'resolved'.
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { GeoResolution } from '../../entities/GeoResolution.ts';
import { DEFAULT_GEO_CONSENSUS, GeoConsensusGuard } from '../../entities/GeoConsensus.ts';
import { GeoPositionBuilder } from '../../entities/GeoPosition.ts';
import { Geo, OfflineGeoResolver } from '@studnicky/geo-resolver';
import {
  MonadicNode,
  RoutedBatch,
  type Batch,
  type NodeContextType,
  type RoutedBatchType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

function isValidPoint(candidate: GeoResolution): boolean {
  return (
    Number.isFinite(candidate.lat) &&
    Number.isFinite(candidate.lng) &&
    (candidate.lat !== 0 || candidate.lng !== 0) &&
    Math.abs(candidate.lat) <= 90 &&
    Math.abs(candidate.lng) <= 180
  );
}

// #region verify-point-containment-node
export class VerifyPointContainmentNode extends MonadicNode<CartographerState, 'resolved'> {
  readonly '@id' = 'urn:noocodec:node:verify-point-containment';
  readonly 'name' = 'verify-point-containment';
  readonly 'outputs' = ['resolved'] as const;

  override get outputSchema(): Record<'resolved', SchemaObjectType> {
    return { 'resolved': { 'type': 'object' } };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'resolved', CartographerState>> {
    for (const item of batch) {
      const rawConsensus = item.state.getMetadata('geo-consensus');
      const consensus = GeoConsensusGuard.is(rawConsensus) ? rawConsensus : DEFAULT_GEO_CONSENSUS;

      const pointCandidate = item.state.geoCandidates
        .filter(isValidPoint)
        .sort((a, b) => b.weight - a.weight)[0];

      if (pointCandidate !== undefined) {
        const outcome = OfflineGeoResolver.resolve(pointCandidate.lat, pointCandidate.lng);
        const resolvedCountry = outcome.candidate.country;
        const resolvedWater = outcome.candidate.water;

        let conflict = false;
        let conflictCountry = '';

        if (consensus.isWater) {
          if (!resolvedWater && resolvedCountry.length > 0) {
            conflict = true;
            conflictCountry = resolvedCountry;
          }
        } else if (consensus.country.length > 0) {
          if (resolvedWater) {
            conflict = true;
            conflictCountry = 'water';
          } else if (resolvedCountry.length > 0 && resolvedCountry !== consensus.country) {
            conflict = true;
            conflictCountry = resolvedCountry;
          }
        }

        item.state.setMetadata('geo-position', GeoPositionBuilder.from({
          'lat':             pointCandidate.lat,
          'lng':             pointCandidate.lng,
          'positionSource':  'verified-point',
          'pointSource':     pointCandidate.source,
          'conflict':        conflict,
          'conflictCountry': conflictCountry,
        }));
        continue;
      }

      const centroid = !consensus.isWater && consensus.country.length > 0
        ? Geo.centroidForCountry(consensus.country)
        : null;

      item.state.setMetadata('geo-position', GeoPositionBuilder.from(
        centroid !== null
          ? { 'lat': centroid.lat, 'lng': centroid.lng, 'positionSource': 'centroid-fallback' }
          : { 'positionSource': 'none' },
      ));
    }
    return RoutedBatch.create('resolved', batch);
  }
}

export const verifyPointContainment = new VerifyPointContainmentNode();
// #endregion verify-point-containment-node
