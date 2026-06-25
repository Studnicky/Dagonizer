/**
 * RecordedAddressGeocoder: deterministic address-modality transport that
 * replays committed fixture data. Used by the smoke and the CLI `--recorded`.
 *
 * The address branch is fully wired but not yet fixture-backed: there are no
 * committed address fixtures, so every lookup is a graceful no-answer (parity
 * with how an absent IP fixture in RecordedIpGeolocator resolves unresolved).
 * When address fixtures are added to GeoFixtures, this class can delegate to
 * them the same way RecordedIpGeolocator does for IPs.
 *
 * Never throws, never makes network requests.
 */

import type { AddressGeocoder } from '../contracts/AddressGeocoder.ts';
import { GeoLookupOutcome, type GeoLookupOutcomeType } from '../errors/GeoLookupOutcome.ts';

// #region recorded-address-geocoder
export class RecordedAddressGeocoder implements AddressGeocoder {
  async geocode(_address: string, _signal: AbortSignal): Promise<GeoLookupOutcomeType> {
    // No committed address fixtures yet — every lookup is a graceful no-answer.
    return GeoLookupOutcome.resolved({
      'modality': 'address', 'resolved': false, 'country': '', 'countryName': '',
      'continent': '', 'region': '', 'locality': '', 'lat': 0, 'lng': 0, 'water': false,
    });
  }
}
// #endregion recorded-address-geocoder
