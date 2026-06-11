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
interface FixtureFile {
  readonly '_recorded': boolean;
  readonly 'ipGeolocate': Record<string, GeoCandidate>;
}

const FIXTURES = FIXTURES_RAW as FixtureFile;

export class GeoFixtures {
  static isLiveRecorded(): boolean {
    return FIXTURES._recorded === true;
  }

  static ipGeolocate(ipAddress: string): GeoCandidate | null {
    return FIXTURES.ipGeolocate[ipAddress] ?? null;
  }
}
// #endregion geo-fixtures
