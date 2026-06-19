/**
 * LiveIpGeolocator: real IP-modality transport via freeipapi.com (free, no key,
 * HTTPS). Geolocates a public IP to a GeoCandidate.
 *
 *   GET https://freeipapi.com/api/json/IP
 *   → { countryCode, countryName, continent, regionName, cityName, latitude, longitude }
 *
 * freeipapi.com is the universal no-key IP API: it answers from Node AND sends
 * `Access-Control-Allow-Origin: *`, so the same code path serves the browser demo.
 *
 * Caching: by IP (a per-region gateway IP recurs across many pings → one call).
 * Never throws — a failed lookup resolves to an unresolved candidate.
 */

import type { GeoCandidate } from '../entities/GeoCandidate.ts';
import type { IpGeolocator } from '../contracts/IpGeolocator.ts';
import { GeoErrorRecord } from '../errors/GeoErrorRecord.ts';
import { GeoLookupOutcome, type GeoLookupOutcomeType } from '../errors/GeoLookupOutcome.ts';

// #region live-ip-geolocator
const FREEIPAPI_ENDPOINT = 'https://freeipapi.com/api/json';
const ERROR_SOURCE = 'ip-geolocate';

interface FreeIpApiResponse {
  readonly 'countryCode': string;
  readonly 'countryName': string;
  readonly 'continent': string;
  readonly 'regionName': string;
  readonly 'cityName': string;
  readonly 'latitude': number;
  readonly 'longitude': number;
}

export class LiveIpGeolocator implements IpGeolocator {
  readonly #cache = new Map<string, GeoCandidate>();

  private static str(value: string | undefined): string {
    return typeof value === 'string' ? value : '';
  }

  private static num(value: number | undefined): number {
    return typeof value === 'number' ? value : 0;
  }

  async lookup(ipAddress: string, signal: AbortSignal): Promise<GeoLookupOutcomeType> {
    const cached = this.#cache.get(ipAddress);
    if (cached !== undefined) return GeoLookupOutcome.resolved(cached);

    let candidate: GeoCandidate;
    try {
      const res = await fetch(`${FREEIPAPI_ENDPOINT}/${encodeURIComponent(ipAddress)}`, {
        'signal':  signal,
        'headers': { 'accept': 'application/json' },
      });
      if (!res.ok) {
        // A non-2xx HTTP status is a real upstream failure: capture it as data.
        const candidateUnresolved = LiveIpGeolocator.unresolved();
        this.#cache.set(ipAddress, candidateUnresolved);
        const error = GeoErrorRecord.capture(
          ERROR_SOURCE,
          new Error(`freeipapi responded ${String(res.status)} ${res.statusText}`),
          `ip=${ipAddress}`,
        );
        return GeoLookupOutcome.failed(candidateUnresolved, error);
      }
      const body = await res.json() as Partial<FreeIpApiResponse>;
      candidate = (body.countryCode !== undefined && body.countryCode.length > 0)
        ? LiveIpGeolocator.fromResponse(body as FreeIpApiResponse)
        : LiveIpGeolocator.unresolved();
    } catch (caught) {
      // A network / abort / JSON-parse failure is a real fault: surface it as
      // data. The candidate still degrades to unresolved so the flow continues.
      const candidateUnresolved = LiveIpGeolocator.unresolved();
      this.#cache.set(ipAddress, candidateUnresolved);
      const error = GeoErrorRecord.capture(ERROR_SOURCE, caught, `ip=${ipAddress}`);
      return GeoLookupOutcome.failed(candidateUnresolved, error);
    }

    this.#cache.set(ipAddress, candidate);
    return GeoLookupOutcome.resolved(candidate);
  }

  private static fromResponse(body: FreeIpApiResponse): GeoCandidate {
    return {
      'modality':    'ip',
      'resolved':    true,
      'country':     LiveIpGeolocator.str(body.countryCode),
      'countryName': LiveIpGeolocator.str(body.countryName),
      'continent':   LiveIpGeolocator.str(body.continent),
      'region':      LiveIpGeolocator.str(body.regionName),
      'locality':    LiveIpGeolocator.str(body.cityName),
      'lat':         LiveIpGeolocator.num(body.latitude),
      'lng':         LiveIpGeolocator.num(body.longitude),
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
