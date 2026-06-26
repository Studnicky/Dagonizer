/**
 * LiveAddressGeocoder: real address-modality transport via OpenStreetMap Nominatim
 * (free, no key, CORS-enabled forward geocoding).
 *
 *   GET https://nominatim.openstreetmap.org/search
 *       ?format=json&limit=1&addressdetails=1&q=<encoded address>
 *   → [{ lat, lon, address: { country_code, country, state, region, city, town, village } }]
 *
 * NOTE: Nominatim's usage policy requires a descriptive User-Agent and/or Referer
 * header in production applications. This demo relies on the browser's or runtime's
 * default headers. See https://operations.osmfoundation.org/policies/nominatim/
 *
 * Caching: by address string (identical addresses produce identical results).
 * Never throws — a failed lookup resolves to an unresolved candidate.
 */

import type { GeoCandidate } from '../entities/GeoCandidate.ts';
import type { AddressGeocoder } from '../contracts/AddressGeocoder.ts';
import { GeoErrorRecord } from '../errors/GeoErrorRecord.ts';
import { GeoLookupOutcome, type GeoLookupOutcomeType } from '../errors/GeoLookupOutcome.ts';

// #region live-address-geocoder
const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const ERROR_SOURCE = 'address-geocode';

export class LiveAddressGeocoder implements AddressGeocoder {
  readonly #cache = new Map<string, GeoCandidate>();

  private static str(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private static num(value: unknown): number {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && isFinite(n) ? n : 0;
  }

  /**
   * Parse the first element of an `unknown` Nominatim JSON array into a
   * `GeoCandidate`, or return `null` when unresolvable.
   * Nominatim returns an array; take index 0.
   */
  private static parseBody(body: unknown): GeoCandidate | null {
    if (!Array.isArray(body) || body.length === 0) return null;
    const item: unknown = body[0];
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;

    // item is narrowed to `object` — use Reflect.get for cast-free property access.
    const addressObj: unknown = Reflect.get(item, 'address');
    const addr: object | null =
      addressObj !== null && typeof addressObj === 'object' && !Array.isArray(addressObj)
        ? addressObj
        : null;

    const rawCountryCode = addr !== null
      ? LiveAddressGeocoder.str(Reflect.get(addr, 'country_code'))
      : '';
    if (rawCountryCode.length === 0) return null;

    const country = rawCountryCode.toUpperCase();
    const countryName = addr !== null
      ? LiveAddressGeocoder.str(Reflect.get(addr, 'country'))
      : '';
    const region = addr !== null
      ? (LiveAddressGeocoder.str(Reflect.get(addr, 'state')) ||
         LiveAddressGeocoder.str(Reflect.get(addr, 'region')))
      : '';
    const locality = addr !== null
      ? (LiveAddressGeocoder.str(Reflect.get(addr, 'city')) ||
         LiveAddressGeocoder.str(Reflect.get(addr, 'town')) ||
         LiveAddressGeocoder.str(Reflect.get(addr, 'village')))
      : '';

    return {
      'modality':    'address',
      'resolved':    true,
      'country':     country,
      'countryName': countryName,
      'continent':   '',
      'region':      region,
      'locality':    locality,
      'lat':         LiveAddressGeocoder.num(Reflect.get(item, 'lat')),
      'lng':         LiveAddressGeocoder.num(Reflect.get(item, 'lon')),
      'water':       false,
    };
  }

  async geocode(address: string, signal: AbortSignal): Promise<GeoLookupOutcomeType> {
    // An empty/whitespace address is a graceful no-answer — skip the network call.
    if (address.trim().length === 0) {
      return GeoLookupOutcome.resolved(LiveAddressGeocoder.unresolved());
    }

    const cached = this.#cache.get(address);
    if (cached !== undefined) return GeoLookupOutcome.resolved(cached);

    let candidate: GeoCandidate;
    try {
      const url = `${NOMINATIM_ENDPOINT}?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(address)}`;
      const res = await fetch(url, {
        'signal':  signal,
        'headers': { 'accept': 'application/json' },
      });
      if (!res.ok) {
        const candidateUnresolved = LiveAddressGeocoder.unresolved();
        this.#cache.set(address, candidateUnresolved);
        const error = GeoErrorRecord.capture(
          ERROR_SOURCE,
          new Error(`Nominatim responded ${String(res.status)} ${res.statusText}`),
          `address=${address}`,
        );
        return GeoLookupOutcome.failed(candidateUnresolved, error);
      }
      const rawBody: unknown = await res.json();
      candidate = LiveAddressGeocoder.parseBody(rawBody) ?? LiveAddressGeocoder.unresolved();
    } catch (caught) {
      const candidateUnresolved = LiveAddressGeocoder.unresolved();
      this.#cache.set(address, candidateUnresolved);
      const error = GeoErrorRecord.capture(ERROR_SOURCE, caught, `address=${address}`);
      return GeoLookupOutcome.failed(candidateUnresolved, error);
    }

    this.#cache.set(address, candidate);
    return GeoLookupOutcome.resolved(candidate);
  }

  private static unresolved(): GeoCandidate {
    return {
      'modality': 'address', 'resolved': false, 'country': '', 'countryName': '',
      'continent': '', 'region': '', 'locality': '', 'lat': 0, 'lng': 0, 'water': false,
    };
  }
}
// #endregion live-address-geocoder
