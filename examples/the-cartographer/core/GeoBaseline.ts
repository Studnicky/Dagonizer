/**
 * GeoBaseline: single source of truth for the empty/unresolved geo baseline values.
 *
 * Used by both `GeoWeightedFusionGather` (when the scatter produces zero weight>0
 * candidates) and `GeoBaselineNode` (when the scatter source array is empty and the
 * engine short-circuits without invoking the gather). Both paths must write the same
 * baseline so downstream consumers (applyGeo, summarizeInsights) see a consistent shape.
 *
 * Browser-safe: pure object literals, no Node.js APIs.
 */

import type { GeoContext } from '../entities/GeoContext.ts';
import type { ResolvedGeo } from '../entities/ResolvedGeo.ts';

export class GeoBaseline {
  private constructor() { /* static-only */ }

  /**
   * Sentinel timezone value. Used both as the empty-case GeoContext.timezone
   * (nothing resolved) and as the interim placeholder assemble-resolved-geo
   * writes before resolve-timezone computes the real geography-derived zone
   * from the final assembled position.
   */
  static readonly TIMEZONE_SENTINEL = 'UTC';

  /** Baseline ResolvedGeo: no country, zero confidence, no provenance or modalities. */
  static resolvedGeo(): ResolvedGeo {
    return {
      'country':      '',
      'countryName':  '',
      'continent':    'Unmapped',
      'region':       '',
      'locality':     '',
      'locale':       '',
      'lat':          0,
      'lng':          0,
      'status':       'land',
      'jurisdiction': 'baseline',
      'confidence':   0,
      'modalities':   [],
      'provenance':   [],
    };
  }

  /** Baseline GeoContext: INTL grid zone, Unmapped continent, UTC timezone. */
  static geoContext(): GeoContext {
    return {
      'gridZone':    'API',
      'country':     'INTL',
      'continent':   'Unmapped',
      'countries':   [],
      'region':      '',
      'hub':         'Unknown',
      'status':      'unmapped',
      'waterBodies': [],
      'timezone':    GeoBaseline.TIMEZONE_SENTINEL,
      'jurisdiction': 'baseline',
    };
  }
}
