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
 *
 * Error surfacing: a genuinely out-of-range coordinate is a real fault, not a
 * graceful degrade. `resolve` returns a `GeoLookupOutcomeType` whose `candidate`
 * still degrades to unresolved (so the flow continues) but whose `error` carries
 * the captured `RangeError` — the GPS transport's contribution to the DAG-flow
 * error collection. In-range coords resolve with `error: null`.
 */

import { feature, iso1A2Code } from '@rapideditor/country-coder';
import CONTINENT_MAP_RAW from '../data/country-continents.json' with { type: 'json' };

import type { GeoCandidate } from '../entities/GeoCandidate.ts';
import { GeoErrorRecord } from '../errors/GeoErrorRecord.ts';
import { GeoLookupOutcome, type GeoLookupOutcomeType } from '../errors/GeoLookupOutcome.ts';

// Static JSON import: assert the shape with a narrow cast at the boundary only.
const CONTINENT_MAP = CONTINENT_MAP_RAW as Record<string, string>;

// #region offline-geo
const ERROR_SOURCE = 'reverse-geocode';

export class OfflineGeo {
  /**
   * Synchronously reverse-geocode WGS-84 coordinates to a GPS-modality outcome.
   * Open water (null feature) → water candidate with locality 'International
   * Waters'. Land → country ISO-2 + name + continent from the static map.
   *
   * An out-of-range coordinate (lat ∉ [-90,90] or lng ∉ [-180,180]) is captured
   * as a `RangeError` in the outcome's `error` — the candidate still degrades to
   * unresolved so the flow continues. In-range coords carry `error: null`.
   *
   * NOTE: country-coder uses [longitude, latitude] order.
   */
  static resolve(lat: number, lng: number): GeoLookupOutcomeType {
    // Out-of-range coords are a genuine fault: the timezone backend (tz-lookup)
    // throws a RangeError on them downstream, and country-coder silently clamps
    // them to a wrong answer. Capture the fault HERE as data rather than letting
    // it vanish or mislead. Graceful in-range resolution carries no error.
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      const error = GeoErrorRecord.capture(
        ERROR_SOURCE,
        new RangeError(`coordinate out of WGS-84 range: lat ${lat}, lng ${lng}`),
        GeoErrorRecord.coords(lat, lng),
      );
      return GeoLookupOutcome.failed(OfflineGeo.unresolved(lat, lng), error);
    }

    const f = feature([lng, lat]);

    if (f === null) {
      // Open water — no country boundary matched. Graceful, not an error.
      return GeoLookupOutcome.resolved({
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
      });
    }

    // Land: extract ISO-2 directly (the fast path).
    let iso2 = iso1A2Code([lng, lat]) ?? '';
    if (iso2.length === 0) {
      // feature resolved but iso1A2Code did not — fall back to typed properties.
      iso2 = f.properties.iso1A2 ?? '';
    }

    const countryName = f.properties.nameEn ?? '';
    const continent   = iso2.length > 0 ? (CONTINENT_MAP[iso2] ?? 'Unmapped') : 'Unmapped';

    return GeoLookupOutcome.resolved({
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
    });
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
