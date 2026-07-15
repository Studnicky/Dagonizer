/**
 * GeoConsensus: the country-agreement verdict produced by `resolve-country-consensus`
 * from the accumulated weight>0 `GeoResolution` candidates.
 *
 * Candidates are grouped by their ISO-2 country (water-status candidates form
 * their own pseudo-group). The consensus group is the one with the highest
 * summed weight — a tie-break between agreement groups, not a per-candidate
 * "biggest single weight" pick, so three modest-weight signals that agree
 * outrank one high-weight signal asserting a different country alone.
 *
 * Carried between nodes via `state.setMetadata('geo-consensus', ...)` — an
 * intermediate value, not a durable `CartographerState` field.
 *
 * @module
 */
import type { FromSchema } from 'json-schema-to-ts';

import { Validator } from '@studnicky/dagonizer/validation';

export const GeoConsensusSchema = {
  '$id': 'https://noocodec.dev/schemas/cartographer/GeoConsensus',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['country', 'isWater', 'weight', 'agreementCount', 'sources', 'unanimous'],
  'properties': {
    // ISO-2 consensus country; empty when no candidate carried a country/water identity.
    'country':        { 'type': 'string' },
    // Water-status candidates form their own pseudo-group (no country).
    'isWater':         { 'type': 'boolean' },
    // Summed weight of the winning agreement group.
    'weight':          { 'type': 'number' },
    // Count of independent source kinds contributing to the winning group.
    'agreementCount':  { 'type': 'number' },
    // Source kinds in the winning group.
    'sources':         { 'type': 'array', 'items': { 'type': 'string' } },
    // True when at most one identity group existed (nothing to tie-break against).
    'unanimous':       { 'type': 'boolean' },
  },
  'additionalProperties': false,
} as const;

export type GeoConsensus = FromSchema<typeof GeoConsensusSchema>;

export const DEFAULT_GEO_CONSENSUS: GeoConsensus = {
  'country':       '',
  'isWater':       false,
  'weight':        0,
  'agreementCount': 0,
  'sources':       [],
  'unanimous':     true,
};

type GeoConsensusInput = {
  country: string;
  isWater: boolean;
  weight: number;
  agreementCount: number;
  sources: string[];
  unanimous: boolean;
};

export class GeoConsensusBuilder {
  private constructor() { /* static-only */ }

  public static from(partial: Partial<GeoConsensusInput>): GeoConsensus {
    return {
      'country':        partial.country        ?? DEFAULT_GEO_CONSENSUS.country,
      'isWater':        partial.isWater        ?? DEFAULT_GEO_CONSENSUS.isWater,
      'weight':         partial.weight         ?? DEFAULT_GEO_CONSENSUS.weight,
      'agreementCount': partial.agreementCount ?? DEFAULT_GEO_CONSENSUS.agreementCount,
      'sources':        partial.sources        ?? DEFAULT_GEO_CONSENSUS.sources,
      'unanimous':      partial.unanimous      ?? DEFAULT_GEO_CONSENSUS.unanimous,
    };
  }
}

const geoConsensusValidator = Validator.compile<GeoConsensus>(GeoConsensusSchema);

export class GeoConsensusGuard {
  /**
   * Type-guard for GeoConsensus. Narrows `unknown` to the schema-derived type.
   * Used at the metadata boundary (`state.getMetadata('geo-consensus')`).
   */
  static is(value: unknown): value is GeoConsensus {
    return geoConsensusValidator.is(value);
  }
}
