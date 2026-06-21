/**
 * GeoFixtures: loads the committed fixture of REAL IP-geolocation responses
 * (data/geo-fixtures.json) once at module load and exposes a typed accessor
 * for the RecordedIpGeolocator. Keyed by IP address.
 *
 * GPS reverse-geocode is now offline (country-coder) — no fixture entries
 * are needed or stored for that modality.
 *
 * `_recorded: true` means the fixture was captured from a live recording pass;
 * `false` marks a synthesised-but-realistic placeholder pending a live re-record.
 *
 * Uses a static JSON import (ESM + Vite compatible; no createRequire/node:module).
 */

import FIXTURES_RAW from '../data/geo-fixtures.json' with { type: 'json' };

import type { GeoCandidate } from '../entities/GeoCandidate.ts';

// #region geo-fixtures

/** Raw shape as inferred from the JSON import (modality is string, not the union). */
interface RawGeoCandidate {
  readonly 'modality': string;
  readonly 'resolved': boolean;
  readonly 'country': string;
  readonly 'countryName': string;
  readonly 'continent': string;
  readonly 'region': string;
  readonly 'locality': string;
  readonly 'lat': number;
  readonly 'lng': number;
  readonly 'water': boolean;
}
interface RawFixtureFile {
  readonly '_recorded': boolean;
  readonly 'ipGeolocate': Record<string, RawGeoCandidate>;
}

const FIXTURES_TYPED: RawFixtureFile = FIXTURES_RAW satisfies RawFixtureFile;

export class GeoFixtures {
  static isLiveRecorded(): boolean {
    return FIXTURES_TYPED._recorded === true;
  }

  static ipGeolocate(ipAddress: string): GeoCandidate | null {
    const raw = FIXTURES_TYPED.ipGeolocate[ipAddress];
    if (raw === undefined) return null;
    return {
      'modality':    raw.modality === 'gps' || raw.modality === 'ip' ? raw.modality : 'ip',
      'resolved':    raw.resolved,
      'country':     raw.country,
      'countryName': raw.countryName,
      'continent':   raw.continent,
      'region':      raw.region,
      'locality':    raw.locality,
      'lat':         raw.lat,
      'lng':         raw.lng,
      'water':       raw.water,
    };
  }
}
// #endregion geo-fixtures
