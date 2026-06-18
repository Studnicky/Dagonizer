/**
 * CartographerServices: the dispatcher's services bag (DI).
 *
 * Geo resolution is performed by real geo APIs reached through swappable
 * TRANSPORT adapters injected here. The geo
 * resolution DAG nodes (`reverse-geocode`, `ip-geolocate`) call these transports;
 * the `fuse-geo` node combines their candidates. Swap the implementations
 * (Live ↔ Recorded) without touching any node — the engine's adapter-DI pattern.
 */

import type { IpGeolocator } from './contracts/IpGeolocator.ts';
import type { ReverseGeocoder } from './contracts/ReverseGeocoder.ts';

// #region cartographer-services
export interface CartographerServices {
  /** GPS-modality transport (reverse-geocode coords → place). */
  readonly reverseGeocoder: ReverseGeocoder;
  /** IP-modality transport (geolocate gateway IP → place). */
  readonly ipGeolocator: IpGeolocator;
}
// #endregion cartographer-services
