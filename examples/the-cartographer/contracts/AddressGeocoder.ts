/**
 * AddressGeocoder: the address-modality TRANSPORT adapter contract.
 *
 * A thin transport: given a free-text postal address, return ONE modality's
 * location candidate. `resolve-address` calls this for address-kind
 * descriptors; the `geo-weighted-fusion` gather folds the result by weight into
 * `ResolvedGeo`. Swappable: `LiveAddressGeocoder` (OpenStreetMap Nominatim) for
 * production, `RecordedAddressGeocoder` (deterministic no-answer) for the smoke.
 *
 * Injected via constructor DI into `ResolveAddressNode`.
 */

// #region address-geocoder-contract
import type { GeoLookupOutcomeType } from '../errors/GeoLookupOutcome.ts';

export interface AddressGeocoder {
  /**
   * Geocode a postal address string to a single address-modality outcome. The
   * outcome's `candidate` resolves to `{ resolved: false, … }` (never throws)
   * when the backend has no answer (empty address, fixture miss); the outcome's
   * `error` is set ONLY when a real exception was caught (HTTP / JSON failure)
   * — surfaced to the node as DATA, never swallowed.
   */
  geocode(address: string, signal: AbortSignal): Promise<GeoLookupOutcomeType>;
}
// #endregion address-geocoder-contract
