/**
 * OfflineGeo: synchronous GPS reverse-geocode via the offline
 * `@rapideditor/country-coder` v5 boundary dataset.
 *
 * Runs identically in Node 18+ and the browser (pure JS, no HTTP, no key,
 * no CORS). `feature([lng, lat])` returns the GeoJSON feature for the given
 * point (NOTE longitude-first), or `null` over open water.
 *
 * Continent lookup: country-coder's `.groups` M49 codes are inconsistent
 * (US/GB carry no region group), so the continent is derived from the static
 * `data/country-continents.json` ISO-2 → continent-name map instead.
 *
 * Water detection: a `null` feature → maritime / international-waters candidate.
 */

import { feature, iso1A2Code } from '@rapideditor/country-coder';
import CONTINENT_MAP_RAW from '../data/country-continents.json' with { type: 'json' };

import type { GeoCandidate } from '../entities/GeoCandidate.ts';

// Static JSON import: assert the shape with a narrow cast at the boundary only.
const CONTINENT_MAP = CONTINENT_MAP_RAW as unknown as Record<string, string>;

// #region offline-geo
export class OfflineGeo {
  /**
   * Synchronously reverse-geocode WGS-84 coordinates to a GPS-modality
   * GeoCandidate. Open water (null feature) → water candidate with
   * locality 'International Waters'. Land → country ISO-2 + name + continent
   * from the static map. Never throws.
   *
   * NOTE: country-coder uses [longitude, latitude] order.
   */
  static resolve(lat: number, lng: number): GeoCandidate {
    let f: ReturnType<typeof feature>;
    try {
      f = feature([lng, lat]);
    } catch {
      // Out-of-range coords or unexpected error → treat as unresolved.
      return OfflineGeo.unresolved(lat, lng);
    }

    if (f === null) {
      // Open water — no country boundary matched.
      return {
        'modality':    'gps',
        'resolved':    true,
        'water':       true,
        'country':     '',
        'countryName': '',
        'continent':   '',
        'region':      '',
        'locality':    'International Waters',
        'lat':         lat,
        'lng':         lng,
      };
    }

    // Land: extract ISO-2 directly (the fast path).
    let iso2: string;
    try {
      iso2 = iso1A2Code([lng, lat]) ?? '';
    } catch {
      iso2 = '';
    }
    if (iso2.length === 0) {
      // feature resolved but iso1A2Code did not — fall back to typed properties.
      iso2 = f.properties.iso1A2 ?? '';
    }

    const countryName = f.properties.nameEn ?? '';
    const continent   = iso2.length > 0 ? (CONTINENT_MAP[iso2] ?? 'Unmapped') : 'Unmapped';

    return {
      'modality':    'gps',
      'resolved':    true,
      'water':       false,
      'country':     iso2,
      'countryName': countryName,
      'continent':   continent,
      'region':      '',
      'locality':    '',
      'lat':         lat,
      'lng':         lng,
    };
  }

  private static unresolved(lat: number, lng: number): GeoCandidate {
    return {
      'modality':    'gps',
      'resolved':    false,
      'water':       false,
      'country':     '',
      'countryName': '',
      'continent':   '',
      'region':      '',
      'locality':    '',
      'lat':         lat,
      'lng':         lng,
    };
  }
}
// #endregion offline-geo
