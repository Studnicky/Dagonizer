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

import { Coalesce } from '@studnicky/concurrency/coalesce';
import { LruCache } from '@studnicky/cache';
import { Guard } from '@studnicky/types';

import type { GeoCandidate } from '../entities/GeoCandidate.ts';
import type { AddressGeocoder } from '../contracts/AddressGeocoder.ts';
import { GeoErrorRecord } from '../errors/GeoErrorRecord.ts';
import { GeoLookupOutcome, type GeoLookupOutcomeType } from '../errors/GeoLookupOutcome.ts';

// #region live-address-geocoder
const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const ERROR_SOURCE = 'address-geocode';
const ADDRESS_CACHE_CAPACITY = 1_000;
const ADDRESS_CACHE_TTL_MS = 30 * 60 * 1_000;

export class LiveAddressGeocoder implements AddressGeocoder {
  static readonly #signalIds = new WeakMap<AbortSignal, string>();
  static #nextSignalId = 0;

  readonly #cache = LruCache.create<string, GeoCandidate>({
    'capacity': ADDRESS_CACHE_CAPACITY,
    'ttlMs':    ADDRESS_CACHE_TTL_MS,
  });
  readonly #lookups = Coalesce.create<GeoLookupOutcomeType>();

  private static num(value: unknown): number {
    const text = Guard.asString(value);
    const numeric = Guard.asNumber(value) ?? (text !== undefined ? Number(text) : undefined);
    return numeric !== undefined && Number.isFinite(numeric) ? numeric : 0;
  }

  /**
   * Parse the first element of an `unknown` Nominatim JSON array into a
   * `GeoCandidate`, or return `null` when unresolvable.
   * Nominatim returns an array; take index 0.
   */
  private static parseBody(body: unknown): GeoCandidate | null {
    if (!Array.isArray(body) || body.length === 0) return null;
    const item = Guard.asRecord(body[0]);
    if (item === undefined) return null;

    const addr = Guard.asRecord(item['address']);

    const rawCountryCode = addr !== undefined
      ? Guard.asString(addr?.['country_code']) ?? ''
      : '';
    if (rawCountryCode.length === 0) return null;

    const country = rawCountryCode.toUpperCase();
    const countryName = addr !== undefined
      ? Guard.asString(addr?.['country']) ?? ''
      : '';
    const region = addr !== undefined
      ? (Guard.asString(addr?.['state']) ??
         Guard.asString(addr?.['region']) ??
         '')
      : '';
    const locality = addr !== undefined
      ? (Guard.asString(addr?.['city']) ??
         Guard.asString(addr?.['town']) ??
         Guard.asString(addr?.['village']) ??
         '')
      : '';

    return {
      'modality':    'address',
      'resolved':    true,
      'country':     country,
      'countryName': countryName,
      'continent':   '',
      'region':      region,
      'locality':    locality,
      'lat':         LiveAddressGeocoder.num(item['lat']),
      'lng':         LiveAddressGeocoder.num(item['lon']),
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

    const key = `${LiveAddressGeocoder.signalKey(signal)}\u0000${address}`;
    return this.#lookups.run(key, () => this.#geocodeMiss(address, signal));
  }

  async #geocodeMiss(address: string, signal: AbortSignal): Promise<GeoLookupOutcomeType> {
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

  private static signalKey(signal: AbortSignal): string {
    const existing = LiveAddressGeocoder.#signalIds.get(signal);
    if (existing !== undefined) return existing;
    const next = `signal:${String(LiveAddressGeocoder.#nextSignalId)}`;
    LiveAddressGeocoder.#nextSignalId++;
    LiveAddressGeocoder.#signalIds.set(signal, next);
    return next;
  }

  private static unresolved(): GeoCandidate {
    return {
      'modality': 'address', 'resolved': false, 'country': '', 'countryName': '',
      'continent': '', 'region': '', 'locality': '', 'lat': 0, 'lng': 0, 'water': false,
    };
  }
}
// #endregion live-address-geocoder
