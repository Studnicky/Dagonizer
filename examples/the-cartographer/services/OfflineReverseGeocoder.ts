/**
 * OfflineReverseGeocoder: deterministic GPS-modality transport backed by the
 * offline `@rapideditor/country-coder` boundary dataset via OfflineGeo.
 *
 * Runs identically in Node 18+ and the browser — no HTTP, no key, no CORS.
 * The result is synchronous and deterministic, so this transport is used by
 * BOTH `GeoResolvers.live()` and `GeoResolvers.recorded()`.
 *
 * The `ReverseGeocoder` contract requires an async signature (implementations
 * may involve I/O); this implementation resolves immediately.
 */

import type { GeoCandidate } from '../entities/GeoCandidate.ts';
import type { ReverseGeocoder } from '../contracts/ReverseGeocoder.ts';
import { OfflineGeo } from './OfflineGeo.ts';

// #region offline-reverse-geocoder
export class OfflineReverseGeocoder implements ReverseGeocoder {
  async lookup(lat: number, lng: number, signal: AbortSignal): Promise<GeoCandidate> {
    if (signal.aborted) throw new Error('Aborted');
    return OfflineGeo.resolve(lat, lng);
  }
}
// #endregion offline-reverse-geocoder
