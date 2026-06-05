/**
 * ReverseGeocoder: the GPS-modality TRANSPORT adapter contract.
 *
 * A thin transport: given WGS-84 coordinates, return ONE modality's location
 * candidate. The `reverse-geocode` DAG node calls this; it does NOT fuse or
 * decide jurisdiction — that is the `fuse-geo` node's job. The contract stays a
 * swappable adapter; the shipped implementation is `OfflineReverseGeocoder`
 * (the `@rapideditor/country-coder` boundary dataset — deterministic, offline,
 * no key/CORS, runs identically in Node 18+ and the browser), used by BOTH the
 * live and the recorded service bags.
 *
 * Implementations are injected via the dispatcher services bag and reached at
 * `context.services.reverseGeocoder`. `lookup` honours the abort signal.
 */

// #region reverse-geocoder-contract
import type { GeoCandidate } from '../entities/GeoCandidate.ts';

export interface ReverseGeocoder {
  /**
   * Reverse-geocode coordinates to a single GPS-modality GeoCandidate. Resolves
   * to `{ resolved: false, … }` (never throws) when the backend has no answer,
   * so the fuse node can degrade gracefully. Open water → `water: true` with
   * 'International Waters' in `locality`.
   */
  lookup(lat: number, lng: number, signal: AbortSignal): Promise<GeoCandidate>;
}
// #endregion reverse-geocoder-contract
