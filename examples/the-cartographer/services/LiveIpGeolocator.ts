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

import { Coalesce } from '@studnicky/concurrency/coalesce';
import { LruCache } from '@studnicky/cache';
import { Guard } from '@studnicky/types';

import type { GeoCandidate } from '../entities/GeoCandidate.ts';
import type { IpGeolocator } from '../contracts/IpGeolocator.ts';
import { GeoErrorRecord } from '../errors/GeoErrorRecord.ts';
import { GeoLookupOutcome, type GeoLookupOutcomeType } from '../errors/GeoLookupOutcome.ts';

// #region live-ip-geolocator
const FREEIPAPI_ENDPOINT = 'https://freeipapi.com/api/json';
const ERROR_SOURCE = 'ip-geolocate';
const IP_CACHE_CAPACITY = 512;
const IP_CACHE_TTL_MS = 60 * 60 * 1_000;

export class LiveIpGeolocator implements IpGeolocator {
  static readonly #signalIds = new WeakMap<AbortSignal, string>();
  static #nextSignalId = 0;

  readonly #cache = LruCache.create<string, GeoCandidate>({
    'capacity': IP_CACHE_CAPACITY,
    'ttlMs':    IP_CACHE_TTL_MS,
  });
  readonly #lookups = Coalesce.create<GeoLookupOutcomeType>();

  private static num(value: unknown): number {
    return Guard.asNumber(value) ?? 0;
  }

  /** Parse an `unknown` API response body into a `GeoCandidate`, or return `null` when unresolvable. */
  private static parseBody(body: unknown): GeoCandidate | null {
    const record = Guard.asRecord(body);
    if (record === undefined) return null;
    const countryCode = Guard.asString(record['countryCode']) ?? '';
    if (countryCode.length === 0) return null;
    return {
      'modality':    'ip',
      'resolved':    true,
      'country':     countryCode,
      'countryName': Guard.asString(record['countryName']) ?? '',
      'continent':   Guard.asString(record['continent']) ?? '',
      'region':      Guard.asString(record['regionName']) ?? '',
      'locality':    Guard.asString(record['cityName']) ?? '',
      'lat':         LiveIpGeolocator.num(record['latitude']),
      'lng':         LiveIpGeolocator.num(record['longitude']),
      'water':       false,
    };
  }

  async lookup(ipAddress: string, signal: AbortSignal): Promise<GeoLookupOutcomeType> {
    const cached = this.#cache.get(ipAddress);
    if (cached !== undefined) return GeoLookupOutcome.resolved(cached);

    const key = `${LiveIpGeolocator.signalKey(signal)}\u0000${ipAddress}`;
    return this.#lookups.run(key, () => this.#lookupMiss(ipAddress, signal));
  }

  async #lookupMiss(ipAddress: string, signal: AbortSignal): Promise<GeoLookupOutcomeType> {
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
      const rawBody: unknown = await res.json();
      candidate = LiveIpGeolocator.parseBody(rawBody) ?? LiveIpGeolocator.unresolved();
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

  private static signalKey(signal: AbortSignal): string {
    const existing = LiveIpGeolocator.#signalIds.get(signal);
    if (existing !== undefined) return existing;
    const next = `signal:${String(LiveIpGeolocator.#nextSignalId)}`;
    LiveIpGeolocator.#nextSignalId++;
    LiveIpGeolocator.#signalIds.set(signal, next);
    return next;
  }

  private static unresolved(): GeoCandidate {
    return {
      'modality': 'ip', 'resolved': false, 'country': '', 'countryName': '',
      'continent': '', 'region': '', 'locality': '', 'lat': 0, 'lng': 0, 'water': false,
    };
  }
}
// #endregion live-ip-geolocator
