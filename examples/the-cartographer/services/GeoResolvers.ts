/**
 * GeoResolvers: assembles the CartographerServices bag with the chosen geo
 * transport backend.
 *
 * GPS reverse-geocode is always the offline `OfflineReverseGeocoder` (backed
 * by `@rapideditor/country-coder`) — deterministic, no HTTP, no key, runs
 * identically in Node 18+ and the browser.
 *
 * IP geolocation uses `LiveIpGeolocator` (freeipapi.com, real HTTPS API) for
 * the online demo, or `RecordedIpGeolocator` (committed fixture replay) for
 * the deterministic offline smoke and `--recorded` CLI flag.
 *
 * The same node DAG runs against either backend; only the injected IP transport
 * differs (the engine's adapter-DI swap).
 */

import type { CartographerServices } from '../CartographerServices.ts';
import { OfflineReverseGeocoder } from './OfflineReverseGeocoder.ts';
import { LiveIpGeolocator } from './LiveIpGeolocator.ts';
import { RecordedIpGeolocator } from './RecordedIpGeolocator.ts';

// #region geo-resolvers
export class GeoResolvers {
  /** Live-IP services: offline country-coder reverse-geocode + live freeipapi IP geolocation. */
  static live(): CartographerServices {
    return {
      'reverseGeocoder': new OfflineReverseGeocoder(),
      'ipGeolocator':    new LiveIpGeolocator(),
    };
  }

  /** Recorded-IP services: offline country-coder reverse-geocode + fixture-replay IP geolocation.
   *  Deterministic and offline — used by the smoke and `--recorded` CLI flag. */
  static recorded(): CartographerServices {
    return {
      'reverseGeocoder': new OfflineReverseGeocoder(),
      'ipGeolocator':    new RecordedIpGeolocator(),
    };
  }
}
// #endregion geo-resolvers
