/**
 * RecordedIpGeolocator: deterministic IP-modality transport that REPLAYS a
 * committed fixture of real freeipapi.com responses (data/geo-fixtures.json),
 * keyed by IP. Offline + byte-deterministic → used by the smoke and the CLI
 * `--recorded`.
 *
 * An absent IP resolves to an unresolved candidate (never throws).
 */

import type { GeoCandidate } from '../entities/GeoCandidate.ts';
import type { IpGeolocator } from '../contracts/IpGeolocator.ts';
import { GeoFixtures } from './GeoFixtures.ts';

// #region recorded-ip-geolocator
export class RecordedIpGeolocator implements IpGeolocator {
  async lookup(ipAddress: string, _signal: AbortSignal): Promise<GeoCandidate> {
    const recorded = GeoFixtures.ipGeolocate(ipAddress);
    if (recorded !== null) return recorded;
    return {
      'modality': 'ip', 'resolved': false, 'country': '', 'countryName': '',
      'continent': '', 'region': '', 'locality': '', 'lat': 0, 'lng': 0, 'water': false,
    };
  }
}
// #endregion recorded-ip-geolocator
