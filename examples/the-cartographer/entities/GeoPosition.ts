/**
 * GeoPosition: the verified/fallback position produced by `verify-point-containment`
 * from the `GeoConsensus` country and the accumulated `GeoResolution` candidates.
 *
 * A valid point candidate (real WGS-84 lat/lng) is reverse-geocoded via
 * `OfflineGeoResolver` and checked against the consensus country: agreement
 * marks the point VERIFIED; disagreement is recorded as a `conflict`, not
 * silently resolved in either direction. No point candidate falls back to the
 * consensus country's centroid; no consensus at all leaves the position empty.
 *
 * Carried between nodes via `state.setMetadata('geo-position', ...)` — an
 * intermediate value, not a durable `CartographerState` field.
 *
 * @module
 */
import type { FromSchema } from 'json-schema-to-ts';

import { Validator } from '@studnicky/dagonizer/validation';

export const GeoPositionSchema = {
  '$id': 'https://noocodec.dev/schemas/cartographer/GeoPosition',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['lat', 'lng', 'positionSource', 'pointSource', 'conflict', 'conflictCountry'],
  'properties': {
    'lat':             { 'type': 'number' },
    'lng':             { 'type': 'number' },
    'positionSource':  { 'type': 'string', 'enum': ['verified-point', 'centroid-fallback', 'none'] },
    // Source kind of the candidate that supplied the point (empty for centroid/none).
    'pointSource':     { 'type': 'string' },
    // True when the point's reverse-geocoded country/water status disagrees with consensus.
    'conflict':        { 'type': 'boolean' },
    // The country (or 'water') the point actually resolved to, when conflict is true.
    'conflictCountry': { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

export type GeoPosition = FromSchema<typeof GeoPositionSchema>;

export const DEFAULT_GEO_POSITION: GeoPosition = {
  'lat':             0,
  'lng':             0,
  'positionSource':  'none',
  'pointSource':     '',
  'conflict':        false,
  'conflictCountry': '',
};

type GeoPositionInput = {
  lat: number;
  lng: number;
  positionSource: GeoPosition['positionSource'];
  pointSource: string;
  conflict: boolean;
  conflictCountry: string;
};

export class GeoPositionBuilder {
  private constructor() { /* static-only */ }

  public static from(partial: Partial<GeoPositionInput>): GeoPosition {
    return {
      'lat':             partial.lat             ?? DEFAULT_GEO_POSITION.lat,
      'lng':             partial.lng             ?? DEFAULT_GEO_POSITION.lng,
      'positionSource':  partial.positionSource  ?? DEFAULT_GEO_POSITION.positionSource,
      'pointSource':     partial.pointSource     ?? DEFAULT_GEO_POSITION.pointSource,
      'conflict':        partial.conflict        ?? DEFAULT_GEO_POSITION.conflict,
      'conflictCountry': partial.conflictCountry ?? DEFAULT_GEO_POSITION.conflictCountry,
    };
  }
}

const geoPositionValidator = Validator.compile<GeoPosition>(GeoPositionSchema);

export class GeoPositionGuard {
  /**
   * Type-guard for GeoPosition. Narrows `unknown` to the schema-derived type.
   * Used at the metadata boundary (`state.getMetadata('geo-position')`).
   */
  static is(value: unknown): value is GeoPosition {
    return geoPositionValidator.is(value);
  }
}
