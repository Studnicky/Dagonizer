/**
 * GeoWeightedFusionGather: stateless weighted-fusion gather strategy for the
 * geo-source-resolve scatter phase.
 *
 * Each scatter clone resolves one geo signal and writes the result as
 * `state.candidate` (a GeoResolution). This strategy:
 *
 *   1. reduce:   Accumulates weight>0 candidates from each clone into
 *                `state.geoCandidates` (read-array, push, set-back idiom).
 *
 *   2. finalize: Applies the weighted-fusion rules to produce
 *                `state.resolvedGeo`, `state.geoContext`, and merges
 *                `state.routing.geoConfidence` / `state.routing.geoModalities`.
 *
 * Fusion rules (in priority order):
 *   - WINNER   = highest-weight candidate (ties: first encountered).
 *   - BACK-FILL: region, locality, countryName, locale, timezone —
 *               if winner's field is empty, fill from the next-highest-weight
 *               candidate that has a non-empty value.
 *   - PROVENANCE = contributing candidates' source strings, ordered
 *                  highest-weight first, de-duplicated.
 *   - CONFIDENCE = winner's weight, with composite override: if BOTH a `code`
 *                  and a `locale` candidate resolved and agree on the same ISO-2
 *                  country, confidence = max(winnerWeight, 0.45).
 *   - MODALITIES: 'gps' if any contributing source is 'coords'; 'ip' if any is 'ip'.
 *   - EMPTY case (zero weight>0 candidates): baseline resolvedGeo, confidence 0.
 *
 * Registered as 'geo-weighted-fusion' at module load.
 */

import type { GatherExecutionType } from '@studnicky/dagonizer/contracts';
import { GatherStrategies, GatherStrategy } from '@studnicky/dagonizer/core';
import type { GatherConfigType, NodeStateInterface } from '@studnicky/dagonizer/types';
import type { StateAccessorInterface } from '@studnicky/dagonizer/contracts';

import type { GeoResolution } from '../entities/GeoResolution.ts';
import { SignalWeight } from '../entities/SignalWeight.ts';
import { Continents, Jurisdictions, TimeZoneResolver } from '../services.ts';
import { GeoBaseline } from './GeoBaseline.ts';

// ── Private structural type-guard ─────────────────────────────────────────────

class CandidateRecord {
  private constructor() { /* static-only */ }

  static is(v: unknown): v is GeoResolution {
    if (v === null || typeof v !== 'object') return false;
    return (
      typeof Reflect.get(v, 'source')      === 'string' &&
      typeof Reflect.get(v, 'weight')      === 'number' &&
      typeof Reflect.get(v, 'country')     === 'string' &&
      typeof Reflect.get(v, 'region')      === 'string' &&
      typeof Reflect.get(v, 'locality')    === 'string' &&
      typeof Reflect.get(v, 'countryName') === 'string' &&
      typeof Reflect.get(v, 'locale')      === 'string' &&
      typeof Reflect.get(v, 'timezone')    === 'string' &&
      typeof Reflect.get(v, 'lat')         === 'number' &&
      typeof Reflect.get(v, 'lng')         === 'number' &&
      typeof Reflect.get(v, 'status')      === 'string' &&
      typeof Reflect.get(v, 'fallbackUsed') === 'boolean'
    );
  }
}

class GeoResolutionArray {
  private constructor() { /* static-only */ }

  static is(v: unknown): v is GeoResolution[] {
    return Array.isArray(v);
  }
}

// ── GeoWeightedFusionGather ───────────────────────────────────────────────────

export class GeoWeightedFusionGather extends GatherStrategy {
  readonly name = 'geo-weighted-fusion';

  // ── initial: reset geoCandidates accumulator in parent state ─────────────

  override initial(
    _config: GatherConfigType,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    accessor.set(state, 'geoCandidates', []);
  }

  // ── reduce: collect weight>0 candidates from each clone ──────────────────

  override reduce(
    _config: GatherConfigType,
    batch: Parameters<GatherStrategy['reduce']>[1],
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    for (const item of batch) {
      const record = item.state;
      const rawCandidate = accessor.get(record.cloneState, 'candidate');
      if (!CandidateRecord.is(rawCandidate)) continue;
      if (rawCandidate.weight <= 0) continue;

      // Read-array, push, set-back idiom (matches InsightsFoldGather pattern).
      const rawCandidates = accessor.get(state, 'geoCandidates');
      const candidates: GeoResolution[] = GeoResolutionArray.is(rawCandidates)
        ? rawCandidates.filter(CandidateRecord.is)
        : [];
      candidates.push(rawCandidate);
      accessor.set(state, 'geoCandidates', candidates);
    }
  }

  // ── finalize: apply fusion rules, write resolvedGeo + geoContext ──────────

