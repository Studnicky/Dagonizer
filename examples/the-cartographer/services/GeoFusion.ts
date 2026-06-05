/**
 * GeoFusion: the multi-modal fusion MATH used by the `fuse-geo` node.
 *
 * Combines the GPS reverse-geocode candidate and the IP geolocation candidate
 * into one ResolvedGeo, deriving a confidence from their agreement:
 *   - both resolved, same country → high confidence, modalities ['gps','ip']
 *   - both resolved, disagree     → prefer GPS (accurate for asset position),
 *                                    lower confidence, flag (both modalities listed)
 *   - GPS only                    → moderate-high confidence, ['gps']
 *   - IP only                     → moderate confidence, ['ip']
 *   - GPS says open water         → status 'water', jurisdiction international-waters
 *
 * GPS reverse-geocode is now offline country-coder — it returns country-level
 * data only (no locality/region). When GPS resolves a land point and the IP
 * candidate is also resolved, region and locality are FILLED from the IP
 * candidate (city-level detail from freeipapi), while country and continent
 * stay from GPS (the accurate boundary dataset).
 *
 * This is a pure static helper (the node is the orchestration unit); the
 * jurisdiction comes from the privacy-regime service, NOT a geo lookup table.
 */

import type { GeoCandidate } from '../entities/GeoCandidate.ts';
import type { ResolvedGeo } from '../entities/ResolvedGeo.ts';
import { Jurisdictions } from '../services.ts';

// #region geo-fusion
export class GeoFusion {
  /**
   * Fuse the two modality candidates into a ResolvedGeo. `gps` is the GPS
   * reverse-geocode result (offline country-coder — country-level only);
   * `ip` is the IP geolocation result (or an unresolved candidate when the
   * ip-geolocate node was skipped / had no IP).
   *
   * Land GPS + resolved IP: country/continent from GPS, region/locality from IP.
   */
  static fuse(gps: GeoCandidate, ip: GeoCandidate, lat: number, lng: number): ResolvedGeo {
    const gpsOk = gps.resolved;
    const ipOk  = ip.resolved;

    // Open-water GPS → maritime, no regional regime (the IP modality is moot at sea).
    if (gpsOk && gps.water) {
      return {
        'country':      '',
        'countryName':  '',
        'continent':    'International Waters / Maritime',
        'region':       'In Transit / Maritime',
        'locality':     gps.locality || 'International Waters',
        'lat':          lat,
        'lng':          lng,
        'status':       'water',
        'jurisdiction': 'international-waters',
        'confidence':   ipOk ? 0.9 : 0.8,
        'modalities':   ipOk ? ['gps', 'ip'] : ['gps'],
      };
    }

    if (gpsOk && ipOk) {
      const agree = gps.country.length > 0 && gps.country === ip.country;
      return GeoFusion.land(gps, ip, lat, lng, agree ? 0.95 : 0.6, ['gps', 'ip']);
    }
    if (gpsOk) {
      return GeoFusion.land(gps, null, lat, lng, 0.8, ['gps']);
    }
    if (ipOk) {
      // GPS failed; fall back to the IP modality's location (lower confidence).
      return GeoFusion.land(ip, null, lat, lng, 0.5, ['ip']);
    }
    // Neither modality resolved — unmapped, baseline regime.
    return {
      'country':      '',
      'countryName':  'Unknown',
      'continent':    'Unmapped',
      'region':       'Unmapped',
      'locality':     'Unknown',
      'lat':          lat,
      'lng':          lng,
      'status':       'land',
      'jurisdiction': 'baseline',
      'confidence':   0,
      'modalities':   [],
    };
  }

  private static land(
    primary: GeoCandidate,
    secondary: GeoCandidate | null,
    lat: number,
    lng: number,
    confidence: number,
    modalities: Array<'gps' | 'ip'>,
  ): ResolvedGeo {
    const country = primary.country;
    const jurisdiction = country.length > 0
      ? Jurisdictions.forIso2(country).jurisdiction
      : 'baseline';

    // GPS (offline country-coder) returns country-level only — region/locality are
    // empty. Fill them from the IP candidate when available (city-level gateway data).
    const region   = primary.region.length > 0
      ? primary.region
      : (secondary?.region ?? '');
    const locality = primary.locality.length > 0
      ? primary.locality
      : (secondary?.locality ?? primary.countryName ?? 'Unknown');

    return {
      'country':      country,
      'countryName':  primary.countryName || 'Unknown',
      'continent':    primary.continent || 'Unmapped',
      'region':       region,
      'locality':     locality || primary.countryName || 'Unknown',
      'lat':          lat,
      'lng':          lng,
      'status':       'land',
      'jurisdiction': jurisdiction,
      'confidence':   confidence,
      'modalities':   modalities,
    };
  }
}
// #endregion geo-fusion
