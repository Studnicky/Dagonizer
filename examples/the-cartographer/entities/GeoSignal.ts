/**
 * GeoSignal: the routing decision record derived from the canonical event body.
 *
 * Captures which geo-resolution model to use (coords, locale, code, ip, none)
 * and carries the raw signal values for the selected resolution path.
 *
 * `primaryModel` is the primary resolution path selected by classify-geo-source.
 *
 * @module
 */
import type { FromSchema } from 'json-schema-to-ts';
import type { CartographerState } from '../CartographerState.ts';

export const GeoSignalSchema = {
  '$id': 'https://noocodec.dev/schemas/cartographer/GeoSignal',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['primaryModel', 'lat', 'lng', 'ipAddress', 'localeTag', 'countryCode'],
  'properties': {
    'primaryModel': { 'type': 'string', 'enum': ['coords', 'locale', 'code', 'ip', 'none'] },
    'lat':          { 'type': 'number' },
    'lng':          { 'type': 'number' },
    'ipAddress':    { 'type': 'string' },
    'localeTag':    { 'type': 'string' },
    'countryCode':  { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

export type GeoSignal = FromSchema<typeof GeoSignalSchema>;

export const DEFAULT_GEO_SIGNAL: GeoSignal = {
  'primaryModel': 'none',
  'lat':         0,
  'lng':         0,
  'ipAddress':   '',
  'localeTag':   '',
  'countryCode': '',
};

export class GeoSignalBuilder {
  private constructor() { /* static-only */ }

  public static from(state: CartographerState): GeoSignal {
    const body = state.canonical.body;
    const lat = body.latitude;
    const lng = body.longitude;
    const ip  = body.ipAddress;
    const localeTag   = body.localeTag;
    const countryCode = body.countryCode;

    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);

    let primaryModel: GeoSignal['primaryModel'];
    if (hasCoords) {
      primaryModel = 'coords';
    } else if (localeTag.length > 0) {
      primaryModel = 'locale';
    } else if (countryCode.length > 0) {
      primaryModel = 'code';
    } else if (ip.length > 0) {
      primaryModel = 'ip';
    } else {
      primaryModel = 'none';
    }

    return {
      'primaryModel': primaryModel,
      'lat':          lat,
      'lng':          lng,
      'ipAddress':    ip,
      'localeTag':    localeTag,
      'countryCode':  countryCode,
    };
  }
}
