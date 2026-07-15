/**
 * assemble-resolved-geo: builds the final `state.resolvedGeo` and
 * `state.geoContext` from the `geo-consensus` verdict, the `geo-position`
 * result, and the accumulated `GeoResolution` candidates.
 *
 * Region/locality/countryName/locale/timezone back-fill only draws from
 * candidates whose OWN country agrees with the consensus country — back-fill
 * from a disagreeing candidate would silently reintroduce the "declare a
 * winner and patch its gaps" behaviour this chain replaces.
 *
 * Confidence uses a noisy-OR combination of the consensus group's member
 * weights (`1 - Π(1 - weight)`), so several independent agreeing signals
 * outscore one strong signal at the same total weight, then applies a 0.7×
 * penalty when `verify-point-containment` recorded a conflict. A single
 * contributing candidate reduces to that candidate's own weight, matching a
 * plain single-signal resolution.
 *
 * Provenance/modalities are the union of every weight>0 candidate's source
 * (all of them already contributed to `state.geoCandidates` by definition).
 *
 * Routes 'resolved' to the geo-source-resolve terminal.
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { GeoResolution } from '../../entities/GeoResolution.ts';
import { DEFAULT_GEO_CONSENSUS, GeoConsensusGuard } from '../../entities/GeoConsensus.ts';
import { DEFAULT_GEO_POSITION, GeoPositionGuard } from '../../entities/GeoPosition.ts';
import { GeoBaseline } from '../../core/GeoBaseline.ts';
import { Continents, CountryCodes, Jurisdictions } from '../../services.ts';
import {
  MonadicNode,
  RoutedBatch,
  type Batch,
  type NodeContextType,
  type RoutedBatchType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

type BackFillField = 'region' | 'locality' | 'countryName' | 'locale';

// #region assemble-resolved-geo-node
export class AssembleResolvedGeoNode extends MonadicNode<CartographerState, 'resolved'> {
  readonly '@id' = 'urn:noocodec:node:assemble-resolved-geo';
  readonly 'name' = 'assemble-resolved-geo';
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
      const rawPosition = item.state.getMetadata('geo-position');
      const position = GeoPositionGuard.is(rawPosition) ? rawPosition : DEFAULT_GEO_POSITION;

      const candidates = item.state.geoCandidates;
      const sorted = [...candidates].sort((a, b) => b.weight - a.weight);

      // Candidates whose OWN country/water status agrees with consensus — the
      // only pool back-fill and confidence draw from.
      const agreeing = sorted.filter((candidate) =>
        consensus.isWater
          ? candidate.status === 'water'
          : consensus.country.length > 0 && CountryCodes.toIso2(candidate.country) === consensus.country,
      );

      const region      = AssembleResolvedGeoNode.backFill(agreeing, 'region');
      const locality     = AssembleResolvedGeoNode.backFill(agreeing, 'locality');
      const countryName = AssembleResolvedGeoNode.backFill(agreeing, 'countryName');
      const locale       = AssembleResolvedGeoNode.backFill(agreeing, 'locale');

      const provenance = AssembleResolvedGeoNode.buildProvenance(sorted);
      const modalities = AssembleResolvedGeoNode.buildModalities(provenance);
      const confidence = AssembleResolvedGeoNode.computeConfidence(agreeing, position.conflict);

      const country = consensus.isWater ? '' : consensus.country;
      const isWater = consensus.isWater;
      const maritimeRegion = locality.length > 0 ? locality : 'International Waters';

      const jurisdiction = isWater
        ? 'international-waters'
        : country.length > 0
        ? Jurisdictions.forIso2(country).jurisdiction
        : 'baseline';

      const continent = isWater
        ? 'International Waters / Maritime'
        : country.length > 0
        ? Continents.forIso2(country)
        : 'Unmapped';

      const lat = position.lat;
      const lng = position.lng;

      // Timezone is NOT assembled here — `resolve-timezone` derives it from
      // this node's FINAL lat/lng, never from a candidate's self-reported
      // value. This placeholder is overwritten unconditionally downstream.
      const placeholderTimezone = GeoBaseline.TIMEZONE_SENTINEL;

      const gridZone = position.positionSource === 'verified-point' && position.pointSource === 'coords'
        ? 'GEOHASH'
        : 'API';

      const effectiveHub = isWater
        ? maritimeRegion
        : locality.length > 0
        ? locality
        : (country.length > 0 ? country : 'Unknown');

      const effectiveRegion = isWater ? maritimeRegion : region;
      const effectiveCountry = isWater ? 'INTL' : country;

      const geoStatus: 'land' | 'water' | 'coastal' | 'unmapped' =
        isWater
          ? 'water'
          : agreeing.some((candidate) => candidate.status === 'coastal')
          ? 'coastal'
          : country.length > 0
          ? 'land'
          : 'unmapped';

      const resolvedStatus: 'land' | 'water' | 'coastal' =
        isWater ? 'water' : geoStatus === 'coastal' ? 'coastal' : 'land';

      item.state.resolvedGeo = {
        'country':      effectiveCountry,
        'countryName':  isWater ? maritimeRegion : countryName.length > 0 ? countryName : country,
        'continent':    continent,
        'region':       effectiveRegion,
        'locality':     isWater ? maritimeRegion : locality,
        'locale':       locale,
        'lat':          lat,
        'lng':          lng,
        'status':       resolvedStatus,
        'jurisdiction': jurisdiction,
        'confidence':   confidence,
        'modalities':   modalities,
        'provenance':   provenance,
      };

      item.state.geoContext = {
        'gridZone':    gridZone,
        'country':     effectiveCountry.length > 0 ? effectiveCountry : 'INTL',
        'continent':   continent,
        'countries':   country.length > 0 ? [country] : [],
        'region':      effectiveRegion.length > 0 ? effectiveRegion : 'Unmapped',
        'hub':         effectiveHub,
        'status':      geoStatus,
        'waterBodies': isWater ? [maritimeRegion] : [],
        'timezone':    placeholderTimezone,
        'jurisdiction': jurisdiction,
      };

      const primary = agreeing[0] ?? sorted[0];
      item.state.routing = {
        ...item.state.routing,
        'geoConfidence':          confidence,
        'geoModalities':          provenance,
        'geoSourceModel':         primary === undefined || primary.source === 'none' ? '' : primary.source,
        'geoSecondaryLookupUsed': primary?.secondaryLookupUsed ?? false,
      };
    }
    return RoutedBatch.create('resolved', batch);
  }

  /** Back-fill: first non-empty value among AGREEING candidates, highest weight first. */
  private static backFill(agreeing: GeoResolution[], field: BackFillField): string {
    for (const candidate of agreeing) {
      const value = candidate[field];
      if (value.length > 0) return value;
    }
    return '';
  }

  /** De-duplicated provenance, ordered highest-weight first — every contributing candidate. */
  private static buildProvenance(sorted: GeoResolution[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const candidate of sorted) {
      if (!seen.has(candidate.source)) {
        seen.add(candidate.source);
        result.push(candidate.source);
      }
    }
    return result;
  }

  private static buildModalities(provenance: string[]): Array<'gps' | 'ip'> {
    const result: Array<'gps' | 'ip'> = [];
    if (provenance.includes('coords')) result.push('gps');
    if (provenance.includes('ip'))     result.push('ip');
    return result;
  }

  /**
   * Noisy-OR combination of the agreeing group's weights: `1 - Π(1 - weight)`.
   * A single contributor reduces to that contributor's own weight. Multiple
   * independent agreeing signals compound toward 1 faster than any one of
   * them alone — the "use every signal" principle expressed as arithmetic.
   * A conflicting point-verification result applies a 0.7× penalty.
   */
  private static computeConfidence(agreeing: GeoResolution[], conflict: boolean): number {
    if (agreeing.length === 0) return 0;
    const complement = agreeing.reduce((acc, candidate) => acc * (1 - Math.min(1, Math.max(0, candidate.weight))), 1);
    const base = 1 - complement;
    return conflict ? base * 0.7 : base;
  }
}

export const assembleResolvedGeo = new AssembleResolvedGeoNode();
// #endregion assemble-resolved-geo-node
