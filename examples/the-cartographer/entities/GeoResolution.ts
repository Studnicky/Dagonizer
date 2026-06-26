/**
 * GeoResolution: the per-signal resolution result produced by the geo resolver
 * nodes (`resolve-coords`, `resolve-ip`, `resolve-address`, `resolve-code`,
 * `resolve-phone`, `resolve-locale`, `resolve-none`) for each scatter clone. Carried as `state.candidate` and accumulated by the
 * `geo-weighted-fusion` gather into `state.geoCandidates` before being folded
 * into the final `ResolvedGeo`.
 *
 * Captures which modality resolved (`source`), whether a fallback was used,
 * and the resolved timezone, country, locale, region, locality, and coordinates.
 *
 * @module
 */
import type { FromSchema } from 'json-schema-to-ts';

export const GeoResolutionSchema = {
  '$id': 'https://noocodex.dev/schemas/cartographer/GeoResolution',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['source', 'fallbackUsed', 'timezone', 'country', 'countryName', 'locale', 'region', 'locality', 'lat', 'lng', 'status', 'weight'],
  'properties': {
    'source':       { 'type': 'string', 'enum': ['coords', 'locale', 'code', 'ip', 'none', 'address', 'phone'] },
    'fallbackUsed': { 'type': 'boolean' },
    'timezone':     { 'type': 'string' },
    'country':      { 'type': 'string' },
    'countryName':  { 'type': 'string' },
    'locale':       { 'type': 'string' },
    'region':       { 'type': 'string' },
    'locality':     { 'type': 'string' },
    'lat':          { 'type': 'number' },
    'lng':          { 'type': 'number' },
    'status':       { 'type': 'string', 'enum': ['land', 'water', 'coastal'] },
    'weight':       { 'type': 'number' },
  },
  'additionalProperties': false,
} as const;

export type GeoResolution = FromSchema<typeof GeoResolutionSchema>;

export const DEFAULT_GEO_RESOLUTION: GeoResolution = {
  'source':       'none',
  'fallbackUsed': false,
  'timezone':     '',
  'country':      '',
  'countryName':  '',
  'locale':       '',
  'region':       '',
  'locality':     '',
  'lat':          0,
  'lng':          0,
  'status':       'land',
  'weight':       0,
};

type GeoResolutionInput = {
  source: GeoResolution['source'];
  fallbackUsed: boolean;
  timezone: string;
  country: string;
  countryName: string;
  locale: string;
  region: string;
  locality: string;
  lat: number;
  lng: number;
  status: GeoResolution['status'];
  weight: number;
};

export class GeoResolutionBuilder {
  private constructor() { /* static-only */ }

  public static from(partial: Partial<GeoResolutionInput>): GeoResolution {
    return {
      'source':       partial.source       ?? DEFAULT_GEO_RESOLUTION.source,
      'fallbackUsed': partial.fallbackUsed ?? DEFAULT_GEO_RESOLUTION.fallbackUsed,
      'timezone':     partial.timezone     ?? DEFAULT_GEO_RESOLUTION.timezone,
      'country':      partial.country      ?? DEFAULT_GEO_RESOLUTION.country,
      'countryName':  partial.countryName  ?? DEFAULT_GEO_RESOLUTION.countryName,
      'locale':       partial.locale       ?? DEFAULT_GEO_RESOLUTION.locale,
      'region':       partial.region       ?? DEFAULT_GEO_RESOLUTION.region,
      'locality':     partial.locality     ?? DEFAULT_GEO_RESOLUTION.locality,
      'lat':          partial.lat          ?? DEFAULT_GEO_RESOLUTION.lat,
      'lng':          partial.lng          ?? DEFAULT_GEO_RESOLUTION.lng,
      'status':       partial.status       ?? DEFAULT_GEO_RESOLUTION.status,
      'weight':       partial.weight       ?? DEFAULT_GEO_RESOLUTION.weight,
    };
  }
}