  override async finalize(
    _config: GatherConfigType,
    execution: GatherExecutionType<NodeStateInterface>,
  ): Promise<void> {
    const rawCandidates = execution.accessor.get(execution.state, 'geoCandidates');
    const candidates: GeoResolution[] = GeoResolutionArray.is(rawCandidates)
      ? rawCandidates.filter(CandidateRecord.is)
      : [];

    // Sort descending by weight (highest first; stable sort preserves tie order).
    const sorted = [...candidates].sort((a, b) => b.weight - a.weight);
    const winner = sorted[0];

    if (winner === undefined) {
      // EMPTY case: delegate to the single source of truth for baseline values.
      execution.accessor.set(execution.state, 'resolvedGeo', GeoBaseline.resolvedGeo());
      execution.accessor.set(execution.state, 'geoContext',  GeoBaseline.geoContext());
      return;
    }

    // BACK-FILL: for each back-fillable field, find the next-highest-weight candidate
    // with a non-empty value for that field.
    const region      = GeoWeightedFusionGather.backFill(sorted, 'region',      winner.region);
    const locality    = GeoWeightedFusionGather.backFill(sorted, 'locality',    winner.locality);
    const countryName = GeoWeightedFusionGather.backFill(sorted, 'countryName', winner.countryName);
    const locale      = GeoWeightedFusionGather.backFill(sorted, 'locale',      winner.locale);
    const timezone    = GeoWeightedFusionGather.backFill(sorted, 'timezone',    winner.timezone);

    // PROVENANCE: sources ordered highest-weight first, de-duplicated
    const provenance = GeoWeightedFusionGather.buildProvenance(sorted);

    // MODALITIES
    const modalities = GeoWeightedFusionGather.buildModalities(provenance);

    // CONFIDENCE
    const confidence = GeoWeightedFusionGather.computeConfidence(sorted, winner.weight);

    // JURISDICTION, CONTINENT, TIMEZONE, STATUS
    const country = winner.country;
    const status  = winner.status;

    const jurisdiction = status === 'water'
      ? 'international-waters'
      : country.length > 0
      ? Jurisdictions.forIso2(country).jurisdiction
      : 'baseline';

    const continent = country.length > 0 ? Continents.forIso2(country) : 'Unmapped';

    const lat = winner.lat;
    const lng = winner.lng;
    const effectiveTimezone = timezone.length > 0
      ? timezone
      : (lat !== 0 || lng !== 0 ? TimeZoneResolver.zoneFor(lat, lng) : 'UTC');

    // GRID ZONE: coords source → 'GEOHASH'; else 'API'
    const gridZone = winner.source === 'coords' ? 'GEOHASH' : 'API';

    const effectiveHub = locality.length > 0
      ? locality
      : (country.length > 0 ? country : 'Unknown');

    const geoStatus: 'land' | 'water' | 'coastal' | 'unmapped' =
      status === 'water'
        ? 'water'
        : status === 'coastal'
        ? 'coastal'
        : country.length > 0
        ? 'land'
        : 'unmapped';

    execution.accessor.set(execution.state, 'resolvedGeo', {
      'country':      country,
      'countryName':  countryName.length > 0 ? countryName : country,
      'continent':    continent,
      'region':       region,
      'locality':     locality,
      'locale':       locale,
      'lat':          lat,
      'lng':          lng,
      'status':       status,
      'jurisdiction': jurisdiction,
      'confidence':   confidence,
      'modalities':   modalities,
      'provenance':   provenance,
    });

    execution.accessor.set(execution.state, 'geoContext', {
      'gridZone':    gridZone,
      'country':     country.length > 0 ? country : 'INTL',
      'continent':   continent,
      'countries':   country.length > 0 ? [country] : [],
      'region':      region,
      'hub':         effectiveHub,
      'status':      geoStatus,
      'waterBodies': status === 'water' ? [locality] : [],
      'timezone':    effectiveTimezone,
      'jurisdiction': jurisdiction,
    });

    // Merge geoConfidence and geoModalities into routing (read-spread-write pattern)
    const rawRouting = execution.accessor.get(execution.state, 'routing');
    if (rawRouting !== null && typeof rawRouting === 'object' && !Array.isArray(rawRouting)) {
      execution.accessor.set(execution.state, 'routing', {
        ...Object.fromEntries(Object.entries(rawRouting)),
        'geoConfidence': confidence,
        'geoModalities': provenance,
      });
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Back-fill: if the winner's field is non-empty, return it.
   * Otherwise find the next-highest-weight candidate with a non-empty value.
   */
  private static backFill(
    sorted: GeoResolution[],
    field: 'region' | 'locality' | 'countryName' | 'locale' | 'timezone',
    winnerValue: string,
  ): string {
    if (winnerValue.length > 0) return winnerValue;
    for (const candidate of sorted) {
      const val = candidate[field];
      if (val.length > 0) return val;
    }
    return '';
  }

  /**
   * Build de-duplicated provenance list ordered highest-weight first.
   * Source strings are added in sorted order (already sorted desc by weight).
   */
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

  /**
   * Build modalities enum: 'gps' if any contributing source is 'coords';
   * 'ip' if any contributing source is 'ip'.
   */
  private static buildModalities(provenance: string[]): Array<'gps' | 'ip'> {
    const result: Array<'gps' | 'ip'> = [];
    if (provenance.includes('coords')) result.push('gps');
    if (provenance.includes('ip'))     result.push('ip');
    return result;
  }

  /**
   * Compute confidence. Applies the composite code+locale override when
   * both are present and agree on ISO-2 country.
   */
  private static computeConfidence(sorted: GeoResolution[], winnerWeight: number): number {
    let codeCandidate:   GeoResolution | undefined;
    let localeCandidate: GeoResolution | undefined;

    for (const candidate of sorted) {
      if (candidate.source === 'code'   && codeCandidate   === undefined) codeCandidate   = candidate;
      if (candidate.source === 'locale' && localeCandidate === undefined) localeCandidate = candidate;
    }

    if (
      codeCandidate   !== undefined &&
      localeCandidate !== undefined &&
      codeCandidate.country.length > 0 &&
      codeCandidate.country === localeCandidate.country
    ) {
      return Math.max(winnerWeight, SignalWeight.COMPOSITE_CODE_LOCALE);
    }

    return winnerWeight;
  }
}

// ── Module-load registration ──────────────────────────────────────────────────

GatherStrategies.register(new GeoWeightedFusionGather());
// GatherStrategies.resolve('geo-weighted-fusion') now works in any scatter placement.
