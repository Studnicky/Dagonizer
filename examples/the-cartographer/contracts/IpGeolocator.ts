/**
 * IpGeolocator: the IP-modality TRANSPORT adapter contract.
 *
 * A thin transport: given a public IP address, return ONE modality's location
 * candidate. The `ip-geolocate` DAG node calls this; fusion happens in `fuse-geo`.
 * Swappable: `LiveIpGeolocator` (real freeipapi.com HTTPS) online,
 * `RecordedIpGeolocator` (committed fixture replay) for the deterministic smoke.
 *
 * Injected via the dispatcher services bag, reached at `context.services.ipGeolocator`.
 */

// #region ip-geolocator-contract
import type { GeoCandidate } from '../entities/GeoCandidate.ts';

export interface IpGeolocator {
  /**
   * Geolocate a public IP to a single IP-modality GeoCandidate. Resolves to
   * `{ resolved: false, … }` (never throws) when the backend has no answer.
   */
  lookup(ipAddress: string, signal: AbortSignal): Promise<GeoCandidate>;
}
// #endregion ip-geolocator-contract
