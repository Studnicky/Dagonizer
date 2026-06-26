/**
 * GeoResolvers: assembles the CartographerServices record with the chosen geo
 * transport backends.
 *
 * Two transports are injected:
 *   - `ipGeolocator`: resolves a gateway IP address to a location.
 *     Live: freeipapi.com (real HTTPS API). Recorded: committed fixture replay.
 *   - `addressGeocoder`: forward-geocodes a postal address string.
 *     Live: OpenStreetMap Nominatim (real HTTPS API). Recorded: deterministic
 *     unresolved (no committed address fixtures yet).
 *
 * The same node DAG runs against either backend; only the injected transports
 * differ (the engine's adapter-DI swap).
 */

import type { CartographerServices } from '../CartographerServices.ts';
import { LiveIpGeolocator } from './LiveIpGeolocator.ts';
import { RecordedIpGeolocator } from './RecordedIpGeolocator.ts';
import { LiveAddressGeocoder } from './LiveAddressGeocoder.ts';
import { RecordedAddressGeocoder } from './RecordedAddressGeocoder.ts';

// #region geo-resolvers
export class GeoResolvers {
  /** Live services: live freeipapi IP geolocation and Nominatim address geocoding. */
  static live(): CartographerServices {
    return {
      'ipGeolocator':    new LiveIpGeolocator(),
      'addressGeocoder': new LiveAddressGeocoder(),
    };
  }

  /** Recorded services: fixture-replay IP geolocation and deterministic address geocoding.
   *  Deterministic and offline — used by the smoke and `--recorded` CLI flag. */
  static recorded(): CartographerServices {
    return {
      'ipGeolocator':    new RecordedIpGeolocator(),
      'addressGeocoder': new RecordedAddressGeocoder(),
    };
  }
}
// #endregion geo-resolvers
