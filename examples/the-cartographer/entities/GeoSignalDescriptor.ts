/**
 * GeoSignalDescriptor: a single scored geo signal for the weighted scatter-gather
 * resolution path. Each descriptor captures one candidate modality (coords, address,
 * ip, code, phone, locale) with its assigned weight and the raw signal values for
 * that modality.
 *
 * The scatter phase produces one GeoSignalDescriptor per active modality; the
 * gather phase folds the highest-weight resolved descriptor into the canonical
 * GeoResolution.
 *
 * @module
 */
import type { FromSchema } from 'json-schema-to-ts';

import { Validator } from '@studnicky/dagonizer/validation';

export const GeoSignalDescriptorSchema = {
  '$id': 'https://noocodex.dev/schemas/cartographer/GeoSignalDescriptor',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['kind', 'weight', 'lat', 'lng', 'ipAddress', 'address', 'localeTag', 'countryCode', 'phone'],
  'properties': {
    'kind':        { 'type': 'string', 'enum': ['coords', 'address', 'ip', 'code', 'phone', 'locale'] },
    'weight':      { 'type': 'number' },
    'lat':         { 'type': 'number' },
    'lng':         { 'type': 'number' },
    'ipAddress':   { 'type': 'string' },
    'address':     { 'type': 'string' },
    'localeTag':   { 'type': 'string' },
    'countryCode': { 'type': 'string' },
    'phone':       { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

export type GeoSignalDescriptor = FromSchema<typeof GeoSignalDescriptorSchema>;

export const DEFAULT_GEO_SIGNAL_DESCRIPTOR: GeoSignalDescriptor = {
  'kind':        'coords',
  'weight':      0,
  'lat':         0,
  'lng':         0,
  'ipAddress':   '',
  'address':     '',
  'localeTag':   '',
  'countryCode': '',
  'phone':       '',
};

type GeoSignalDescriptorInput = {
  kind: GeoSignalDescriptor['kind'];
  weight: number;
  lat: number;
  lng: number;
  ipAddress: string;
  address: string;
  localeTag: string;
  countryCode: string;
  phone: string;
};

export class GeoSignalDescriptorBuilder {
  private constructor() { /* static-only */ }

  public static from(partial: Partial<GeoSignalDescriptorInput>): GeoSignalDescriptor {
    return {
      'kind':        partial.kind        ?? DEFAULT_GEO_SIGNAL_DESCRIPTOR.kind,
      'weight':      partial.weight      ?? DEFAULT_GEO_SIGNAL_DESCRIPTOR.weight,
      'lat':         partial.lat         ?? DEFAULT_GEO_SIGNAL_DESCRIPTOR.lat,
      'lng':         partial.lng         ?? DEFAULT_GEO_SIGNAL_DESCRIPTOR.lng,
      'ipAddress':   partial.ipAddress   ?? DEFAULT_GEO_SIGNAL_DESCRIPTOR.ipAddress,
      'address':     partial.address     ?? DEFAULT_GEO_SIGNAL_DESCRIPTOR.address,
      'localeTag':   partial.localeTag   ?? DEFAULT_GEO_SIGNAL_DESCRIPTOR.localeTag,
      'countryCode': partial.countryCode ?? DEFAULT_GEO_SIGNAL_DESCRIPTOR.countryCode,
      'phone':       partial.phone       ?? DEFAULT_GEO_SIGNAL_DESCRIPTOR.phone,
    };
  }
}

const geoSignalDescriptorValidator = Validator.compile<GeoSignalDescriptor>(GeoSignalDescriptorSchema);

export class GeoSignalDescriptorGuard {
  /**
   * Type-guard for GeoSignalDescriptor. Narrows `unknown` to the schema-derived
   * type by verifying the required fields and their value types. Used at the
   * scatter metadata boundary (`state.getMetadata(itemKey)`), where the typed
   * array element re-enters as an untyped JSON value on the clone.
   */
  static is(value: unknown): value is GeoSignalDescriptor {
    return geoSignalDescriptorValidator.is(value);
  }
}
