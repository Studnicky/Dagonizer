/**
 * CartographerServices: the dispatcher's services record (DI).
 *
 * Geo resolution runs through two swappable TRANSPORT adapters injected here:
 * `ipGeolocator` resolves a gateway IP address to a location, and
 * `addressGeocoder` forward-geocodes a postal address string to a location.
 * Swap the implementations (Live ↔ Recorded) without touching any node —
 * the engine's adapter-DI pattern.
 */

import type { IpGeolocator } from './contracts/IpGeolocator.ts';
import type { AddressGeocoder } from './contracts/AddressGeocoder.ts';

// #region cartographer-services
export interface CartographerServices {
  /** IP-modality transport (geolocate gateway IP → place). */
  readonly ipGeolocator: IpGeolocator;
  /** Address-modality transport (forward-geocode postal address → place). */
  readonly addressGeocoder: AddressGeocoder;
}
// #endregion cartographer-services
