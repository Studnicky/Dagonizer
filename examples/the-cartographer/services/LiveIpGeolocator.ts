/**
 * LiveIpGeolocator: real IP-modality transport via freeipapi.com (free, no key,
 * HTTPS). Geolocates a public IP to a GeoCandidate.
 *
 *   GET https://freeipapi.com/api/json/IP
 *   → { countryCode, countryName, regionName, cityName, latitude, longitude }
 *
 * freeipapi.com is the universal no-key IP API: it answers from Node AND sends
 * `Access-Control-Allow-Origin: *`, so the same code path serves the browser demo.
 *
 * Caching: by IP (a per-region gateway IP recurs across many pings → one call).
 * Never throws — a failed lookup resolves to an unresolved candidate.
 */

import type { GeoCandidate } from '../entities/GeoCandidate.ts';
import type { IpGeolocator } from '../contracts/IpGeolocator.ts';

// #region live-ip-geolocator
const FREEIPAPI_ENDPOINT = 'https://freeipapi.com/api/json';

interface FreeIpApiResponse {
  readonly 'countryCode'?: unknown;
  readonly 'countryName'?: unknown;
  readonly 'continent'?: unknown;
  readonly 'regionName'?: unknown;
  readonly 'cityName'?: unknown;
  readonly 'latitude'?: unknown;
  readonly 'longitude'?: unknown;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

export class LiveIpGeolocator implements IpGeolocator {
  readonly #cache = new Map<string, GeoCandidate>();

  async lookup(ipAddress: string, signal: AbortSignal): Promise<GeoCandidate> {
    const cached = this.#cache.get(ipAddress);
    if (cached !== undefined) return cached;

    let candidate: GeoCandidate;
    try {
      const res = await fetch(`${FREEIPAPI_ENDPOINT}/${encodeURIComponent(ipAddress)}`, {
        'signal':  signal,
        'headers': { 'accept': 'application/json' },
      });
      if (!res.ok) {
        candidate = LiveIpGeolocator.unresolved();
      } else {
        const body: FreeIpApiResponse = await res.json() as FreeIpApiResponse;
        candidate = str(body.countryCode).length > 0
          ? LiveIpGeolocator.fromResponse(body)
          : LiveIpGeolocator.unresolved();
      }
    } catch {
      candidate = LiveIpGeolocator.unresolved();
    }

    this.#cache.set(ipAddress, candidate);
    return candidate;
  }

  private static fromResponse(body: FreeIpApiResponse): GeoCandidate {
    return {
      'modality':    'ip',
      'resolved':    true,
      'country':     str(body.countryCode),
      'countryName': str(body.countryName),
      'continent':   str(body.continent),
      'region':      str(body.regionName),
      'locality':    str(body.cityName),
      'lat':         num(body.latitude),
      'lng':         num(body.longitude),
      'water':       false,
    };
  }

  private static unresolved(): GeoCandidate {
    return {
      'modality': 'ip', 'resolved': false, 'country': '', 'countryName': '',
      'continent': '', 'region': '', 'locality': '', 'lat': 0, 'lng': 0, 'water': false,
    };
  }
}
// #endregion live-ip-geolocator
